# Provenance

Where code and material in this repository come from when they were not written for zero-to.

## The 3D experience

The table of maps, the dive into a map and the walk along a trail were designed after studying how an existing public interactive map site looks and moves. That site carries no licence, and nothing of it was copied.

The work was split in two. One group read the site's public source and took screenshots of it in a normal browser, and wrote notes in its own words: what objects appear, how the camera and the light move, in what order, and how long each move takes. Some notes describe a motion as short pseudocode with the timings and spring values read from the source; none of them contain the site's code. The notes and the screenshots stay outside this repository. A second group built zero-to from the notes and screenshots alone and never opened the site's scripts, markup or style sheets.

No code, text, artwork, model, texture, font, sound or brand element of that site is in this repository. The scene is drawn with three.js from geometry written for zero-to: the compass, the table, the paper mountains, the trail, the signposts, the walker and the props are all generated in code. The icons in `public/` were drawn for zero-to, and the other images in `public/` and `docs/media/` were recorded from zero-to itself. The site's typefaces, three.js and Vite's preload helper are listed with their licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Learning resources in the examples

The six example roadmaps in `src/roadmap/samples/` link to third-party pages. They link only: no text of those pages is copied beyond titles, and each link carries the date and result of its check. The titles, notes, tasks, questions and takeaways were written for zero-to.

## Development tools

Vite, TypeScript, Vitest, happy-dom and Playwright build and test the project and are not shipped. Exact versions are pinned in `package.json`.

## Bookmark Bookshelf modules

The resource shelf is built on modules from Bookmark Bookshelf, a project by the same author under the same licence.

- Source repository: https://github.com/OthmanAdi/bookmark-bookshelf
- Release tag: `v0.2.0`
- Commit: `498626dd44b0f676faa389fdbf558d0fd1a3672d`
- Licence: Apache-2.0. Copyright 2026 Ahmad Othman Ammar Adi (OthmanAdi).
- Taken on: 2026-11-13, file by file from the tag with `git show v0.2.0:<path>`.

### Copied unchanged

These 73 files are byte for byte the files at the tag, tests included. They live under `src/bookshelf/` with the folder layout of the source, so their relative imports still resolve.

| Source path at the tag | Path here | Files |
|---|---|---|
| `src/shelf/` | `src/bookshelf/shelf/` | 27 (the 3D shelf: volumes, covers, layout, light, looks) |
| `src/motion/` | `src/bookshelf/motion/` | 11 (springs, drag, flick, open and close progress) |
| `src/reader/` | `src/bookshelf/reader/` | 32 (the reader dialog, markdown-lite, reading position, notes) |
| `src/styles/tokens.css` | `src/bookshelf/styles/tokens.css` | 1 (the `--bb-*` design tokens) |
| `src/app/flight.ts`, `src/app/flight.test.ts` | `src/bookshelf/app/` | 2 (the cover that travels between shelf and page) |

The `store` module is not taken: progress and the field notebook belong to zero-to's roadmap and learning packages.

Do not edit these files here. A change belongs in Bookmark Bookshelf first and comes in with a new tag; record the new tag and commit in this section when that happens.

### Taken in part and scoped

- `src/shelf/bookshelf-base.css` holds the reset, the focus ring and the `.bb-label`, `.bb-visually-hidden` and `.bb-button` rules of `src/styles/base.css` at the tag. The declarations are unchanged; every selector is wrapped in `:where(.zt-dock, .zt-shelf-layer)` so the rules reach only the shelf and its reader.
- The flight layer rules (`.bb-flight`, `.bb-flight__book`, `.bb-flight__shadow`, `.bb-flight__spine`) and the cover slot rule of `src/app/bookshelf.css` at the tag are in `src/shelf/dock.css`, scoped to `.zt-shelf-layer`. Its page rule `html.bb-reading` is written there as `html.zt-reading`, and its `body` rule is not taken.

### Written for zero-to after the Bookshelf composition

`src/shelf/dock.ts` wires shelf, motion, reader and flight the way `src/app/bookshelf.ts` at the tag does (intents to motion, the flight from `coverPlacement()` to `flightTarget()`, focus given back on close, Escape routed to the reader while it opens). It is new code for zero-to: it reads roadmap resources instead of a bookmark store and writes nothing itself.

### Known gaps

- The shelf cannot draw a status band on a spine without a change upstream (an optional `band` field on `ShelfItem`). Until then gated and unverified sources are named in the caption, the dock header and the reader page.
- The shelf names each volume's button in English ("Volume 3 of 7", "Marked as read") and has no option for other words. A German interface therefore gets English names on the volume buttons until the shelf takes labels the way the reader does.
