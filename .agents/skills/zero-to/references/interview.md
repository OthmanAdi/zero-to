# The interview

Ask only what the prompt did not answer. The first option of every question is the recommended default. Every question also accepts the host's free-text "Other".

Rounds hold up to four questions. Learners get at most three rounds, teachers at most four. When a round would hold a single question, move it into the round before or after.

## Contents

- [Round 1: destination](#round-1-destination-everyone)
- [Round 2: time and supplies](#round-2-time-and-supplies-learners-and-students)
- [Round 3: route and map](#round-3-route-and-map-learners-and-students)
- [Teacher branch](#teacher-branch)
- [Placement check](#placement-check)
- [Without a question tool](#without-a-question-tool)
- [What each answer sets](#what-each-answer-sets)

## Round 1: destination (everyone)

| # | Question | Options, recommended first |
|---|---|---|
| 1 | Who is this roadmap for? | Me, learning on my own · Me, alongside a course or degree · A class or group I teach · One person I mentor or onboard |
| 2 | Which part of `<topic>`? | Three or four directions from the scout search, the usual first route first. Skip for a narrow topic |
| 3 | What should be true when you arrive? | I can make something small without a guide (silver) · I can follow it and talk about it (bronze) · I can use it for real work or pass the exam (gold) · I can explain, review and teach it (diamond) |
| 4 | Where do you start? | From zero · I know a neighbouring field · I started before and got stuck · I use it already and have gaps |

"Mentor or onboard" runs the teacher branch with a class of one. "Got stuck" and "have gaps" add the placement check below.

## Round 2: time and supplies (learners and students)

| # | Question | Options, recommended first |
|---|---|---|
| 5 | How much time per week? | About 5 hours · About 2 hours · About 10 hours · 20 hours or more |
| 6 | By when? (students: "by the exam or the end of term?") | No date, steady pace · In about 4 weeks · In about 3 months · A fixed date (type it) |
| 7 | How do you learn best? | Build first, read when stuck · One guided course, step by step · Read and take notes, then practise · Watch, then copy along |
| 8 | Which languages may the sources be in? | The language of this prompt first, English allowed · English only · German only · Another language (type it) |

The learning style changes which source types rank first. It never lowers the hands-on share below 60 percent.

## Round 3: route and map (learners and students)

| # | Question | Options, recommended first |
|---|---|---|
| 9 | Budget for paid material? | Free only · Up to 30 EUR, one book or course · Up to 100 EUR · No limit, show me prices |
| 10 | What do you want to build on the way? | One project that grows from camp to camp · A small separate project per stage · Short drills only · My own project (describe it) |
| 11 | How strict should the trail be? | Guided: a recommended order, nothing locked · Open: every panel unfolded from the start · Gated: a signpost unlocks the next panel |
| 12 | Which map should it draw? | Surprise me: a seeded random mountain and trail · Pick a mountain and trail (ask the map questions below) · Classic topo look with the defaults · Alpine winter |

When the answer to 12 is "Pick a mountain and trail", ask one extra round with the map questions. Take the option lists from `node scripts/zero-to.mjs catalogue` so they match the installed version:

| # | Question | Options |
|---|---|---|
| M1 | Mountain shape | Four of: volcano, ridge, massif, twin peaks, plateau, canyon, each with its one-line description from the catalogue |
| M2 | Trail | Four of: switchback, ridge walk, spiral, valley first, traverse |
| M3 | Ground from foot to summit | Automatic for the theme · Grass, forest, rock, snow · Sand, grass, dirt, rock · Water, grass, forest, scree, snow |
| M4 | Signposts at checkpoints | Timber · Cairn · Trig pillar · Summit flag (blaze post, snow pole and buoy also exist) |

A theme (`classic-topo`, `alpine-winter`, `desert-expedition`, `coastal-survey`) sets an automatic ground order, a default signpost and the lamp's warmth. "Surprise me" leaves `map.terrain` and `map.trail` as `random` and sets `map.seed` to the roadmap id, so the same file always draws the same landscape.

## Teacher branch

Round 1 changes wording: question 3 becomes "What should every student be able to show at the end?" and question 4 "Where does the class start?". Then:

| Round | # | Question | Options, recommended first |
|---|---|---|---|
| 2 | T1 | How many learners? | 16 to 30 · 6 to 15 · 1 to 5 · More than 30 |
| 2 | T2 | Who are they? | School, 14 to 18 · School, under 14 · Adults in training or a bootcamp · University |
| 2 | T3 | How do you meet? | Once a week, 90 minutes · Once a week, 45 minutes · Twice a week, 45 minutes · A daily block of 4 to 5 hours |
| 2 | T4 | How long is the course? | 8 weeks · 4 weeks · 16 weeks · A fixed end date (type it) |
| 3 | T5 | What can students work on? | One device each · Shared in pairs · Only the teacher's projector · No devices, paper only |
| 3 | T6 | How is it assessed? | Signpost tasks, met or not yet · Not assessed · A graded project with criteria · A written test |
| 3 | T7 | What do students take away? | A printable handout per session · Handout plus homework · The link only · One summary sheet per stage |
| 3 | 8 | Source languages | as in round 2 |
| 4 | 9 | Budget per student | as in round 3, default free only |
| 4 | 10 | How do students build? | In pairs · Alone · Groups of three or four · No project, drills only |
| 4 | 12 | Which map? | as in round 3 |

Teachers are not asked for hours, deadline, style or strictness. Hours and dates follow from T3 and T4, style is short input then practice, and the trail is guided because the teacher sets the pace. "Music theory for my class of 14-year-olds" already answers question 1 and T2.

## Placement check

For "got stuck" or "have gaps", draft the stage checkpoints first, then ask five short questions drawn from them, one round, before research. The red pin goes in at the first stage the person could not pass (`brief.entry`). Earlier stages stay on the map, already inked, so nothing is hidden.

## Without a question tool

Print the round as a numbered list with lettered options and accept compact answers:

```text
1. Who is this roadmap for?
   a) Me, learning on my own (recommended)
   b) Me, alongside a course or degree
   c) A class or group I teach
   d) One person I mentor or onboard
   or type your own
...
Answer like: 1a 3c 4 "I did a Python course last year"
```

## What each answer sets

| Question | Field |
|---|---|
| 1 | `brief.audience` (`self`, `student`, `teacher`) |
| 3 | `brief.targetTier` |
| 4 | `brief.startLevel` (`zero`, `adjacent`, `stuck`, `gaps`), and `brief.entry` after placement |
| 5, 6 | `brief.hoursPerWeek`, `brief.startDate`, `brief.deadline` |
| 7 | `brief.style` (`build`, `course`, `read`, `watch`) |
| 8 | `brief.resourceLangs` |
| 9 | `brief.budget` (`max`: 0 for free only, `null` for no limit) |
| 10 | `brief.projects` (`capstone`, `per-stage`, `drills`, `own`) |
| 11 | `brief.gating` (`guided`, `open`, `gated`) |
| 12, M1 to M4 | `map.theme`, `map.terrain`, `map.trail`, `map.surfaces`, `map.signpost`, `map.seed` |
| T1 to T7 | `class.size`, `class.ages`, `class.sessionsPerWeek`, `class.sessionMinutes`, `class.weeks`, `class.devices`, `class.assessment`, `class.handout`, `class.homework` |
