# Changelog

All notable changes to zero-to are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-13

The first release.

### The skill

- `/zero-to <topic>` reads the prompt, asks up to four questions per round with the recommended answer first (at most three rounds for a learner, four for a teacher), prints a trip card with the total hours and an arrival date, researches the topic and writes one roadmap file.
- Every resource link is opened. A source is marked verified only after its page was read, gated when it sits behind a sign-in, and unverified when it could not be read, each with a note. A step without a checked source gets a gap line with search terms.
- A teacher branch plans a unit for a class: class size, sessions, devices in the room, a session plan and a student copy without teacher notes.
- `/zero-to recheck <file>` opens every link again, and `/zero-to replan <roadmap> <progress>` adjusts a roadmap to the progress a learner exported.
- References for the interview, research, the roadmap format, the map options, teacher mode, recheck and replan, and six evaluation scenarios.

### The command-line tool

- `scripts/zero-to.mjs`, plain Node with no dependencies: `validate`, `check-links`, `build`, `link`, `student` and `catalogue`.
- `build` writes the whole site and the roadmap into one HTML file that opens offline. The file carries the licence notices of everything inside it.

### The site

- A round table of roadmaps under a floating brass compass with reflections. The table turns between roadmaps, and the lit sheet grows its paper mountain.
- A red pin marks where the learner is. Clicking it dives into the map and lands at the current step.
- The walk: a walker follows the dashed trail, each waypoint opens a note card (note, a question to answer first, a hands-on task with minutes, points to take away), and each stage ends at a signpost with a self-rating.
- The resource shelf uses Bookmark Bookshelf 0.3 Studio on capable devices and keeps a Classic view for reduced motion, forced colours and lighter devices. Both offer the same books, source details and reader.
- An elevation strip shows the route by hours, the current position and the arrival date at the learner's pace.
- A class flag marks the latest dated session up to today on the walk, profile and mini-map. Optional steps use dotted side trails where the route has room.
- Notes turn to the next step as you walk. On phones the text changes in place. Reduced motion makes the change instant.
- Trail strokes join across the edges of the paper cards on steep ground.
- Six mountain shapes, five trail styles, eight kinds of ground, seven signposts and four themes, chosen in the roadmap or picked by a seed.
- Progress, ratings and the field notebook are kept in the browser. Share link, Markdown, print handout and calendar export.
- A plain list view and a page without WebGL show the same content. Reduced motion is honoured. English and German interface.
- Six example roadmaps with 170 sources, links opened on 2026-11-13, each with its own prerendered page, social image and structured data.
- Roadmaps opened from a file or a link have their own table and trip brief. The standalone viewer carries only the roadmap it was built for.

### Known limits

- Automated browser coverage is in Chromium. The shelf was also checked on a Radeon 8060S.
- Scripts other than Latin fall back to the system fonts.

[0.1.0]: https://github.com/OthmanAdi/zero-to/releases/tag/v0.1.0
