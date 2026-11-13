# Teacher mode

For a class, a group or one mentee. The roadmap is the same format with a `class` block; the site adds a session view, a class flag on the route and print handouts.

## Contents

- [Class pacing](#class-pacing)
- [Sessions](#sessions)
- [Two files: teacher and student](#two-files-teacher-and-student)
- [Handouts](#handouts)
- [Students keep their own progress](#students-keep-their-own-progress)
- [One route for everyone](#one-route-for-everyone)

## Class pacing

Turn sessions per week, minutes per session and weeks into `class.sessions[]`. Input stays near 30 percent of a session; the rest is practice. `skipDates` holds holidays. When the course does not fit, say which stages fall off and lower the summit. Do not shrink the estimates to make it fit.

## Sessions

Each session has `n`, `title` and `inClass` (waypoint ids done in class), and may have `date`, `homework` (waypoint ids), `opener` (a recall task from earlier sessions, which is spaced review for a whole room), `exit` (one question every student answers before leaving) and `materials`. Use `teacherNote` on waypoints for typical misconceptions and the answer key.

## Two files: teacher and student

```bash
node scripts/zero-to.mjs student class.roadmap.json --out class.student.json
node scripts/zero-to.mjs build class.student.json --out class-students.html
node scripts/zero-to.mjs build class.roadmap.json --out class-teacher.html
```

The student copy has no teacher notes, no session plans and no answers to assessed checks. Share the student HTML file or its link; keep the teacher file.

## Handouts

The site prints without the 3D scene: per session, what students will be able to show, the tasks, the checks without answers, source titles with short addresses and room for notes. With "paper only" devices, write tasks that work without a screen and prefer printable sources.

## Students keep their own progress

Progress stays in each student's browser and nothing is sent anywhere, which matters for schools and for minors. A student can export a progress file or print a one-page trail card and hand it in by choice. There are no accounts, no leaderboards and no tracking.

## One route for everyone

Nobody is sorted into a track. Fast students take side trails and the "own" project rung; others take the detour after a missed check. Assessment defaults to "met" or "not yet" and can be repeated. For graded projects, mark each criterion on the four tiers.
