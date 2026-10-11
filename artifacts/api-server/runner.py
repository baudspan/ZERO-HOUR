"""Fail-closed adapter for a trusted, separately hosted Judge0-compatible sandbox."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx

_submission_limit = asyncio.Semaphore(10)


def runner_is_configured() -> bool:
    return _configuration() is not None


def _configuration() -> tuple[str, dict[str, str]] | None:
    base_url = os.getenv("JUDGE0_URL", "").strip().rstrip("/")
    if not base_url:
        return None
    parsed = urlparse(base_url)
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"}:
        return None

    headers: dict[str, str] = {"Content-Type": "application/json"}
    api_key = os.getenv("JUDGE0_API_KEY", "")
    if api_key:
        auth_header = os.getenv("JUDGE0_AUTH_HEADER", "X-Auth-Token").strip()
        if not auth_header or any(ch in auth_header for ch in "\r\n:"):
            return None
        headers[auth_header] = api_key
    api_host = os.getenv("JUDGE0_API_HOST", "").strip()
    if api_host:
        headers["X-RapidAPI-Host"] = api_host
    return base_url, headers


def _wrapper(source_code: str) -> str:
    return (
        source_code
        + "\n\nimport json as _zh_json\nimport sys as _zh_sys\n"
        + "_zh_data = _zh_json.load(_zh_sys.stdin)\n"
        + "_zh_result = solve(_zh_data)\n"
        + "print(_zh_json.dumps(_zh_result, ensure_ascii=False, separators=(',', ':')))\n"
    )


async def _execute(source_code: str, input_value: Any) -> dict[str, Any]:
    configuration = _configuration()
    if configuration is None:
        return {
            "status": "unavailable",
            "stdout": "",
            "stderr": "A trusted Judge0-compatible sandbox is not configured.",
            "executionMs": 0,
            "infrastructureError": True,
            "value": None,
        }
    base_url, headers = configuration
    try:
        language_id = int(os.getenv("JUDGE0_LANGUAGE_ID", "71"))
    except ValueError:
        language_id = 71

    payload = {
        "source_code": _wrapper(source_code),
        "language_id": language_id,
        "stdin": json.dumps(input_value, ensure_ascii=False, separators=(",", ":")),
        "cpu_time_limit": 2,
        "wall_time_limit": 4,
        "memory_limit": 65536,
        "stack_limit": 8192,
        "max_file_size": 4096,
    }
    started = time.monotonic()
    try:
        async with _submission_limit:
            async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0), follow_redirects=False) as client:
                response = await client.post(
                    f"{base_url}/submissions",
                    params={"base64_encoded": "false", "wait": "true"},
                    headers=headers,
                    json=payload,
                )
        if response.status_code < 200 or response.status_code >= 300:
            return {
                "status": "unavailable",
                "stdout": "",
                "stderr": "The external code execution service returned an error.",
                "executionMs": int((time.monotonic() - started) * 1000),
                "infrastructureError": True,
                "value": None,
            }
        result = response.json()
        status_id = int((result.get("status") or {}).get("id", 0))
        stdout = (result.get("stdout") or "")[:5000]
        stderr = (result.get("stderr") or result.get("compile_output") or "")[:5000]
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if status_id == 3:
            try:
                value = json.loads(stdout.strip())
            except (ValueError, TypeError):
                return {
                    "status": "error",
                    "stdout": stdout,
                    "stderr": "Your program must return a JSON-compatible value from solve(data).",
                    "executionMs": elapsed_ms,
                    "infrastructureError": False,
                    "value": None,
                }
            return {
                "status": "success",
                "stdout": stdout,
                "stderr": stderr,
                "executionMs": elapsed_ms,
                "infrastructureError": False,
                "value": value,
            }
        if status_id == 5:
            status = "timeout"
        elif status_id in {1, 2, 13, 14}:
            return {
                "status": "unavailable",
                "stdout": "",
                "stderr": "The sandbox did not complete the execution.",
                "executionMs": elapsed_ms,
                "infrastructureError": True,
                "value": None,
            }
        else:
            status = "error"
        return {
            "status": status,
            "stdout": stdout,
            "stderr": stderr or "The program exited with an error.",
            "executionMs": elapsed_ms,
            "infrastructureError": False,
            "value": None,
        }
    except (httpx.TimeoutException, httpx.NetworkError, ValueError):
        return {
            "status": "unavailable",
            "stdout": "",
            "stderr": "The external code execution service is unavailable.",
            "executionMs": int((time.monotonic() - started) * 1000),
            "infrastructureError": True,
            "value": None,
        }


async def run_visible(source_code: str, input_text: str) -> dict[str, Any]:
    try:
        parsed_input = json.loads(input_text)
    except ValueError:
        return {
            "status": "error",
            "stdout": "",
            "stderr": "Input must be valid JSON.",
            "executionMs": 0,
        }
    result = await _execute(source_code, parsed_input)
    return {key: result[key] for key in ("status", "stdout", "stderr", "executionMs")}


async def run_hidden_tests(source_code: str, cases: list[tuple[Any, Any]]) -> dict[str, Any]:
    # A sandbox outage must never become a failed submission or award partial credit.
    results = await asyncio.gather(*(_execute(source_code, input_value) for input_value, _ in cases))
    for result in results:
        if result["infrastructureError"]:
            return {"infrastructureError": True, "passed": False}
    return {
        "infrastructureError": False,
        "passed": all(
            result["status"] == "success" and result["value"] == expected
            for result, (_, expected) in zip(results, cases)
        ),
    }
