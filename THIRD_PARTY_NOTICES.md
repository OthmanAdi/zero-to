# Third-party notices

zero-to is licensed under Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). A production build includes the following third-party material. Each entry names the component, its copyright holder, its licence and where the full licence text is in this repository and in every built site.

## three.js

- Use: draws the 3D scene (the table, the compass, the paper mountains, the map and the walker) and the Studio shelf.
- Copyright © 2010-2026 three.js authors.
- Licence: MIT. Full text: [public/licenses/three.js-MIT.txt](public/licenses/three.js-MIT.txt).
- Source: https://github.com/mrdoob/three.js, version 0.187.0 from npm.

## Fraunces

- Use: the display typeface (headlines, roadmap titles, cover titles, big numbers and the wordmark). The site serves the Latin and Latin Extended subsets of the variable font, upright and italic, as packaged by Fontsource.
- Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces).
- Licence: SIL Open Font License 1.1. Full text: [public/licenses/Fraunces-OFL-1.1.txt](public/licenses/Fraunces-OFL-1.1.txt).
- Source: https://github.com/undercasetype/Fraunces, packaged as `@fontsource-variable/fraunces` version 5.3.0 from npm.

## Atkinson Hyperlegible Next

- Use: the text typeface (notes, tasks, buttons and everything else that is read). The site serves the Latin and Latin Extended subsets of the variable font, upright and italic, as packaged by Fontsource.
- Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next).
- Licence: SIL Open Font License 1.1. Full text: [public/licenses/Atkinson-Hyperlegible-Next-OFL-1.1.txt](public/licenses/Atkinson-Hyperlegible-Next-OFL-1.1.txt).
- Source: https://github.com/googlefonts/atkinson-hyperlegible-next, packaged as `@fontsource-variable/atkinson-hyperlegible-next` version 5.3.0 from npm.

## IBM Plex Mono

- Use: the label typeface (map print, readouts, eyebrows and index numbers). The site serves the Latin and Latin Extended subsets of weights 400 and 500, as packaged by Fontsource.
- Copyright 2017 IBM Corp. All rights reserved.
- Licence: SIL Open Font License 1.1. Full text: [public/licenses/IBM-Plex-Mono-OFL-1.1.txt](public/licenses/IBM-Plex-Mono-OFL-1.1.txt).
- Source: https://github.com/IBM/plex, packaged as `@fontsource/ibm-plex-mono` version 5.3.0 from npm.

## Vite module preload helper

- Use: when Vite bundles the site it adds a short module-preload helper to the generated JavaScript (inside the main `home-*.js` chunk in `assets/`, and inside the skill's single-file viewer). That helper is the only code from Vite in the build. Vite itself is not shipped.
- Copyright (c) 2019-present, VoidZero Inc. and Vite contributors.
- Licence: MIT. Full text: [public/licenses/Vite-MIT.txt](public/licenses/Vite-MIT.txt), the "Vite core license" section of `LICENSE.md` in the npm package `vite` 8.3.7, copied exactly.

## Bookmark Bookshelf modules

- Use: the Classic and Studio resource shelf, reader, motion, design tokens and travelling cover, copied into `src/bookshelf/`. Rules from the base and composition stylesheets are scoped to the shelf in `src/shelf/`. [PROVENANCE.md](PROVENANCE.md) lists the source paths.
- Copyright 2026 Ahmad Othman Ammar Adi (OthmanAdi), the author of zero-to.
- Licence: Apache-2.0, the licence of zero-to. Full text: [LICENSE](LICENSE).
- Source: https://github.com/OthmanAdi/bookmark-bookshelf, version 0.3.0, commit 3c93653b477aa32f5190a8ac3ace93b2fd4475d1.
