import express from "express";
import { migrate } from "./db";
import { authRouter, profileRouter } from "./routes/auth";
import { runsRouter } from "./routes/runs";
import { configRouter, plansRouter, eventsRouter, coachRouter } from "./routes/misc";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => { res.json({ ok: true, service: "pacemaker-api" }); });

app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/config", configRouter);
app.use("/api/plans", plansRouter);
app.use("/api/runs", runsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/coach", coachRouter);

const PORT = Number(process.env.PORT || 3000);
migrate()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`PaceMaker API listening on :${PORT}`)))
  .catch((err) => {
    console.error("Migration failed — is DATABASE_URL set? Provision Replit PostgreSQL.", err);
    process.exit(1);
  });
