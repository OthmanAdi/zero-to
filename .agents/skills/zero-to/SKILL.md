---
name: zero-to
description: Turns any topic into a researched learning roadmap that opens as a 3D trail map in the browser, with stages, hands-on tasks, checkpoints, spaced review and only links that were opened and checked. Use whenever someone wants to learn something, asks for a study plan, learning path, curriculum, syllabus, course outline, onboarding plan or "where do I start with X", for themselves, a student, a mentee or a class they teach, in any field and in English or German, even when they never say "zero-to". Also use to recheck the links of an existing roadmap (`/zero-to recheck <file>`) or to replan one from an exported progress file (`/zero-to replan <roadmap> <progress>`).
---

# zero-to

`/zero-to <topic>` interviews the person, researches the topic, writes one roadmap file and opens it as a 3D trail map. Every stage of the roadmap is a stretch of trail ending at a camp, every step is a waypoint with a note, a hands-on task and checked sources, and every checkpoint is a signpost the learner has to pass. The site keeps progress in the learner's browser. Nothing is sent anywhere.

This skill is the method. The tools are next to it:

| Path (relative to this file) | What it is |
|---|---|
| `scripts/zero-to.mjs` | Command-line tool, plain Node (22.12 or newer), no dependencies: `validate`, `check-links`, `build`, `link`, `student`, `catalogue` |
| `viewer/zero-to.html` | The whole website as one file. `build` writes a roadmap into a copy of it |
| `schema/roadmap.schema.json` | The roadmap format (JSON Schema 2020-12) |
| `references/` | The interview, the research rules, the format, the map options, teacher mode, recheck and replan |

Run the tool as `node <this folder>/scripts/zero-to.mjs <command>`. Check `node --version` first; below 22.12, say so and stop before writing files.

## The run, in order

### 1. Read the prompt before asking anything

Fill these slots from what the person wrote: topic, audience (self, student, teacher, mentor), current level, goal, hours per week, deadline, resource languages, ages and class size. A slot the prompt states is not asked again, only echoed back ("Understood: you already write Python"). An inferred slot is asked with the inferred answer as the first option.

Then run one short scout search on the topic, so the focus question can offer real directions (for Rust: language foundations, command-line tools, web services, embedded). Skip the scout for a narrow topic.

If the person wrote `--defaults` or "you decide", ask nothing, take the recommended default of every question and list the defaults you took.

### 2. Interview

Read `references/interview.md`. It has every question, its four options with the recommended one first, the teacher branch and the map questions. Rules:

- One round is one call of the question tool with up to four questions. Learners get at most three rounds, teachers at most four.
- Use the host's question tool when there is one (`AskUserQuestion` in Claude Code). Without one, ask the same questions as a numbered list and accept answers like `1b 2a 3 "own text"`.
- The map is part of the interview: terrain (six shapes or random), trail (five templates or random), ground surfaces from foot to summit, signpost style and theme. Offer "Surprise me (seeded random)" as a real option, because a seed makes the same roadmap draw the same mountain every time.

### 3. Trip card

After the last round print the brief in a few lines: who it is for, start and summit, hours per week, total hours, projected arrival date, budget, languages, map choice. Then start the research. The person can still correct the card by typing.

### 4. Research and check every source

Read `references/research.md` before the first search. In short:

- Find sources in every allowed language. Prefer primary sources (official documentation, the standards body, the author's page, a university's open course), then established teaching platforms, then single articles or videos for a remaining gap.
- A source is `verified` only when, in this run, you fetched it, it answered 200 after at most five redirects, you read the page, it is what the entry names, and what you wrote in `why` is on the page. Cost and language must be seen on the page; a price carries the day it was seen.
- Reachable behind a login or paywall is `gated`. Could not be opened by an automated client (403, 429, timeout) is `unverified`, with a note. A dead link (404, 410, no DNS, parked) is never written.
- Never invent or reconstruct a URL from memory. If no source for a step can be verified, keep the step and write a `gap` line with search terms that should find one.
- Use `node scripts/zero-to.mjs check-links roadmap.json --receipt receipt.json` to fetch every link in one go and catch dead ones. It does not read pages for you: open each kept page and confirm the `why` line yourself.

### 5. Write the roadmap

Read `references/roadmap-format.md` for the fields and `references/map-and-assets.md` for the map options (or run `node scripts/zero-to.mjs catalogue`). Rules that make it teach:

- Two to eight stages. Each stage has a tier (bronze, silver, gold, diamond), one to nine waypoints, a checkpoint with things to show, and usually a project with rungs guided, changed and own.
- Every waypoint has a note (what the step gives you), a predict question to answer before opening the source, a concrete `do` task, minutes and practice minutes, one main resource and up to two alternatives, and up to four `takeaways`: short, specific points the learner pins into the field notebook. Write takeaways a learner can use tomorrow, never filler.
- About 70 percent of the minutes are hands-on across the roadmap and never under 60 percent in a stage.
- Minutes are estimates and say so. No streaks, no scolding, no ability tracks: one route, and learners differ by where they enter and which side trails they take.
- Write the roadmap in the person's language. German prompts get German roadmaps.

Save it as `<id>.roadmap.json` in the current folder unless the person names a place.

### 6. Validate

`node scripts/zero-to.mjs validate <file>` must report no errors. Fix every error and read every warning; a warning about the practice share or an unused resource usually means the roadmap is not finished.

### 7. Build and open

- `node scripts/zero-to.mjs build <file> --out <id>.html` writes one self-contained HTML file. It works offline and can be emailed or put on any web space. Open it for the person (`start` on Windows, `open` on macOS, `xdg-open` on Linux).
- `node scripts/zero-to.mjs link <file>` prints a share link to the hosted site that carries the whole roadmap in the address. Nothing is stored on a server.
- For a teacher, also run `student <file>` and build the student copy: it drops teacher notes, session plans and the answers to assessed checks. See `references/teacher.md`.

### 8. Report

Tell the person, in a few lines: the file paths, the share link, the stage list with total hours, the receipt ("38 opened, 31 kept, 5 dead, 2 flagged") and every source that is gated or unverified. Say plainly what you could not check.

## Other commands

- `/zero-to recheck <roadmap.json>`: reopen every link, update statuses and dates, replace dead sources with checked ones, keep the rest of the roadmap as it is. See `references/recheck-replan.md`.
- `/zero-to replan <roadmap.json> <progress.json>`: read the learner's exported progress (done steps, ratings, missed checks, pace) and rewrite the remaining route against their deadline. Never rewrite what they already walked.

## Never

- Never write a link you did not fetch in this run, and never mark a source verified without reading it.
- Never collect learner data or add accounts, trackers or analytics.
- Never put personal data of students into a roadmap.
- Never pad a roadmap with sources to look thorough. Three good volumes per stage beat seven weak ones.
