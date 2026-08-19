// ─────────────────────────────────────────────────────────────────────────
// Presentation layer: HUD + metrics panels + dropdown.
// Renders all DOM UI (score/lives/wave, the metrics dropdown and the INP /
// event-loop panels). Reads state from the application/inspector through a
// narrow view-model interface — it never touches the game logic directly.
//
// The dropdown ("Ver métricas") selects which panel is visible:
//   • HUD      – score, lives, wave, frame timing, task/microtask counts
//   • INP      – interaction-to-next-paint breakdown per interaction
//   • EventLoop– task/microtask counters, long tasks, recent yields
//   • Terminal – filterable log of events emitted by the scheduler
// ─────────────────────────────────────────────────────────────────────────
import type { GamePhase } from '../domain/types';
import { ARENA_W, ARENA_H } from '../domain/types';
import type { SchedulerStats } from '../infrastructure/event-loop-scheduler';
import type { InpSummary } from '../infrastructure/inp-metrics';
import type { GameCallbacks } from '../application/game-runner';

export interface HudViewModel {
  getSchedulerStats(): SchedulerStats;
  getInpSummary(): InpSummary;
  start(): void;
  togglePause(): void;
  restart(): void;
  /** run a chunked "busy" demo: yields between chunks, observing long tasks */
  runChunkedWork(totalMs: number, chunkMs: number): Promise<void>;
  /** run a blocking "busy" demo in a single task (long task) */
  runBlockingWork(ms: number): void;
  gameStarted(): boolean;
}

export class Hud implements GameCallbacks {
  private container: HTMLElement;
  private canvasHost: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private livesEl: HTMLElement | null = null;
  private waveEl: HTMLElement | null = null;
  private phaseEl: HTMLElement | null = null;
  private dropdown: HTMLSelectElement | null = null;
  private panel: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private viewModel: HudViewModel | null = null;
  private phase: GamePhase = 'loading';
  private lastHud = { score: 0, lives: 3, wave: 1 };

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const host = document.createElement('div');
    host.className = 'si-app';
    host.innerHTML = `
      <div class="si-topbar">
        <div class="si-brand">SPACE&nbsp;INVADERS <span class="si-brand-sub">· wasm · event loop · inp</span></div>
        <div class="si-hud-stats">
          <span class="si-stat"><b id="si-score">0000</b><label>SCORE</label></span>
          <span class="si-stat"><b id="si-lives">3</b><label>LIVES</label></span>
          <span class="si-stat"><b id="si-wave">1</b><label>WAVE</label></span>
        </div>
      </div>
      <div class="si-body">
        <div class="si-stage" id="si-stage" role="application" aria-label="Space Invaders">
          <div class="si-canvas-host" id="si-canvas"></div>
          <button id="si-start" class="si-start">▶ START</button>
          <div class="si-dpad">
            <button data-k="left" class="si-btn">◀</button>
            <button data-k="fire" class="si-btn">FIRE</button>
            <button data-k="right" class="si-btn">▶</button>
          </div>
        </div>
        <aside class="si-side">
          <div class="si-panel-nav">
            <select id="si-metrics" class="si-select" aria-label="Seleccionar métricas">
              <option value="hud">Métricas: HUD</option>
              <option value="inp">Métricas: INP</option>
              <option value="eventloop">Métricas: Event Loop</option>
              <option value="terminal">Métricas: Terminal</option>
            </select>
            <button id="si-restart" class="si-btn" disabled>↻ Restart</button>
          </div>
          <div class="si-stress">
            <span class="si-stress-label">Simular trabajo CPU:</span>
            <button id="si-block" class="si-btn" disabled>⛔ bloqueante</button>
            <button id="si-chunk" class="si-btn" disabled>┅ en trozos</button>
          </div>
          <div id="si-panel" class="si-panel"></div>
        </aside>
      </div>
      <p class="si-hint">←/A <b>izq</b> · →/D <b>der</b> · Espacio/Z <b>disparo</b> · R <b>restart</b> </p>
    `;
    this.container.appendChild(host);

    this.canvasHost = this.container.querySelector('#si-canvas');
    this.scoreEl = this.container.querySelector('#si-score');
    this.livesEl = this.container.querySelector('#si-lives');
    this.waveEl = this.container.querySelector('#si-wave');
    this.phaseEl = this.container.querySelector('#si-phase');
    this.dropdown = this.container.querySelector('#si-metrics');
    this.panel = this.container.querySelector('#si-panel');
    this.startBtn = this.container.querySelector('#si-start');

    const restartBtn = this.container.querySelector('#si-restart');
    const blockBtn = this.container.querySelector<HTMLButtonElement>('#si-block');
    const chunkBtn = this.container.querySelector<HTMLButtonElement>('#si-chunk');

    this.dropdown?.addEventListener('change', () => this.renderPanel());
    restartBtn?.addEventListener('click', () => this.viewModel?.restart());
    blockBtn?.addEventListener('click', () => this.viewModel?.runBlockingWork(180));
    chunkBtn?.addEventListener('click', () => {
      void this.viewModel?.runChunkedWork(180, 22);
    });
    this.startBtn?.addEventListener('click', () => {
      this.viewModel?.start();
    });

    // touch/dpad buttons reuse the same intent path as the keyboard
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-k]');
    const press = (code: string, state: boolean): void => {
      const ev = new KeyboardEvent(
        state ? 'keydown' : 'keyup',
        { code, bubbles: true },
      );
      window.dispatchEvent(ev);
    };
    buttons.forEach((b) => {
      const code = b.dataset.k;
      if (!code) return;
      b.addEventListener('pointerdown', () => press(code, true));
      b.addEventListener('pointerup', () => press(code, false));
      b.addEventListener('pointerleave', () => press(code, false));
    });
  }

  getCanvasHost(): HTMLElement {
    // mount() has run before this is used
    return this.canvasHost ?? this.container;
  }

  getStageSize(): { w: number; h: number } {
    const stage = this.container.querySelector<HTMLElement>('#si-stage');
    const w = stage?.clientWidth ?? ARENA_W;
    const h = stage?.clientHeight ?? ARENA_H;
    return { w, h };
  }

  setViewModel(vm: HudViewModel): void {
    this.viewModel = vm;
    const restartBtn = this.container.querySelector('#si-restart');
    const blockBtn = this.container.querySelector<HTMLButtonElement>('#si-block');
    const chunkBtn = this.container.querySelector<HTMLButtonElement>('#si-chunk');
    if (restartBtn) (restartBtn as HTMLButtonElement).disabled = false;
    if (blockBtn) blockBtn.disabled = false;
    if (chunkBtn) chunkBtn.disabled = false;
  }

  /** Begin polling the view-model ~4×/s via a timer task and render the
   *  active panel lazily. */
  begin(): void {
    this.renderPanel();
    window.setInterval(() => this.renderPanel(), 250);
  }

  // GameCallbacks (called on the rAF microtask) ── tiny DOM writes, throttled
  onHud(hud: { score: number; lives: number; wave: number; gameOver: boolean }): void {
    const changed =
      hud.score !== this.lastHud.score ||
      hud.lives !== this.lastHud.lives ||
      hud.wave !== this.lastHud.wave;
    this.lastHud = { score: hud.score, lives: hud.lives, wave: hud.wave };
    if (changed) {
      if (this.scoreEl)
        this.scoreEl.textContent = String(hud.score).padStart(4, '0');
      if (this.livesEl)
        this.livesEl.textContent = String(hud.lives);
      if (this.waveEl)
        this.waveEl.textContent = String(hud.wave);
    }
    if (hud.gameOver && this.phase !== 'game-over') {
      if (this.startBtn) this.startBtn.textContent = '↺ GAME OVER';
    }
  }

  onPhase(phase: GamePhase): void {
    this.phase = phase;
    if (this.phaseEl) this.phaseEl.textContent = phase;
    // dismiss the START overlay once the game is actually live
    if (phase === 'running' && this.startBtn) {
      this.startBtn.style.display = 'none';
    }
  }

  // ── panel rendering ────────────────────────────────────────────────────
  private renderPanel(): void {
    if (!this.panel || !this.viewModel) {
      if (this.panel && !this.viewModel) {
        this.panel.innerHTML =
          '<p class="si-empty">Game not initialised yet…</p>';
      }
      return;
    }
    const mode = this.dropdown?.value ?? 'hud';
    const stats = this.viewModel.getSchedulerStats();
    const inp = this.viewModel.getInpSummary();

    const fps = stats.frameCount > 4 ? Math.round(1000 / (stats.avgFrameMs || 16)) : '—';
    switch (mode) {
      case 'hud':
        this.renderHud(stats, fps);
        break;
      case 'inp':
        this.renderInp(inp);
        break;
      case 'eventloop':
        this.renderEventLoop(stats);
        break;
      case 'terminal':
        this.renderTerminal();
        break;
    }
  }

  private renderHud(
    stats: SchedulerStats,
    fps: number | string,
  ): void {
    const rows = [
      ['Score', String(this.lastHud.score)],
      ['Lives', String(this.lastHud.lives)],
      ['Wave', String(this.lastHud.wave)],
      ['Frame (avg)', `${stats.avgFrameMs.toFixed(2)} ms`],
      ['Frames counted', String(stats.frameCount)],
      ['FPS (est.)', String(fps)],
      ['Tasks (sched.)', String(stats.tasksStarted)],
      ['Microtasks (sched.)', String(stats.microtasksStarted)],
      ['Yields', String(stats.yields)],
      ['Long tasks', String(stats.longTasksObserved)],
    ];
    this.panel!.innerHTML = `
      <h3 class="si-title">Panel HUD</h3>
      <table class="si-table">${rows
        .map(
          ([k, v]) =>
            `<tr><th>${k}</th><td>${v}</td></tr>`,
        )
        .join('')}</table>
      <p class="si-explain">Resumen de la partida + fugas básicas del loop.</p>
    `;
  }

  private renderInp(summary: InpSummary): void {
    const inpVal = summary.inp?.toFixed(1) ?? '—';
    const inputDelay = summary.inputDelay?.toFixed(1) ?? '—';
    const proc = summary.processingDuration?.toFixed(1) ?? '—';
    const present = summary.presentationDelay?.toFixed(1) ?? '—';
    const target = summary.interactionTarget ?? '—';
    const samples = [...summary.samples].reverse().slice(0, 8);
    const rows = samples
      .map(
        (s) =>
          `<tr><td>${s.type}</td><td>${s.total.toFixed(0)}ms</td>
           <td>${s.inputDelay.toFixed(0)}</td><td>${s.processingDuration.toFixed(0)}</td>
           <td>${s.presentationDelay.toFixed(0)}</td></tr>`,
      )
      .join('');

    this.panel!.innerHTML = `
      <h3 class="si-title">Interaction to Next Paint</h3>
      <div class="si-inp-hero">
        <div class="si-inp-value">${inpVal} ms</div>
        <div class="si-inp-budget ${summary.inp && summary.inp < 200 ? 'ok' : summary.inp ? 'bad' : ''}">
          objetivo &lt; 200 ms
        </div>
      </div>
      <table class="si-table">
        <tr><th>Input delay</th><td>${inputDelay} ms</td></tr>
        <tr><th>Processing</th><td>${proc} ms</td></tr>
        <tr><th>Presentation</th><td>${present} ms</td></tr>
        <tr><th>Target</th><td>${target}</td></tr>
        <tr><th>Long task counts</th><td>${summary.longTasks.length}</td></tr>
        <tr><th>LoAF entries</th><td>${summary.loafEntries}</td></tr>
      </table>
      ${samples.length ? `<h4 class="si-sub">últimas interacciones</h4>
        <table class="si-table si-table-sm"><thead>
          <tr><th>tipo</th><th>total</th><th>inp</th><th>proc</th><th>pres</th></tr>
        </thead><tbody>${rows}</tbody></table>` : ''}
      <p class="si-explain">Interacción → siguiente paint. Suma: inputDelay + processing + presentation.</p>
    `;
  }

  private renderEventLoop(stats: SchedulerStats): void {
    const longList = stats.recentLongTasks
      .slice(-6)
      .map((t) => `<li>${t.duration.toFixed(1)} ms @ ${t.start.toFixed(0)}</li>`)
      .join('') || '<li>Ninguno hasta ahora</li>';

    const samples = stats.recentSamples;
    const sampleCount = samples.length;
    const total = sampleCount
      ? samples.reduce((a, b) => a + b.total, 0) / sampleCount
      : 0;

    this.panel!.innerHTML = `
      <h3 class="si-title">Event Loop</h3>
      <table class="si-table">
        <tr><th>Tareas (macrotasks)</th><td>${stats.tasksStarted}</td></tr>
        <tr><th>Microtareas</th><td>${stats.microtasksStarted}</td></tr>
        <tr><th>Yields (voluntarios)</th><td>${stats.yields}</td></tr>
        <tr><th>Long tasks (&gt;50 ms)</th><td>${stats.longTasksObserved}</td></tr>
        <tr><th>Prom. interacción</th><td>${total.toFixed(1)} ms (n=${sampleCount})</td></tr>
      </table>
      <h4 class="si-sub">Long tasks recientes</h4>
      <ul class="si-list">${longList}</ul>
      <p class="si-explain">Tareas = trabajo síncrono de una sola pieza. Microtareas = continuaciones
        de promises/queueMicrotask entre tareas. Yields permiten procesar input a media tarea larga.</p>
    `;
  }

  private renderTerminal(): void {
    const stats = this.viewModel?.getSchedulerStats();
    const lines: string[] = [];
    if (stats) {
      const base = Math.max(0, stats.recentTasks[0]?.at ?? 0);
      for (const t of stats.recentTasks.slice(-24)) {
        lines.push(`[+${(t.at - base).toFixed(0).padStart(4)}ms] task "${t.label}"`);
      }
      for (const s of stats.recentSamples.slice(-6)) {
        lines.push(
          `[${s.type}] total=${s.total.toFixed(1)}ms · input=${s.inputDelay.toFixed(1)} · ` +
            `proc=${s.processingDuration.toFixed(1)} · pres=${s.presentationDelay.toFixed(1)}`,
        );
      }
    }
    this.panel!.innerHTML = `
      <h3 class="si-title">Terminal</h3>
      <label class="si-inline">Hilo de eventos del navegador —
        observa este log mientras juegas y con los botones "trabajo".</label>
      <pre class="si-terminal">${lines.join('\n') || '// sin eventos todavía — dispara, muévete o pulsa un botón de stress'}</pre>
    `;
  }
}