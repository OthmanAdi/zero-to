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
- Version: 0.3.0
- Commit: `3c93653b477aa32f5190a8ac3ace93b2fd4475d1`
- Licence: Apache-2.0. Copyright 2026 Ahmad Othman Ammar Adi (OthmanAdi).

### Copied unchanged

These 123 files match the pinned commit, including the tests. They live under `src/bookshelf/` and keep their relative imports.

| Source path | Path here | Files |
|---|---|---|
| `src/shelf/` | `src/bookshelf/shelf/` | 30 (the Classic shelf, its controls and layout) |
| `src/motion/` | `src/bookshelf/motion/` | 11 (springs, drag, flick, open and close progress) |
| `src/reader/` | `src/bookshelf/reader/` | 32 (the reader dialog, markdown-lite, reading position, notes) |
| `src/studio/` | `src/bookshelf/studio/` | 47 (the WebGL renderer, book materials and page motion) |
| `src/styles/tokens.css` | `src/bookshelf/styles/tokens.css` | 1 (the `--bb-*` design tokens) |
| `src/app/flight.ts`, `src/app/flight.test.ts` | `src/bookshelf/app/` | 2 (the cover that travels between shelf and page) |

The `store` module is not taken: progress and the field notebook belong to zero-to's roadmap and learning packages.

Make changes to the copied modules in Bookmark Bookshelf and update the pinned commit here.

### Taken in part and scoped

- `src/shelf/bookshelf-base.css` holds the reset, focus ring, `.bb-label`, `.bb-visually-hidden` and `.bb-button` rules of `src/styles/base.css` at v0.2.0. The declarations are unchanged. The selectors use `:where(.zt-dock, .zt-shelf-layer)` so the rules reach the shelf and its reader.
- The flight layer and cover slot rules of `src/app/bookshelf.css` at v0.2.0 are in `src/shelf/dock.css`, scoped to `.zt-shelf-layer`. The dock uses `html.zt-reading` for the page state.

### Written for zero-to after the Bookshelf composition

`src/shelf/dock.ts` connects the shelf and reader to roadmap resources and gives focus back to the shelf when the reader closes. `src/shelf/adaptive-paint.ts` chooses the renderer for this dock. Studio paints the same volumes while the Classic shelf supplies the controls.

### Known gaps

- The shelf cannot draw a status band on a spine without a change upstream (an optional `band` field on `ShelfItem`). Until then gated and unverified sources are named in the caption, the dock header and the reader page.
- The shelf names each volume's button in English ("Volume 3 of 7", "Marked as read") and has no option for other words. A German interface therefore gets English names on the volume buttons until the shelf takes labels the way the reader does.
