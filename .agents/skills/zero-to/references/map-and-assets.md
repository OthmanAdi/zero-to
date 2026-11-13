# Map options and assets

Every roadmap draws its own landscape. The `map` block chooses it; anything left out falls back to the default. `node scripts/zero-to.mjs catalogue` prints this list as JSON from the installed version, so use it when the two differ.

## Contents

- [Seeded random](#seeded-random)
- [Mountain shape: `map.terrain`](#mountain-shape-mapterrain)
- [Trail: `map.trail`](#trail-maptrail)
- [Ground: `map.surfaces`](#ground-mapsurfaces)
- [Signposts: `map.signpost` and `checkpoint.signpost`](#signposts-mapsignpost-and-checkpointsignpost)
- [Themes: `map.theme`](#themes-maptheme)
- [Examples](#examples)

## Seeded random

`random` for the terrain or the trail lets the seed choose. `map.seed` defaults to the roadmap id, so the same file always draws the same mountain and a shared link shows the receiver what the sender saw. Change the seed to roll a new landscape without touching the content.

## Mountain shape: `map.terrain`

| Key | Shape |
|---|---|
| `volcano` | One cone with a crater on top. The summit is the highest point of the rim. |
| `ridge` | A long narrow spine with a main summit and two lower tops along the crest. |
| `massif` | A broad mountain with a main summit and a ring of lower peaks round it. |
| `twin-peaks` | Two summits joined by a saddle. The trail ends on the higher one. |
| `plateau` | A flat-topped table mountain with cliffs all round and a small knoll as its summit. |
| `canyon` | A mountain on a raised bench, with a winding river canyon cut through its base. |
| `random` | The seed picks one (default). |

The height of the mountain comes from the content: each tier owns a quarter of it, so a roadmap that ends at silver stands lower than one that ends at diamond.

## Trail: `map.trail`

| Key | Route |
|---|---|
| `switchback` | Zigzags straight up the steepest face in tight hairpins. |
| `ridge-walk` | Gains the longest spur and follows its crest to the top. |
| `spiral` | Winds round the whole mountain, so every side is seen on the way up. |
| `valley-first` | Walks in along low ground for the first half, then climbs out of the valley. |
| `traverse` | Crosses one broad face from side to side in two or three long legs. |
| `random` | The seed picks one (default). |

Camps sit on the trail at the height of each stage, in order. The route is planned over the ground, so steep faces produce real hairpins.

## Ground: `map.surfaces`

A list from the foot of the mountain to the summit, using `water`, `sand`, `grass`, `forest`, `dirt`, `scree`, `rock` and `snow`, or `auto` to let the theme decide. Each band brings its own scenery: reeds on water, dunes and grass tufts on sand, flowers on grass, paper trees in forest, stones on dirt and scree, boulders on rock, drifts on snow.

```json
"surfaces": ["sand", "grass", "forest", "rock", "snow"]
```

## Signposts: `map.signpost` and `checkpoint.signpost`

Each stage ends at a signpost. Its arms carry the checkpoint's `show` items, and they tick and swing up the route as the learner passes them. The choice falls through: the checkpoint's own key, then the map's, then the theme's, then `timber`.

| Key | Name | Suits |
|---|---|---|
| `timber` | Timber fingerpost | A wooden post with pointed boards, the classic sign at a path junction. Any roadmap; the default. |
| `cairn` | Cairn | A pile of flat stones with a stick through the top that carries the boards. Bare, stony or desert ground. |
| `trig-pillar` | Survey pillar | A squat concrete pillar with a brass plate. Exact subjects: mathematics, measurement, engineering. |
| `blaze-post` | Waymark post | A grey post with a painted waymark. Woodland, and long routes with many small steps. |
| `snow-pole` | Snow pole | A tall black and white pole in a drift. High, cold or wintry roadmaps. |
| `buoy` | Buoy | A brass buoy with a lattice mast and pennants. Water, coasts and anything that is a voyage. |
| `summit-flag` | Summit flag | A tall pole on a few stones with a long pennant. The last checkpoint, or a short roadmap with one clear goal. |

## Themes: `map.theme`

| Key | Sets |
|---|---|
| `classic-topo` | Ground grass, forest, rock, snow. Signposts `timber`. A warm lamp, 2900 K. The default. |
| `alpine-winter` | Ground forest, scree, rock, snow. Signposts `snow-pole`. A cool lamp, 4200 K. |
| `desert-expedition` | Ground sand, dirt, rock. Signposts `cairn`. A hot lamp, 2500 K. |
| `coastal-survey` | Ground water, sand, grass, rock. Signposts `buoy`. A pale lamp, 3600 K. |

## Examples

A random landscape that never changes for this roadmap:

```json
"map": { "terrain": "random", "trail": "random" }
```

A chosen one:

```json
"map": {
  "terrain": "volcano",
  "trail": "spiral",
  "surfaces": ["sand", "grass", "forest", "rock", "snow"],
  "signpost": "cairn",
  "theme": "desert-expedition"
}
```

A different stage-end sign for the final checkpoint only:

```json
"checkpoint": { "title": "Summit", "signpost": "summit-flag", "show": ["Ship it", "Teach it"] }
```
