// Sound, synthesized: no audio files, only WebAudio oscillators and filtered noise.
// Every effect is a short function; the game calls them, never the AudioContext.
// M mutes. The context is created on the first user gesture (pointer lock), so the
// page never complains about autoplay.
export function createSound() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
      return true;
    } catch (error) {
      return false;
    }
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.1, frequency = 1200, type = 'lowpass', gain = 0.5, when = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  function tone({ frequency = 440, end = null, duration = 0.1, type = 'sine', gain = 0.3, when = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (end !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(weaponId) {
      if (weaponId === 'marksman') {
        burst({ duration: 0.22, frequency: 900, gain: 0.7 });
        tone({ frequency: 160, end: 60, duration: 0.18, type: 'square', gain: 0.25 });
      } else if (weaponId === 'pistol') {
        burst({ duration: 0.07, frequency: 2400, gain: 0.4 });
      } else {
        burst({ duration: 0.09, frequency: 1500, gain: 0.5 });
      }
    },
    distantShot() {
      burst({ duration: 0.08, frequency: 800, gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.12 });
      tone({ frequency: 600, duration: 0.04, type: 'square', gain: 0.12, when: 0.25 });
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.1 });
    },
    hit() {
      tone({ frequency: 1250, duration: 0.05, type: 'sine', gain: 0.25 });
    },
    kill() {
      tone({ frequency: 660, duration: 0.07, type: 'sine', gain: 0.3 });
      tone({ frequency: 990, duration: 0.09, type: 'sine', gain: 0.3, when: 0.07 });
    },
    hurt() {
      tone({ frequency: 220, end: 110, duration: 0.15, type: 'sawtooth', gain: 0.2 });
    },
    grenadeThrow() {
      burst({ duration: 0.12, frequency: 500, gain: 0.2 });
    },
    explosion() {
      burst({ duration: 0.7, frequency: 400, gain: 0.9 });
      tone({ frequency: 120, end: 28, duration: 0.6, type: 'sine', gain: 0.6 });
    },
    plantBeep() {
      tone({ frequency: 880, duration: 0.06, type: 'square', gain: 0.2 });
    },
    bombBeep() {
      tone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.18 });
    },
    buy() {
      tone({ frequency: 1320, duration: 0.05, type: 'sine', gain: 0.2 });
      tone({ frequency: 1760, duration: 0.06, type: 'sine', gain: 0.2, when: 0.05 });
    },
    roundStart() {
      tone({ frequency: 440, duration: 0.1, type: 'square', gain: 0.2 });
      tone({ frequency: 660, duration: 0.12, type: 'square', gain: 0.2, when: 0.1 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.14, type: 'sine', gain: 0.25, when: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.16, type: 'sine', gain: 0.22, when: i * 0.12 }));
    },
  };
}
