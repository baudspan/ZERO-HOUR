CREATE TABLE IF NOT EXISTS event_config (
    id smallint PRIMARY KEY CHECK (id = 1),
    start_at timestamptz
);

INSERT INTO event_config(id, start_at) VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teams (
    team_id text PRIMARY KEY,
    team_name text NOT NULL,
    participant_names jsonb NOT NULL DEFAULT '[]'::jsonb,
    access_code_hash text NOT NULL,
    access_code_fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_team_id_casefold_unique
    ON teams (lower(team_id));

ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS access_code_fingerprint text;

UPDATE teams
SET access_code_fingerprint = 'legacy:' || md5(team_id || access_code_hash)
WHERE access_code_fingerprint IS NULL;

ALTER TABLE teams
    ALTER COLUMN access_code_fingerprint SET NOT NULL;

CREATE INDEX IF NOT EXISTS teams_access_code_fingerprint_idx
    ON teams (access_code_fingerprint);

CREATE TABLE IF NOT EXISTS question_progress (
    team_id text NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    question_id smallint NOT NULL CHECK (question_id BETWEEN 1 AND 5),
    status text NOT NULL CHECK (status IN ('locked', 'unlocked', 'solved')),
    score smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 20),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    unlocked_at timestamptz,
    solved_at timestamptz,
    draft text NOT NULL DEFAULT '',
    PRIMARY KEY (team_id, question_id)
);

CREATE TABLE IF NOT EXISTS participant_sessions (
    token_hash text PRIMARY KEY,
    team_id text NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participant_sessions_expiry_idx
    ON participant_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_events (
    id bigserial PRIMARY KEY,
    client_ip text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_events_ip_created_idx
    ON auth_events (client_ip, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_events (
    id bigserial PRIMARY KEY,
    team_id text NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('run', 'submit')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS execution_events_rate_idx
    ON execution_events (team_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS submissions (
    id bigserial PRIMARY KEY,
    team_id text NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    submission_id text NOT NULL,
    question_id smallint NOT NULL CHECK (question_id BETWEEN 1 AND 5),
    passed boolean NOT NULL,
    score_awarded smallint NOT NULL DEFAULT 0 CHECK (score_awarded BETWEEN 0 AND 20),
    submitted_at timestamptz NOT NULL,
    result jsonb NOT NULL,
    UNIQUE (team_id, submission_id)
);

CREATE INDEX IF NOT EXISTS submissions_team_question_time_idx
    ON submissions (team_id, question_id, submitted_at DESC);
