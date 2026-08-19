// ─────────────────────────────────────────────────────────────────────────
// Infrastructure: explicit event-loop scheduler.
//
// This is the heart of the exercise. It deliberately makes the three
// browser-concurrency primitives visible and measurable:
//
//   TASKS      – requestAnimationFrame work, setTimeout chunks, input event
//                listeners. Each runs to completion on the main thread and
//                the next task only starts after the previous one ends.
//   MICROTASKS – promise continuations / queueMicrotask, drained between
//                tasks at each checkpoint (one microtask checkpoint runs as
//                soon as the current JS stack unwinds).
//   EVENT LOOP – the outer loop that alternates task -> microtask ->
//                (render) -> next task.
//
// Every public method is a labelled primitive so the inspector can attribute
// work to a task vs a microtask, count long tasks, and keep the INP panel in
// sync. Nothing here touches DOM styling – this is pure scheduling plumbing.
// ─────────────────────────────────────────────────────────────────────────
import type { MetricsPort, InteractionSample } from '../domain/types';

export interface SchedulerStats {
  tasksStarted: number;
  tasksEnded: number;
  microtasksStarted: number;
  longTasksObserved: number;
  yields: number;
  lastFrameMs: number;
  avgFrameMs: number;
  frameCount: number;
  /** timestamps of the most recent long tasks detected by Long Task API */
  recentLongTasks: { start: number; duration: number }[];
  recentSamples: InteractionSample[];
  /** labelled trace of recent scheduled app tasks (for the Terminal panel) */
  recentTasks: { label: string; at: number }[];
}

const LONG_TASK_THRESHOLD = 50; // ms – the INP-relevant long task threshold

export class EventLoopScheduler {
  readonly stats: SchedulerStats = {
    tasksStarted: 0,
    tasksEnded: 0,
    microtasksStarted: 0,
    longTasksObserved: 0,
    yields: 0,
    lastFrameMs: 0,
    avgFrameMs: 0,
    frameCount: 0,
    recentLongTasks: [],
    recentSamples: [],
    recentTasks: [],
  };

  private metrics: MetricsPort | null = null;
  private sampleCounter = 0;
  private longTaskObserver: PerformanceObserver | null = null;
  private eventObserver: PerformanceObserver | null = null;

  /** Inject the port that records interactions / long tasks. */
  attachMetrics(port: MetricsPort): void {
    this.metrics = port;
  }

  /** Schedule a macrotask (setTimeout) and count it as a "task". */
  scheduleTask(label: string, fn: () => void, delay = 0): number {
    this.stats.tasksStarted += 1;
    this.logTask(label);
    return window.setTimeout(() => {
      this.markTaskEnd();
      fn();
    }, delay);
  }

  private logTask(label: string): void {
    this.stats.recentTasks.push({ label, at: performance.now() });
    if (this.stats.recentTasks.length > 64) {
      this.stats.recentTasks.shift();
    }
  }

  /** Mark that one app-managed task finished (used when tasks end naturally). */
  markTaskEnd(): void {
    this.stats.tasksEnded += 1;
  }

  /**
   * Yield to the main thread so pending input + rendering can run before we
   * resume. Uses `scheduler.yield()` when available (Chrome 129+); otherwise
   * falls back to a 0ms setTimeout task. Returns a promise resolved on a NEW
   * task, i.e. the continuation below it is a fresh macrotask checkpoint.
   */
  async yieldToMainThread(): Promise<void> {
    this.stats.yields += 1;
    const scheduler = this.schedulerInterface();
    if (scheduler && typeof scheduler.yield === 'function') {
      await scheduler.yield();
    } else {
      await new Promise<void>((resolve) => this.scheduleTask('yield-fallback', resolve));
    }
  }

  private schedulerInterface(): { yield: () => Promise<void> } | null {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (!s || typeof s !== 'object' || typeof s.yield !== 'function') {
      return null;
    }
    return { yield: () => (s as { yield: () => Promise<void> }).yield() };
  }

  /**
   * Run a macrotask-then-microtask cycle: execute `taskWork` inside the
   * current task, then (optionally) run `microWork` as a chained microtask
   * via a resolved promise — demonstrating the microtask checkpoint after the
   * synchronous task body completes.
   */
  runTaskThenMicrotask(taskWork: () => void, microWork: () => void): void {
    this.stats.tasksStarted += 1;
    taskWork();
    this.markTaskEnd();
    this.enqueueMicrotask(microWork);
  }

  /** queueMicrotask alias that keeps a visible counter of microtasks. */
  enqueueMicrotask(fn: () => void): void {
    this.stats.microtasksStarted += 1;
    queueMicrotask(fn);
  }

  /** Promise.catch/then style microtask scheduling. */
  thenMicrotask(p: PromiseLike<unknown>, fn: () => void): void {
    this.stats.microtasksStarted += 1;
    void p.then(() => {
      fn();
    });
  }

  /**
   * Record an interaction sample decoded from the Event Timing API.
   * Keeps a small ring buffer for the metrics panel + forwards to the port.
   */
  recordInteraction(sample: InteractionSample): void {
    this.sampleCounter += 1;
    this.stats.recentSamples.push(sample);
    if (this.stats.recentSamples.length > 64) {
      this.stats.recentSamples.shift();
    }
    void this.sampleCounter;
    this.metrics?.onInteraction(sample);
  }

  /** Start observing long tasks (Long Task API) + event timings. */
  startObservers(): void {
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= LONG_TASK_THRESHOLD) {
              this.stats.longTasksObserved += 1;
              this.stats.recentLongTasks.push({
                start: entry.startTime,
                duration: entry.duration,
              });
              if (this.stats.recentLongTasks.length > 16) {
                this.stats.recentLongTasks.shift();
              }
              this.metrics?.recordLongTask(entry.duration, 'Long Task API');
            }
          }
        });
        this.longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch {
        this.longTaskObserver = null;
      }

      try {
        this.eventObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceEventTiming[]) {
            if (entry.interactionId === undefined) continue;
            const inputDelay = entry.startTime - entry.processingStart;
            const processingDuration = entry.processingEnd - entry.processingStart;
            const presentationDelay = entry.duration - processingDuration;
            this.recordInteraction({
              startTime: entry.startTime,
              type: entry.name,
              inputDelay: Math.max(0, inputDelay),
              processingDuration,
              presentationDelay: Math.max(0, presentationDelay),
              total: entry.duration,
            });
          }
        });
        this.eventObserver.observe({
          type: 'event',
          durationThreshold: 16,
          buffered: true,
        });
      } catch {
        this.eventObserver = null;
      }
    }
  }

  /** Track per-frame timings supplied by the render loop. */
  recordFrame(frameMs: number): void {
    this.stats.frameCount += 1;
    this.stats.lastFrameMs = frameMs;
    const n = this.stats.frameCount;
    this.stats.avgFrameMs =
      this.stats.avgFrameMs === 0
        ? frameMs
        : this.stats.avgFrameMs + (frameMs - this.stats.avgFrameMs) / n;
  }

  dispose(): void {
    this.longTaskObserver?.disconnect();
    this.eventObserver?.disconnect();
  }
}