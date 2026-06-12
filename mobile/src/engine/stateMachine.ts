// Adaptive coaching engine (spec §5). Deterministic state machine evaluated
// every ~10 s. The LLM never makes real-time decisions — this does.

import { Coach, EngineEvent, Mode, RunTarget, RunnerState, Segment } from "../types";
import { SEGMENT_INTENSITY_CAP } from "../data/coaches";

export interface TickInput {
  elapsedS: number;
  distanceM: number;
  paceS: number | null; // smoothed s/km, null = stopped/no signal
  trend: "improving" | "decaying" | "flat";
  hasEnoughData: boolean;
  speedMs: number;
}

export interface Prompt {
  event: EngineEvent;
  intensity: number;
  corrective: boolean;
}

const ANTI_NAG_CORRECTIVE_S = 90; // max 1 corrective prompt per 90 s (spec §5.3)
const GLOBAL_PROMPT_GAP_S = 45; // event prompts queue/drop rather than stack (D.5)

export class CoachingEngine {
  state: RunnerState = "WARMUP";
  private coach: Coach;
  private target: RunTarget;
  private segment: Segment;
  private isFirstRuns: boolean; // first-run conservatism (spec §5.4.3)

  private intensity = 1;
  private slippingTicks = 0;
  private strugglingTicks = 0;
  private stoppedTicks = 0;
  private lastPromptAt = -999;
  private lastCorrectiveAt = -999;
  private lastPromptWasCorrective = false;
  private lastOnTargetPromptAt = -999;
  private crisisFired = false;
  private finalStretchFired = false;
  private halfwayFired = false;
  private lastKmAnnounced = 0;
  private bestSplitS = Infinity;
  private fastestSplitFired = false;
  // COMPLETION mode interval clock
  private intervalIdx = 0;
  private intervalPhase: "run" | "walk" = "run";
  private intervalPhaseStartedS = 0;
  private intervalAnnouncedIdx = -1;
  private blockExtendedFired = false;

  constructor(coach: Coach, target: RunTarget, segment: Segment, runsCompleted: number) {
    this.coach = coach;
    this.target = target;
    this.segment = segment;
    this.isFirstRuns = runsCompleted < 3;
  }

  private maxIntensity(): number {
    let cap = Math.min(this.coach.maxIntensity, SEGMENT_INTENSITY_CAP[this.segment]);
    if (this.isFirstRuns) cap = Math.max(1, Math.round(cap * 0.5));
    return cap;
  }

  private canPrompt(elapsedS: number, corrective: boolean): boolean {
    if (elapsedS - this.lastPromptAt < GLOBAL_PROMPT_GAP_S) return false;
    if (corrective) {
      if (elapsedS - this.lastCorrectiveAt < ANTI_NAG_CORRECTIVE_S) return false;
      // anti-nag: must inject a non-corrective line between two correctives
      if (this.lastPromptWasCorrective) return false;
    }
    return true;
  }

  private emit(elapsedS: number, event: EngineEvent, corrective: boolean, intensity = this.intensity): Prompt {
    this.lastPromptAt = elapsedS;
    this.lastPromptWasCorrective = corrective;
    if (corrective) this.lastCorrectiveAt = elapsedS;
    return { event, intensity: Math.min(intensity, this.maxIntensity()), corrective };
  }

  /** Evaluate one tick (~every 10 s). Returns at most one prompt. */
  tick(input: TickInput, splits: number[]): Prompt | null {
    // AT_RISK heuristic (no HR in MVP): sudden pace collapse to near-stop after
    // sustained running, mid-run — calm guidance overrides everything (spec §5.2/5.4).
    if (this.detectAtRisk(input)) {
      if (this.state !== "AT_RISK") {
        this.state = "AT_RISK";
        return this.emit(input.elapsedS, "AT_RISK", false, 1);
      }
      return null;
    }
    if (this.state === "AT_RISK" && input.speedMs > 0.6) this.state = "WARMUP"; // recovered, re-evaluate gently

    // Universal milestone prompts (any mode)
    const milestone = this.milestones(input, splits);
    if (milestone) return milestone;

    switch (this.target.mode) {
      case "PACE": return this.tickPace(input);
      case "COMPLETION": return this.tickCompletion(input);
      case "CONSISTENCY": return this.tickConsistency(input);
    }
  }

  private detectAtRisk(input: TickInput): boolean {
    if (input.elapsedS < 120) return false;
    const inWalkPhase = this.target.mode === "COMPLETION" && this.intervalPhase === "walk";
    if (inWalkPhase) return false;
    if (input.speedMs < 0.3 && this.state !== "UNSCHEDULED_STOP") {
      this.stoppedTicks++;
    } else {
      this.stoppedTicks = 0;
    }
    // ~30s of near-total stop straight after running pace = possible distress.
    return this.stoppedTicks >= 3 && this.state !== "WARMUP" && this.state !== "AT_RISK";
  }

  private milestones(input: TickInput, splits: number[]): Prompt | null {
    const { elapsedS, distanceM } = input;
    const frac = this.target.distanceM > 0 ? distanceM / this.target.distanceM : 0;

    // km splits (each km, with fastest-split recognition — E-KM-SPLIT / E-FASTEST-SPLIT)
    const km = Math.floor(distanceM / 1000);
    if (km > this.lastKmAnnounced && this.canPrompt(elapsedS, false)) {
      this.lastKmAnnounced = km;
      const splitS = splits[km - 1];
      if (splitS && splitS < this.bestSplitS) {
        const wasBest = this.bestSplitS !== Infinity;
        this.bestSplitS = splitS;
        if (wasBest && !this.fastestSplitFired && km >= 3) {
          this.fastestSplitFired = true; // cap 1/run
          return this.emit(elapsedS, "FASTEST_SPLIT", false, 1);
        }
      }
      return this.emit(elapsedS, "KM_SPLIT", false, 1);
    }
    // halfway (E-HALFWAY)
    if (!this.halfwayFired && frac >= 0.5 && frac < 0.6 && this.canPrompt(elapsedS, false)) {
      this.halfwayFired = true;
      return this.emit(elapsedS, "HALFWAY", false, 1);
    }
    // 55–70% crisis window — one pre-emptive support prompt even if ON_TARGET (R9)
    if (!this.crisisFired && frac >= 0.57 && frac <= 0.7 && this.canPrompt(elapsedS, false)) {
      this.crisisFired = true;
      return this.emit(elapsedS, "CRISIS_WINDOW", false, 1);
    }
    // final 10% — encouragement density spikes (R3 / peak-end R17)
    if (!this.finalStretchFired && frac >= 0.9 && this.canPrompt(elapsedS, false)) {
      this.finalStretchFired = true;
      return this.emit(elapsedS, "FINAL_STRETCH", false, this.maxIntensity());
    }
    return null;
  }

  private tickPace(input: TickInput): Prompt | null {
    const { elapsedS, paceS, trend, hasEnoughData } = input;
    const target = this.target.targetPaceS!;
    const tol = this.target.toleranceS ?? 15;

    if (!hasEnoughData || paceS === null || elapsedS < 60) {
      if (this.state !== "AT_RISK") this.state = "WARMUP";
      return null;
    }

    const delta = paceS - target; // positive = slower than target
    const frac = this.target.distanceM > 0 ? input.distanceM / this.target.distanceM : 0;

    // Classify (spec §5.2)
    let next: RunnerState;
    if (delta > tol * 3 && this.strugglingTicks >= 4) next = "STRUGGLING";
    else if (delta > tol) next = trend === "improving" ? "RECOVERING" : "SLIPPING";
    else if (delta < -tol) next = "AHEAD";
    else next = "ON_TARGET";

    if (delta > tol * 3) this.strugglingTicks++;
    else this.strugglingTicks = 0;

    // Escalation ramp (spec §5.3): intensity climbs after N consecutive
    // slipping prompts per coach curve; resets on recovery.
    if (next === "SLIPPING") this.slippingTicks++;
    else this.slippingTicks = 0;

    const prev = this.state;
    this.state = next;

    switch (next) {
      case "SLIPPING": {
        const ramped = 1 + Math.floor(this.slippingTicks / this.coach.escalationRampPrompts);
        this.intensity = Math.min(ramped + 1, this.maxIntensity());
        if (this.canPrompt(elapsedS, true)) return this.emit(elapsedS, "SLIPPING", true);
        return null;
      }
      case "RECOVERING":
        this.intensity = 1;
        if (prev !== "RECOVERING" && this.canPrompt(elapsedS, false))
          return this.emit(elapsedS, "RECOVERING", false, 1);
        return null;
      case "AHEAD":
        // celebrate only late; caution early (spec §5.2)
        if (frac < 0.75 && prev !== "AHEAD" && this.canPrompt(elapsedS, true))
          return this.emit(elapsedS, "AHEAD", true, 1);
        return null;
      case "STRUGGLING":
        // de-escalate: support + adjusted target, never push (spec §5.2)
        this.intensity = 1;
        if (prev !== "STRUGGLING" && this.canPrompt(elapsedS, false))
          return this.emit(elapsedS, "STRUGGLING", false, 1);
        return null;
      case "ON_TARGET": {
        // positive reinforcement; frequency scales with % remaining (sparser early)
        const gap = 180 - 110 * frac; // 180 s early → ~70 s near the finish
        if (elapsedS - this.lastOnTargetPromptAt >= gap && this.canPrompt(elapsedS, false)) {
          this.lastOnTargetPromptAt = elapsedS;
          return this.emit(elapsedS, "ON_TARGET", false, 1);
        }
        return null;
      }
      default:
        return null;
    }
  }

  private tickCompletion(input: TickInput): Prompt | null {
    const { elapsedS, speedMs } = input;
    const iv = this.target.intervals;
    if (!iv) return null;

    // Interval clock: run/walk alternation
    const phaseLen = this.intervalPhase === "run" ? iv.runS : iv.walkS;
    if (elapsedS - this.intervalPhaseStartedS >= phaseLen) {
      if (this.intervalPhase === "run" && iv.walkS > 0) {
        this.intervalPhase = "walk";
      } else {
        this.intervalPhase = "run";
        this.intervalIdx++;
      }
      this.intervalPhaseStartedS = elapsedS;
      if (this.intervalIdx < iv.repeats && this.intervalAnnouncedIdx !== this.intervalIdx * 2 + (this.intervalPhase === "walk" ? 1 : 0)) {
        this.intervalAnnouncedIdx = this.intervalIdx * 2 + (this.intervalPhase === "walk" ? 1 : 0);
        this.state = this.intervalPhase === "run" ? "IN_INTERVAL" : "SCHEDULED_WALK";
        return this.emit(elapsedS, this.intervalPhase === "run" ? "INTERVAL_RUN" : "INTERVAL_WALK", false, 1);
      }
    }

    // Unscheduled stop during a run block: support + restart plan, NEVER scold (spec §5.5)
    if (this.intervalPhase === "run" && elapsedS - this.intervalPhaseStartedS > 10 && speedMs < 0.5 && input.hasEnoughData) {
      if (this.state !== "UNSCHEDULED_STOP" && this.canPrompt(elapsedS, false)) {
        this.state = "UNSCHEDULED_STOP";
        return this.emit(elapsedS, "UNSCHEDULED_STOP", false, 1);
      }
    } else if (this.state === "UNSCHEDULED_STOP" && speedMs > 1.0) {
      this.state = "IN_INTERVAL";
    }

    // Block extended: ran past the planned distance (graduation feeder)
    if (!this.blockExtendedFired && this.target.distanceM > 0 && input.distanceM > this.target.distanceM && this.canPrompt(elapsedS, false)) {
      this.blockExtendedFired = true;
      return this.emit(elapsedS, "BLOCK_EXTENDED", false, 1);
    }
    return null;
  }

  private tickConsistency(input: TickInput): Prompt | null {
    const { elapsedS, speedMs, hasEnoughData } = input;
    if (!hasEnoughData || elapsedS < 90) return null;
    // FLAGGING: effort fading well below comfortable jog → gentle re-engage
    if (speedMs < 1.2 && speedMs > 0.4) {
      if (this.state !== "FLAGGING" && this.canPrompt(elapsedS, false)) {
        this.state = "FLAGGING";
        return this.emit(elapsedS, "FLAGGING", false, 1);
      }
      return null;
    }
    this.state = "ON_PLAN";
    // show-up framing, sparse positive reinforcement
    if (elapsedS - this.lastOnTargetPromptAt >= 240 && this.canPrompt(elapsedS, false)) {
      this.lastOnTargetPromptAt = elapsedS;
      return this.emit(elapsedS, "ON_TARGET", false, 1);
    }
    return null;
  }
}
