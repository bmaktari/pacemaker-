import { Coach, Segment, CoachStyle } from "../types";

// Nine coaches at launch — 3 × 3 archetype grid (spec §3).
export const COACHES: Coach[] = [
  { id: "A1", name: "Sgt. Steel", archetype: "Pusher", styleMatch: "push",
    tagline: "Drill instructor. You signed up for this — now you deliver.",
    escalationRampPrompts: 2, maxIntensity: 5, tts: { pitch: 0.7, rate: 1.05 } },
  { id: "A2", name: "Coach Hammer", archetype: "Pusher", styleMatch: "push",
    tagline: "Old-school tough love. Run smart for me, not just hard.",
    escalationRampPrompts: 3, maxIntensity: 4, tts: { pitch: 0.8, rate: 0.95 } },
  { id: "A3", name: "The Rival", archetype: "Pusher", styleMatch: "push",
    tagline: "Last-week-you is on the start line next to you. Keep up.",
    escalationRampPrompts: 2, maxIntensity: 4, tts: { pitch: 1.05, rate: 1.1 } },
  { id: "B1", name: "Coach Maya", archetype: "Supporter", styleMatch: "encourage",
    tagline: "Relentlessly in your corner. Every dip is a comeback setup.",
    escalationRampPrompts: 5, maxIntensity: 3, tts: { pitch: 1.15, rate: 1.0 } },
  { id: "B2", name: "Kai (Zen)", archetype: "Supporter", styleMatch: "encourage",
    tagline: "Calm, mindful guide. Let the pace come back gently.",
    escalationRampPrompts: 6, maxIntensity: 2, tts: { pitch: 0.95, rate: 0.85 } },
  { id: "B3", name: "Sam (The Buddy)", archetype: "Supporter", styleMatch: "encourage",
    tagline: "Best-friend energy. One song's worth of effort — deal?",
    escalationRampPrompts: 4, maxIntensity: 3, tts: { pitch: 1.05, rate: 1.05 } },
  { id: "C1", name: "Dr. Vec (Analyst)", archetype: "Expert", styleMatch: "teach",
    tagline: "Splits, projections, tolerance bands. The model likes you today.",
    escalationRampPrompts: 4, maxIntensity: 3, tts: { pitch: 1.0, rate: 1.0 } },
  { id: "C2", name: "Marathon Joe", archetype: "Expert", styleMatch: "teach",
    tagline: "Retired elite. The wall whispers before it shouts.",
    escalationRampPrompts: 4, maxIntensity: 3, tts: { pitch: 0.78, rate: 0.9 } },
  { id: "C3", name: "Prof. Lina", archetype: "Expert", styleMatch: "teach",
    tagline: "Exercise physiologist. More is not better — better is better.",
    escalationRampPrompts: 5, maxIntensity: 3, tts: { pitch: 1.1, rate: 0.95 } },
];

export const coachById = (id: string): Coach => COACHES.find((c) => c.id === id) ?? COACHES[3];

// Coach gating by segment (spec §2.2). Pushers soft-locked for S1/S2 with
// double-confirm; escalation hard-capped by segment regardless of coach.
export const RECOMMENDED: Record<Segment, string[]> = {
  S1: ["B1", "B2"],
  S2: ["B3", "C2"],
  S3: ["B3", "B1", "C3"],
  S4: [], // style-question driven — full roster
};

export const SEGMENT_INTENSITY_CAP: Record<Segment, number> = { S1: 2, S2: 3, S3: 3, S4: 5 };

export function isPusherSoftLocked(segment: Segment, coachId: string): boolean {
  return (segment === "S1" || segment === "S2") && coachId.startsWith("A");
}

export function recommendCoaches(segment: Segment, style: CoachStyle): string[] {
  if (segment !== "S4") return RECOMMENDED[segment];
  const matches = COACHES.filter((c) => c.styleMatch === style).map((c) => c.id);
  return matches.slice(0, 2);
}
