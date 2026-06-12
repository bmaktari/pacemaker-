// Variant selection (spec Appendix E.1): weighted random with freshness decay,
// no-repeat within the run, humor quota via variable-reward weighting (R16),
// strong/clean twin resolution, and Tier-1.5 slot filling.

import { Line, EngineEvent } from "../types";
import { LINE_BANK } from "../data/lineBank";

// Generic fallbacks so the coach NEVER goes silent on an event with no
// per-coach line yet (content backlog, spec B.9 note).
const GENERIC: Partial<Record<EngineEvent, string>> = {
  FLAGGING: "Energy's dipping — that's okay. Find an easy rhythm you could hold all day, and stay with me.",
  QUIT_TEMPTATION: "Almost there — the distance is the only goal today. One more stretch, then we're done, together.",
  ON_PLAN: "Right on plan. This is exactly the run that keeps the streak alive.",
  HALFWAY: "Halfway there. From here, every step counts down instead of up.",
  FASTEST_SPLIT: "That was your fastest kilometre of the day. Remember how this feels.",
  RUN_SAVED: "You came back to this run. That matters more than any split today.",
  WALKED_OUT: "We close it here, walking, with credit for every metre. Good call. Next run is a clean page.",
  QUIT_INTERCEPT: "Before we end it — give me two minutes of walking. Then decide. Deal?",
  BLOCK_EXTENDED: "You just went past the plan. That's real progress, logged and remembered.",
  UNSCHEDULED_STOP: "We stopped — no problem. Thirty seconds of walking, then we pick it back up together.",
};

export interface SlotValues {
  pace?: string; // "5:30"
  dist?: string; // "5.0 km"
  n?: string;
}

export class LineSelector {
  private playedThisRun = new Set<string>();
  private playCounts: Record<string, number>;
  private strongLanguage: boolean;

  constructor(historicPlayCounts: Record<string, number>, strongLanguage: boolean) {
    this.playCounts = { ...historicPlayCounts };
    this.strongLanguage = strongLanguage;
  }

  private lineId(l: Line): string {
    return `${l.coachId}|${l.event}|${l.text.slice(0, 40)}`;
  }

  pick(coachId: string, event: EngineEvent, intensity: number, slots: SlotValues): { text: string; lineId: string } | null {
    let pool = LINE_BANK.filter((l) => l.coachId === coachId && l.event === event);
    if (pool.length === 0) {
      const generic = GENERIC[event];
      return generic ? { text: fillSlots(generic, slots), lineId: `generic|${event}` } : null;
    }
    // intensity match: prefer exact, fall back to nearest, then any
    const withIntensity = pool.filter((l) => l.intensity !== undefined);
    if (withIntensity.length > 0 && pool.some((l) => l.intensity !== undefined)) {
      const exact = pool.filter((l) => l.intensity === undefined || l.intensity === intensity);
      if (exact.length > 0) pool = exact;
      else {
        const nearest = Math.min(...withIntensity.map((l) => Math.abs((l.intensity ?? 0) - intensity)));
        pool = pool.filter((l) => l.intensity === undefined || Math.abs(l.intensity - intensity) === nearest);
      }
    }
    // no-repeat within the run
    const fresh = pool.filter((l) => !this.playedThisRun.has(this.lineId(l)));
    if (fresh.length > 0) pool = fresh;

    // freshness decay (weight halves per historic play) × mild humor boost (R16/R18)
    const weights = pool.map((l) => {
      const plays = this.playCounts[this.lineId(l)] ?? 0;
      let w = Math.pow(0.5, plays);
      if (l.humor) w *= 1.3;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let chosen = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = pool[i]; break; }
    }

    const id = this.lineId(chosen);
    this.playedThisRun.add(id);
    this.playCounts[id] = (this.playCounts[id] ?? 0) + 1;

    const raw = this.strongLanguage && chosen.strong ? chosen.strong : chosen.text;
    return { text: fillSlots(raw, slots), lineId: id };
  }

  getPlayCounts(): Record<string, number> {
    return this.playCounts;
  }
}

export function fillSlots(text: string, slots: SlotValues): string {
  return text
    .replace(/\{pace\}/g, slots.pace ?? "target pace")
    .replace(/\{dist\}/g, slots.dist ?? "the distance")
    .replace(/\{n\}/g, slots.n ?? "a few");
}

export function fmtPace(secPerKm: number | null): string {
  if (secPerKm === null || !isFinite(secPerKm)) return "--:--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDist(m: number): string {
  return `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`;
}

export function fmtDuration(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = Math.floor(totalS % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
