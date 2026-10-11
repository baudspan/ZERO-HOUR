# ZERO HOUR — DEBUGGER GAUNTLET

React/TypeScript participant and organizer app, FastAPI service, and PostgreSQL persistence. The organizer console is protected by Clerk and a server-side user-ID allowlist. Participant code is sent only to the configured Judge0-compatible sandbox; the API server never evaluates submitted Python locally.

## Before the event

1. **Prepare PostgreSQL.** Apply `artifacts/api-server/migrations/001_initial.sql` to the database used by the API. The API checks for the required tables at startup and will stop with an actionable error if the migration is missing. Apply it separately to each environment you will use.
2. **Configure the isolated runner.** Set `JUDGE0_URL` to an HTTPS Judge0-compatible submission endpoint. Add `JUDGE0_API_KEY` through Replit Secrets if the provider requires one. The default auth header is `X-Auth-Token`; override it with `JUDGE0_AUTH_HEADER` when required. Set `JUDGE0_API_HOST` for providers that require a separate host header. `JUDGE0_LANGUAGE_ID` defaults to `71` (Python 3 on Judge0 CE).
   - Use a runner configured to deny outbound network access and enforce CPU, wall-clock, memory, process, and filesystem limits.
   - No runner is connected in this workspace yet. Run and submit stay fail-closed, and the event schedule control is disabled until `JUDGE0_URL` is set.
   - A configured URL is not proof the provider is online. Smoke-test the provider before the event; a runner outage never earns points or unlocks a question.
3. **Allowlist organizers.** Sign in to Clerk, copy the displayed Clerk user ID, and set `ORGANIZER_USER_IDS` to a comma-separated list of exact user IDs. Keep the list limited to event organizers. Without an allowlist, organizer APIs deny access.
4. **Import team records.** Upload a UTF-8 CSV with `Team ID`, `Team Name`, and `Participant Names` headers. Separate multiple names with `;` or `|`. `Access Code` is optional. If omitted, the API generates a unique code and returns it once with the import result. Save and distribute those codes securely. Re-importing a team preserves its scores but replaces its code.
5. **Schedule the event.** Choose the official start time from the organizer dashboard. The 15-minute timer is based on server time. The schedule cannot be paused or reset after it starts.

Configure environment variables and secrets in Replit's workspace settings; do not commit credentials or put them in this file. `DATABASE_URL`, `SESSION_SECRET`, and Clerk's managed keys are provided by the workspace. `SESSION_SECRET` must remain stable so duplicate access-code detection stays consistent.

## Participant flow and scoring

- Participants sign in with their registered Team ID and access code. The server keeps session, drafts, progress, scores, and timestamps in PostgreSQL.
- Five original Python challenges unlock in order. **Run Code** uses only the supplied custom input and never scores. **Submit** sends the solution to the isolated runner's hidden tests. A runner error awards no points and does not unlock the next challenge.
- A passing answer earns 20 points if submitted within 60 seconds after that question unlocks. After that, one point is deducted for each additional 15 seconds, to a floor of zero. Each challenge is worth at most 20 points; the total is 100.
- The server calculates time and scores, serializes concurrent progress updates, and makes repeated requests with the same submission ID idempotent. The leaderboard is built from database records.
- On completion, the app records the completion time and displays **“The sixth sick sheik’s sixth sheep’s sick.”** with a button that speaks it three times.

## Recovery

- **Runner missing or unavailable before the event:** do not schedule the start. Configure and smoke-test the isolated service first. The API intentionally has no local-execution fallback.
- **Runner outage during the event:** runs and submissions fail without adding score or unlocking a challenge. The 15-minute clock continues and cannot be paused from the dashboard. Restore the runner; preserve existing database progress and use the event's announced fairness policy rather than editing scores directly.
- **Database outage:** the health endpoint returns an error, and API operations fail rather than fabricating state. Restore PostgreSQL connectivity and restart the API. Sessions and accepted scores are persisted in the database.
- **Expired event:** progress and scores remain available in the organizer dashboard and CSV export. The app has no organizer reset control.
- **Lost team code:** re-import that team with a replacement code and distribute the returned code securely. Existing progress is retained.

## Verification status

The five reference solutions were checked against 26 local challenge cases. The live Judge0-compatible runner is not configured in this workspace, so participant code execution, hidden-test submissions, end-to-end progression, and 50-person load have not been verified here. Complete a runner smoke test and event rehearsal before using this for a live competition.
