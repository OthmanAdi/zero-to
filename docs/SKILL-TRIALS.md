# Skill trials

Runs of the skill in a fresh agent session, recorded against the scenarios in [`evals/evals.json`](../.agents/skills/zero-to/evals/evals.json). A trial counts only when the skill was installed the way a user installs it and the agent had no other context.

## 2026-11-13: `defaults-and-random-map` with a topic outside the gallery

- Install: `skills` CLI 1.8.1 from a local checkout into an empty folder, for Claude Code and Codex (telemetry off).
- Agent: Claude Code 2.1.323 in headless mode, model `claude-sonnet-5-5`. Tools allowed: reading and writing files, web search, web fetch and `node`. Opening a browser was not allowed.
- Prompt: `/zero-to sourdough bread baking --defaults`
- Run: 29 turns, 4 minutes 23 seconds.

Results against the scenario:

| Expectation | Result |
|---|---|
| The agent asked no questions and listed every default it took | Met. It listed audience, level, target tier, hours per week, start date, style, source language, budget, project, gating and map. |
| `map.terrain` and `map.trail` are random or absent, with a fixed seed | Met. Both are `random`, and `map.seed` is the roadmap id. |
| The roadmap validates | Met. `validate` exits 0 with no errors. |
| Every waypoint has at least one verified source or a gap line | Met. 9 waypoints, each with one to three verified sources, no gap lines needed. |

What it produced: 3 stages (bronze, bronze, silver), 9 waypoints, about 14 hours, 14 sources from five sites, all opened and kept. The agent dropped two addresses it had guessed after they returned 404, dropped one page it judged to be affiliate filler, and said which pages it had read only in part. Four of those pages carry a check note saying how much was read. Two pages it said it had read only from summaries (a Dutch oven guide and a scoring and baking guide) are marked verified without such a note. The research rules did not yet say what to do with a page read only as a summary; after this trial they ask for a note in that case. It built the HTML page and printed a share link of 7,473 characters.

Not covered by this trial: the interview rounds (skipped by `--defaults`), the trip card, the teacher branch, German output, recheck and replan, and a run in Codex.
