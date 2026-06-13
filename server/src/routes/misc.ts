import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth";
import { generateTier2, Tier2Kind } from "../llm";
import { generatePlan, Segment } from "../planGenerator";

// ---------- Remote config ----------
export const configRouter = Router();

configRouter.get("/", async (_req, res) => {
  const rows = await pool.query("SELECT key, value FROM config");
  res.json(Object.fromEntries(rows.rows.map((r) => [r.key, r.value])));
});

// ---------- Plans ----------
export const plansRouter = Router();

plansRouter.post("/generate", requireAuth, async (req: AuthedRequest, res) => {
  const body = z.object({
    segment: z.enum(["S1", "S2", "S3", "S4"]),
    runsPerWeek: z.number().int().min(1).max(7),
    goal: z.string().max(200),
    targetPaceS: z.number().int().min(120).max(900).optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const weeks = generatePlan(body.data.segment as Segment, body.data.runsPerWeek, body.data.goal, body.data.targetPaceS);
  const saved = await pool.query(
    "INSERT INTO plans (user_id, segment, goal, weeks) VALUES ($1, $2, $3, $4) RETURNING id",
    [req.userId, body.data.segment, body.data.goal, JSON.stringify(weeks)]
  );
  res.json({ planId: saved.rows[0].id, weeks });
});

// ---------- Analytics ingest (event spine, spec §11.4) ----------
export const eventsRouter = Router();

eventsRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const body = z.object({
    events: z.array(z.object({ type: z.string(), payload: z.record(z.any()).optional() })).max(500),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  for (const e of body.data.events) {
    await pool.query(
      "INSERT INTO events (user_id, event_type, payload) VALUES ($1, $2, $3)",
      [req.userId, e.type, JSON.stringify(e.payload ?? {})]
    );
  }
  res.json({ ok: true, accepted: body.data.events.length });
});

// ---------- LLM proxy: Tier-2 coach moments ----------
export const coachRouter = Router();

coachRouter.post("/:kind(brief|debrief|milestone|recap)", requireAuth, async (req: AuthedRequest, res) => {
  const kind = req.params.kind as Tier2Kind;
  const user = await pool.query("SELECT coach_id, strong_language FROM users WHERE id = $1", [req.userId]);
  if (!user.rows[0]) return res.status(404).json({ error: "user not found" });
  const coachId = (req.body?.coachId as string) || user.rows[0].coach_id;
  const result = await generateTier2(req.userId!, kind, coachId, req.body?.input, user.rows[0].strong_language);
  res.json(result);
});
