// Everything audible is synthesised at runtime with WebAudio: filtered noise for shots and
// impacts, oscillators for clicks, beeps and stingers. No files, no network.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;

  function ensure() {
    if (ctx) return ctx;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.24;
    master.connect(compressor).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function now() {
    return ctx.currentTime;
  }

  function envelope(gain, start, attack, hold, release, volume) {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.setValueAtTime(volume, start + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
  }

  function burst({ duration = 0.08, volume = 0.5, type = 'lowpass', from = 2200, to = 400, q = 0.8, delay = 0 }) {
    if (!ensure()) return;
    const start = now() + delay;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + duration);
    const gain = ctx.createGain();
    envelope(gain, start, 0.004, duration * 0.2, duration * 0.8, volume);
    source.connect(filter).connect(gain).connect(master);
    source.start(start, Math.random() * 0.6);
    source.stop(start + duration + 0.03);
  }

  function tone({ frequency = 440, end = frequency, duration = 0.08, volume = 0.2, type = 'sine', delay = 0 }) {
    if (!ensure()) return;
    const start = now() + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (end !== frequency) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
    envelope(gain, start, 0.006, duration * 0.15, duration * 0.85, volume);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function shot(weaponId, distance = 0) {
    const attenuation = Math.max(0.08, 1 / (1 + distance * 0.085));
    if (weaponId === 'sniper') {
      burst({ duration: 0.34, volume: 0.95 * attenuation, from: 5200, to: 160, q: 0.7 });
      burst({ duration: 0.5, volume: 0.35 * attenuation, from: 900, to: 80, q: 0.5, delay: 0.02 });
      tone({ frequency: 110, end: 42, duration: 0.32, volume: 0.4 * attenuation, type: 'sine' });
    } else if (weaponId === 'rifle') {
      burst({ duration: 0.15, volume: 0.8 * attenuation, from: 3600, to: 280, q: 0.8 });
      tone({ frequency: 150, end: 58, duration: 0.14, volume: 0.34 * attenuation, type: 'triangle' });
    } else if (weaponId === 'smg') {
      burst({ duration: 0.085, volume: 0.62 * attenuation, from: 4200, to: 620, q: 0.9 });
      tone({ frequency: 210, end: 95, duration: 0.075, volume: 0.2 * attenuation, type: 'square' });
    } else {
      burst({ duration: 0.1, volume: 0.68 * attenuation, from: 3000, to: 420, q: 0.8 });
      tone({ frequency: 190, end: 82, duration: 0.09, volume: 0.24 * attenuation, type: 'triangle' });
    }
  }

  return {
    resume() {
      const context = ensure();
      if (context && context.state === 'suspended') context.resume();
    },
    shot,
    shotAt(weaponId, from, to) {
      shot(weaponId, from.distanceTo(to));
    },
    reload() {
      tone({ frequency: 420, end: 240, duration: 0.05, volume: 0.14, type: 'square' });
      burst({ duration: 0.045, volume: 0.18, from: 2200, to: 700, delay: 0.12 });
      tone({ frequency: 300, end: 500, duration: 0.045, volume: 0.12, type: 'square', delay: 0.3 });
    },
    empty() {
      tone({ frequency: 900, end: 620, duration: 0.035, volume: 0.1, type: 'square' });
    },
    hit(headshot) {
      if (headshot) {
        tone({ frequency: 1500, end: 1180, duration: 0.07, volume: 0.22, type: 'triangle' });
        tone({ frequency: 2200, duration: 0.04, volume: 0.09, type: 'sine' });
      } else {
        tone({ frequency: 780, end: 560, duration: 0.045, volume: 0.14, type: 'square' });
      }
    },
    kill() {
      tone({ frequency: 190, end: 110, duration: 0.14, volume: 0.2, type: 'triangle' });
      burst({ duration: 0.09, volume: 0.22, from: 900, to: 200 });
    },
    footstep(distance = 0) {
      const attenuation = Math.max(0.04, 1 / (1 + distance * 0.12));
      burst({ duration: 0.07, volume: 0.12 * attenuation, from: 700, to: 120, q: 0.6 });
    },
    beep(urgent = false) {
      tone({ frequency: urgent ? 1480 : 1080, duration: 0.055, volume: urgent ? 0.16 : 0.1, type: 'sine' });
    },
    plantTick() {
      tone({ frequency: 540, end: 700, duration: 0.045, volume: 0.09, type: 'square' });
    },
    defuseTick() {
      tone({ frequency: 760, end: 980, duration: 0.045, volume: 0.09, type: 'square' });
    },
    explosion() {
      burst({ duration: 1.1, volume: 1, from: 2600, to: 60, q: 0.4 });
      burst({ duration: 1.8, volume: 0.55, from: 800, to: 32, q: 0.3, delay: 0.04 });
      tone({ frequency: 84, end: 26, duration: 1.4, volume: 0.55, type: 'sine' });
    },
    roundStart() {
      tone({ frequency: 660, duration: 0.1, volume: 0.12, type: 'triangle' });
      tone({ frequency: 990, duration: 0.16, volume: 0.12, type: 'triangle', delay: 0.11 });
    },
    win() {
      [523, 659, 784, 1046].forEach((frequency, i) => tone({ frequency, duration: 0.22, volume: 0.15, type: 'triangle', delay: i * 0.1 }));
    },
    lose() {
      [392, 349, 294, 220].forEach((frequency, i) => tone({ frequency, duration: 0.28, volume: 0.15, type: 'sine', delay: i * 0.12 }));
    },
    buy() {
      tone({ frequency: 880, end: 1180, duration: 0.06, volume: 0.1, type: 'square' });
    },
    deny() {
      tone({ frequency: 180, end: 140, duration: 0.12, volume: 0.14, type: 'square' });
    },
    ui() {
      tone({ frequency: 620, duration: 0.035, volume: 0.06, type: 'sine' });
    },
  };
}
