import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { signToken, requireAuth, AuthedRequest } from "../auth";

export const authRouter = Router();

// Device-based MVP auth; Google OAuth is a later swap-in.
authRouter.post("/device", async (req, res) => {
  const body = z.object({ deviceId: z.string().min(8), displayName: z.string().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { deviceId, displayName } = body.data;
  const result = await pool.query(
    `INSERT INTO users (device_id, display_name) VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE SET display_name = COALESCE($2, users.display_name)
     RETURNING id, segment, coach_id, strong_language`,
    [deviceId, displayName ?? null]
  );
  const user = result.rows[0];
  res.json({ token: signToken(user.id), profile: user });
});

export const profileRouter = Router();

profileRouter.put("/", requireAuth, async (req: AuthedRequest, res) => {
  const body = z.object({
    segment: z.enum(["S1", "S2", "S3", "S4"]).optional(),
    coachId: z.string().regex(/^[ABC][123]$/).optional(),
    strongLanguage: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { segment, coachId, strongLanguage } = body.data;
  await pool.query(
    `UPDATE users SET segment = COALESCE($2, segment), coach_id = COALESCE($3, coach_id),
       strong_language = COALESCE($4, strong_language) WHERE id = $1`,
    [req.userId, segment ?? null, coachId ?? null, strongLanguage ?? null]
  );
  res.json({ ok: true });
});
