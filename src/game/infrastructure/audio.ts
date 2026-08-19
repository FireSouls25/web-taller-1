// ─────────────────────────────────────────────────────────────────────────
// Infrastructure: WebAudio synthesised retro SFX.
// No external audio files: every sound is produced with an oscillators +
// envelope helper so the repo stays self-contained (assets "self-found").
// AudioContext resumes on first user interaction (autoplay policy).
// ─────────────────────────────────────────────────────────────────────────
import type { AudioPort } from '../domain/types';

export class SynthAudio implements AudioPort {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  async init(): Promise<void> {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
    // Do NOT await resume() here: it only resolves after a user gesture
    // (autoplay policy), which would hang the whole game boot. We resume
    // lazily inside the first real sound playback instead.
  }

  /** Call from a user-gesture handler to unlock audio early if needed. */
  unlock(): void {
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private ensureRunning(): void {
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  shoot(): void {
    this.ensureRunning();
    this.tone(880, 160, 'square', 0.07, -24);
  }

  invaderHit(): void {
    this.ensureRunning();
    this.tone(220, 880, 'triangle', 0.08, -12);
  }

  playerHit(): void {
    this.ensureRunning();
    this.noiseBurst(0.25, -6);
    this.tone(160, 40, 'sawtooth', 0.25, -4);
  }

  ufoSpawned(): void {
    this.ensureRunning();
    this.sweep(300, 900, 0.5, 'sine', -16);
  }

  ufoHit(): void {
    this.ensureRunning();
    this.noiseBurst(0.15, -8);
    this.tone(880, 330, 'square', 0.18, -14);
  }

  waveStart(): void {
    this.ensureRunning();
    this.sweep(140, 520, 0.6, 'triangle', -14);
  }

  gameOver(): void {
    this.ensureRunning();
    this.sweep(440, 70, 1.1, 'sawtooth', -2);
  }

  private tone(
    from: number,
    to: number,
    type: OscillatorType,
    duration: number,
    gainDb: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const peak = Math.min(0.25, Math.pow(10, gainDb / 20));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    gainDb: number,
  ): void {
    this.tone(from, to, type, duration, gainDb);
  }

  private noiseBurst(duration: number, gainDb: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(0.3, Math.pow(10, gainDb / 20));
    src.connect(gain).connect(this.master);
    src.start(t);
  }
}