// Desktop engine simulator — runs synthetic runners through the REAL pace
// filter + coaching engine + line selector and prints the coach transcript.
// No device or emulator needed. This is the spec's Phase-0 validation harness.
//
//   npx tsx sim/simulate.ts                      # all scenarios, default coach A1
//   npx tsx sim/simulate.ts --coach B1           # pick a coach
//   npx tsx sim/simulate.ts --scenario fader     # one scenario
//   npx tsx sim/simulate.ts --segment S1         # engine mode/caps per segment

import { CoachingEngine } from "../src/engine/stateMachine";
import { PaceFilter } from "../src/engine/paceFilter";
import { LineSelector, buildSlots, fmtPace, fmtDist } from "../src/engine/lineSelector";
import { coachById } from "../src/data/coaches";
import { RunTarget, Segment, Split } from "../src/types";

// ---------- Scenarios: speed (m/s) as a function of elapsed seconds ----------
// 5:30/km target ≈ 3.03 m/s
const TARGET_SPEED = 1000 / 330;

type Scenario = { name: string; describe: string; speedAt: (t: number, durationS: number) => number };

const SCENARIOS: Scenario[] = [
  {
    name: "steady",
    describe: "Holds target pace the whole run (expect: ON_TARGET cadence, crisis-window support, finish ceremony)",
    speedAt: (t, d) => TARGET_SPEED * (1 + 0.02 * Math.sin(t / 40)),
  },
  {
    name: "fader",
    describe: "On pace for 40%, then steadily fades (expect: SLIPPING escalation per coach curve, then STRUGGLING de-escalation)",
    speedAt: (t, d) => {
      const frac = t / d;
      if (frac < 0.4) return TARGET_SPEED;
      return TARGET_SPEED * Math.max(0.62, 1 - (frac - 0.4) * 0.9);
    },
  },
  {
    name: "surger",
    describe: "Goes out 15% too fast, corrects, finishes strong (expect: AHEAD caution early, FINAL_STRETCH hype)",
    speedAt: (t, d) => {
      const frac = t / d;
      if (frac < 0.25) return TARGET_SPEED * 1.18;
      if (frac < 0.85) return TARGET_SPEED * 1.0;
      return TARGET_SPEED * 1.12;
    },
  },
  {
    name: "yo-yo",
    describe: "Slips and recovers repeatedly (expect: SLIPPING → RECOVERING acknowledgement loops, anti-nag respected)",
    speedAt: (t) => TARGET_SPEED * (1 - 0.12 * Math.sin(t / 90)),
  },
  {
    name: "collapse",
    describe: "Runs well then stops dead mid-run (expect: AT_RISK calm guidance, persona dropped)",
    speedAt: (t, d) => (t / d < 0.5 ? TARGET_SPEED : 0.05),
  },
];

// ---------- CLI args ----------
const args = process.argv.slice(2);
const argOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const coachId = argOf("--coach") ?? "A1";
const onlyScenario = argOf("--scenario");
const segment = (argOf("--segment") ?? "S4") as Segment;
const strong = args.includes("--strong");

// ---------- Run one scenario ----------
function runScenario(sc: Scenario): void {
  const coach = coachById(coachId);
  const durationS = 28 * 60; // ~5k at 5:30
  const target: RunTarget =
    segment === "S1"
      ? { mode: "COMPLETION", distanceM: 1500, intervals: { runS: 90, walkS: 120, repeats: 6 } }
      : segment === "S3"
      ? { mode: "CONSISTENCY", distanceM: 5000 }
      : { mode: "PACE", distanceM: 5000, targetPaceS: 330, toleranceS: 15 };

  const engine = new CoachingEngine(coach, target, segment, 5 /* past first-run conservatism */);
  const filter = new PaceFilter();
  const selector = new LineSelector({}, strong);

  let distanceM = 0;
  const splits: Split[] = [];
  let splitStartM = 0;
  let splitStartT = 0;
  let prompts = 0;
  let correctives = 0;
  let lastState = "";

  console.log(`\n━━━ ${sc.name} · coach ${coach.name} · segment ${segment} (${target.mode}) ━━━`);
  console.log(`    ${sc.describe}\n`);

  const t0 = Date.now();
  for (let t = 1; t <= durationS; t++) {
    const speed = sc.speedAt(t, durationS);
    const simNow = t0 + t * 1000;
    // feed a GPS-ish noisy sample every 2s
    if (t % 2 === 0) {
      const noisy = speed * (1 + (Math.random() - 0.5) * 0.12);
      filter.addSample(noisy, 8 + Math.random() * 10, simNow);
    }
    distanceM += speed;

    if (distanceM - splitStartM >= 1000) {
      splits.push({ km: splits.length + 1, paceS: Math.round(t - splitStartT) });
      splitStartM = distanceM;
      splitStartT = t;
    }

    if (t % 10 !== 0) continue;
    const prompt = engine.tick(
      {
        elapsedS: t,
        distanceM,
        paceS: filter.paceSecPerKm(),
        trend: filter.trend(),
        hasEnoughData: filter.hasEnoughData(simNow),
        speedMs: filter.speed(),
      },
      splits.map((s) => s.paceS)
    );

    if (engine.state !== lastState) {
      console.log(`  ${mmss(t)}  [state → ${engine.state}]  pace ${fmtPace(filter.paceSecPerKm())}`);
      lastState = engine.state;
    }
    if (prompt) {
      prompts++;
      if (prompt.corrective) correctives++;
      const line = selector.pick(
        coach.id,
        prompt.event,
        prompt.intensity,
        buildSlots(prompt.event, {
          distanceM,
          targetDistanceM: target.distanceM,
          targetPaceS: target.targetPaceS,
          curPaceS: filter.paceSecPerKm(),
        })
      );
      console.log(`  ${mmss(t)}  ${prompt.event}${prompt.corrective ? "!" : ""} i${prompt.intensity}  🗣 "${line?.text ?? "(no line)"}"`);
    }

    if (target.mode === "PACE" && distanceM >= target.distanceM) {
      const avg = Math.round(t / (distanceM / 1000));
      const met = avg <= (target.targetPaceS ?? 0) + (target.toleranceS ?? 15);
      const fin = selector.pick(coach.id, met ? "FINISH_MET" : "FINISH_MISSED", 1, {
        pace: fmtPace(avg), dist: fmtDist(distanceM), n: String(splits.length),
      });
      console.log(`  ${mmss(t)}  ${met ? "FINISH_MET" : "FINISH_MISSED"}  🗣 "${fin?.text}"`);
      break;
    }
  }

  console.log(`\n  ── ${prompts} prompts (${correctives} corrective) · ${splits.length} splits: ${splits.map((s) => fmtPace(s.paceS)).join(" / ")}`);
}

function mmss(t: number): string {
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

const toRun = onlyScenario ? SCENARIOS.filter((s) => s.name === onlyScenario) : SCENARIOS;
if (toRun.length === 0) {
  console.error(`Unknown scenario "${onlyScenario}". Available: ${SCENARIOS.map((s) => s.name).join(", ")}`);
  process.exit(1);
}
toRun.forEach(runScenario);
