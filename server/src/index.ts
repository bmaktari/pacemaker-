import express from "express";
import { z } from "zod";
import { pool, migrate } from "./db";
import { signToken, requireAuth, AuthedRequest } from "./auth";
import { generateTier2, Tier2Kind } from "./llm";
import { generatePlan, Segment } from "./planGenerator";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "pacemaker-api" }));

// ---------- Auth (device-based MVP; Google OAuth is a later swap-in) ----------
app.post("/api/auth/device", async (req, res) => {
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

// ---------- Profile (segment + coach from the wizard) ----------
app.put("/api/profile", requireAuth, async (req: AuthedRequest, res) => {
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

// ---------- Remote config (spec §7.2 — the monetization experiment depends on this) ----------
app.get("/api/config", async (_req, res) => {
  const rows = await pool.query("SELECT key, value FROM config");
  res.json(Object.fromEntries(rows.rows.map((r) => [r.key, r.value])));
});

// ---------- Plans ----------
app.post("/api/plans/generate", requireAuth, async (req: AuthedRequest, res) => {
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

// ---------- Run sync ----------
app.post("/api/runs", requireAuth, async (req: AuthedRequest, res) => {
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

app.get("/api/runs", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await pool.query(
    "SELECT * FROM runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100",
    [req.userId]
  );
  res.json(rows.rows);
});

// ---------- Analytics ingest (event spine, spec §11.4) ----------
app.post("/api/events", requireAuth, async (req: AuthedRequest, res) => {
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

// ---------- LLM proxy: Tier-2 coach moments (spec §6.1, Appendix E.5) ----------
app.post("/api/coach/:kind(brief|debrief|milestone|recap)", requireAuth, async (req: AuthedRequest, res) => {
  const kind = req.params.kind as Tier2Kind;
  const user = await pool.query("SELECT coach_id, strong_language FROM users WHERE id = $1", [req.userId]);
  if (!user.rows[0]) return res.status(404).json({ error: "user not found" });
  const coachId = (req.body?.coachId as string) || user.rows[0].coach_id;
  const result = await generateTier2(req.userId!, kind, coachId, req.body?.input, user.rows[0].strong_language);
  res.json(result);
});

const PORT = Number(process.env.PORT || 3000);
migrate()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`PaceMaker API listening on :${PORT}`)))
  .catch((err) => {
    console.error("Migration failed — is DATABASE_URL set? Provision Replit PostgreSQL.", err);
    process.exit(1);
  });
