import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlarmPlayer} from '../dist/alarm-audio.js';

// Model a browser that suspends Web Audio until an operator interacts with the page.
function browserAudio() {
  const instances = [], tones = [];
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 5; instances.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() {
      return {frequency: {}, connect() {}, disconnect() {}, start(at) {tones.push(at);}, stop() {}};
    }
    createGain() {
      return {connect() {}, disconnect() {}, gain: {setValueAtTime() {}, exponentialRampToValueAtTime() {}}};
    }
  }
  return {instances, tones, Context};
}

test('alarms while locked do not queue tones on resume; the next playback emits a single pattern', async () => {
  const {instances, tones, Context} = browserAudio();
  const player = createAlarmPlayer(() => {}, Context);
  for (let i = 0; i < 5; i++) assert.equal(player.play(), false);
  assert.equal(await player.unlock(), true);
  assert.equal(tones.length, 0);
  assert.equal(player.play(), true);
  assert.equal(tones.length, 3);
  assert.equal(instances.length, 1);
});

test('an interrupted context can be resumed and a closed context is replaced', async () => {
  const {instances, Context} = browserAudio();
  const player = createAlarmPlayer(() => {}, Context);
  await player.unlock();
  instances[0].state = 'interrupted';
  assert.equal(player.play(), false);
  assert.equal(await player.unlock(), true);
  instances[0].state = 'closed';
  assert.equal(await player.unlock(), true);
  assert.equal(instances.length, 2);
  assert.equal(player.play(), true);
});

test('a rejected resume reports the lock and a later click can retry', async () => {
  const {Context} = browserAudio();
  let attempts = 0;
  class BlockedOnce extends Context {
    resume() { return attempts++ ? super.resume() : Promise.reject(new Error('NotAllowedError')); }
  }
  const player = createAlarmPlayer(() => {}, BlockedOnce);
  assert.equal(await player.unlock(), false);
  assert.equal(player.state, 'locked');
  assert.equal(await player.unlock(), true);
  assert.equal(player.state, 'ready');
});
