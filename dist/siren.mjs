// Synthesised ambulance siren (Web Audio API): a rising and falling "wail",
// louder as the ambulance nears the listener, Doppler-shifted while it
// approaches or recedes, and panned left/right with its screen position.
// Browsers only allow audio after a click, so start() must follow one.

const WAIL_LOW = 700, WAIL_HIGH = 1450, WAIL_PERIOD = 2.4, SOUND_SPEED = 343, DOPPLER_BOOST = 2.5;

export function createSiren() {
  let ctx = null, live = null, enabled = true;

  function context() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      ctx = new AudioContextClass();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Two slightly detuned oscillators through a low-pass filter sound like a horn speaker.
  function voice(c, cutoff) {
    const main = c.createOscillator(), body = c.createOscillator(), bodyGain = c.createGain();
    const filter = c.createBiquadFilter(), gain = c.createGain();
    main.type = 'sawtooth';
    body.type = 'square';
    bodyGain.gain.value = 0.22;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.8;
    gain.gain.value = 0;
    main.connect(filter);
    body.connect(bodyGain).connect(filter);
    filter.connect(gain);
    return {main, body, gain};
  }

  const wail = t => WAIL_LOW + (WAIL_HIGH - WAIL_LOW) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / WAIL_PERIOD));

  function start() {
    if (!enabled || live) return;
    const c = context();
    if (!c) return;
    const v = voice(c, 2800), pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) v.gain.connect(pan).connect(c.destination);
    else v.gain.connect(c.destination);
    v.main.start();
    v.body.start();
    live = {...v, pan, startedAt: c.currentTime};
  }

  // distance: metres from the listener · closing: m/s towards the listener · pan: -1 (left) … 1 (right)
  function update({distance, closing, pan}) {
    if (!live) return;
    const now = ctx.currentTime;
    const pitch = wail(now - live.startedAt) * SOUND_SPEED / Math.max(200, SOUND_SPEED - closing * DOPPLER_BOOST);
    live.main.frequency.setTargetAtTime(pitch, now, 0.015);
    live.body.frequency.setTargetAtTime(pitch * 1.006, now, 0.015);
    const loudness = Math.pow(Math.min(1, Math.max(0.06, 1 - distance / 170)), 1.6);
    live.gain.gain.setTargetAtTime(0.3 * loudness, now, 0.12);
    if (live.pan) live.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.1);
  }

  function stop(fade = 0.5) {
    if (!live) return;
    const now = ctx.currentTime, {main, body, gain} = live;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, fade / 4);
    main.stop(now + fade);
    body.stop(now + fade);
    live = null;
  }

  // A distant siren bouncing off buildings: muffled, quiet, with echoes, and not getting closer.
  function echo(seconds = 3.6) {
    if (!enabled) return;
    const c = context();
    if (!c) return;
    const v = voice(c, 950), delay = c.createDelay(1), feedback = c.createGain(), now = c.currentTime;
    delay.delayTime.value = 0.16;
    feedback.gain.value = 0.42;
    v.gain.connect(c.destination);
    v.gain.connect(delay).connect(feedback).connect(delay);
    feedback.connect(c.destination);
    const curve = new Float32Array(64).map((_, i) => wail(i / 63 * seconds) * 0.97);
    v.main.frequency.setValueCurveAtTime(curve, now, seconds);
    v.body.frequency.setValueCurveAtTime(curve.map(f => f * 1.006), now, seconds);
    v.gain.gain.setValueAtTime(0, now);
    v.gain.gain.linearRampToValueAtTime(0.07, now + 0.4);
    v.gain.gain.setValueAtTime(0.07, now + seconds - 0.8);
    v.gain.gain.linearRampToValueAtTime(0, now + seconds);
    v.main.start(now);
    v.body.start(now);
    v.main.stop(now + seconds + 0.05);
    v.body.stop(now + seconds + 0.05);
  }

  return {
    start, update, stop, echo,
    get active() { return !!live; },
    get enabled() { return enabled; },
    setEnabled(value) { enabled = value; if (!value) stop(0.2); },
    pause() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };
}
