"""ZERO HOUR FastAPI application.

Participant code is never evaluated in this process. Execution is delegated to
the separately configured Judge0-compatible sandbox in runner.py.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any
from urllib.parse import unquote

import asyncpg
import httpx
import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from jwt import PyJWKClient
from pydantic import BaseModel, Field

from challenges import get_challenge, public_challenges
from runner import runner_is_configured, run_hidden_tests, run_visible

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("zero-hour")

EVENT_DURATION_SECONDS = 15 * 60
SESSION_DURATION = timedelta(days=7)
ACCESS_CODE_ITERATIONS = 180_000
ALLOWED_PROXY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
PROXY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required; configure the workspace PostgreSQL database.")
    app.state.pool = await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=int(os.getenv("DB_POOL_MAX_SIZE", "30")),
        command_timeout=10,
    )
    schema_ready = await app.state.pool.fetchval(
        """
        SELECT bool_and(to_regclass('public.' || table_name) IS NOT NULL)
        FROM unnest($1::text[]) AS required_tables(table_name)
        """,
        [
            "event_config",
            "teams",
            "question_progress",
            "participant_sessions",
            "auth_events",
            "execution_events",
            "submissions",
        ],
    )
    if not schema_ready:
        await app.state.pool.close()
        raise RuntimeError(
            "Database schema is missing. Apply artifacts/api-server/migrations/001_initial.sql before starting the API."
        )
    yield
    await app.state.pool.close()


app = FastAPI(title="ZERO HOUR — DEBUGGER GAUNTLET", version="1.0.0", lifespan=lifespan)


class Credentials(BaseModel):
    teamId: str = Field(min_length=1, max_length=80)
    accessCode: str = Field(min_length=1, max_length=128)


class DraftInput(BaseModel):
    questionId: int = Field(ge=1, le=5)
    code: str = Field(max_length=30_000)


class CodeRunInput(BaseModel):
    code: str = Field(max_length=30_000)
    input: str = Field(max_length=10_000)


class CodeSubmissionInput(BaseModel):
    code: str = Field(max_length=30_000)
    submissionId: str = Field(min_length=8, max_length=80)


class TeamImportInput(BaseModel):
    csv: str = Field(min_length=1, max_length=200_000)


class EventScheduleInput(BaseModel):
    startAt: datetime


def now_utc() -> datetime:
    return datetime.now(UTC)


def _pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


async def _event(pool: asyncpg.Pool) -> asyncpg.Record:
    row = await pool.fetchrow("SELECT start_at FROM event_config WHERE id = 1")
    if row is None:
        raise HTTPException(status_code=503, detail="Competition schedule is not initialized.")
    return row


def _event_status(start_at: datetime | None, now: datetime) -> str:
    if start_at is None:
        return "not_scheduled"
    deadline = start_at + timedelta(seconds=EVENT_DURATION_SECONDS)
    if now < start_at:
        return "scheduled"
    if now >= deadline:
        return "ended"
    return "running"


def _event_json(start_at: datetime | None, now: datetime) -> dict[str, Any]:
    return {
        "startAt": start_at,
        "deadline": start_at + timedelta(seconds=EVENT_DURATION_SECONDS) if start_at else None,
        "durationSeconds": EVENT_DURATION_SECONDS,
        "status": _event_status(start_at, now),
    }


def _hash_access_code(code: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", code.encode(), salt, ACCESS_CODE_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def _fingerprint_access_code(code: str) -> str:
    pepper = os.getenv("SESSION_SECRET", "")
    if not pepper:
        raise HTTPException(status_code=503, detail="Session security is not configured.")
    return hmac.new(pepper.encode(), code.encode(), hashlib.sha256).hexdigest()


def _check_access_code(code: str, stored: str) -> bool:
    try:
        salt_hex, expected_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(expected_hex)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", code.encode(), salt, ACCESS_CODE_ITERATIONS)
    return hmac.compare_digest(actual, expected)


def _digest_session(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


async def _login_rate_limit(pool: asyncpg.Pool, client_ip: str) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"login:{client_ip}")
            count = await conn.fetchval(
                "SELECT count(*) FROM auth_events WHERE client_ip = $1 AND created_at > now() - interval '15 minutes'",
                client_ip,
            )
            if count >= 20:
                raise HTTPException(status_code=429, detail="Too many sign-in attempts. Try again in a few minutes.")
            await conn.execute("INSERT INTO auth_events(client_ip) VALUES($1)", client_ip)


async def _execution_rate_limit(pool: asyncpg.Pool, team_id: str, kind: str) -> None:
    max_per_minute = 12 if kind == "run" else 8
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"execution:{kind}:{team_id}")
            count = await conn.fetchval(
                """
                SELECT count(*) FROM execution_events
                WHERE team_id = $1 AND kind = $2 AND created_at > now() - interval '1 minute'
                """,
                team_id,
                kind,
            )
            if count >= max_per_minute:
                raise HTTPException(status_code=429, detail="Execution rate limit reached. Wait a moment and retry.")
            await conn.execute(
                "INSERT INTO execution_events(team_id, kind) VALUES($1, $2)",
                team_id,
                kind,
            )


async def participant_team(
    request: Request,
    pool: asyncpg.Pool = Depends(_pool),
) -> asyncpg.Record:
    token = request.cookies.get("zh_session")
    if not token:
        raise HTTPException(status_code=401, detail="Sign in with your team ID and access code.")
    row = await pool.fetchrow(
        """
        SELECT t.team_id, t.team_name, t.participant_names
        FROM participant_sessions s
        JOIN teams t ON t.team_id = s.team_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
        """,
        _digest_session(token),
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Your team session has expired. Sign in again.")
    return row


def _clerk_jwks_url() -> str:
    configured = os.getenv("CLERK_JWKS_URL", "").strip()
    if configured:
        return configured
    publishable_key = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    try:
        encoded_domain = publishable_key.split("_", 2)[2]
        padding = "=" * (-len(encoded_domain) % 4)
        domain = base64.urlsafe_b64decode(encoded_domain + padding).decode().rstrip("$")
    except (IndexError, ValueError, UnicodeDecodeError):
        domain = ""
    if not domain or "/" in domain or ":" in domain:
        raise RuntimeError("Clerk publishable key is not configured.")
    return f"https://{domain}/.well-known/jwks.json"


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    return PyJWKClient(_clerk_jwks_url(), cache_keys=True, timeout=5)


async def organizer_user(request: Request) -> dict[str, str]:
    session_token = request.cookies.get("__session")
    if not session_token:
        raise HTTPException(status_code=401, detail="Organizer sign-in required.")
    try:
        signing_key = await asyncio.to_thread(_jwks_client().get_signing_key_from_jwt, session_token)
        claims = jwt.decode(
            session_token,
            signing_key.key,
            algorithms=[signing_key.algorithm_name],
            options={"verify_aud": False},
            leeway=60,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Organizer session is invalid or expired.") from None
    user_id = str(claims.get("sub", ""))
    allowed_ids = {
        item.strip()
        for item in os.getenv("ORGANIZER_USER_IDS", "").split(",")
        if item.strip()
    }
    if not allowed_ids:
        raise HTTPException(
            status_code=503,
            detail="Organizer access is disabled until ORGANIZER_USER_IDS is configured.",
        )
    if user_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="This account is not authorized as an organizer.")
    return {"userId": user_id}


async def _active_question(pool: asyncpg.Pool, team_id: str) -> int | None:
    return await pool.fetchval(
        """
        SELECT question_id FROM question_progress
        WHERE team_id = $1 AND status = 'unlocked'
        ORDER BY question_id LIMIT 1
        """,
        team_id,
    )


async def _team_progress(pool: asyncpg.Pool, team_id: str) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        """
        SELECT p.question_id, p.status, p.score, p.attempts, p.unlocked_at, p.solved_at,
               COALESCE(
                   jsonb_agg(
                       jsonb_build_object(
                           'submittedAt', s.submitted_at,
                           'passed', s.passed,
                           'scoreAwarded', s.score_awarded
                       ) ORDER BY s.submitted_at
                   ) FILTER (WHERE s.id IS NOT NULL),
                   '[]'::jsonb
               ) AS attempt_log
        FROM question_progress p
        LEFT JOIN submissions s
          ON s.team_id = p.team_id AND s.question_id = p.question_id
        WHERE p.team_id = $1
        GROUP BY p.team_id, p.question_id
        ORDER BY p.question_id
        """,
        team_id,
    )
    return [
        {
            "questionId": row["question_id"],
            "status": row["status"],
            "score": row["score"],
            "attempts": row["attempts"],
            "unlockedAt": row["unlocked_at"],
            "solvedAt": row["solved_at"],
            "attemptLog": _json_value(row["attempt_log"]) or [],
        }
        for row in rows
    ]


async def _participant_dashboard(pool: asyncpg.Pool, team_id: str, team_name: str) -> dict[str, Any]:
    now = now_utc()
    event = await _event(pool)
    start_at = event["start_at"]
    deadline = start_at + timedelta(seconds=EVENT_DURATION_SECONDS) if start_at else None
    progress = await _team_progress(pool, team_id)
    active_id = next((item["questionId"] for item in progress if item["status"] == "unlocked"), None)
    solved_count = sum(item["status"] == "solved" for item in progress)
    total_score = sum(item["score"] for item in progress)
    status = "complete" if solved_count == 5 else _event_status(start_at, now)
    draft = None
    challenge = None
    if active_id is not None:
        draft = await pool.fetchval(
            "SELECT draft FROM question_progress WHERE team_id = $1 AND question_id = $2",
            team_id,
            active_id,
        )
        challenge = get_challenge(active_id)
        if challenge:
            challenge = {
                key: value
                for key, value in challenge.items()
                if key not in {"tests", "reference"}
            }
    finished_at = await pool.fetchval(
        "SELECT solved_at FROM question_progress WHERE team_id = $1 AND question_id = 5 AND status = 'solved'",
        team_id,
    )
    return {
        "teamId": team_id,
        "teamName": team_name,
        "serverNow": now,
        "startAt": start_at,
        "deadline": deadline,
        "status": status,
        "activeQuestionId": active_id,
        "question": challenge,
        "draft": draft,
        "progress": progress,
        "totalScore": total_score,
        "solvedCount": solved_count,
        "completedAt": finished_at,
    }


async def _require_active_question(
    pool: asyncpg.Pool,
    team_id: str,
    question_id: int,
) -> tuple[asyncpg.Record, datetime, datetime]:
    event = await _event(pool)
    start_at = event["start_at"]
    if start_at is None:
        raise HTTPException(status_code=409, detail="The organizer has not scheduled the challenge yet.")
    now = now_utc()
    deadline = start_at + timedelta(seconds=EVENT_DURATION_SECONDS)
    if now < start_at:
        raise HTTPException(status_code=409, detail="The challenge has not started yet.")
    if now >= deadline:
        raise HTTPException(status_code=410, detail="Time is up. Further submissions are closed.")
    progress = await pool.fetchrow(
        "SELECT * FROM question_progress WHERE team_id = $1 AND question_id = $2",
        team_id,
        question_id,
    )
    active_id = await _active_question(pool, team_id)
    if progress is None or progress["status"] != "unlocked" or active_id != question_id:
        raise HTTPException(status_code=403, detail="That challenge is locked.")
    return progress, start_at, deadline


def _status_for_team(start_at: datetime | None, solved_count: int, now: datetime) -> str:
    if solved_count == 5:
        return "complete"
    if start_at and now >= start_at + timedelta(seconds=EVENT_DURATION_SECONDS):
        return "expired"
    if start_at and now >= start_at:
        return "in_progress"
    return "not_started"


@app.get("/api/healthz")
async def health_check(request: Request):
    try:
        await _pool(request).fetchval("SELECT 1")
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error"})
    return {"status": "ok"}


@app.get("/api/competition")
async def get_competition(request: Request):
    now = now_utc()
    event = await _event(_pool(request))
    start_at = event["start_at"]
    return {
        "title": "ZERO HOUR — DEBUGGER GAUNTLET",
        "durationSeconds": EVENT_DURATION_SECONDS,
        "serverNow": now,
        "startAt": start_at,
        "deadline": start_at + timedelta(seconds=EVENT_DURATION_SECONDS) if start_at else None,
        "status": _event_status(start_at, now),
        "questions": public_challenges(),
    }


@app.get("/api/leaderboard")
async def get_leaderboard(request: Request):
    pool = _pool(request)
    now = now_utc()
    event = await _event(pool)
    start_at = event["start_at"]
    rows = await pool.fetch(
        """
        SELECT t.team_id, t.team_name,
               COALESCE(sum(p.score), 0)::int AS score,
               count(*) FILTER (WHERE p.status = 'solved')::int AS solved_count,
               max(p.solved_at) FILTER (WHERE p.question_id = 5 AND p.status = 'solved') AS completed_at
        FROM teams t
        LEFT JOIN question_progress p ON p.team_id = t.team_id
        GROUP BY t.team_id, t.team_name
        ORDER BY score DESC, solved_count DESC, completed_at ASC NULLS LAST, t.team_id ASC
        """
    )
    return [
        {
            "rank": index,
            "teamId": row["team_id"],
            "teamName": row["team_name"],
            "score": row["score"],
            "solvedCount": row["solved_count"],
            "status": _status_for_team(start_at, row["solved_count"], now),
            "completedAt": row["completed_at"],
        }
        for index, row in enumerate(rows, 1)
    ]


@app.post("/api/participant/session")
async def create_participant_session(
    payload: Credentials,
    request: Request,
    response: Response,
):
    pool = _pool(request)
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded.split(",", 1)[0].strip() or (request.client.host if request.client else "unknown")
    await _login_rate_limit(pool, client_ip[:120])
    team = await pool.fetchrow(
        "SELECT team_id, team_name, access_code_hash FROM teams WHERE lower(team_id) = lower($1)",
        payload.teamId.strip(),
    )
    valid = team is not None and await asyncio.to_thread(
        _check_access_code,
        payload.accessCode,
        team["access_code_hash"] if team else "",
    )
    if not valid or team is None:
        raise HTTPException(status_code=401, detail="Team ID or access code is incorrect.")
    token = secrets.token_urlsafe(32)
    await pool.execute(
        """
        INSERT INTO participant_sessions(token_hash, team_id, expires_at)
        VALUES($1, $2, $3)
        """,
        _digest_session(token),
        team["team_id"],
        now_utc() + SESSION_DURATION,
    )
    response.set_cookie(
        "zh_session",
        token,
        httponly=True,
        secure=os.getenv("NODE_ENV") == "production",
        samesite="lax",
        max_age=int(SESSION_DURATION.total_seconds()),
        path="/api",
    )
    return await _participant_dashboard(pool, team["team_id"], team["team_name"])


@app.post("/api/participant/session/logout", status_code=204)
async def delete_participant_session(request: Request, response: Response):
    token = request.cookies.get("zh_session")
    if token:
        await _pool(request).execute(
            "DELETE FROM participant_sessions WHERE token_hash = $1",
            _digest_session(token),
        )
    response.delete_cookie("zh_session", path="/api")
    response.status_code = 204
    return response


@app.get("/api/participant/me")
async def get_participant_dashboard(
    request: Request,
    team: asyncpg.Record = Depends(participant_team),
):
    return await _participant_dashboard(_pool(request), team["team_id"], team["team_name"])


@app.put("/api/participant/draft")
async def save_participant_draft(
    payload: DraftInput,
    request: Request,
    team: asyncpg.Record = Depends(participant_team),
):
    pool = _pool(request)
    current = await _active_question(pool, team["team_id"])
    if current != payload.questionId:
        raise HTTPException(status_code=403, detail="Drafts can only be saved for the unlocked challenge.")
    updated = await pool.execute(
        """
        UPDATE question_progress SET draft = $1
        WHERE team_id = $2 AND question_id = $3 AND status = 'unlocked'
        """,
        payload.code,
        team["team_id"],
        payload.questionId,
    )
    if updated.endswith("0"):
        raise HTTPException(status_code=403, detail="That challenge is locked.")
    return {"saved": True}


@app.post("/api/participant/questions/{question_id}/run")
async def run_participant_code(
    question_id: int,
    payload: CodeRunInput,
    request: Request,
    team: asyncpg.Record = Depends(participant_team),
):
    pool = _pool(request)
    await _require_active_question(pool, team["team_id"], question_id)
    await _execution_rate_limit(pool, team["team_id"], "run")
    await pool.execute(
        "UPDATE question_progress SET draft = $1 WHERE team_id = $2 AND question_id = $3",
        payload.code,
        team["team_id"],
        question_id,
    )
    return await run_visible(payload.code, payload.input)


@app.post("/api/participant/questions/{question_id}/submit")
async def submit_participant_code(
    question_id: int,
    payload: CodeSubmissionInput,
    request: Request,
    team: asyncpg.Record = Depends(participant_team),
):
    pool = _pool(request)
    existing = await pool.fetchval(
        "SELECT result FROM submissions WHERE team_id = $1 AND submission_id = $2",
        team["team_id"],
        payload.submissionId,
    )
    if existing:
        return existing if isinstance(existing, dict) else json.loads(existing)

    progress, _, _ = await _require_active_question(pool, team["team_id"], question_id)
    await _execution_rate_limit(pool, team["team_id"], "submit")
    challenge = get_challenge(question_id)
    if challenge is None:
        raise HTTPException(status_code=404, detail="Challenge not found.")
    suite = await run_hidden_tests(payload.code, challenge["tests"])
    if suite["infrastructureError"]:
        logger.warning("Sandbox unavailable during submission for team=%s question=%s", team["team_id"], question_id)
        raise HTTPException(
            status_code=503,
            detail="The isolated code runner is unavailable. No score was recorded; retry when service is restored.",
        )

    now = now_utc()
    result: dict[str, Any]
    async with pool.acquire() as conn:
        async with conn.transaction():
            previous = await conn.fetchval(
                "SELECT result FROM submissions WHERE team_id = $1 AND submission_id = $2",
                team["team_id"],
                payload.submissionId,
            )
            if previous:
                return previous if isinstance(previous, dict) else json.loads(previous)
            locked = await conn.fetchrow(
                "SELECT * FROM question_progress WHERE team_id = $1 AND question_id = $2 FOR UPDATE",
                team["team_id"],
                question_id,
            )
            current_event = await conn.fetchrow("SELECT start_at FROM event_config WHERE id = 1")
            start_at = current_event["start_at"] if current_event else None
            deadline = start_at + timedelta(seconds=EVENT_DURATION_SECONDS) if start_at else None
            if deadline is None or now < start_at or now >= deadline:
                raise HTTPException(status_code=410, detail="The official challenge window has ended.")
            active_id = await conn.fetchval(
                """
                SELECT question_id FROM question_progress
                WHERE team_id = $1 AND status = 'unlocked'
                ORDER BY question_id LIMIT 1
                """,
                team["team_id"],
            )
            if locked is None or locked["status"] != "unlocked" or active_id != question_id:
                raise HTTPException(status_code=403, detail="That challenge is locked.")

            # The row lock makes the score award and unlock transition atomic even
            # when different request IDs submit the same solved question together.
            if suite["passed"]:
                elapsed = max(0.0, (now - (locked["unlocked_at"] or start_at)).total_seconds())
                penalty = int(max(0.0, elapsed - 60.0) // 15)
                score_added = max(0, 20 - penalty)
                solved_at = now
                await conn.execute(
                    """
                    UPDATE question_progress
                    SET status = 'solved', score = $1, attempts = attempts + 1,
                        solved_at = $2, draft = $3
                    WHERE team_id = $4 AND question_id = $5
                    """,
                    score_added,
                    solved_at,
                    payload.code,
                    team["team_id"],
                    question_id,
                )
                if question_id < 5:
                    await conn.execute(
                        """
                        UPDATE question_progress
                        SET status = 'unlocked', unlocked_at = $1
                        WHERE team_id = $2 AND question_id = $3 AND status = 'locked'
                        """,
                        now,
                        team["team_id"],
                        question_id + 1,
                    )
                total_score = await conn.fetchval(
                    "SELECT COALESCE(sum(score), 0)::int FROM question_progress WHERE team_id = $1",
                    team["team_id"],
                )
                solved_count = await conn.fetchval(
                    "SELECT count(*)::int FROM question_progress WHERE team_id = $1 AND status = 'solved'",
                    team["team_id"],
                )
                completed_at = now if question_id == 5 else None
                result = {
                    "passed": True,
                    "scoreAdded": score_added,
                    "totalScore": total_score,
                    "solvedCount": solved_count,
                    "attempts": locked["attempts"] + 1,
                    "message": "All hidden checks passed.",
                    "nextQuestionId": question_id + 1 if question_id < 5 else None,
                    "completedAt": completed_at,
                }
            else:
                await conn.execute(
                    """
                    UPDATE question_progress
                    SET attempts = attempts + 1, draft = $1
                    WHERE team_id = $2 AND question_id = $3
                    """,
                    payload.code,
                    team["team_id"],
                    question_id,
                )
                total_score = await conn.fetchval(
                    "SELECT COALESCE(sum(score), 0)::int FROM question_progress WHERE team_id = $1",
                    team["team_id"],
                )
                solved_count = await conn.fetchval(
                    "SELECT count(*)::int FROM question_progress WHERE team_id = $1 AND status = 'solved'",
                    team["team_id"],
                )
                result = {
                    "passed": False,
                    "scoreAdded": 0,
                    "totalScore": total_score,
                    "solvedCount": solved_count,
                    "attempts": locked["attempts"] + 1,
                    "message": "One or more hidden checks did not pass.",
                    "nextQuestionId": None,
                    "completedAt": None,
                }
            await conn.execute(
                """
                INSERT INTO submissions(team_id, submission_id, question_id, passed, score_awarded, submitted_at, result)
                VALUES($1, $2, $3, $4, $5, $6, $7::jsonb)
                """,
                team["team_id"],
                payload.submissionId,
                question_id,
                result["passed"],
                result["scoreAdded"],
                now,
                json.dumps(result, default=lambda item: item.isoformat() if isinstance(item, datetime) else item),
            )
    return result


@app.get("/api/organizer/summary")
async def get_organizer_summary(
    request: Request,
    _: dict[str, str] = Depends(organizer_user),
):
    pool = _pool(request)
    now = now_utc()
    event = await _event(pool)
    teams = await pool.fetch(
        """
        SELECT t.team_id, count(*) FILTER (WHERE p.status = 'solved')::int AS solved_count,
               COALESCE(sum(p.score), 0)::int AS score
        FROM teams t LEFT JOIN question_progress p ON p.team_id = t.team_id
        GROUP BY t.team_id
        """
    )
    start_at = event["start_at"]
    started = sum(bool(start_at and now >= start_at) for _ in teams)
    complete = sum(row["solved_count"] == 5 for row in teams)
    expired = sum(
        bool(start_at and now >= start_at + timedelta(seconds=EVENT_DURATION_SECONDS) and row["solved_count"] < 5)
        for row in teams
    )
    average = sum(row["score"] for row in teams) / len(teams) if teams else 0
    return {
        "teamCount": len(teams),
        "startedCount": started,
        "completedCount": complete,
        "expiredCount": expired,
        "averageScore": average,
        "runnerConfigured": runner_is_configured(),
        "event": _event_json(start_at, now),
    }


@app.get("/api/organizer/participants")
async def get_organizer_participants(
    request: Request,
    search: str = "",
    status: str = "all",
    sort: str = "score",
    _: dict[str, str] = Depends(organizer_user),
):
    if status not in {"all", "in_progress", "complete", "expired", "not_started"}:
        raise HTTPException(status_code=422, detail="Unknown participant status.")
    if sort not in {"score", "team", "completion"}:
        raise HTTPException(status_code=422, detail="Unknown sort field.")
    pool = _pool(request)
    now = now_utc()
    event = await _event(pool)
    team_rows = await pool.fetch(
        """
        SELECT t.team_id, t.team_name, t.participant_names,
               COALESCE(sum(p.score), 0)::int AS score,
               count(*) FILTER (WHERE p.status = 'solved')::int AS solved_count,
               COALESCE(sum(p.attempts), 0)::int AS attempts,
               max(p.solved_at) FILTER (WHERE p.question_id = 5 AND p.status = 'solved') AS completed_at
        FROM teams t LEFT JOIN question_progress p ON p.team_id = t.team_id
        GROUP BY t.team_id, t.team_name, t.participant_names
        """
    )
    lowered_search = search.strip().casefold()
    result: list[dict[str, Any]] = []
    for row in team_rows:
        names = _json_value(row["participant_names"]) or []
        team_status = _status_for_team(event["start_at"], row["solved_count"], now)
        searchable = " ".join([row["team_id"], row["team_name"], *names]).casefold()
        if lowered_search and lowered_search not in searchable:
            continue
        if status != "all" and status != team_status:
            continue
        result.append(
            {
                "teamId": row["team_id"],
                "teamName": row["team_name"],
                "participantNames": names,
                "score": row["score"],
                "solvedCount": row["solved_count"],
                "status": team_status,
                "attempts": row["attempts"],
                "completedAt": row["completed_at"],
                "questions": await _team_progress(pool, row["team_id"]),
            }
        )
    if sort == "team":
        result.sort(key=lambda item: item["teamName"].casefold())
    elif sort == "completion":
        result.sort(key=lambda item: item["completedAt"] or datetime.max.replace(tzinfo=UTC))
    else:
        result.sort(
            key=lambda item: (
                -item["score"],
                -item["solvedCount"],
                item["completedAt"] or datetime.max.replace(tzinfo=UTC),
                item["teamId"].casefold(),
            )
        )
    return result


def _parse_import_csv(text: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include column headers.")
    normalized = {
        (header or "").strip().casefold().replace("_", " "): header
        for header in reader.fieldnames
    }

    def select_header(*aliases: str) -> str | None:
        for alias in aliases:
            if alias in normalized:
                return normalized[alias]
        return None

    id_header = select_header("team id", "teamid")
    name_header = select_header("team name", "team")
    participants_header = select_header("participant names", "participants", "participant name", "names")
    access_code_header = select_header("access code", "accesscode")
    if not id_header or not name_header or not participants_header:
        raise HTTPException(
            status_code=400,
            detail="CSV needs Team ID, Team Name, and Participant Names columns.",
        )
    parsed: list[dict[str, Any]] = []
    seen: set[str] = set()
    seen_codes: set[str] = set()
    for line_number, row in enumerate(reader, start=2):
        team_id = (row.get(id_header) or "").strip()
        team_name = (row.get(name_header) or "").strip()
        raw_names = (row.get(participants_header) or "").strip()
        access_code = (row.get(access_code_header) or "").strip() if access_code_header else None
        names = [part.strip() for part in raw_names.replace("|", ";").split(";") if part.strip()]
        folded = team_id.casefold()
        if not team_id or not team_name or not names:
            raise HTTPException(status_code=400, detail=f"CSV row {line_number} is missing a required value.")
        if access_code_header and (not access_code or len(access_code) > 128):
            raise HTTPException(status_code=400, detail=f"CSV row {line_number} needs an access code of 1–128 characters.")
        if folded in seen:
            raise HTTPException(status_code=400, detail=f"CSV has duplicate Team ID on row {line_number}.")
        if access_code:
            folded_code = access_code.casefold()
            if folded_code in seen_codes:
                raise HTTPException(status_code=400, detail=f"CSV has duplicate access codes on row {line_number}.")
            seen_codes.add(folded_code)
        seen.add(folded)
        parsed.append(
            {
                "teamId": team_id,
                "teamName": team_name,
                "participantNames": names,
                "accessCode": access_code,
            }
        )
        if len(parsed) > 500:
            raise HTTPException(status_code=400, detail="CSV may contain at most 500 teams.")
    if not parsed:
        raise HTTPException(status_code=400, detail="CSV contains no team rows.")
    return parsed


@app.post("/api/organizer/import")
async def import_organizer_teams(
    payload: TeamImportInput,
    request: Request,
    _: dict[str, str] = Depends(organizer_user),
):
    teams = _parse_import_csv(payload.csv)
    pool = _pool(request)
    codes: list[dict[str, str]] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            event = await conn.fetchrow("SELECT start_at FROM event_config WHERE id = 1")
            start_at = event["start_at"] if event else None
            for team in teams:
                existing = await conn.fetchrow(
                    "SELECT team_id FROM teams WHERE lower(team_id) = lower($1)",
                    team["teamId"],
                )
                canonical_id = existing["team_id"] if existing else team["teamId"]
                raw_code = team["accessCode"]
                for _ in range(5):
                    if raw_code is None:
                        raw_code = secrets.token_urlsafe(9)
                    fingerprint = _fingerprint_access_code(raw_code)
                    collision = await conn.fetchval(
                        """
                        SELECT team_id FROM teams
                        WHERE access_code_fingerprint = $1 AND lower(team_id) <> lower($2)
                        """,
                        fingerprint,
                        canonical_id,
                    )
                    if collision is None:
                        break
                    if team["accessCode"] is not None:
                        raise HTTPException(
                            status_code=400,
                            detail="An access code is already assigned to another team.",
                        )
                    raw_code = None
                else:
                    raise HTTPException(status_code=500, detail="Could not generate a unique access code.")
                stored_hash = await asyncio.to_thread(_hash_access_code, raw_code)
                if existing:
                    await conn.execute(
                        """
                        UPDATE teams SET team_name = $1, participant_names = $2::jsonb,
                                         access_code_hash = $3, access_code_fingerprint = $4, updated_at = now()
                        WHERE team_id = $5
                        """,
                        team["teamName"],
                        json.dumps(team["participantNames"]),
                        stored_hash,
                        fingerprint,
                        canonical_id,
                    )
                else:
                    await conn.execute(
                        """
                        INSERT INTO teams(team_id, team_name, participant_names, access_code_hash, access_code_fingerprint)
                        VALUES($1, $2, $3::jsonb, $4, $5)
                        """,
                        canonical_id,
                        team["teamName"],
                        json.dumps(team["participantNames"]),
                        stored_hash,
                        fingerprint,
                    )
                    for question_id in range(1, 6):
                        await conn.execute(
                            """
                            INSERT INTO question_progress(team_id, question_id, status, unlocked_at)
                            VALUES($1, $2, $3, $4)
                            """,
                            canonical_id,
                            question_id,
                            "unlocked" if question_id == 1 else "locked",
                            start_at if question_id == 1 else None,
                        )
                codes.append(
                    {"teamId": canonical_id, "teamName": team["teamName"], "accessCode": raw_code}
                )
    return {"imported": len(codes), "teams": codes}


@app.get("/api/organizer/export")
async def export_organizer_csv(
    request: Request,
    _: dict[str, str] = Depends(organizer_user),
):
    teams = await get_organizer_participants(request, status="all", sort="team", _={"userId": "verified"})
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(
        ["Team ID", "Team Name", "Participant Names", "Total Score", "Questions Solved", "Status", "Completion Time"]
        + [f"Q{i} Score" for i in range(1, 6)]
        + [f"Q{i} Attempts" for i in range(1, 6)]
        + [f"Q{i} Attempt Timeline" for i in range(1, 6)]
        + [f"Q{i} Unlocked At" for i in range(1, 6)]
        + [f"Q{i} Solved At" for i in range(1, 6)]
    )
    for team in teams:
        row: list[Any] = [
            team["teamId"],
            team["teamName"],
            "; ".join(team["participantNames"]),
            team["score"],
            team["solvedCount"],
            team["status"],
            team["completedAt"].isoformat() if team["completedAt"] else "",
        ]
        question_map = {item["questionId"]: item for item in team["questions"]}
        for question_id in range(1, 6):
            row.append(question_map.get(question_id, {}).get("score", 0))
        for question_id in range(1, 6):
            row.append(question_map.get(question_id, {}).get("attempts", 0))
        for question_id in range(1, 6):
            attempt_log = question_map.get(question_id, {}).get("attemptLog", [])
            row.append(
                "; ".join(
                    f"{attempt['submittedAt']}:{'passed' if attempt['passed'] else 'failed'}:+{attempt['scoreAwarded']}"
                    for attempt in attempt_log
                )
            )
        for question_id in range(1, 6):
            value = question_map.get(question_id, {}).get("unlockedAt")
            row.append(value.isoformat() if value else "")
        for question_id in range(1, 6):
            value = question_map.get(question_id, {}).get("solvedAt")
            row.append(value.isoformat() if value else "")
        writer.writerow(row)
    return Response(
        output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="zero-hour-results.csv"'},
    )


@app.put("/api/organizer/event")
async def set_organizer_event(
    payload: EventScheduleInput,
    request: Request,
    _: dict[str, str] = Depends(organizer_user),
):
    if not runner_is_configured():
        raise HTTPException(
            status_code=503,
            detail="The event cannot be scheduled until a trusted Judge0-compatible runner is configured.",
        )
    if payload.startAt.tzinfo is None:
        raise HTTPException(status_code=422, detail="Start time must include a timezone.")
    pool = _pool(request)
    start_at = payload.startAt.astimezone(UTC)
    now = now_utc()
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow("SELECT start_at FROM event_config WHERE id = 1 FOR UPDATE")
            if current and current["start_at"] and current["start_at"] <= now:
                raise HTTPException(status_code=409, detail="The official timer has already started and cannot be reset.")
            await conn.execute(
                """
                INSERT INTO event_config(id, start_at) VALUES(1, $1)
                ON CONFLICT(id) DO UPDATE SET start_at = EXCLUDED.start_at
                """,
                start_at,
            )
            await conn.execute(
                """
                UPDATE question_progress SET unlocked_at = $1
                WHERE question_id = 1 AND status = 'unlocked' AND attempts = 0
                """,
                start_at,
            )
    return _event_json(start_at, now_utc())


@app.api_route("/api/__clerk/{path:path}", methods=ALLOWED_PROXY_METHODS)
async def clerk_frontend_api_proxy(request: Request, path: str):
    """Production-only Clerk FAPI proxy matching Replit's managed Clerk setup."""
    secret_key = os.getenv("CLERK_SECRET_KEY", "")
    if os.getenv("NODE_ENV") != "production" or not secret_key:
        raise HTTPException(status_code=404, detail="Not found.")
    protocol = request.headers.get("x-forwarded-proto", "https").split(",", 1)[0].strip()
    host = request.headers.get("x-forwarded-host", request.headers.get("host", "")).split(",", 1)[0].strip()
    proxy_url = f"{protocol}://{host}/api/__clerk"
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded.split(",", 1)[0].strip() or (request.client.host if request.client else "")
    upstream_headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in PROXY_HOP_HEADERS | {"host", "content-length", "clerk-secret-key"}
    }
    upstream_headers["Clerk-Proxy-Url"] = proxy_url
    upstream_headers["Clerk-Secret-Key"] = secret_key
    if client_ip:
        upstream_headers["X-Forwarded-For"] = client_ip
    url = f"https://frontend-api.clerk.dev/{path}"
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                url,
                params=list(request.query_params.multi_items()),
                content=await request.body(),
                headers=upstream_headers,
            )
    except httpx.HTTPError:
        logger.warning("Clerk frontend API proxy request failed.")
        return Response(status_code=502, headers={"content-length": "0"})
    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in PROXY_HOP_HEADERS | {"content-length", "set-cookie"}
    }
    response_headers["content-length"] = str(len(upstream.content))
    proxied_response = Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )
    for cookie in upstream.headers.get_list("set-cookie"):
        proxied_response.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
    return proxied_response
