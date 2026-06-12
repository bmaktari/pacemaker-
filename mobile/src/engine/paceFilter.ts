// Pace smoothing (spec §7.1 / Risk #1): raw GPS pace is too noisy to coach on.
// Rolling 30s window with outlier rejection + EMA. The engine never judges on
// fewer than 15 s of data (grace period).

interface Sample {
  t: number; // epoch ms
  speed: number; // m/s
}

const WINDOW_MS = 30_000;
const GRACE_MS = 15_000;
const MAX_HUMAN_SPEED = 12; // m/s — reject GPS jumps
const EMA_ALPHA = 0.25;

export class PaceFilter {
  private samples: Sample[] = [];
  private ema: number | null = null;
  private firstSampleAt: number | null = null;

  /** Feed a location fix. speed in m/s (negative/undefined fixes are ignored). */
  addSample(speed: number | null | undefined, accuracy: number | null | undefined, t = Date.now()): void {
    if (speed == null || speed < 0 || speed > MAX_HUMAN_SPEED) return;
    if (accuracy != null && accuracy > 35) return; // urban-canyon junk fix
    if (this.firstSampleAt === null) this.firstSampleAt = t;
    this.samples.push({ t, speed });
    this.samples = this.samples.filter((s) => t - s.t <= WINDOW_MS);
    const median = this.median();
    // Reject single-sample spikes >60% off the window median before smoothing.
    const usable = Math.abs(speed - median) / Math.max(median, 0.1) > 0.6 ? median : speed;
    this.ema = this.ema === null ? usable : EMA_ALPHA * usable + (1 - EMA_ALPHA) * this.ema;
  }

  private median(): number {
    if (this.samples.length === 0) return 0;
    const sorted = this.samples.map((s) => s.speed).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /** true once we have ≥15 s of data — before that, no coaching judgement. */
  hasEnoughData(t = Date.now()): boolean {
    return this.firstSampleAt !== null && t - this.firstSampleAt >= GRACE_MS && this.samples.length >= 4;
  }

  /** Smoothed speed in m/s. */
  speed(): number {
    return this.ema ?? 0;
  }

  /** Smoothed pace in seconds per km; null if effectively stopped. */
  paceSecPerKm(): number | null {
    const v = this.speed();
    if (v < 0.4) return null; // standing / GPS drift
    return Math.round(1000 / v);
  }

  /** Trend over the window: negative = speeding up (pace improving). */
  trend(): "improving" | "decaying" | "flat" {
    if (this.samples.length < 6) return "flat";
    const mid = Math.floor(this.samples.length / 2);
    const avg = (arr: Sample[]) => arr.reduce((a, s) => a + s.speed, 0) / arr.length;
    const older = avg(this.samples.slice(0, mid));
    const newer = avg(this.samples.slice(mid));
    const delta = (newer - older) / Math.max(older, 0.1);
    if (delta > 0.05) return "improving";
    if (delta < -0.05) return "decaying";
    return "flat";
  }

  reset(): void {
    this.samples = [];
    this.ema = null;
    this.firstSampleAt = null;
  }
}
