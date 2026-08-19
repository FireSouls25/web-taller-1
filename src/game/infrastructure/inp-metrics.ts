// ─────────────────────────────────────────────────────────────────────────
// Infrastructure: INP (Interaction to Next Paint) metrics collector using
// the web-vitals attribution build. Provides real field-style measurement of
// each interaction's three phases:
//
//   inputDelay        – time until the event callback starts running
//   processingDuration– event callbacks execution
//   presentationDelay – time until the next frame is painted afterwards
//
// INP budget rule of thumb: keep total latency < 200 ms.
// ─────────────────────────────────────────────────────────────────────────
import { onINP } from 'web-vitals/attribution';
import type { MetricsPort, InteractionSample } from '../domain/types';

export interface InpSummary {
  /** current INP candidate (longest interaction so far) */
  inp: number | null;
  /** raw INP reported value (97th-percentile-style reporting) */
  reportedValue: number | null;
  inputDelay: number | null;
  processingDuration: number | null;
  presentationDelay: number | null;
  interactionTarget: string | null;
  interactionType: string | null;
  sampleCount: number;
  samples: InteractionSample[];
  longTasks: { duration: number; attribution: string }[];
  loafEntries: number;
  /** 0.05–1, quality flag for how trustworthy the INP reading is */
  confidence: number;
}

export class InpMetrics implements MetricsPort {
  readonly summary: InpSummary = {
    inp: null,
    reportedValue: null,
    inputDelay: null,
    processingDuration: null,
    presentationDelay: null,
    interactionTarget: null,
    interactionType: null,
    sampleCount: 0,
    samples: [],
    longTasks: [],
    loafEntries: 0,
    confidence: 0,
  };

  private enabled = false;
  private readings = 0;
  private lastTotal = 0;

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.bindWebVitals();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private bindWebVitals(): void {
    // attribution build => metric.attribution exposes the INP subparts + LoAF
    onINP(
      (metric) => {
        this.readings += 1;
        const attr = metric.attribution as unknown as {
          inputDelay?: number;
          processingDuration?: number;
          presentationDelay?: number;
          interactionTarget?: string;
          interactionType?: string;
          longAnimationFrameEntries?: unknown[];
        };

        this.summary.reportedValue = metric.value;
        this.summary.inp = Math.max(this.summary.inp ?? 0, metric.value);
        this.summary.inputDelay = attr.inputDelay ?? null;
        this.summary.processingDuration = attr.processingDuration ?? null;
        this.summary.presentationDelay = attr.presentationDelay ?? null;
        this.summary.interactionTarget = attr.interactionTarget ?? null;
        this.summary.interactionType = attr.interactionType ?? null;
        this.summary.sampleCount = this.readings;
        this.summary.loafEntries =
          attr.longAnimationFrameEntries?.length ?? this.summary.loafEntries;

        // confidence: more readings => higher confidence; only complete
        // readings (which have a processing duration) count toward it.
        this.lastTotal =
          (attr.inputDelay ?? 0) + (attr.processingDuration ?? 0) + (attr.presentationDelay ?? 0);
        const phaseCount = attr.processingDuration !== undefined ? 1 : 0;
        this.summary.confidence = Math.min(
          1,
          this.summary.confidence + 0.15 + phaseCount * 0.05,
        );

        // Keep a structured sample for the panel table.
        this.summary.samples.push({
          startTime: performance.now(),
          type: attr.interactionType ?? 'unknown',
          inputDelay: attr.inputDelay ?? 0,
          processingDuration: attr.processingDuration ?? 0,
          presentationDelay: attr.presentationDelay ?? 0,
          total: this.lastTotal,
        });
        if (this.summary.samples.length > 32) {
          this.summary.samples.shift();
        }
      },
      { reportAllChanges: true },
    );
  }

  recordLongTask(durationMs: number, attribution: string): void {
    this.summary.longTasks.push({ duration: durationMs, attribution });
    if (this.summary.longTasks.length > 32) {
      this.summary.longTasks.shift();
    }
  }

  onInteraction(entry: InteractionSample, target?: string): void {
    void entry;
    void target;
    // Keep as a secondary view; the attribution build is authoritative.
  }
}