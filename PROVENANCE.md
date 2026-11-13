# Provenance

Where code and material in this repository come from when they were not written for zero-to.

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
