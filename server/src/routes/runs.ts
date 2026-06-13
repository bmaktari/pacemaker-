import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth";

export const runsRouter = Router();

runsRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const body = z.object({
    clientRunId: z.string(),
    coachId: z.string(),
    mode: z.string(),
    startedAt: z.string(),
    durationS: z.number().int().nonnegative(),
    distanceM: z.number().int().nonnegative(),
    avgPaceS: z.number().int().nullable().optional(),
    targetPaceS: z.number().int().nullable().optional(),
    targetMet: z.boolean().nullable().optional(),
    wasSaved: z.boolean().optional(),
    quitEarly: z.boolean().optional(),
    splits: z.array(z.any()).optional(),
    summary: z.record(z.any()).optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const d = body.data;
  await pool.query(
    `INSERT INTO runs (user_id, client_run_id, coach_id, mode, started_at, duration_s, distance_m,
       avg_pace_s, target_pace_s, target_met, was_saved, quit_early, splits, summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (user_id, client_run_id) DO NOTHING`,
    [req.userId, d.clientRunId, d.coachId, d.mode, d.startedAt, d.durationS, d.distanceM,
     d.avgPaceS ?? null, d.targetPaceS ?? null, d.targetMet ?? null, d.wasSaved ?? false,
     d.quitEarly ?? false, JSON.stringify(d.splits ?? []), JSON.stringify(d.summary ?? {})]
  );
  res.json({ ok: true });
});

runsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await pool.query(
    "SELECT * FROM runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100",
    [req.userId]
  );
  res.json(rows.rows);
});
