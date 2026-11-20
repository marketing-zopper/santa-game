// Tiny Web Audio synth — identical tones to the original game. Starts after the first user gesture (browser rule).
export class SynthAudio {
  constructor() { this.ac = null; this.muted = false; }

  /** Create / resume the AudioContext. Call from a click or touch handler. */
  unlock() {
    if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; } }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }

  setMuted(m) { this.muted = !!m; }

  close() { try { this.ac && this.ac.close(); } catch (e) { /* ignore */ } this.ac = null; }

  tone(f, d, type, vol, slide, delay) {
    const ac = this.ac;
    if (this.muted || !ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + d);
    g.gain.setValueAtTime(vol || 0.15, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.02);
  }

  noise(d, vol) {
    const ac = this.ac;
    if (this.muted || !ac) return;
    const len = ac.sampleRate * d, buf = ac.createBuffer(1, len, ac.sampleRate), ch0 = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch0[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const s = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol; s.buffer = buf; s.connect(g).connect(ac.destination); s.start();
  }

  catch(lvl) { const f = 660 + Math.min(lvl, 10) * 40; this.tone(f, 0.12, 'triangle', 0.14); this.tone(f * 1.5, 0.12, 'sine', 0.08, 0, 0.05); }
  gold() { [880, 1108, 1320, 1760].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.12, 0, i * 0.05)); }
  miss() { this.noise(0.25, 0.35); this.tone(220, 0.25, 'square', 0.06, 90); }
  coal() { this.tone(140, 0.3, 'sawtooth', 0.12, 60); this.noise(0.15, 0.2); }
  shield() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.13, 0, i * 0.07)); }
  tier() { [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.13, 0, i * 0.09)); }
  over() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.12, 0, i * 0.16)); }
  count(hi) { this.tone(hi ? 1046 : 523, 0.15, 'square', 0.07); }
}
