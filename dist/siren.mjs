// Synthesised electronic ambulance siren (Web Audio API).
// Like a real siren it sweeps a square-ish tone between ~650 and 1500 Hz through a
// horn speaker: a slow "wail" on the open road, switching to the fast "yelp" near
// the junction. It gets louder, brighter and drier as the ambulance comes closer,
// is Doppler-shifted while approaching or receding, echoes off the street, and is
// panned left/right with the ambulance. Browsers only allow audio after a click,
// so start() must follow one.

const LOW = 650, HIGH = 1500;
const WAIL_RATE = 1 / 4.6, YELP_RATE = 3.3;          // sweeps per second
const YELP_WITHIN = 50, WAIL_BEYOND = 62;             // metres from the junction (with hysteresis)
const SOUND_SPEED = 343, DOPPLER_BOOST = 1.6, FAR = 170;

export function createSiren() {
  let ctx = null, live = null, enabled = true, shapes = null, room = null, limiter = null;

  function context() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      ctx = new AudioContextClass();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A fast compressor in front of the speakers keeps the close pass loud without distorting.
  function output(c) {
    if (!limiter) {
      limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = .003;
      limiter.release.value = .25;
      limiter.connect(c.destination);
    }
    return limiter;
  }

  // Tone: odd harmonics (a square wave) softened the way a horn driver rolls them off.
  // Sweep: a rounded triangle, so the pitch rises and falls at a steady rate.
  function waves(c) {
    if (!shapes) {
      const tone = new Float32Array(24), lfo = new Float32Array(8);
      for (let k = 1; k < tone.length; k += 2) tone[k] = Math.pow(.7, (k - 1) / 2) / k;
      for (let k = 1; k < lfo.length; k += 2) lfo[k] = (k % 4 === 1 ? 1 : -1) / (k * k);
      shapes = {tone: c.createPeriodicWave(new Float32Array(24), tone), sweep: c.createPeriodicWave(new Float32Array(8), lfo)};
    }
    return shapes;
  }

  // Street reflections: a short burst of decaying noise used as a reverb impulse.
  function reverb(c) {
    if (!room) {
      const length = Math.floor(c.sampleRate * 1.8);
      room = c.createBuffer(2, length, c.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = room.getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
    }
    const convolver = c.createConvolver();
    convolver.buffer = room;
    return convolver;
  }

  function softClip() {
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(2.2 * (i / (curve.length - 1) * 2 - 1)) / Math.tanh(2.2);
    return curve;
  }

  // tone → speaker drive → horn (no bass, presence peak) → air absorption → dry + echo → output
  function voice(c) {
    const s = waves(c), tone = c.createOscillator(), sweep = c.createOscillator(), depth = c.createGain();
    const drive = c.createGain(), shaper = c.createWaveShaper(), highpass = c.createBiquadFilter(), horn = c.createBiquadFilter();
    const air = c.createBiquadFilter(), dry = c.createGain(), wet = c.createGain(), out = c.createGain();
    tone.setPeriodicWave(s.tone);
    tone.frequency.value = (LOW + HIGH) / 2;
    sweep.setPeriodicWave(s.sweep);
    sweep.frequency.value = WAIL_RATE;
    depth.gain.value = (HIGH - LOW) / 2;
    sweep.connect(depth).connect(tone.frequency);
    drive.gain.value = .8;
    shaper.curve = softClip();
    shaper.oversample = '2x';
    highpass.type = 'highpass';
    highpass.frequency.value = 420;
    horn.type = 'peaking';
    horn.frequency.value = 2000;
    horn.Q.value = .9;
    horn.gain.value = 5;
    air.type = 'lowpass';
    air.frequency.value = 9000;
    air.Q.value = .5;
    tone.connect(drive).connect(shaper).connect(highpass).connect(horn).connect(air);
    air.connect(dry).connect(out);
    air.connect(reverb(c)).connect(wet).connect(out);
    wet.gain.value = .15;
    out.gain.value = 0;
    return {tone, sweep, air, dry, wet, out, mode: 'wail'};
  }

  function start() {
    if (!enabled || live) return;
    const c = context();
    if (!c) return;
    const v = voice(c), pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) v.out.connect(pan).connect(output(c));
    else v.out.connect(output(c));
    v.tone.start();
    v.sweep.start();
    live = {...v, pan};
  }

  // distance: metres from the junction · closing: m/s towards it · pan: -1 (left) … 1 (right)
  function update({distance, closing, pan}) {
    if (!live) return;
    const now = ctx.currentTime, far = Math.min(1, distance / FAR);
    const mode = live.mode === 'wail' ? (distance < YELP_WITHIN ? 'yelp' : 'wail') : (distance > WAIL_BEYOND ? 'wail' : 'yelp');
    if (mode !== live.mode) {
      live.mode = mode;
      live.sweep.frequency.setValueAtTime(mode === 'yelp' ? YELP_RATE : WAIL_RATE, now);
    }
    const doppler = SOUND_SPEED / Math.max(250, SOUND_SPEED - closing * DOPPLER_BOOST);
    live.tone.detune.setTargetAtTime(1200 * Math.log2(doppler), now, .06);
    live.out.gain.setTargetAtTime(.32 * Math.min(1, 22 / (distance + 22)), now, .12);
    live.air.frequency.setTargetAtTime(9000 - 6000 * far, now, .2);
    live.dry.gain.setTargetAtTime(1 - .45 * far, now, .2);
    live.wet.gain.setTargetAtTime(.12 + .35 * far, now, .2);
    if (live.pan) live.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, .1);
  }

  function stop(fade = .6) {
    if (!live) return;
    const now = ctx.currentTime, {tone, sweep, out} = live;
    out.gain.cancelScheduledValues(now);
    out.gain.setTargetAtTime(0, now, fade / 4);
    tone.stop(now + fade);
    sweep.stop(now + fade);
    live = null;
  }

  // A distant siren bouncing off buildings: quiet, muffled, mostly echo, and not getting closer.
  function echo(seconds = 4) {
    if (!enabled) return;
    const c = context();
    if (!c) return;
    const v = voice(c), now = c.currentTime;
    v.out.connect(output(c));
    v.air.frequency.value = 1300;
    v.dry.gain.value = .3;
    v.wet.gain.value = .9;
    v.out.gain.setValueAtTime(0, now);
    v.out.gain.linearRampToValueAtTime(.07, now + .5);
    v.out.gain.setValueAtTime(.07, now + seconds - 1);
    v.out.gain.linearRampToValueAtTime(0, now + seconds);
    v.tone.start(now);
    v.sweep.start(now);
    v.tone.stop(now + seconds + .05);
    v.sweep.stop(now + seconds + .05);
  }

  return {
    start, update, stop, echo,
    get active() { return !!live; },
    get enabled() { return enabled; },
    setEnabled(value) { enabled = value; if (!value) stop(.2); },
    pause() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };
}
