import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  device_id     TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  segment       TEXT NOT NULL DEFAULT 'S4',
  coach_id      TEXT NOT NULL DEFAULT 'B1',
  strong_language BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id),
  segment     TEXT NOT NULL,
  goal        TEXT NOT NULL,
  weeks       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id),
  client_run_id TEXT NOT NULL,
  coach_id      TEXT NOT NULL,
  mode          TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  duration_s    INT NOT NULL,
  distance_m    INT NOT NULL,
  avg_pace_s    INT,
  target_pace_s INT,
  target_met    BOOLEAN,
  was_saved     BOOLEAN NOT NULL DEFAULT FALSE,
  quit_early    BOOLEAN NOT NULL DEFAULT FALSE,
  splits        JSONB NOT NULL DEFAULT '[]',
  summary       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_run_id)
);

-- Append-only analytics spine (spec §11.4). prompt_played rows carry the
-- prompt_reaction payload (pace delta 60s post-prompt) — the moat dataset.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_type_day ON events (event_type, created_at);

-- Provider-agnostic entitlements (spec §9.1) — RevenueCat/Play wiring comes later.
CREATE TABLE IF NOT EXISTS entitlements (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id),
  provider    TEXT NOT NULL DEFAULT 'promo',
  product     TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Remote config (replaces Firebase Remote Config — spec §7.2).
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Per-user daily LLM token accounting (spec §7.2: budget enforced server-side).
CREATE TABLE IF NOT EXISTS llm_usage (
  user_id  INT NOT NULL REFERENCES users(id),
  day      DATE NOT NULL,
  tokens   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
`;

const DEFAULT_CONFIG: Record<string, unknown> = {
  paywall_gate: { variant: "trial_14d", run_threshold: 20 },
  escalation: { first_run_intensity_factor: 0.5, anti_nag_seconds: 90 },
  llm: { daily_token_budget: 20000 },
  heat_advisory: { wet_bulb_c_cap: 28 },
};

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA);
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    await pool.query(
      "INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [key, JSON.stringify(value)]
    );
  }
}
