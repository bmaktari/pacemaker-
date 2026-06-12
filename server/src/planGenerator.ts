// Rule-based plan generation per segment (spec §4.2). Not LLM-dependent.
// Each run carries structured targets the coaching engine consumes.

export type Segment = "S1" | "S2" | "S3" | "S4";

export interface PlannedRun {
  day: number; // 0-6 within the week
  type: "easy" | "tempo" | "intervals" | "long" | "runwalk" | "consistency";
  mode: "PACE" | "COMPLETION" | "CONSISTENCY";
  label: string;
  distanceM?: number;
  targetPaceS?: number; // seconds per km
  toleranceS?: number;
  intervals?: { runS: number; walkS: number; repeats: number };
}

export interface PlanWeek {
  week: number;
  runs: PlannedRun[];
}

// C25K-style ladder: run/walk seconds per week index (S1 → first unbroken 1 km).
const S1_LADDER: Array<[number, number, number]> = [
  [60, 90, 8], [90, 120, 6], [120, 90, 6], [180, 90, 5],
  [300, 120, 4], [480, 120, 3], [600, 90, 2], [900, 0, 1],
];

export function generatePlan(
  segment: Segment,
  runsPerWeek: number,
  goal: string,
  targetPaceS?: number
): PlanWeek[] {
  const weeks: PlanWeek[] = [];
  const days = spreadDays(runsPerWeek);

  if (segment === "S1") {
    S1_LADDER.forEach(([runS, walkS, repeats], i) => {
      weeks.push({
        week: i + 1,
        runs: days.map((day) => ({
          day, type: "runwalk", mode: "COMPLETION",
          label: walkS > 0 ? `Run ${runS}s / walk ${walkS}s × ${repeats}` : `Continuous run ${Math.round(runS / 60)} min`,
          intervals: { runS, walkS, repeats },
        })),
      });
    });
  } else if (segment === "S2") {
    // Continuous-block extension: 1.2 km → 2.5 km over 8 weeks.
    for (let w = 1; w <= 8; w++) {
      const dist = Math.round(1200 + ((2500 - 1200) * w) / 8);
      weeks.push({
        week: w,
        runs: days.map((day, i) => ({
          day, type: "runwalk", mode: "COMPLETION",
          label: i === 0 ? `Continuous block ${(dist / 1000).toFixed(1)} km` : `Easy run/walk 20 min`,
          distanceM: i === 0 ? dist : undefined,
          intervals: i === 0 ? undefined : { runS: 240, walkS: 60, repeats: 4 },
        })),
      });
    }
  } else if (segment === "S3") {
    for (let w = 1; w <= 8; w++) {
      weeks.push({
        week: w,
        runs: days.map((day, i) => ({
          day, type: "consistency", mode: "CONSISTENCY",
          label: i % 3 === 2 ? "Comfortable 5 km, slight variety" : "Comfortable 5 km",
          distanceM: 5000,
        })),
      });
    }
  } else {
    // S4 performance plan: easy / tempo / intervals / long with pace targets.
    const base = targetPaceS ?? 330; // default 5:30/km
    for (let w = 1; w <= 8; w++) {
      const taper = w >= 7 ? 0.9 : 1;
      const runs: PlannedRun[] = [];
      const types: PlannedRun["type"][] = ["easy", "tempo", "intervals", "long"];
      days.forEach((day, i) => {
        const t = types[i % types.length];
        const cfg = {
          easy:      { pace: base + 45, dist: 5000, tol: 20 },
          tempo:     { pace: base - 10, dist: Math.round(5000 * taper), tol: 10 },
          intervals: { pace: base - 25, dist: 4000, tol: 10 },
          long:      { pace: base + 60, dist: Math.round((7000 + w * 500) * taper), tol: 25 },
        }[t]!;
        runs.push({
          day, type: t, mode: "PACE",
          label: `${t[0].toUpperCase()}${t.slice(1)} ${(cfg.dist / 1000).toFixed(1)} km @ ${fmtPace(cfg.pace)}/km`,
          distanceM: cfg.dist, targetPaceS: cfg.pace, toleranceS: cfg.tol,
        });
      });
      weeks.push({ week: w, runs });
    }
  }
  return weeks;
}

function spreadDays(n: number): number[] {
  const all = [1, 3, 5, 0, 2, 4, 6]; // Tue, Thu, Sat first — rest-day friendly
  return all.slice(0, Math.max(1, Math.min(7, n))).sort();
}

function fmtPace(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
