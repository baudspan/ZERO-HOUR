import fs from "fs";


import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import crypto from "crypto";
import { Pool } from "pg";
// Native .env file loader
try {
  const envPaths = [".env", "../../.env", "../.env"];
  for (const ep of envPaths) {
    if (fs.existsSync(ep)) {
      const raw = fs.readFileSync(ep, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const idx = trimmed.indexOf("=");
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    }
  }
} catch (e) {
  // Ignore
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const EVENT_DURATION_SECONDS = 15 * 60; // 15 minutes

// 5 Debugging Challenges
interface Challenge {
  id: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  concepts: string[];
  statement: string;
  instructions: string;
  starterCode: string;
  examples: Array<{ input: string; output: string }>;
  tests: Array<[any, any]>;
}

const CHALLENGES: Challenge[] = [
  {
    id: 1,
    title: "Alias Cleanup",
    difficulty: "Easy",
    concepts: ["loops", "sets", "case normalization"],
    statement:
      "A signup importer needs to remove repeated usernames without changing the first spelling or the original order. Treat usernames as equal when they differ only by letter case.",
    instructions:
      "Implement solve(values). Return a list containing the first occurrence of each username, comparing with casefold(). Input is a JSON array of strings.",
    starterCode: `def solve(values):
    seen = set()
    result = []
    for username in values:
        key = username.casefold()
        if key not in seen:
            result.append(username)
        seen.add(username)  # BUG: tracks the original spelling
    return result
`,
    examples: [
      { input: '["Nova", "orbit", "NOVA", "Orbit"]', output: '["Nova", "orbit"]' },
      { input: '["A", "b", "C"]', output: '["A", "b", "C"]' },
    ],
    tests: [
      [["Nova", "orbit", "NOVA", "Orbit"], ["Nova", "orbit"]],
      [[], []],
      [["A", "a", "á", "Á"], ["A", "á"]],
      [["z", "Z", "z", "x"], ["z", "x"]],
    ],
  },
  {
    id: 2,
    title: "Signal Climb",
    difficulty: "Medium",
    concepts: ["loops", "state", "edge cases"],
    statement:
      "A sensor records signal strengths once per second. Find the length of the longest contiguous stretch where every reading is strictly greater than the one before it.",
    instructions:
      "Implement solve(values) and return the longest strictly increasing contiguous run length. An empty list returns 0; a single reading returns 1.",
    starterCode: `def solve(values):
    if not values:
        return 0
    longest = current = 1
    for i in range(1, len(values)):
        if values[i] > values[i - 1]:
            current += 1
        else:
            current = longest  # BUG: a new run must start at 1
        longest = max(longest, current)
    return longest
`,
    examples: [
      { input: "[4, 5, 8, 2, 3, 6, 1]", output: "3" },
      { input: "[7, 7, 7]", output: "1" },
    ],
    tests: [
      [[4, 5, 8, 2, 3, 6, 1], 3],
      [[], 0],
      [[9], 1],
      [[1, 2, 3, 4, 5], 5],
      [[1, 3, 2, 4, 6], 3],
      [[7, 7, 7], 1],
    ],
  },
  {
    id: 3,
    title: "Room Pressure",
    difficulty: "Medium",
    concepts: ["conditions", "sorting", "intervals"],
    statement:
      "Workshop bookings are half-open intervals [start, end): a room ending at 10:00 is free for a booking that starts at 10:00. Return the peak number of workshops happening at the same time.",
    instructions:
      'Implement solve(data), where data is {"intervals": [[start, end], ...]}. Return 0 for no bookings. Times are integers and every interval has start < end.',
    starterCode: `def solve(data):
    events = []
    for start, end in data["intervals"]:
        events.append((start, 1))
        events.append((end, -1))
    events.sort(key=lambda event: (event[0], -event[1]))  # BUG: starts before ends
    active = peak = 0
    for _, change in events:
        active += change
        peak = max(peak, active)
    return peak
`,
    examples: [
      { input: '{"intervals": [[1, 4], [4, 7], [2, 5]]}', output: "2" },
      { input: '{"intervals": []}', output: "0" },
    ],
    tests: [
      [{ intervals: [[1, 4], [4, 7], [2, 5]] }, 2],
      [{ intervals: [] }, 0],
      [{ intervals: [[0, 1], [1, 2], [2, 3]] }, 1],
      [{ intervals: [[0, 10], [2, 4], [3, 7], [10, 11]] }, 3],
      [{ intervals: [[5, 9], [5, 8], [5, 7]] }, 3],
    ],
  },
  {
    id: 4,
    title: "Dead Zone",
    difficulty: "Hard",
    concepts: ["graphs", "queues", "breadth-first search"],
    statement:
      "A robot must cross a grid from S to G. Dots are open cells and # cells are blocked. It can move one cell up, down, left, or right per step. Return the shortest number of steps, or -1 if no route exists.",
    instructions:
      "Implement solve(grid), where grid is a list of equal-length strings containing exactly one S and one G. Use a shortest-path search; start and goal cells are traversable.",
    starterCode: `def solve(grid):
    rows, cols = len(grid), len(grid[0])
    start = goal = None
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "S": start = (r, c)
            if grid[r][c] == "G": goal = (r, c)
    queue = [(start[0], start[1], 0)]
    visited = set()
    while queue:
        r, c, steps = queue.pop()
        if (r, c) == goal:
            return steps
        if (r, c) in visited:
            continue
        visited.add((r, c))
        for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != "#":
                queue.append((nr, nc, steps + 1))
    return -1
`,
    examples: [
      { input: '["S..", ".#.", "..G"]', output: "4" },
      { input: '["S#G"]', output: "-1" },
    ],
    tests: [
      [["S..", ".#.", "..G"], 4],
      [["S#G"], -1],
      [["S.G"], 2],
      [["S....", "####.", "....G"], 6],
      [["S#.", ".#.", "..G"], 4],
      [["S....", ".....", "....G"], 6],
      [["S...#", ".#..#", ".#..#", "..G.#"], 5],
      [["S....", ".###.", "...G."], 5],
    ],
  },
  {
    id: 5,
    title: "Exact Change",
    difficulty: "Hard",
    concepts: ["dynamic programming", "edge cases", "algorithms"],
    statement:
      "A kiosk accepts an unlimited supply of each listed coin. Find the fewest coins that total the exact amount. Return -1 when no exact combination exists.",
    instructions:
      'Implement solve(data), where data is {"coins": [positive integers], "amount": a non-negative integer}. You may reuse each coin any number of times. Return 0 for amount 0.',
    starterCode: `def solve(data):
    coins, amount = data["coins"], data["amount"]
    coins.sort(reverse=True)
    count = 0
    for coin in coins:
        used = amount // coin
        count += used
        amount -= used * coin
    return count if amount == 0 else -1  # BUG: greedy is not always optimal
`,
    examples: [
      { input: '{"coins": [1, 3, 4], "amount": 6}', output: "2" },
      { input: '{"coins": [2], "amount": 3}', output: "-1" },
    ],
    tests: [
      [{ coins: [1, 3, 4], amount: 6 }, 2],
      [{ coins: [2], amount: 3 }, -1],
      [{ coins: [1, 5, 10, 25], amount: 41 }, 4],
      [{ coins: [7, 11], amount: 0 }, 0],
      [{ coins: [9, 6, 1], amount: 12 }, 2],
      [{ coins: [2, 5], amount: 1 }, -1],
    ],
  },
];

// Helper to return public challenge data (excluding hidden tests)
function getPublicChallenges() {
  return CHALLENGES.map(({ id, title, difficulty, concepts, statement, instructions, starterCode, examples }) => ({
    id,
    title,
    difficulty,
    concepts,
    statement,
    instructions,
    starterCode,
    examples,
  }));
}

// In-Memory Database State
interface Team {
  teamId: string;
  teamName: string;
  participantNames: string[];
  accessCode: string;
  disqualified?: boolean;
  disqualifiedAt?: string | null;
  disqualifiedReason?: string | null;
}

interface QuestionProgress {
  questionId: number;
  status: "locked" | "unlocked" | "solved";
  score: number;
  attempts: number;
  unlockedAt: string | null;
  solvedAt: string | null;
  draft: string | null;
  attemptLog: Array<{
    submittedAt: string;
    passed: boolean;
    scoreAwarded: number;
  }>;
}

// Event state
// Event state: Initialized to current time on boot so the round is fresh (15 minutes from now)
let eventStartAt: Date = new Date();

const teamsMap = new Map<string, Team>();

// Supabase / PostgreSQL integration
const STATIC_SUPABASE_URL = "postgresql://postgres.aiqglrfwlxlzzruoxehg:FVkmm54fCX0SUl3F@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
let dbPool: Pool | null = null;

function getDbPool(): Pool | null {
  if (dbPool) return dbPool;
  const connStr = (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("[YOUR-PASSWORD]"))
    ? process.env.DATABASE_URL
    : STATIC_SUPABASE_URL;

  try {
    dbPool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
    });
    console.log("[ZERO HOUR] Connected to Supabase PostgreSQL database pool!");
    return dbPool;
  } catch (err) {
    console.error("[ZERO HOUR] Failed to initialize DB pool:", err);
    return null;
  }
}


// Auto-persist leaderboard snapshot to Supabase / DB for organizers
async function persistLeaderboardSnapshot() {
  const pool = getDbPool();
  if (!pool) return;
  try {
    // Create leaderboard_archive table if it doesn't already exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaderboard_results (
        team_id VARCHAR(100) PRIMARY KEY,
        team_name VARCHAR(255),
        marks INT DEFAULT 0,
        questions_solved INT DEFAULT 0,
        status VARCHAR(50),
        completion_time TIMESTAMPTZ,
        last_submission_time TIMESTAMPTZ,
        is_disqualified BOOLEAN DEFAULT FALSE,
        disqualified_reason TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const now = new Date();
    const startAt = eventStartAt;
    for (const [normId, team] of teamsMap) {
      const prog = progressMap.get(normId) || [];
      const score = prog.reduce((sum, p) => sum + p.score, 0);
      const solvedCount = prog.filter((p) => p.status === "solved").length;
      const q5 = prog.find((p) => p.questionId === 5);
      const completedAt = q5 && q5.status === "solved" ? q5.solvedAt : null;
      const status = getTeamStatus(startAt, solvedCount, now, normId);
      
      let lastSubmissionAt: string | null = null;
      for (const p of prog) {
        if (p.solvedAt) {
          if (!lastSubmissionAt || new Date(p.solvedAt).getTime() > new Date(lastSubmissionAt).getTime()) {
            lastSubmissionAt = p.solvedAt;
          }
        }
      }

      await pool.query(`
        INSERT INTO leaderboard_results (
          team_id, team_name, marks, questions_solved, status, completion_time, 
          last_submission_time, is_disqualified, disqualified_reason, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (team_id) DO UPDATE SET
          team_name = EXCLUDED.team_name,
          marks = EXCLUDED.marks,
          questions_solved = EXCLUDED.questions_solved,
          status = EXCLUDED.status,
          completion_time = EXCLUDED.completion_time,
          last_submission_time = EXCLUDED.last_submission_time,
          is_disqualified = EXCLUDED.is_disqualified,
          disqualified_reason = EXCLUDED.disqualified_reason,
          updated_at = NOW();
      `, [
        normId,
        team.teamName,
        score,
        solvedCount,
        status,
        completedAt,
        lastSubmissionAt,
        Boolean(team.disqualified),
        team.disqualifiedReason || null
      ]);
    }
  } catch (err: any) {
    // Non-blocking background log
    // console.warn("[ZERO HOUR] Leaderboard auto-save notice:", err.message);
  }
}

async function syncTeamsFromSupabase() {
  const pool = getDbPool();
  if (!pool) return;
  try {
    // Try querying teams table
    const res = await pool.query("SELECT * FROM teams");
    let count = 0;
    for (const row of res.rows) {
      // Support common column names, including "Team ID", "Team Name", team_id, teamId, etc.
      const rawId = row["Team ID"] || row["team_id"] || row.teamid || row.teamId || row.id;
      const rawName = row["Team Name"] || row["team_name"] || row.teamname || row.teamName || row.name || rawId;
      const rawParticipants = row["participant_names"] || row.participants || row.participantNames || [];
      const rawCode = row["access_code"] || row.accesscode || row.accessCode || "zero-hour-2026";
      
      if (!rawId) continue;
      const tId = String(rawId).trim().toUpperCase();
      const pNames = Array.isArray(rawParticipants)
        ? rawParticipants
        : typeof rawParticipants === "string"
        ? rawParticipants.split(";").map((p) => p.trim()).filter(Boolean)
        : [];
      
      teamsMap.set(tId, {
        teamId: tId,
        teamName: String(rawName).trim(),
        participantNames: pNames,
        accessCode: String(rawCode).trim() || "zero-hour-2026",
      });
      initTeamProgress(tId);
      count++;
    }
    console.log(`[ZERO HOUR] Loaded ${count} official teams from Supabase database.`);
  } catch (err: any) {
    console.error("[ZERO HOUR] Notice: Could not sync teams from Supabase table:", err.message);
  }
}

const progressMap = new Map<string, QuestionProgress[]>();

function initTeamProgress(teamId: string) {
  const startIso = eventStartAt.toISOString();
  const list: QuestionProgress[] = [
    {
      questionId: 1,
      status: "unlocked",
      score: 0,
      attempts: 0,
      unlockedAt: startIso,
      solvedAt: null,
      draft: CHALLENGES[0].starterCode,
      attemptLog: [],
    },
    {
      questionId: 2,
      status: "locked",
      score: 0,
      attempts: 0,
      unlockedAt: null,
      solvedAt: null,
      draft: CHALLENGES[1].starterCode,
      attemptLog: [],
    },
    {
      questionId: 3,
      status: "locked",
      score: 0,
      attempts: 0,
      unlockedAt: null,
      solvedAt: null,
      draft: CHALLENGES[2].starterCode,
      attemptLog: [],
    },
    {
      questionId: 4,
      status: "locked",
      score: 0,
      attempts: 0,
      unlockedAt: null,
      solvedAt: null,
      draft: CHALLENGES[3].starterCode,
      attemptLog: [],
    },
    {
      questionId: 5,
      status: "locked",
      score: 0,
      attempts: 0,
      unlockedAt: null,
      solvedAt: null,
      draft: CHALLENGES[4].starterCode,
      attemptLog: [],
    },
  ];
  progressMap.set(teamId.toUpperCase(), list);
  return list;
}

// Pre-initialize initial teams
for (const [id] of teamsMap) {
  initTeamProgress(id);
}

// Active sessions map: sessionToken -> teamId
const sessions = new Map<string, string>();

function getEventStatus(startAt: Date, now: Date): "not_scheduled" | "scheduled" | "running" | "ended" {
  if (!startAt) return "not_scheduled";
  const deadline = new Date(startAt.getTime() + EVENT_DURATION_SECONDS * 1000);
  if (now < startAt) return "scheduled";
  if (now >= deadline) return "ended";
  return "running";
}

function getTeamStatus(startAt: Date, solvedCount: number, now: Date, teamId?: string) {
  if (teamId) {
    const t = teamsMap.get(teamId.toUpperCase());
    if (t?.disqualified) return "disqualified";
  }
  if (solvedCount === 5) return "complete";
  const deadline = new Date(startAt.getTime() + EVENT_DURATION_SECONDS * 1000);
  if (now >= deadline) return "expired";
  if (now >= startAt) return "in_progress";
  return "not_started";
}

// Python Code Execution via spawn
async function runPythonScript(
  sourceCode: string,
  inputValue: any,
): Promise<{
  status: "success" | "error" | "timeout";
  stdout: string;
  stderr: string;
  executionMs: number;
  infrastructureError: boolean;
  value: any;
}> {
  const started = Date.now();

  const runnerCode = `import sys, json

try:
    raw_input = sys.stdin.read()
    if raw_input.strip():
        try:
            stdin_data = json.loads(raw_input)
        except Exception:
            stdin_data = raw_input.strip()
    else:
        stdin_data = None
except Exception:
    stdin_data = None

# User code
${sourceCode}

if 'solve' in locals():
    try:
        res = solve(stdin_data)
        print(json.dumps(res, ensure_ascii=False, separators=(',', ':')))
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
`;

  return new Promise((resolve) => {
    let stdoutData = "";
    let stderrData = "";
    let isDone = false;

    const child = spawn("python3", ["-c", runnerCode]);

    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        child.kill("SIGKILL");
        resolve({
          status: "timeout",
          stdout: stdoutData.slice(0, 5000),
          stderr: "Execution timed out (maximum 4 seconds).",
          executionMs: Date.now() - started,
          infrastructureError: false,
          value: null,
        });
      }
    }, 4000);

    child.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    child.on("error", (err) => {
      if (!isDone) {
        isDone = true;
        clearTimeout(timer);
        resolve({
          status: "error",
          stdout: "",
          stderr: `Process execution error: ${err.message}`,
          executionMs: Date.now() - started,
          infrastructureError: false,
          value: null,
        });
      }
    });

    child.on("close", (code) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      const trimmedOut = stdoutData.trim();

      if (code === 0) {
        try {
          const lines = trimmedOut.split("\n");
          const lastLine = lines[lines.length - 1];
          const val = JSON.parse(lastLine);
          resolve({
            status: "success",
            stdout: stdoutData.slice(0, 5000),
            stderr: stderrData.slice(0, 5000),
            executionMs: elapsed,
            infrastructureError: false,
            value: val,
          });
        } catch {
          resolve({
            status: "success",
            stdout: stdoutData.slice(0, 5000),
            stderr: stderrData.slice(0, 5000),
            executionMs: elapsed,
            infrastructureError: false,
            value: trimmedOut,
          });
        }
      } else {
        resolve({
          status: "error",
          stdout: stdoutData.slice(0, 5000),
          stderr: stderrData || "Execution failed with non-zero exit code.",
          executionMs: elapsed,
          infrastructureError: false,
          value: null,
        });
      }
    });

    try {
      const inputStr =
        inputValue !== undefined
          ? typeof inputValue === "string"
            ? inputValue
            : JSON.stringify(inputValue)
          : "";
      child.stdin.write(inputStr);
      child.stdin.end();
    } catch {
      child.stdin.end();
    }
  });
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

// Build Participant Dashboard object
function buildParticipantDashboard(teamId: string) {
  const normId = teamId.toUpperCase();
  const team = teamsMap.get(normId);
  const teamName = team ? team.teamName : normId;
  const progress = progressMap.get(normId) || initTeamProgress(normId);
  const now = new Date();

  const active = progress.find((p) => p.status === "unlocked");
  const solvedCount = progress.filter((p) => p.status === "solved").length;
  const totalScore = progress.reduce((sum, p) => sum + p.score, 0);

  const startAt = eventStartAt;
  const deadline = new Date(startAt.getTime() + EVENT_DURATION_SECONDS * 1000);
  const evStatus = getEventStatus(startAt, now);
  const status = team?.disqualified ? "disqualified" : (solvedCount === 5 ? "complete" : evStatus);

  let activeQuestion: any = null;
  let draft: string | null = null;

  const isExpiredOrDisqualified = Boolean(team?.disqualified) || status === "ended" || status === "expired";
  if (active && !isExpiredOrDisqualified) {
    const ch = CHALLENGES.find((c) => c.id === active.questionId);
    if (ch) {
      const { tests, ...rest } = ch;
      activeQuestion = rest;
    }
    draft = active.draft;
  }

  const q5 = progress.find((p) => p.questionId === 5);
  const completedAt = q5 && q5.status === "solved" ? q5.solvedAt : null;

  return {
    teamId: normId,
    teamName,
    serverNow: now.toISOString(),
    startAt: startAt.toISOString(),
    deadline: deadline.toISOString(),
    status,
    disqualified: Boolean(team?.disqualified),
    disqualifiedReason: team?.disqualifiedReason || null,
    activeQuestionId: active ? active.questionId : null,
    question: activeQuestion,
    draft,
    progress: progress.map((p) => ({
      questionId: p.questionId,
      status: p.status,
      score: p.score,
      attempts: p.attempts,
      unlockedAt: p.unlockedAt,
      solvedAt: p.solvedAt,
      attemptLog: p.attemptLog,
    })),
    totalScore,
    solvedCount,
    completedAt,
  };
}

async function createApp() {
  const app = express();

  app.use(cors());
  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  // API Router
  const api = express.Router();

  // Health
  api.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Competition
  api.get("/competition", (_req: Request, res: Response) => {
    const now = new Date();
    const startAt = eventStartAt;
    const deadline = new Date(startAt.getTime() + EVENT_DURATION_SECONDS * 1000);

    res.json({
      title: "ZERO HOUR — DEBUGGER GAUNTLET",
      durationSeconds: EVENT_DURATION_SECONDS,
      serverNow: now.toISOString(),
      startAt: startAt.toISOString(),
      deadline: deadline.toISOString(),
      status: getEventStatus(startAt, now),
      questions: getPublicChallenges(),
    });
  });

  // Leaderboard
  api.get("/sync-supabase", async (_req: Request, res: Response) => {
    await syncTeamsFromSupabase();
    res.json({ success: true, count: teamsMap.size });
  });

  api.get("/leaderboard", async (_req: Request, res: Response) => {
    if (teamsMap.size === 0) {
      await syncTeamsFromSupabase();
    }
    const now = new Date();
    const startAt = eventStartAt;
    const list: Array<{
      teamId: string;
      teamName: string;
      score: number;
      solvedCount: number;
      completedAt: string | null;
      lastSubmissionAt: string | null;
      status: string;
      isDisqualified: boolean;
    }> = [];

    for (const [normId, team] of teamsMap) {
      const prog = progressMap.get(normId) || [];
      const score = prog.reduce((sum, p) => sum + p.score, 0);
      const solvedCount = prog.filter((p) => p.status === "solved").length;
      const q5 = prog.find((p) => p.questionId === 5);
      const completedAt = q5 && q5.status === "solved" ? q5.solvedAt : null;
      const status = getTeamStatus(startAt, solvedCount, now, normId);
      
      // Calculate latest solved time across all solved challenges for tie-breaking by fastest submission time
      let lastSubmissionAt: string | null = null;
      for (const p of prog) {
        if (p.solvedAt) {
          if (!lastSubmissionAt || new Date(p.solvedAt).getTime() > new Date(lastSubmissionAt).getTime()) {
            lastSubmissionAt = p.solvedAt;
          }
        }
      }

      list.push({
        teamId: normId,
        teamName: team.teamName,
        score,
        solvedCount,
        completedAt,
        lastSubmissionAt,
        status,
        isDisqualified: Boolean(team.disqualified),
      });
    }

    list.sort((a, b) => {
      // Disqualified teams are always placed at the bottom
      if (a.isDisqualified !== b.isDisqualified) {
        return a.isDisqualified ? 1 : -1;
      }
      // Primary: Score out of 15 (descending)
      if (b.score !== a.score) return b.score - a.score;
      // Secondary: Solved challenges count (descending)
      if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
      // Tertiary: Timing! (Faster submission time wins earlier rank)
      if (a.completedAt && b.completedAt) {
        return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
      }
      if (a.completedAt) return -1;
      if (b.completedAt) return 1;
      if (a.lastSubmissionAt && b.lastSubmissionAt) {
        return new Date(a.lastSubmissionAt).getTime() - new Date(b.lastSubmissionAt).getTime();
      }
      if (a.lastSubmissionAt) return -1;
      if (b.lastSubmissionAt) return 1;
      return a.teamId.localeCompare(b.teamId);
    });

    const ranked = list.map((item, index) => ({
      rank: index + 1,
      ...item,
    }));

    res.json(ranked);
  });

  const UNIVERSAL_ACCESS_CODE = "zero-hour-2026";
  const ORGANIZER_KEY = process.env.ORGANIZER_KEY || "organizer-2026";

  // Organizer Authentication Verification endpoint
  api.post("/organizer/auth", (req: Request, res: Response) => {
    const { passcode } = req.body || {};
    const entered = String(passcode || "").trim();
    const isOrgMatch = !ORGANIZER_KEY || entered === ORGANIZER_KEY;
    if (isOrgMatch) {
      res.cookie("zh_organizer_key", ORGANIZER_KEY, {
        httpOnly: false,
        sameSite: "none",
        secure: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });
      res.json({ authorized: true, token: "organizer-session-token" });
    } else {
      res.status(401).json({ error: "Invalid organizer passcode. Access denied." });
    }
  });

  // Organizer Authorization Middleware - protects organizer routes from participants
  const requireOrganizer = (req: Request, res: Response, next: () => void) => {
    const orgKeyHeader = (req.headers["x-organizer-key"] || req.headers["x-organizer-token"] || "") as string;
    const orgCookie = req.cookies?.zh_organizer_key;
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const isAuthorized =
      orgKeyHeader === ORGANIZER_KEY ||
      orgCookie === ORGANIZER_KEY ||
      bearer === ORGANIZER_KEY ||
      bearer === "organizer-session-token" ||
      orgKeyHeader === "organizer-session-token" ||
      (!ORGANIZER_KEY && true);

    if (!isAuthorized) {
      res.status(403).json({
        error: "Access denied. Organizer credentials required. Participants do not have access to organizer operations.",
      });
      return;
    }
    next();
  };

  // Participant Session Login
  api.post("/participant/session", async (req: Request, res: Response) => {
    const { teamId, accessCode } = req.body || {};
    const rawTeamId = String(teamId || "").trim();
    if (!rawTeamId) {
      res.status(400).json({ error: "Please enter your assigned Team ID." });
      return;
    }

    const normId = rawTeamId.toUpperCase();
    const enteredCode = String(accessCode || "").trim();
    const effectiveCode = enteredCode || UNIVERSAL_ACCESS_CODE;

    // Check if team is in memory; if not and Supabase is connected, attempt live lookup
    let team = teamsMap.get(normId);
    if (!team && dbPool) {
      try {
        const queryRes = await pool.query(
          "SELECT * FROM teams WHERE UPPER(team_id) = $1 OR UPPER(teamid) = $1 LIMIT 1",
          [normId]
        );
        if (queryRes.rows.length > 0) {
          const row = queryRes.rows[0];
          const rawName = row.team_name || row.teamname || row.teamName || row.name || normId;
          const rawParticipants = row.participant_names || row.participants || row.participantNames || [];
          const rawCode = row.access_code || row.accesscode || row.accessCode || UNIVERSAL_ACCESS_CODE;
          const pNames = Array.isArray(rawParticipants)
            ? rawParticipants
            : typeof rawParticipants === "string"
            ? rawParticipants.split(";").map((p) => p.trim()).filter(Boolean)
            : [];
          team = {
            teamId: normId,
            teamName: String(rawName).trim(),
            participantNames: pNames,
            accessCode: String(rawCode).trim() || UNIVERSAL_ACCESS_CODE,
          };
          teamsMap.set(normId, team);
          initTeamProgress(normId);
        }
      } catch (err: any) {
        console.warn("[ZERO HOUR] Supabase lookup error:", err.message);
      }
    }

    // STRICT TEAM ID VALIDATION:
    // If teams have been loaded into the database or roster, prevent invalid team IDs!
    if (!team && teamsMap.size > 0) {
      res.status(401).json({
        error: `Invalid Team ID "${rawTeamId}". This team ID is not registered in the gauntlet roster.`
      });
      return;
    }

    // If no teams loaded anywhere yet, permit registration
    if (!team) {
      team = {
        teamId: normId,
        teamName: rawTeamId,
        participantNames: [rawTeamId],
        accessCode: effectiveCode,
      };
      teamsMap.set(normId, team);
      initTeamProgress(normId);
    }

    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, normId);

    res.cookie("zh_session", token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    const dashboard = buildParticipantDashboard(normId);
    res.json({
      ...dashboard,
      token,
      teamId: normId,
    });
  });

  // Participant Logout
  api.post("/participant/session/logout", (req: Request, res: Response) => {
    const token = req.cookies?.zh_session;
    if (token) {
      sessions.delete(token);
    }
    res.clearCookie("zh_session", { path: "/" });
    res.clearCookie("zh_session", { path: "/api" });
    res.status(204).end();
  });

  // Participant Session Resolver Middleware
  const requireParticipant = (req: Request, res: Response, next: () => void) => {
    // 1. Authorization: Bearer <token>
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    // 2. Custom header x-team-token
    if (!token && typeof req.headers["x-team-token"] === "string" && req.headers["x-team-token"].trim()) {
      token = req.headers["x-team-token"].trim();
    }

    // 3. Cookie zh_session
    if (!token) {
      token = req.cookies?.zh_session;
    }

    let teamId = token ? sessions.get(token) : null;

    // 4. Fallback by x-team-id header
    if (!teamId && typeof req.headers["x-team-id"] === "string" && req.headers["x-team-id"].trim()) {
      teamId = req.headers["x-team-id"].trim().toUpperCase();
    }

    // 5. Fallback by body teamId
    if (!teamId && req.body && typeof req.body.teamId === "string" && req.body.teamId.trim()) {
      teamId = req.body.teamId.trim().toUpperCase();
    }

    // 6. Fallback by query teamId
    if (!teamId && typeof req.query?.teamId === "string" && req.query.teamId.trim()) {
      teamId = req.query.teamId.trim().toUpperCase();
    }

    // If teamId is identified:
    if (teamId) {
      const normId = teamId.trim().toUpperCase();
      // Ensure team exists and progress is initialized even if server restarted
      if (!teamsMap.has(normId)) {
        teamsMap.set(normId, {
          teamId: normId,
          teamName: normId,
          participantNames: [normId],
          accessCode: UNIVERSAL_ACCESS_CODE,
        });
        initTeamProgress(normId);
      }
      if (token && !sessions.has(token)) {
        sessions.set(token, normId);
      }
      (req as any).teamId = normId;
      return next();
    }

    // If token exists but not in sessions map, bind to first registered team or TEAM-042
    if (token) {
      const fallbackId = teamsMap.keys().next().value || "TEAM-042";
      sessions.set(token, fallbackId);
      (req as any).teamId = fallbackId;
      return next();
    }

    // Fallback: if any team exists in development, use default team so execution is never blocked
    const defaultTeamId = teamsMap.keys().next().value || "TEAM-042";
    (req as any).teamId = defaultTeamId;
    next();
  };

  // Participant Screen Switch / Tab Leave Disqualification endpoint
  api.post("/participant/disqualify", requireParticipant, (req: Request, res: Response) => {
    const teamId = (req as any).teamId;
    const { reason } = req.body || {};
    const normId = String(teamId || "").toUpperCase();
    const team = teamsMap.get(normId);
    if (team) {
      team.disqualified = true;
      team.disqualifiedAt = new Date().toISOString();
      team.disqualifiedReason = reason || "Tab switch or screen departure detected";
      console.log(`[ZERO HOUR] Team ${normId} DISQUALIFIED. Reason: ${team.disqualifiedReason}`);
      void persistLeaderboardSnapshot();
    }
    // Lock any active question draft in progress
    const prog = progressMap.get(normId);
    if (prog) {
      for (const q of prog) {
        if (q.status === "unlocked") {
          q.status = "locked";
        }
      }
    }
    res.json({
      disqualified: true,
      teamId: normId,
      message: "Time is up. Disqualified due to tab switch or screen departure.",
    });
  });

  // Participant Dashboard
  api.get("/participant/me", requireParticipant, (req: Request, res: Response) => {
    const teamId = (req as any).teamId;
    res.json(buildParticipantDashboard(teamId));
  });

  // Save Draft
  api.put("/participant/draft", requireParticipant, (req: Request, res: Response) => {
    const teamId = (req as any).teamId;
    const { questionId, code } = req.body || {};
    const prog = progressMap.get(teamId);
    if (!prog) {
      res.status(404).json({ error: "Team progress not found." });
      return;
    }

    const q = prog.find((p) => p.questionId === Number(questionId));
    if (!q || q.status !== "unlocked") {
      res.status(403).json({ error: "That challenge is locked." });
      return;
    }

    q.draft = String(code || "");
    res.json({ saved: true });
  });

  // Run Code
  api.post(
    "/participant/questions/:questionId/run",
    requireParticipant,
    async (req: Request, res: Response) => {
      const teamId = (req as any).teamId;
      const questionId = Number(req.params.questionId);
      const { code, input } = req.body || {};

      const team = teamsMap.get(teamId);
      if (team?.disqualified) {
        res.status(403).json({ error: "Time is up. Disqualified due to screen or tab departure." });
        return;
      }
      const prog = progressMap.get(teamId);
      const q = prog?.find((p) => p.questionId === questionId);
      if (!q || q.status !== "unlocked") {
        res.status(403).json({ error: "That challenge is locked." });
        return;
      }

      q.draft = String(code || "");

      // If no custom input provided, automatically use the first test case input of this challenge
      let effectiveInput = input;
      if (effectiveInput === undefined || effectiveInput === null || (typeof effectiveInput === "string" && !effectiveInput.trim())) {
        const challenge = CHALLENGES.find((c) => c.id === questionId);
        if (challenge && challenge.tests.length > 0) {
          effectiveInput = challenge.tests[0][0];
        }
      }
      const result = await runPythonScript(String(code || ""), effectiveInput);
      res.json(result);
    },
  );

  // Submit Code
  api.post(
    "/participant/questions/:questionId/submit",
    requireParticipant,
    async (req: Request, res: Response) => {
      const teamId = (req as any).teamId;
      const questionId = Number(req.params.questionId);
      const { code } = req.body || {};

      const now = new Date();
      const startAt = eventStartAt;
      const deadline = new Date(startAt.getTime() + EVENT_DURATION_SECONDS * 1000);

      if (now >= deadline) {
        res.status(410).json({ error: "The official challenge window has ended." });
        return;
      }

      const prog = progressMap.get(teamId);
      const q = prog?.find((p) => p.questionId === questionId);
      if (!q || q.status !== "unlocked") {
        res.status(403).json({ error: "That challenge is locked." });
        return;
      }

      const challenge = CHALLENGES.find((c) => c.id === questionId);
      if (!challenge) {
        res.status(404).json({ error: "Challenge not found." });
        return;
      }

      q.attempts += 1;
      q.draft = String(code || "");

      // Run hidden tests
      let allPassed = true;
      for (const [testInput, expectedOutput] of challenge.tests) {
        const testRes = await runPythonScript(String(code || ""), testInput);
        if (testRes.status !== "success" || !deepEqual(testRes.value, expectedOutput)) {
          allPassed = false;
          break;
        }
      }

      let scoreAdded = 0;
      if (allPassed) {
        // 15 Marks Total (3 Marks per question)
        scoreAdded = 3;

        q.status = "solved";
        q.score = scoreAdded;
        q.solvedAt = now.toISOString();

        q.attemptLog.push({
          submittedAt: now.toISOString(),
          passed: true,
          scoreAwarded: scoreAdded,
        });

        // Unlock next question if not at question 5
        if (questionId < 5) {
          const nextQ = prog?.find((p) => p.questionId === questionId + 1);
          if (nextQ && nextQ.status === "locked") {
            nextQ.status = "unlocked";
            nextQ.unlockedAt = now.toISOString();
          }
        }
      } else {
        q.attemptLog.push({
          submittedAt: now.toISOString(),
          passed: false,
          scoreAwarded: 0,
        });
      }

      const totalScore = prog!.reduce((sum, p) => sum + p.score, 0);
      const solvedCount = prog!.filter((p) => p.status === "solved").length;
      const completedAt = questionId === 5 && allPassed ? now.toISOString() : null;

      res.json({
        passed: allPassed,
        scoreAdded,
        totalScore,
        solvedCount,
        attempts: q.attempts,
        message: allPassed
          ? "All hidden checks passed."
          : "One or more hidden checks did not pass.",
        nextQuestionId: allPassed && questionId < 5 ? questionId + 1 : null,
        completedAt,
      });
    },
  );

  // Organizer endpoints (gated by requireOrganizer)
  api.get("/organizer/summary", requireOrganizer, (_req: Request, res: Response) => {
    const now = new Date();
    const startAt = eventStartAt;
    const deadline = new Date(startAt.getTime() + EVENT_DURATION_SECONDS * 1000);

    const teamList = Array.from(teamsMap.keys());
    let startedCount = 0;
    let completedCount = 0;
    let expiredCount = 0;
    let totalScoreSum = 0;

    for (const id of teamList) {
      const prog = progressMap.get(id) || [];
      const score = prog.reduce((sum, p) => sum + p.score, 0);
      const solved = prog.filter((p) => p.status === "solved").length;
      totalScoreSum += score;

      if (now >= startAt) startedCount++;
      if (solved === 5) completedCount++;
      else if (now >= deadline) expiredCount++;
    }

    const averageScore = teamList.length > 0 ? Math.round(totalScoreSum / teamList.length) : 0;

    res.json({
      teamCount: teamList.length,
      startedCount,
      completedCount,
      expiredCount,
      averageScore,
      runnerConfigured: true,
      event: {
        startAt: startAt.toISOString(),
        deadline: deadline.toISOString(),
        durationSeconds: EVENT_DURATION_SECONDS,
        status: getEventStatus(startAt, now),
      },
    });
  });

  api.get("/organizer/participants", requireOrganizer, (req: Request, res: Response) => {
    const now = new Date();
    const startAt = eventStartAt;
    const search = String(req.query.search || "").toLowerCase().trim();
    const statusFilter = String(req.query.status || "all");
    const sortField = String(req.query.sort || "score");

    const result: any[] = [];

    for (const [normId, team] of teamsMap) {
      const prog = progressMap.get(normId) || [];
      const score = prog.reduce((sum, p) => sum + p.score, 0);
      const solvedCount = prog.filter((p) => p.status === "solved").length;
      const attempts = prog.reduce((sum, p) => sum + p.attempts, 0);
      const q5 = prog.find((p) => p.questionId === 5);
      const completedAt = q5 && q5.status === "solved" ? q5.solvedAt : null;
      const status = getTeamStatus(startAt, solvedCount, now, normId);

      const searchable = `${normId} ${team.teamName} ${team.participantNames.join(" ")}`.toLowerCase();
      if (search && !searchable.includes(search)) continue;
      if (statusFilter !== "all" && statusFilter !== status) continue;

      result.push({
        teamId: normId,
        teamName: team.teamName,
        participantNames: team.participantNames,
        score,
        solvedCount,
        status,
        attempts,
        completedAt,
        questions: prog.map((p) => ({
          questionId: p.questionId,
          status: p.status,
          score: p.score,
          attempts: p.attempts,
          unlockedAt: p.unlockedAt,
          solvedAt: p.solvedAt,
          attemptLog: p.attemptLog,
        })),
      });
    }

    if (sortField === "team") {
      result.sort((a, b) => a.teamName.localeCompare(b.teamName));
    } else if (sortField === "completion") {
      result.sort((a, b) => {
        if (a.completedAt && b.completedAt) {
          return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
        }
        if (a.completedAt) return -1;
        if (b.completedAt) return 1;
        return 0;
      });
    } else {
      result.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.solvedCount - a.solvedCount;
      });
    }

    res.json(result);
  });

  api.post("/organizer/import", requireOrganizer, (req: Request, res: Response) => {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== "string") {
      res.status(400).json({ error: "CSV text required." });
      return;
    }

    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      res.status(400).json({ error: "CSV must contain a header and at least one team row." });
      return;
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idIdx = headers.findIndex((h) => h.includes("team id") || h.includes("teamid") || h === "id");
    const nameIdx = headers.findIndex((h) => h.includes("team name") || h.includes("team"));
    const partIdx = headers.findIndex((h) => h.includes("participant") || h.includes("players") || h.includes("names"));
    const codeIdx = headers.findIndex((h) => h.includes("access") || h.includes("code"));

    if (idIdx === -1 || nameIdx === -1) {
      res.status(400).json({ error: "CSV needs Team ID and Team Name columns." });
      return;
    }

    const created: Array<{ teamId: string; teamName: string; accessCode: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map((p) => p.trim());
      const teamId = (parts[idIdx] || "").toUpperCase();
      const teamName = parts[nameIdx] || teamId;
      const participantNames = partIdx !== -1 && parts[partIdx]
        ? parts[partIdx].split(";").map((p) => p.trim()).filter(Boolean)
        : [];
      const accessCode = (codeIdx !== -1 && parts[codeIdx]) ? parts[codeIdx] : UNIVERSAL_ACCESS_CODE;

      if (!teamId) continue;

      teamsMap.set(teamId, {
        teamId,
        teamName,
        participantNames,
        accessCode,
      });

      if (!progressMap.has(teamId)) {
        initTeamProgress(teamId);
      }

      created.push({ teamId, teamName, accessCode });
    }

    res.json({ imported: created.length, teams: created });
  });

  api.post("/organizer/save-leaderboard", requireOrganizer, async (_req: Request, res: Response) => {
    await persistLeaderboardSnapshot();
    res.json({ success: true, message: "Leaderboard results snapshot saved successfully to database." });
  });

  api.get("/organizer/export", requireOrganizer, (_req: Request, res: Response) => {
    const now = new Date();
    const startAt = eventStartAt;
    const rows = [
      [
        "Team ID",
        "Team Name",
        "Participant Names",
        "Total Score",
        "Questions Solved",
        "Status",
        "Completion Time",
        "Q1 Score",
        "Q2 Score",
        "Q3 Score",
        "Q4 Score",
        "Q5 Score",
        "Q1 Attempts",
        "Q2 Attempts",
        "Q3 Attempts",
        "Q4 Attempts",
        "Q5 Attempts",
      ].join(","),
    ];

    for (const [normId, team] of teamsMap) {
      const prog = progressMap.get(normId) || [];
      const score = prog.reduce((sum, p) => sum + p.score, 0);
      const solved = prog.filter((p) => p.status === "solved").length;
      const status = getTeamStatus(startAt, solved, now, normId);
      const q5 = prog.find((p) => p.questionId === 5);
      const completed = q5 && q5.status === "solved" ? q5.solvedAt : "";

      const scores = [1, 2, 3, 4, 5].map((qid) => {
        const q = prog.find((p) => p.questionId === qid);
        return q ? q.score : 0;
      });
      const attempts = [1, 2, 3, 4, 5].map((qid) => {
        const q = prog.find((p) => p.questionId === qid);
        return q ? q.attempts : 0;
      });

      rows.push(
        [
          `"${normId}"`,
          `"${team.teamName}"`,
          `"${team.participantNames.join("; ")}"`,
          score,
          solved,
          status,
          `"${completed || ""}"`,
          ...scores,
          ...attempts,
        ].join(","),
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="zero-hour-results.csv"');
    res.send(rows.join("\n"));
  });

  api.put("/organizer/event", requireOrganizer, (req: Request, res: Response) => {
    const { startAt } = req.body || {};
    if (!startAt) {
      res.status(400).json({ error: "startAt is required." });
      return;
    }

    eventStartAt = new Date(startAt);
    const now = new Date();

    // Reset Q1 unlock times for teams that haven't made attempts
    for (const [, list] of progressMap) {
      const q1 = list.find((p) => p.questionId === 1);
      if (q1 && q1.attempts === 0 && q1.status === "unlocked") {
        q1.unlockedAt = eventStartAt.toISOString();
      }
    }

    const deadline = new Date(eventStartAt.getTime() + EVENT_DURATION_SECONDS * 1000);
    res.json({
      startAt: eventStartAt.toISOString(),
      deadline: deadline.toISOString(),
      durationSeconds: EVENT_DURATION_SECONDS,
      status: getEventStatus(eventStartAt, now),
    });
  });

  // Mount API router
  app.use("/api", api);

  // Development: Vite middlewares; Production: Static serve
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: HOST,
        hmr: false,
      },
      appType: "spa",
      root: __dirname,
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist/public")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(__dirname, "dist/public/index.html"));
    });
  }

  await syncTeamsFromSupabase();
  app.listen(PORT, HOST, () => {
    console.log(`[ZERO HOUR] Server listening at http://${HOST}:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
