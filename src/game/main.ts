// ─────────────────────────────────────────────────────────────────────────
// Composition root (clean architecture "wiring").
// Instantiates domain ports, the application runner and the presentation HUD,
// then hands the HUD a view-model so the UI never touches game internals.
// This module is imported only by the client <script> of index.astro.
// ─────────────────────────────────────────────────────────────────────────
import { WasmGameEngine } from './infrastructure/wasm-engine';
import { CanvasRenderer } from './infrastructure/renderer';
import { SynthAudio } from './infrastructure/audio';
import { KeyboardInput } from './infrastructure/input';
import { EventLoopScheduler } from './infrastructure/event-loop-scheduler';
import { InpMetrics } from './infrastructure/inp-metrics';
import { GameRunner } from './application/game-runner';
import { Hud, type HudViewModel } from './presentation/hud';
import { StressDemo } from './application/stress-demo';

export type { GamePhase, InteractionSample } from './domain/types';

export function startApp(root: HTMLElement): () => void {
  const engine = new WasmGameEngine();
  const renderer = new CanvasRenderer();
  const audio = new SynthAudio();
  const input = new KeyboardInput();
  const scheduler = new EventLoopScheduler();
  const metrics = new InpMetrics();

  const hud = new Hud(root);
  hud.mount();
  renderer.mount(hud.getCanvasHost());
  const { w, h } = hud.getStageSize();
  renderer.resize(w, h);

  const runner = new GameRunner(
    engine,
    renderer,
    audio,
    input,
    scheduler,
    metrics,
    hud,
  );
  const stress = new StressDemo(scheduler);

  // view-model for the HUD (keeps presentation decoupled from app internals)
  const viewModel: HudViewModel = {
    getSchedulerStats: () => scheduler.stats,
    getInpSummary: () => metrics.summary,
    start: () => void runner.start(),
    togglePause: () =>
      runner.isRunning() ? runner.pause() : runner.resume(),
    restart: () => runner.restart(),
    runChunkedWork: (totalMs, chunkMs) => stress.runChunked(totalMs, chunkMs),
    runBlockingWork: (ms) => stress.runBlocking(ms),
    gameStarted: () => runner.getPhase() === 'running',
  };
  hud.setViewModel(viewModel);
  hud.begin();

  return () => {
    runner.dispose();
  };
}