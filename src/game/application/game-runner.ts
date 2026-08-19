// ─────────────────────────────────────────────────────────────────────────
// Application layer: GameRunner.
// The single place that wires the ports together and OWNS the main loop.
//
// Event-loop pedagogy made explicit, frame by frame:
//
//   TASK (rAF) ──► read input ──► WASM step() ──► build DOM HUD snapshot
//                                            │
//                          [current task unwinds] ──► MICROTASK CHECKPOINT
//                                            │  (queuedMicrotask renders the
//                                            │   canvas, calls listeners)
//   next rAF TASK ◄── re-arm from either a promise microtask continuation
//
// Between frames we deliberately show the three concurrency mechanisms:
//   • TASK   : the rAF callback itself; setTimeout()-based chunked "busy"
//              work used by the demo buttons.
//   • MICROTASK: Promise.then / queueMicrotask continuations that decouple
//              rendering from the update computation.
//   • EVENT LOOP: yielding via scheduler.yield()/setTimeout(0) between
//              chunks so late-arriving input can interrupt long work.
// ─────────────────────────────────────────────────────────────────────────
import type {
  GameEnginePort,
  RendererPort,
  AudioPort,
  MetricsPort,
} from '../domain/types';
import type { GamePhase } from '../domain/types';
import type { KeyboardInput } from '../infrastructure/input';
import { EventLoopScheduler } from '../infrastructure/event-loop-scheduler';

export interface GameCallbacks {
  onHud(snapshot: { score: number; lives: number; wave: number; gameOver: boolean }): void;
  onPhase(phase: GamePhase): void;
}

export class GameRunner {
  private phase: GamePhase = 'loading';
  private booted = false;
  private lastRender = 0;
  private rafId = 0;
  private running = false;
  private disposed = false;
  private inputUnbind: (() => void) | null = null;

  constructor(
    private readonly engine: GameEnginePort,
    private readonly renderer: RendererPort,
    private readonly audio: AudioPort,
    private readonly input: KeyboardInput,
    private readonly scheduler: EventLoopScheduler,
    private readonly metrics: MetricsPort,
    private readonly callbacks: GameCallbacks,
  ) {}

  getScheduler(): EventLoopScheduler {
    return this.scheduler;
  }

  async start(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.setPhase('loading');
    this.metrics.enable();
    this.scheduler.startObservers();
    this.scheduler.attachMetrics(this.metrics);

    await this.audio.init();
    await this.engine.init();
    this.engine.reset();

    this.inputUnbind = this.input.bind(
      () => this.audio.shoot(),
      () => this.restart(),
    );

    this.running = true;
    this.lastRender = performance.now();
    this.rafId = requestAnimationFrame(this.frameTask);
    this.setPhase('running');
  }

  // ── the frame TASK ─────────────────────────────────────────────────────
  private frameTask = (timestamp: number): void => {
    if (!this.running) return;
    const dt = Math.min(50, timestamp - this.lastRender);
    this.lastRender = timestamp;

    const t0 = performance.now();
    const intent = this.input.sample();
    const snapshot = this.engine.step(dt, intent);
    void t0;

    // Schedule the DRAW as a MICROTASK continuation after this task, so the
    // update can finish computing with zero scheduling latency and each paint
    // is decoupled from the computation — the classic microtask use-case.
    this.scheduler.enqueueMicrotask(() => {
      this.renderer.draw(snapshot);
      this.emitHud(snapshot);
    });

    this.scheduler.recordFrame(performance.now() - t0);
    if (snapshot.gameOver && this.phase !== 'game-over') {
      this.audio.gameOver();
      this.setPhase('game-over');
    }

    this.rafId = requestAnimationFrame(this.frameTask);
  };

  private emitHud(
    snapshot: Awaited<ReturnType<GameEnginePort['step']>>,
  ): void {
    this.callbacks.onHud({
      score: snapshot.score,
      lives: snapshot.lives,
      wave: snapshot.wave,
      gameOver: snapshot.gameOver,
    });
  }

  // ── public controls ────────────────────────────────────────────────────
  pause(): void {
    if (this.phase === 'running') {
      this.running = false;
      cancelAnimationFrame(this.rafId);
      this.setPhase('paused');
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.input.releaseAll();
      this.running = true;
      this.lastRender = performance.now();
      this.rafId = requestAnimationFrame(this.frameTask);
      this.setPhase('running');
    }
  }

  restart(): void {
    this.engine.reset();
    this.audio.waveStart();
    this.running = true;
    cancelAnimationFrame(this.rafId);
    this.lastRender = performance.now();
    this.rafId = requestAnimationFrame(this.frameTask);
    this.setPhase('running');
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.inputUnbind?.();
    this.inputUnbind = null;
    this.scheduler.dispose();
    this.renderer.dispose();
  }

  setPhase(phase: GamePhase): void {
    if (this.disposed) return;
    this.phase = phase;
    this.callbacks.onPhase(phase);
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  isRunning(): boolean {
    return this.phase === 'running';
  }
}