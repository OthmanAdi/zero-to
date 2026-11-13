# The roadmap file

One JSON file, `schema: "zero-to/1"`, described by `schema/roadmap.schema.json`. `node scripts/zero-to.mjs validate <file>` checks the schema and the rules a schema cannot express. A complete example ships with the project: `src/roadmap/samples/rust-for-a-python-dev.json`.

## Contents

- [How the file becomes a trail](#how-the-file-becomes-a-trail)
- [Top level](#top-level)
- [Stage](#stage)
- [Waypoint](#waypoint)
- [Checks](#checks)
- [Checkpoint](#checkpoint)
- [Project](#project)
- [Resource](#resource)
- [Map](#map)
- [Rules the validator adds](#rules-the-validator-adds)
- [Progress is not in this file](#progress-is-not-in-this-file)

## How the file becomes a trail

| In the file | On the map |
|---|---|
| `stages[]` | One map panel each, ending at a camp |
| `stage.tier` | The altitude band. Each tier owns a quarter of the height, so a roadmap that ends at silver is a lower mountain than one that ends at diamond |
| `stage.waypoints[]` | Points on the dashed route, each with a floating note |
| `waypoint.optional` | A dotted side trail that leaves and rejoins the route |
| `waypoint.takeaways` | "Take with you" points the learner pins into the field notebook |
| `stage.checkpoint` | A signpost with one arm per `show` item |
| `stage.project` | The camp, with one flag per rung |
| `resources[]` | Volumes on the shelf, for the step the walker stands on |
| `brief.entry` | Where the red pin goes in |
| `brief.deadline`, `brief.hoursPerWeek` | The pace line and arrival date on the profile strip |
| `reviewDays` | Review cairns on the walked part of the route |
| `class.sessions[]` | The class flag on a teacher's map |

Hours are counted from waypoint `minutes`. Height is never printed in metres: it reads as tier names.

## Top level

Required: `schema`, `id` (lowercase letters, digits and hyphens, at most 48), `title` (at most 80), `topic` (the prompt as typed), `lang` (the language the roadmap is written in), `checkedOn` (day of the last full link check), `brief`, `stages`, `resources`.

Optional: `summary` (at most 280), `freshness` (`fast`, `medium`, `slow`), `reviewDays` (default `[2, 7, 21, 60]`), `capstone` (`title`, `brief`), `class`, `map`.

`brief` requires `audience` (`self`, `student`, `teacher`), `startLevel` (`zero`, `adjacent`, `stuck`, `gaps`), `targetTier` and `hoursPerWeek`. It may hold `goal` (one sentence in the person's words), `entry`, `startDate`, `deadline`, `style`, `budget` (`max`, `currency`), `resourceLangs`, `projects`, `gating` and `theme`.

## Stage

Required: `id`, `title` (at most 60), `tier`, `waypoints` (1 to 9), `checkpoint`. Optional: `summary` (at most 200), `requires` (stage ids; default the stage before), `project`.

## Waypoint

Required: `id`, `title` (at most 60), `note` (at most 240: what this step gives you), `do` (the hands-on task and what to look at when it is done), `minutes` (at least 5), `practiceMinutes`, `resources` (resource ids, the first is the main one).

Optional: `predict` (one question to answer before opening a source), `takeaways` (up to 4 points of at most 140 characters), `requires`, `optional`, `gap` (written when no source could be verified), `checks` (up to 4), `teacherNote` (removed from the student copy).

Good takeaways are things the learner can act on: "The ? operator returns the error early, so it only works in a function that returns a Result." Bad takeaways restate the title.

## Checks

`q`, `kind` (`recall`, `predict`, `apply`, `explain`) and `answer` (the model answer, or why the correct option is correct) are required. Multiple choice adds `options` (2 to 5) and `correct` (an index). `onMiss` names a waypoint to walk to after a miss.

## Checkpoint

`title` and `show` are required: one to five things the learner can show, test or explain, never trivia. Each is one arm of the signpost. Optional: `signpost` (an asset key, see map-and-assets.md), `checks` (up to 6) and `pass` (share of arms needed, default 0.8).

## Project

`title`, `brief` and `rungs` (one to three of `guided`, `changed`, `own`, each with a `task`) are required. Optional: `minutes`, `capstone` (continues the roadmap's capstone), `resources`, `choices` (the same menu for everyone) and `criteria` (up to 5).

## Resource

Required: `id`, `title`, `url` (http or https), `type` (`docs`, `book`, `course`, `video`, `article`, `interactive`, `exercises`, `tool`, `reference`, `community`), `cost` (`free`, `freemium`, `paid`), `lang`, `level` (a tier), `why` (at most 200: why it is on the list for this step) and `check` (`status`, `on`, `http`, and a `note` unless verified).

Optional: `by`, `price` (`amount`, `currency`, `per`, `seenOn`), `minutes`, `updated` (the source's own date, copied as printed).

## Map

All optional. `terrain` (a mountain shape or `random`), `trail` (a trail template or `random`), `seed` (default: the roadmap id), `surfaces` (ground bands from foot to summit, or `auto`), `signpost` (default style) and `theme`. See map-and-assets.md.

## Rules the validator adds

- Ids are unique, and every id a field names exists.
- Prerequisites form no cycle.
- Every resource is used by a waypoint or a project.
- Every waypoint has a verified source or a `gap` line.
- At least 60 percent of each stage's minutes are hands-on (warning), and 70 percent overall (warning).
- Dates are real dates, and the deadline comes after the start.
- Unknown fields are errors, with the nearest known field name suggested.

## Progress is not in this file

Progress (done steps, ratings, answers, notes, pinned notebook entries) lives in each learner's browser and exports as its own file. One roadmap file can be shared with thirty students and each keeps their own trail.
