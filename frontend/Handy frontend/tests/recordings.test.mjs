import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEMO_RECORDINGS, RECORDINGS, Playback, chartData, describeError, loadRecording, recordingWindow, sampleAt } from '../recordings.mjs';

const getOriginal = async (url) => new Response(await readFile(new URL('../recordings/' + url.pathname.split('/').at(-1), import.meta.url)));
const [plastic, paper] = await Promise.all(RECORDINGS.map((source) => loadRecording(source, getOriginal)));

test('the original metadata identifies both materials and the same ILD1900 in mm', () => {
  assert.equal(plastic.material, 'Weißer Kunststoff');
  assert.equal(paper.material, 'Schwarz-weißes Papier');
  assert.equal(plastic.model, 'ILD1900');
  assert.equal(paper.model, plastic.model);
  assert.equal(paper.serial, plastic.serial);
  assert.equal(paper.unit, 'mm');
  assert.equal(plastic.unit, paper.unit);
  assert.equal(plastic.samples[0].value, 24.37439);
  assert.equal(paper.samples[0].value, 25.643005);
  assert.equal(plastic.invalidCount, 0);
  assert.equal(paper.invalidCount, 2316);
});

test('the real paper error splits the chart and replaces the current value with a gap', () => {
  const { segments, gaps } = chartData(paper, 280);
  assert.equal(gaps.length, 1);
  const [gap] = gaps;
  assert.ok(gap.start > 1.23 && gap.start < 1.24);
  assert.ok(gap.end > 1.81 && gap.end < 1.82);
  assert.equal(segments.length, 2);
  assert.ok(segments[0].at(-1).time < gap.start);
  assert.ok(segments[1][0].time >= gap.end);
  const invalid = sampleAt(paper.samples, (gap.start + gap.end) / 2);
  assert.equal(invalid.value, null);
  assert.equal(describeError(invalid.code), 'Kein Messsignal erkannt');
  assert.ok(sampleAt(paper.samples, gap.end).value > 20);

  const plasticChart = chartData(plastic, 280);
  assert.equal(plasticChart.segments.length, 1);
  assert.equal(plasticChart.gaps.length, 0);
});

test('plastic continues while paper is invalid and while viewing either channel', () => {
  const plasticPlayback = new Playback(plastic);
  const paperPlayback = new Playback(paper);
  plasticPlayback.start(0);
  paperPlayback.start(0);
  const initial = plasticPlayback.frame(1);
  const paperError = paperPlayback.frame(1.4);
  const again = plasticPlayback.frame(1.6);
  assert.equal(paperError.sample.value, null);
  assert.ok(paperError.playing);
  assert.ok(again.sample.value > 20 && again.playing);
  assert.ok(again.time > initial.time);
  assert.ok(paperPlayback.frame(2).sample.value > 20);
});

test('pause, resume, restart, speed and loop keep their positions on original data', () => {
  const playback = new Playback(paper);
  playback.start(10);
  playback.pause(11.5);
  assert.equal(playback.frame(20).time, 1.5);
  assert.equal(playback.frame(20).sample.value, null);
  assert.equal(playback.frame(20).playing, false);

  playback.start(20);
  playback.configure({ speed: .25, loop: false }, 20.5);
  assert.equal(playback.frame(21.5).time, 2.25);
  assert.equal(playback.frame(100).playing, false);
  assert.equal(playback.frame(100).ended, true);
  playback.start(100);
  assert.equal(playback.frame(100).time, 0);
  playback.configure({ speed: 1, loop: true }, 101);
  assert.ok(Math.abs(playback.frame(101 + paper.duration).time - .25) < 1e-8);
  playback.restart(120);
  assert.equal(playback.frame(120).sample, paper.samples[0]);
});

test('one HTTP failure leaves the other original recording playable', async () => {
  for (const suffix of ['csv', 'json']) {
    const request = (url) => url.pathname.endsWith('203320.' + suffix)
      ? new Response(null, { status: 404 })
      : getOriginal(url);
    const [healthy, missing] = await Promise.allSettled(RECORDINGS.map((source) => loadRecording(source, request)));
    assert.equal(healthy.status, 'fulfilled');
    assert.equal(missing.status, 'rejected');
    assert.equal(missing.reason.message, 'Datei fehlt: rec_20261127_203320.' + suffix + '.');
    const playback = new Playback(healthy.value);
    playback.start(0);
    assert.ok(playback.frame(2).sample.value > 20);
  }
});

test('an unreadable response is attributed to the original paper metadata file', async () => {
  const request = async (url) => {
    const response = await getOriginal(url);
    if (!url.pathname.endsWith('203320.json')) return response;
    await response.text();
    return response;
  };
  await assert.rejects(loadRecording(RECORDINGS[1], request), /rec_20261127_203320\.json konnte nicht gelesen werden/);
});


test('all 12 versioned demo files match their model, material and averaging metadata', async () => {
  assert.equal(DEMO_RECORDINGS.length, 12);
  for (const source of DEMO_RECORDINGS) {
    const recording = await loadRecording(source, getOriginal);
    const metadata = JSON.parse(await readFile(new URL('../recordings/' + source.file + '.json', import.meta.url)));
    assert.equal(metadata.file, source.file + '.csv');
    assert.equal(recording.material, source.fallbackName);
    assert.equal(recording.model, 'ILD1900');
    assert.equal(recording.unit, 'mm');
    assert.equal(source.averaging, metadata.settings.averaging.mode === 'MEDIAN' ? 'Median 9' : 'Ohne Mittelung');
  }
});

test('the chart only exposes points and gaps up to the playback time', () => {
  const start = recordingWindow(paper, 0, 10);
  assert.deepEqual(start.samples, [paper.samples[0]]);
  assert.equal(chartData(start, 280).gaps.length, 0);

  const beforeError = recordingWindow(paper, 1, 10);
  assert.ok(beforeError.samples.at(-1).time <= 1);
  assert.equal(chartData(beforeError, 280).gaps.length, 0);

  const duringError = recordingWindow(paper, 1.5, 10);
  assert.equal(duringError.samples.at(-1).value, null);
  assert.equal(chartData(duringError, 280).gaps[0].end, 1.5);

  const narrow = recordingWindow(paper, 2.5, 1);
  assert.equal(narrow.start, 1.5);
  assert.equal(narrow.duration, 1);
  assert.ok(narrow.samples.every(({ time }) => time >= 1.5 && time <= 2.5));
});
