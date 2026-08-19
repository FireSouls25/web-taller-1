// ─────────────────────────────────────────────────────────────────────────
// Application: StressDemo.
// Two ways to simulate CPU-bound work so the event-loop/INP story is actual:
//
//   runBlocking(ms)  – ONE long macrotask. The main thread is monopolised
//                      the whole time: any pending input (keydown, click)
//                      sits in the task queue and only runs afterwards.
//                      This is the "long task" the INP metric punishes.
//
//   runChunked(ms, chunk) – same total work split into many small macrotasks
//                      with an explicit yield between each (scheduler.yield()
//                      or setTimeout(0)). Input events get a turn between
//                      chunks, so the browser stays responsive.
//
// Both call the SAME cpuBurn payload, so the difference is purely scheduling.
// ─────────────────────────────────────────────────────────────────────────
import { EventLoopScheduler } from '../infrastructure/event-loop-scheduler';

export class StressDemo {
  constructor(private readonly scheduler: EventLoopScheduler) {}

  /** classic tight loop: blocks the main thread for `ms` in one task */
  runBlocking(ms: number): void {
    computeLoop(this.cpuBurn, ms);
  }

  /**
   * chunked: runs ~`ms` of the same work but in `chunk` pieces, awaiting each
   * piece's own macrotask and THEN yielding, so pending input events are
   * processed between chunks. Total wall time will slightly exceed `totalMs`
   * because of the yields — that's the responsiveness tradeoff.
   */
  async runChunked(totalMs: number, chunkMs: number): Promise<void> {
    let remaining = totalMs;
    while (remaining > 0) {
      const piece = Math.min(chunkMs, remaining);
      await new Promise<void>((resolve) => {
        this.scheduler.scheduleTask('stress-chunk', () => {
          computeLoop(this.cpuBurn, piece);
          resolve();
        });
      });
      remaining -= piece;
      // yield AFTER a chunk: allow queued input/rendering to run before the
      // next chunk. Yield is also a macrotask boundary (microtask checkpoint).
      await this.scheduler.yieldToMainThread();
    }
  }

  /** The compute hull: volatile arithmetic to prevent dead-code elimination
   *  while staying pure-JS (no DOM, no IO, no allocations). */
  private cpuBurn(deadlineUntil: number): void {
    let acc = 0x5f3759df;
    while (performance.now() < deadlineUntil) {
      acc = (acc * 1103515245 + 12345) >>> 0;
    }
    void acc;
  }
}

function computeLoop(body: (until: number) => void, ms: number): void {
  body(performance.now() + ms);
}