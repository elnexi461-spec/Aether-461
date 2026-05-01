-- ─────────────────────────────────────────────────────────────────────────────
-- AETHER D1 SCHEMA
-- Run: pnpm db:migrate:local  (local)
--      pnpm db:migrate:remote (production)
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Airdrop Earnings Log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS airdrop_earnings (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  project_id   TEXT    NOT NULL,
  project_name TEXT    NOT NULL,
  ticker       TEXT    NOT NULL,
  amount_tokens REAL   NOT NULL DEFAULT 0,
  amount_usd   REAL    NOT NULL DEFAULT 0,
  claimed_at   TEXT    NOT NULL,
  tx_hash      TEXT,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_earnings_user ON airdrop_earnings(user_id);
CREATE INDEX IF NOT EXISTS idx_earnings_project ON airdrop_earnings(project_id);

-- ── Airdrop Projects ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS airdrop_projects (
  id               TEXT    PRIMARY KEY,
  user_id          TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  ticker           TEXT    NOT NULL,
  network          TEXT    NOT NULL,
  tvl              REAL,
  funding_raised   REAL,
  task_description TEXT    NOT NULL,
  estimated_roi    REAL,
  risk_tier        TEXT    NOT NULL DEFAULT 'MODERATE',
  status           TEXT    NOT NULL DEFAULT 'TRACKING',
  added_at         TEXT    NOT NULL,
  last_action_at   TEXT,
  notes            TEXT,
  tags             TEXT    NOT NULL DEFAULT '[]',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON airdrop_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON airdrop_projects(status);

-- ── Workout Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_sessions (
  id                           TEXT     PRIMARY KEY,
  user_id                      TEXT     NOT NULL,
  date                         TEXT     NOT NULL,
  training_day                 TEXT     NOT NULL,
  exercises_json               TEXT     NOT NULL DEFAULT '[]',
  duration_minutes             INTEGER,
  bodyweight_kg                REAL,
  notes                        TEXT,
  progressive_overload_achieved INTEGER NOT NULL DEFAULT 0,
  created_at                   TEXT     NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON workout_sessions(user_id, date);

-- ── Personal Records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_records (
  id            TEXT  PRIMARY KEY,
  user_id       TEXT  NOT NULL,
  exercise_name TEXT  NOT NULL,
  weight        REAL  NOT NULL,
  reps          INTEGER NOT NULL,
  rpe           REAL,
  achieved_at   TEXT  NOT NULL,
  session_id    TEXT,
  created_at    TEXT  NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, exercise_name)
);
CREATE INDEX IF NOT EXISTS idx_pr_user ON personal_records(user_id);

-- ── CS Courses ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cs_courses (
  id               TEXT    PRIMARY KEY,
  user_id          TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  institution      TEXT,
  semester         TEXT,
  status           TEXT    NOT NULL DEFAULT 'NOT_STARTED',
  progress         REAL    NOT NULL DEFAULT 0,
  total_topics     INTEGER NOT NULL DEFAULT 0,
  completed_topics INTEGER NOT NULL DEFAULT 0,
  tags             TEXT    NOT NULL DEFAULT '[]',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_courses_user ON cs_courses(user_id);

-- ── CS Knowledge Chunks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id           TEXT  PRIMARY KEY,
  user_id      TEXT  NOT NULL,
  course_id    TEXT  NOT NULL,
  topic        TEXT  NOT NULL,
  content_type TEXT  NOT NULL DEFAULT 'NOTES',
  content      TEXT  NOT NULL,
  embedding_id TEXT,
  added_at     TEXT  NOT NULL,
  created_at   TEXT  NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (course_id) REFERENCES cs_courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_user ON knowledge_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON knowledge_chunks(course_id);

-- ── x402 Payment Events ───────────────────────────────────────────────────────
-- Immutable audit trail of all autonomous USDC payments triggered by Aether.
-- Network: Base mainnet (EIP-155:8453). Asset: USDC.
CREATE TABLE IF NOT EXISTS payment_events (
  id           TEXT  PRIMARY KEY,
  module       TEXT  NOT NULL,           -- e.g. "alpha-hunter"
  action       TEXT  NOT NULL,           -- e.g. "autonomous_premium_unlock"
  amount_usdc  REAL  NOT NULL,           -- e.g. 0.05
  recipient    TEXT  NOT NULL,           -- Base EVM address
  tx_hash      TEXT,                     -- On-chain tx hash (null if pending)
  network      TEXT  NOT NULL DEFAULT 'base',
  status       TEXT  NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed
  metadata     TEXT  NOT NULL DEFAULT '{}',        -- JSON: cdpTransferId, error, etc.
  created_at   TEXT  NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_events(status);
CREATE INDEX IF NOT EXISTS idx_payments_module ON payment_events(module);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payment_events(created_at);

-- ── Agent Event Log ───────────────────────────────────────────────────────────
-- Immutable audit trail of all significant agent actions.
CREATE TABLE IF NOT EXISTS agent_events (
  id         TEXT  PRIMARY KEY,
  user_id    TEXT  NOT NULL,
  module     TEXT  NOT NULL,
  action     TEXT  NOT NULL,
  summary    TEXT  NOT NULL,
  payload    TEXT,
  created_at TEXT  NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_module ON agent_events(user_id, module);
