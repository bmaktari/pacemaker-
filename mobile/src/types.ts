export type Segment = "S1" | "S2" | "S3" | "S4";
export type CoachStyle = "encourage" | "teach" | "push";
export type Archetype = "Pusher" | "Supporter" | "Expert";
export type Mode = "PACE" | "COMPLETION" | "CONSISTENCY";

export type RunnerState =
  | "WARMUP"
  | "ON_TARGET"
  | "SLIPPING"
  | "RECOVERING"
  | "AHEAD"
  | "STRUGGLING"
  | "AT_RISK"
  // COMPLETION mode
  | "IN_INTERVAL"
  | "SCHEDULED_WALK"
  | "UNSCHEDULED_STOP"
  // CONSISTENCY mode
  | "ON_PLAN"
  | "FLAGGING";

export type EngineEvent =
  | "RUN_START"
  | "ON_TARGET"
  | "SLIPPING"
  | "RECOVERING"
  | "AHEAD"
  | "STRUGGLING"
  | "CRISIS_WINDOW"
  | "FINAL_STRETCH"
  | "FINISH_MET"
  | "FINISH_MISSED"
  | "AT_RISK"
  | "KM_SPLIT"
  | "HALFWAY"
  | "FASTEST_SPLIT"
  | "QUIT_INTERCEPT"
  | "RUN_SAVED"
  | "WALKED_OUT"
  // COMPLETION mode
  | "INTERVAL_RUN"
  | "INTERVAL_WALK"
  | "UNSCHEDULED_STOP"
  | "BLOCK_EXTENDED"
  // CONSISTENCY mode
  | "ON_PLAN"
  | "FLAGGING"
  | "QUIT_TEMPTATION";

export interface Coach {
  id: string;
  name: string;
  archetype: Archetype;
  tagline: string;
  styleMatch: CoachStyle;
  /** prompts needed to ramp one intensity step (Steel ramps in 2, Maya in 5) */
  escalationRampPrompts: number;
  maxIntensity: number;
  /** expo-speech voice shaping — stand-in for the real voice bank */
  tts: { pitch: number; rate: number };
}

export interface Line {
  coachId: string;
  event: EngineEvent;
  text: string;
  /** Strong Language tier twin; falls back to text when clean tier active */
  strong?: string;
  intensity?: number; // 1-5; undefined = any
  humor?: boolean;
}

export interface RunTarget {
  mode: Mode;
  distanceM: number;
  targetPaceS?: number; // seconds per km (PACE mode)
  toleranceS?: number;
  intervals?: { runS: number; walkS: number; repeats: number }; // COMPLETION mode
}

export interface Split {
  km: number;
  paceS: number;
}

export interface CompletedRun {
  clientRunId: string;
  coachId: string;
  mode: Mode;
  startedAt: string;
  durationS: number;
  distanceM: number;
  avgPaceS: number | null;
  targetPaceS: number | null;
  targetMet: boolean | null;
  wasSaved: boolean;
  quitEarly: boolean;
  splits: Split[];
  transcript: { atS: number; text: string }[];
}

export interface Profile {
  segment: Segment;
  coachId: string;
  strongLanguage: boolean;
  displayName: string;
  runsCompleted: number;
  token?: string;
}
