import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";
import { VOICE_CARDS, COACH_NAMES } from "./voiceCards";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export type Tier2Kind = "brief" | "debrief" | "milestone" | "recap";

// Spec Appendix E.5 — runtime Tier-2 prompt library. Shared guardrails are in
// the system prompt; per-kind beats go in the user turn with the input JSON.
const KIND_INSTRUCTIONS: Record<Tier2Kind, string> = {
  brief: `Write a SPOKEN pre-run brief, max 60 words, ending on an energising note.
REQUIRED BEATS: (1) one specific callback to the last run — reference a real moment from
last_3_run_summaries if present; (2) today's mission with its ONE number; (3) send-off in persona.
FORBIDDEN: generic praise; mentioning data not in INPUT.`,
  debrief: `Write a SPOKEN post-run debrief, max 75 words.
STRUCTURE: (1) verdict in persona; (2) the GOLDEN MOMENT — name the single best data point of
this run, even if the run was poor; (3) ONE improvement cue, instructional not critical;
(4) forward tease for the next run. If run_was_saved=true the save IS the golden moment.
If the user quit, zero criticism — log respect, point forward.`,
  milestone: `The user just achieved the milestone described in INPUT. Write a 40-70 word SPOKEN
celebration. REQUIRED: anchor it in their real history from INPUT — contrast where they started
with where they are now. One concrete next horizon at the end. No generic congratulations.`,
  recap: `Write a 3-sentence weekly recap TEXT message (notification, not spoken).
Sentence 1: the week's headline number. Sentence 2: the single most interesting pattern in INPUT.
Sentence 3: next week's one-line mission. No hashtags, no emoji.`,
};

// Canned fallbacks — the coach never goes silent (spec §6.3).
const FALLBACKS: Record<Tier2Kind, (coach: string) => string> = {
  brief: (c) => `${c} here. You know the plan — one target, full focus. Let's go to work.`,
  debrief: (c) => `${c}: run banked. Every session counts, and this one's in the book. Next one, we go again.`,
  milestone: (c) => `${c}: that's a real milestone. Remember where you started — and look where you are. Onward.`,
  recap: (c) => `${c}: solid week of work in the log. The pattern that matters most: you kept showing up. Next week — same again, one notch better.`,
};

async function checkBudget(userId: number): Promise<{ ok: boolean; budget: number }> {
  const cfg = await pool.query("SELECT value FROM config WHERE key = 'llm'");
  const budget: number = cfg.rows[0]?.value?.daily_token_budget ?? 20000;
  const used = await pool.query(
    "SELECT tokens FROM llm_usage WHERE user_id = $1 AND day = CURRENT_DATE",
    [userId]
  );
  return { ok: (used.rows[0]?.tokens ?? 0) < budget, budget };
}

async function recordUsage(userId: number, tokens: number): Promise<void> {
  await pool.query(
    `INSERT INTO llm_usage (user_id, day, tokens) VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (user_id, day) DO UPDATE SET tokens = llm_usage.tokens + $2`,
    [userId, tokens]
  );
}

export async function generateTier2(
  userId: number,
  kind: Tier2Kind,
  coachId: string,
  input: unknown,
  strongLanguage: boolean
): Promise<{ script: string; source: "llm" | "fallback" }> {
  const coachName = COACH_NAMES[coachId] ?? "Coach";
  const voiceCard = VOICE_CARDS[coachId];

  if (!client || !voiceCard) {
    return { script: FALLBACKS[kind](coachName), source: "fallback" };
  }
  const { ok } = await checkBudget(userId);
  if (!ok) return { script: FALLBACKS[kind](coachName), source: "fallback" };

  const system = `You are ${coachName}, an audio running coach. You write short scripts that are
spoken aloud by TTS, so they must sound natural in speech. Stay strictly in the voice defined below.

VOICE CARD:
${voiceCard}

GLOBAL GUARDRAILS (non-negotiable):
- Never reference data not present in the INPUT JSON.
- No medical claims. Never mock the user's body, weight, or identity.
- If input contains at_risk_occurred=true, tone is protective and calm regardless of persona.
- Language tier: ${strongLanguage ? "strong (damn/hell-level max, no F-tier)" : "clean — no profanity at all"}.
- Output ONLY the script text. No quotes, no stage directions, no preamble.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [
        {
          role: "user",
          content: `${KIND_INSTRUCTIONS[kind]}\n\nINPUT:\n${JSON.stringify(input ?? {}, null, 2)}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text");
    const script = text && text.type === "text" ? text.text.trim() : "";
    if (!script) return { script: FALLBACKS[kind](coachName), source: "fallback" };
    await recordUsage(userId, response.usage.input_tokens + response.usage.output_tokens);
    return { script, source: "llm" };
  } catch (err) {
    console.error("LLM generation failed:", err);
    return { script: FALLBACKS[kind](coachName), source: "fallback" };
  }
}
