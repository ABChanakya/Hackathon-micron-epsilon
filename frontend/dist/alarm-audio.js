// Use one audio context per cockpit tab. Only a user gesture should wait for resume();
// otherwise a browser can queue many suspended alarms and play them all at once.
export function createAlarmPlayer(onStateChange, AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext) {
  let context, state = 'locked', unlocking;
  function setState(next) {
    if (state === next) return;
    state = next;
    onStateChange(next);
  }

  function getContext() {
    if (!context || context.state === 'closed') {
      context = new AudioContext();
      context.onstatechange = () => setState(context.state === 'running' ? 'ready' : 'locked');
    }
    return context;
  }

  function unlock() {
    if (unlocking) return unlocking;
    let timer;
    try {
      const audio = getContext();
      if (audio.state === 'running') {
        setState('ready');
        return Promise.resolve(true);
      }
      const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); });
      // Call resume synchronously inside the click/key handler, including on Safari after interruption.
      unlocking = Promise.race([audio.resume().then(() => audio.state === 'running'), deadline])
        .catch(() => false)
        .then(ready => { setState(ready ? 'ready' : 'locked'); return ready; })
        .finally(() => { clearTimeout(timer); unlocking = undefined; });
      return unlocking;
    } catch {
      clearTimeout(timer);
      setState(AudioContext ? 'locked' : 'unavailable');
      return Promise.resolve(false);
    }
  }

  function play() {
    try {
      const audio = getContext();
      if (audio.state !== 'running') {
        setState('locked');
        return false;
      }
      const now = audio.currentTime;
      for (const [index, hz] of [920, 920, 760].entries()) {
        const start = now + .015 + index * .19;
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = hz;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(.2, start + .012);
        gain.gain.setValueAtTime(.2, start + .105);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .125);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + .13);
      }
      setState('ready');
      return true;
    } catch {
      setState('unavailable');
      return false;
    }
  }

  return {unlock, play, get state() { return state; }};
}
