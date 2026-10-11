"""Public challenge statements and private grader data for ZERO HOUR.

Only public_challenges() is returned to participants. Hidden tests and reference
implementations stay on the server and are sent only to the configured judge.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


_CHALLENGES: list[dict[str, Any]] = [
    {
        "id": 1,
        "title": "Alias Cleanup",
        "difficulty": "Easy",
        "concepts": ["loops", "sets", "case normalization"],
        "statement": (
            "A signup importer needs to remove repeated usernames without changing "
            "the first spelling or the original order. Treat usernames as equal "
            "when they differ only by letter case."
        ),
        "instructions": (
            "Implement solve(values). Return a list containing the first occurrence "
            "of each username, comparing with casefold(). Input is a JSON array of strings."
        ),
        "starterCode": (
            "def solve(values):\n"
            "    seen = set()\n"
            "    result = []\n"
            "    for username in values:\n"
            "        key = username.casefold()\n"
            "        if key not in seen:\n"
            "            result.append(username)\n"
            "        seen.add(username)  # BUG: tracks the original spelling\n"
            "    return result\n"
        ),
        "examples": [
            {"input": '["Nova", "orbit", "NOVA", "Orbit"]', "output": '["Nova", "orbit"]'},
            {"input": '["A", "b", "C"]', "output": '["A", "b", "C"]'},
        ],
        "tests": [
            (["Nova", "orbit", "NOVA", "Orbit"], ["Nova", "orbit"]),
            ([], []),
            (["A", "a", "á", "Á"], ["A", "á"]),
            (["z", "Z", "z", "x"], ["z", "x"]),
        ],
        "reference": (
            "def solve(values):\n"
            "    seen = set()\n"
            "    result = []\n"
            "    for username in values:\n"
            "        key = username.casefold()\n"
            "        if key not in seen:\n"
            "            result.append(username)\n"
            "            seen.add(key)\n"
            "    return result\n"
        ),
    },
    {
        "id": 2,
        "title": "Signal Climb",
        "difficulty": "Medium",
        "concepts": ["loops", "state", "edge cases"],
        "statement": (
            "A sensor records signal strengths once per second. Find the length "
            "of the longest contiguous stretch where every reading is strictly "
            "greater than the one before it."
        ),
        "instructions": (
            "Implement solve(values) and return the longest strictly increasing "
            "contiguous run length. An empty list returns 0; a single reading returns 1."
        ),
        "starterCode": (
            "def solve(values):\n"
            "    if not values:\n"
            "        return 0\n"
            "    longest = current = 1\n"
            "    for i in range(1, len(values)):\n"
            "        if values[i] > values[i - 1]:\n"
            "            current += 1\n"
 "        else:\n"
            "            current = longest  # BUG: a new run must start at 1\n"
            "        longest = max(longest, current)\n"
            "    return longest\n"
        ),
        "examples": [
            {"input": "[4, 5, 8, 2, 3, 6, 1]", "output": "3"},
            {"input": "[7, 7, 7]", "output": "1"},
        ],
        "tests": [
            ([4, 5, 8, 2, 3, 6, 1], 3),
            ([], 0),
            ([9], 1),
            ([1, 2, 3, 4, 5], 5),
            ([1, 3, 2, 4, 6], 3),
            ([7, 7, 7], 1),
        ],
        "reference": (
            "def solve(values):\n"
            "    if not values:\n"
            "        return 0\n"
            "    longest = current = 1\n"
            "    for i in range(1, len(values)):\n"
            "        if values[i] > values[i - 1]:\n"
            "            current += 1\n"
            "        else:\n"
            "            current = 1\n"
            "        longest = max(longest, current)\n"
            "    return longest\n"
        ),
    },
    {
        "id": 3,
        "title": "Room Pressure",
        "difficulty": "Medium",
        "concepts": ["conditions", "sorting", "intervals"],
        "statement": (
            "Workshop bookings are half-open intervals [start, end): a room ending "
            "at 10:00 is free for a booking that starts at 10:00. Return the peak "
            "number of workshops happening at the same time."
        ),
        "instructions": (
            "Implement solve(data), where data is {\"intervals\": [[start, end], ...]}. "
            "Return 0 for no bookings. Times are integers and every interval has start < end."
        ),
        "starterCode": (
            "def solve(data):\n"
            "    events = []\n"
            "    for start, end in data[\"intervals\"]:\n"
            "        events.append((start, 1))\n"
            "        events.append((end, -1))\n"
            "    events.sort(key=lambda event: (event[0], -event[1]))  # BUG: starts before ends\n"
            "    active = peak = 0\n"
            "    for _, change in events:\n"
            "        active += change\n"
            "        peak = max(peak, active)\n"
            "    return peak\n"
        ),
        "examples": [
            {"input": '{"intervals": [[1, 4], [4, 7], [2, 5]]}', "output": "2"},
            {"input": '{"intervals": []}', "output": "0"},
        ],
        "tests": [
            ({"intervals": [[1, 4], [4, 7], [2, 5]]}, 2),
            ({"intervals": []}, 0),
            ({"intervals": [[0, 1], [1, 2], [2, 3]]}, 1),
            ({"intervals": [[0, 10], [2, 4], [3, 7], [10, 11]]}, 3),
            ({"intervals": [[5, 9], [5, 8], [5, 7]]}, 3),
        ],
        "reference": (
            "def solve(data):\n"
            "    events = []\n"
            "    for start, end in data[\"intervals\"]:\n"
            "        events.append((start, 1))\n"
            "        events.append((end, -1))\n"
            "    events.sort(key=lambda event: (event[0], event[1]))\n"
            "    active = peak = 0\n"
            "    for _, change in events:\n"
            "        active += change\n"
            "        peak = max(peak, active)\n"
            "    return peak\n"
        ),
    },
    {
        "id": 4,
        "title": "Dead Zone",
        "difficulty": "Hard",
        "concepts": ["graphs", "queues", "breadth-first search"],
        "statement": (
            "A robot must cross a grid from S to G. Dots are open cells and # cells "
            "are blocked. It can move one cell up, down, left, or right per step. "
            "Return the shortest number of steps, or -1 if no route exists."
        ),
        "instructions": (
            "Implement solve(grid), where grid is a list of equal-length strings "
            "containing exactly one S and one G. Use a shortest-path search; start "
            "and goal cells are traversable."
        ),
        "starterCode": (
            "def solve(grid):\n"
            "    rows, cols = len(grid), len(grid[0])\n"
            "    start = goal = None\n"
            "    for r in range(rows):\n"
            "        for c in range(cols):\n"
            "            if grid[r][c] == \"S\": start = (r, c)\n"
            "            if grid[r][c] == \"G\": goal = (r, c)\n"
            "    queue = [(start[0], start[1], 0)]\n"
            "    visited = set()\n"
            "    while queue:\n"
            "        r, c, steps = queue.pop()\n"
            "        if (r, c) == goal:\n"
            "            return steps\n"
            "        if (r, c) in visited:\n"
            "            continue\n"
            "        visited.add((r, c))\n"
            "        for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)):\n"
            "            nr, nc = r + dr, c + dc\n"
            "            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != \"#\":\n"
            "                queue.append((nr, nc, steps + 1))\n"
            "    return -1\n"
        ),
        "examples": [
            {"input": '["S..", ".#.", "..G"]', "output": "4"},
            {"input": '["S#G"]', "output": "-1"},
        ],
        "tests": [
            (["S..", ".#.", "..G"], 4),
            (["S#G"], -1),
            (["S.G"], 2),
            (["S....", "####.", "....G"], 6),
            (["S#.", ".#.", "..G"], 4),
            (["S....", ".....", "....G"], 6),
            (["S...#", ".#..#", ".#..#", "..G.#"], 5),
            (["S....", ".###.", "...G."], 5),
        ],
        "reference": (
            "from collections import deque\n"
            "def solve(grid):\n"
            "    rows, cols = len(grid), len(grid[0])\n"
            "    start = goal = None\n"
            "    for r in range(rows):\n"
            "        for c in range(cols):\n"
            "            if grid[r][c] == \"S\": start = (r, c)\n"
            "            if grid[r][c] == \"G\": goal = (r, c)\n"
            "    queue = deque([(start[0], start[1], 0)])\n"
            "    visited = {start}\n"
            "    while queue:\n"
            "        r, c, steps = queue.popleft()\n"
            "        if (r, c) == goal:\n"
            "            return steps\n"
            "        for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)):\n"
            "            nr, nc = r + dr, c + dc\n"
            "            if (0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] != \"#\"\n"
            "                    and (nr, nc) not in visited):\n"
            "                visited.add((nr, nc))\n"
            "                queue.append((nr, nc, steps + 1))\n"
            "    return -1\n"
        ),
    },
    {
        "id": 5,
        "title": "Exact Change",
        "difficulty": "Hard",
        "concepts": ["dynamic programming", "edge cases", "algorithms"],
        "statement": (
            "A kiosk accepts an unlimited supply of each listed coin. Find the "
            "fewest coins that total the exact amount. Return -1 when no exact "
            "combination exists."
        ),
        "instructions": (
            "Implement solve(data), where data is {\"coins\": [positive integers], "
            "\"amount\": a non-negative integer}. You may reuse each coin any number "
            "of times. Return 0 for amount 0."
        ),
        "starterCode": (
            "def solve(data):\n"
            "    coins, amount = data[\"coins\"], data[\"amount\"]\n"
            "    coins.sort(reverse=True)\n"
            "    count = 0\n"
            "    for coin in coins:\n"
            "        used = amount // coin\n"
            "        count += used\n"
            "        amount -= used * coin\n"
            "    return count if amount == 0 else -1  # BUG: greedy is not always optimal\n"
        ),
        "examples": [
            {"input": '{"coins": [1, 3, 4], "amount": 6}', "output": "2"},
            {"input": '{"coins": [2], "amount": 3}', "output": "-1"},
        ],
        "tests": [
            ({"coins": [1, 3, 4], "amount": 6}, 2),
            ({"coins": [2], "amount": 3}, -1),
            ({"coins": [1, 5, 10, 25], "amount": 41}, 4),
            ({"coins": [7, 11], "amount": 0}, 0),
            ({"coins": [9, 6, 1], "amount": 12}, 2),
            ({"coins": [2, 5], "amount": 1}, -1),
        ],
        "reference": (
            "def solve(data):\n"
            "    coins, amount = data[\"coins\"], data[\"amount\"]\n"
            "    best = [0] + [amount + 1] * amount\n"
            "    for value in range(1, amount + 1):\n"
            "        for coin in coins:\n"
            "            if coin <= value:\n"
            "                best[value] = min(best[value], best[value - coin] + 1)\n"
            "    return best[amount] if best[amount] <= amount else -1\n"
        ),
    },
]


def public_challenges() -> list[dict[str, Any]]:
    """Return challenge statements only; never expose tests or reference solutions."""
    return [
        {key: deepcopy(value) for key, value in challenge.items() if key not in {"tests", "reference"}}
        for challenge in _CHALLENGES
    ]


def get_challenge(question_id: int) -> dict[str, Any] | None:
    if question_id < 1 or question_id > len(_CHALLENGES):
        return None
    return _CHALLENGES[question_id - 1]
