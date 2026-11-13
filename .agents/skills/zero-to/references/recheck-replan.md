# Recheck and replan

Two commands keep a roadmap alive after the first run.

## `/zero-to recheck <roadmap.json>`

1. `node scripts/zero-to.mjs check-links <file> --receipt recheck-receipt.json` fetches every link.
2. For every source that is now dead, find a replacement with the rules in research.md, read it, and swap it in under the same id so waypoints keep pointing at it. If no replacement can be verified, write a `gap` line on the waypoints that used it.
3. Open every source whose final address or title changed and confirm its `why` line still holds.
4. Record the statuses and dates with `check-links <file> --write`, set `checkedOn` to today, validate, and build again.
5. Report what changed: replaced, flagged and unchanged counts, and every source that is now gated or unverified.

Do not change stages, waypoints or tasks during a recheck. A learner's progress refers to waypoint ids, so ids must stay stable.

## `/zero-to replan <roadmap.json> <progress.json>`

The learner exports their progress from the site (done steps, self-ratings, missed checks, review history, their own plan: start day, hours per week, deadline). Read it and rewrite only what is ahead of them.

- Never change or remove a waypoint they have done. Keep every existing id.
- Low self-ratings or missed checks on a stage: add a short review waypoint or a side trail before the next camp, not a lecture.
- Behind pace against the deadline: offer the four choices the site offers (more hours, a later date, a lower summit, no side trails) and apply the one the person picks.
- Ahead of pace: offer a higher summit or the "own" rung of each project.
- Recheck the links of every source you add.

Validate, build, and report what changed in a few lines.
