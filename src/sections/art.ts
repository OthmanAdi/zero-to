/**
 * The drawings of the landing sections: cut paper in the colours of the look. Every drawing is an SVG fragment
 * written here, coloured through the `--zt-*` custom properties, so a theme change recolours it. None of them
 * carries text a reader needs: the art is decoration, and the page's words stand beside it.
 */

const P = 'var(--zt-paper)';
const HI = 'var(--zt-paper-hi)';
const SHADE = 'var(--zt-paper-shade)';
const INK = 'var(--zt-ink)';
const SOFT = 'var(--zt-ink-soft)';
const SIGNAL = 'var(--zt-signal)';
const BRASS = 'var(--zt-brass)';
const BRASS_DEEP = 'var(--zt-brass-deep)';
const WALNUT = 'var(--zt-walnut)';
const surface = (kind: string): string => `var(--zt-surface-${kind})`;
const tier = (name: string): string => `var(--zt-tier-${name})`;

export interface Drawing {
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  readonly body: string;
}

const drawing = (width: number, height: number, body: string): Drawing => ({ viewBox: `0 0 ${width} ${height}`, width, height, body });

/** The lighter core a cut shows at its rim. */
const rim = (d: string): string => `<path d="${d}" fill="none" stroke="${HI}" stroke-opacity=".6" stroke-width="1.6" stroke-linejoin="round"/>`;

/** A waymark on a short stake: white paint with the tier's colour across it. */
const waymark = (x: number, y: number, name: string): string =>
  `<rect x="${x - 1.4}" y="${y - 26}" width="2.8" height="26" fill="${WALNUT}"/>` +
  `<rect x="${x - 6.5}" y="${y - 27}" width="13" height="12" rx="1" fill="${HI}"/>` +
  `<rect x="${x - 6.5}" y="${y - 23.5}" width="13" height="5" fill="${tier(name)}"/>`;

// ---------------------------------------------------------------------------------------------------------
// Stop 01: four peaks, one per altitude, each higher and barer than the last.

const BRONZE_HILL = 'M2 86C22 72 40 26 72 17c30-6 52 40 76 69Z';
const SILVER_PEAK = 'M3 124 50 40 70 12l22 30 20 22 36 60Z';
const GOLD_PEAK = 'M4 164 42 92l18-28L78 14l18 40 24 42 30 68Z';
const DIAMOND_PEAK = 'M3 206 34 126l22-36L84 10l20 52 16-18 20 62 18 94Z';

export const PEAKS: readonly Drawing[] = [
  drawing(
    164,
    90,
    `<path d="${BRONZE_HILL}" fill="${surface('grass')}"/>` +
      `<path d="M2 86C22 72 40 26 72 17 60 42 64 68 72 86Z" fill="${surface('forest')}" opacity=".42"/>` +
      [
        [92, 52],
        [102, 46],
        [84, 44],
        [110, 38],
      ]
        .map(([x, y]) => `<path d="M${x} ${(y as number) - 13}l5.2 13h-10.4Z" fill="${surface('forest')}"/>`)
        .join('') +
      `<path d="M124 86c-12-16-30-18-36-34-4-12-10-22-16-34" fill="none" stroke="${HI}" stroke-opacity=".75" stroke-width="1.5" stroke-linecap="round"/>` +
      rim(BRONZE_HILL) +
      waymark(154, 88, 'bronze'),
  ),
  drawing(
    164,
    128,
    `<path d="${SILVER_PEAK}" fill="${surface('forest')}"/>` +
      `<path d="M3 124 50 40 70 12l-6 112Z" fill="${INK}" opacity=".16"/>` +
      `<path d="M50 40 70 12l22 30-12 6-10-10-10 12Z" fill="${surface('rock')}"/>` +
      [
        [100, 96],
        [112, 104],
        [90, 108],
        [122, 112],
        [104, 114],
      ]
        .map(([x, y]) => `<path d="M${x} ${(y as number) - 15}l6 15h-12Z" fill="${INK}" opacity=".24"/>`)
        .join('') +
      rim(SILVER_PEAK) +
      waymark(154, 126, 'silver'),
  ),
  drawing(
    164,
    168,
    `<path d="${GOLD_PEAK}" fill="${surface('rock')}"/>` +
      `<path d="M4 164 42 92l18-28L78 14l-8 150Z" fill="${INK}" opacity=".2"/>` +
      `<path d="M4 164l16-30 104-14 26 44Z" fill="${surface('scree')}" opacity=".8"/>` +
      `<path d="M78 14l18 40-10-6-8 12-8-14-10 18Z" fill="${surface('snow')}"/>` +
      `<path d="M96 96l10 22M58 104l-8 26M82 76l4 30" stroke="${INK}" stroke-opacity=".22" stroke-width="1.3" fill="none" stroke-linecap="round"/>` +
      rim(GOLD_PEAK) +
      waymark(154, 166, 'gold'),
  ),
  drawing(
    176,
    210,
    `<path d="${DIAMOND_PEAK}" fill="${surface('snow')}"/>` +
      `<path d="M84 10l20 52-8 40-20-30Z" fill="${surface('rock')}" opacity=".6"/>` +
      `<path d="M34 126l22-36 8 46-16 22Z" fill="${surface('rock')}" opacity=".5"/>` +
      `<path d="M120 44l20 62-12 18-14-38Z" fill="${surface('rock')}" opacity=".55"/>` +
      `<path d="M3 206 34 126l14 32 12 48Z" fill="${INK}" opacity=".1"/>` +
      `<path d="M84 10V-6" stroke="${INK}" stroke-width="1.6"/><path d="M84-6l16 5-16 5Z" fill="${SIGNAL}"/>` +
      rim(DIAMOND_PEAK) +
      waymark(166, 208, 'diamond'),
  ),
];

/** The print of a station sheet: a few contour rings, the dashed route across the front and its start dot. */
export function groundPrint(seed = 0): Drawing {
  const rings: string[] = [];
  const hills = [
    [150 + seed * 7, 86, 1],
    [420, 70 + seed * 5, 1.2],
    [650 - seed * 9, 96, 0.9],
  ] as const;
  for (const [cx, cy, scale] of hills) {
    for (let ring = 1; ring <= 5; ring += 1) {
      rings.push(`<ellipse cx="${cx}" cy="${cy}" rx="${(ring * 26 * scale).toFixed(1)}" ry="${(ring * 15 * scale).toFixed(1)}" transform="rotate(${ring * 3 - 8} ${cx} ${cy})"/>`);
    }
  }
  return drawing(
    800,
    390,
    `<g fill="none" stroke="${INK}" stroke-opacity=".13" stroke-width="1.1">${rings.join('')}</g>` +
      `<path d="M48 318C220 280 330 356 448 310s250-10 310-34" fill="none" stroke="${SIGNAL}" stroke-width="3.4" stroke-dasharray="11 8"/>` +
      `<circle cx="48" cy="318" r="6" fill="${SIGNAL}"/>`,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Stop 02: one small picture per step of a run.

export const STEP_ART: readonly Drawing[] = [
  // The interview: a card with a question and four answers, the recommended one first.
  drawing(
    96,
    72,
    `<rect x="10" y="6" width="76" height="60" rx="2" fill="${HI}" stroke="${INK}" stroke-opacity=".2"/>` +
      `<path d="M20 18h40" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      [30, 40, 50, 60]
        .map(
          (y, index) =>
            `<circle cx="22" cy="${y}" r="3.2" fill="${index === 0 ? SIGNAL : 'none'}" stroke="${index === 0 ? SIGNAL : SOFT}" stroke-width="1.4"/>` +
            `<path d="M31 ${y}h${index === 0 ? 44 : 30 + index * 4}" stroke="${index === 0 ? INK : SOFT}" stroke-opacity="${index === 0 ? 1 : 0.6}" stroke-width="2" stroke-linecap="round"/>`,
        )
        .join(''),
  ),
  // Research: three slips, two kept with a tick and one struck out.
  drawing(
    96,
    72,
    `<g transform="rotate(-7 30 40)"><rect x="6" y="14" width="46" height="26" rx="1.5" fill="${HI}" stroke="${INK}" stroke-opacity=".2"/><path d="M13 23h22M13 31h30" stroke="${SOFT}" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/><path d="M38 20l3 3 6-7" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `<g transform="rotate(5 66 30)"><rect x="42" y="8" width="46" height="26" rx="1.5" fill="${HI}" stroke="${INK}" stroke-opacity=".2"/><path d="M49 17h20M49 25h30" stroke="${SOFT}" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/><path d="M73 14l3 3 6-7" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `<g transform="rotate(-3 58 54)"><rect x="30" y="42" width="52" height="24" rx="1.5" fill="${SHADE}" stroke="${INK}" stroke-opacity=".2"/><path d="M37 50h24M37 58h34" stroke="${SOFT}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/><path d="M33 62 79 46" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/></g>`,
  ),
  // The file: a sheet with a folded corner and braces.
  drawing(
    96,
    72,
    `<path d="M22 4h38l16 16v48H22Z" fill="${HI}" stroke="${INK}" stroke-opacity=".2"/>` +
      `<path d="M60 4v16h16Z" fill="${SHADE}"/>` +
      `<path d="M36 28c-4 0-4 4-4 7s0 5-4 5c4 0 4 2 4 5s0 7 4 7M62 28c4 0 4 4 4 7s0 5 4 5c-4 0-4 2-4 5s0 7-4 7" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M42 34h12M42 40h8M42 46h14" stroke="${SOFT}" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>` +
      '',
  ),
  // The map: a folded sheet with contours, the dashed route and the pin.
  drawing(
    96,
    72,
    `<path d="M8 14l20-6 20 6 20-6 20 6v48l-20-6-20 6-20-6-20 6Z" fill="${HI}" stroke="${INK}" stroke-opacity=".2"/>` +
      `<path d="M28 8v48M48 14v48M68 8v48" stroke="${INK}" stroke-opacity=".14"/>` +
      `<g fill="none" stroke="${INK}" stroke-opacity=".22"><ellipse cx="58" cy="30" rx="20" ry="13"/><ellipse cx="58" cy="30" rx="13" ry="8"/><ellipse cx="58" cy="30" rx="6" ry="3.5"/></g>` +
      `<path d="M14 54c10-8 20 4 28-8s8-12 16-16" fill="none" stroke="${SIGNAL}" stroke-width="2.4" stroke-dasharray="5 4"/>` +
      `<path d="M58 30v-13" stroke="${INK}" stroke-width="1.4"/><circle cx="58" cy="14" r="4.2" fill="${SIGNAL}"/>`,
  ),
];

// ---------------------------------------------------------------------------------------------------------
// Stop 03: what a roadmap carries. Five pictures for the cards of the ring and two for what the learner keeps.

export const CARRY_KEYS = ['stages', 'checkpoints', 'projects', 'sources', 'pace', 'notebook', 'cairns'] as const;
export type CarryKey = (typeof CARRY_KEYS)[number];

export const CARRY_ART: Readonly<Record<CarryKey, Drawing>> = {
  // A stretch of trail over three folded panels, with waypoints.
  stages: drawing(
    64,
    64,
    `<path d="M6 16l17-5 18 5 17-5v38l-17 5-18-5-17 5Z" fill="${P}" stroke="${INK}" stroke-opacity=".25"/>` +
      `<path d="M23 11v38M41 16v38" stroke="${INK}" stroke-opacity=".16"/>` +
      `<path d="M11 44c8-4 10-12 18-12s8-8 14-10 8 2 11-3" fill="none" stroke="${SIGNAL}" stroke-width="2.2" stroke-dasharray="4.5 3.5"/>` +
      `<circle cx="11" cy="44" r="2.6" fill="${SIGNAL}"/><circle cx="29" cy="32" r="2.4" fill="${INK}"/><circle cx="43" cy="22" r="2.4" fill="${INK}"/>`,
  ),
  // A fingerpost with two arms, one of them ticked and swung up.
  checkpoints: drawing(
    64,
    64,
    `<rect x="29.5" y="12" width="5" height="46" rx="1" fill="${WALNUT}"/>` +
      `<path d="M34 18h20l5 5-5 5H34Z" fill="${P}" stroke="${INK}" stroke-opacity=".3"/>` +
      `<g transform="rotate(-24 30 38)"><path d="M30 33H10l-5 5 5 5h20Z" fill="${HI}" stroke="${INK}" stroke-opacity=".3"/><path d="M13 38l3 3 6-7" fill="none" stroke="${SIGNAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>` +
      `<path d="M39 23h10" stroke="${SOFT}" stroke-width="1.8" stroke-linecap="round"/>` +
      `<ellipse cx="32" cy="58" rx="12" ry="2.6" fill="${INK}" opacity=".16"/>`,
  ),
  // A tent with three flags for the three rungs.
  projects: drawing(
    64,
    64,
    `<path d="M8 54 30 18l22 36Z" fill="${surface('sand')}" stroke="${INK}" stroke-opacity=".25"/>` +
      `<path d="M30 18 22 54h16Z" fill="${INK}" opacity=".28"/>` +
      `<path d="M30 18v-8" stroke="${INK}" stroke-width="1.4"/>` +
      [0, 1, 2].map((index) => `<path d="M${44 + index * 6} 54V${40 - index * 6}" stroke="${INK}" stroke-width="1.3"/><path d="M${44 + index * 6} ${40 - index * 6}l8 2.5-8 2.5Z" fill="${index === 2 ? SHADE : SIGNAL}"/>`).join('') +
      `<path d="M4 54h58" stroke="${INK}" stroke-opacity=".3" stroke-width="1.4" stroke-linecap="round"/>`,
  ),
  // Three volumes on a shelf, one with a ribbon.
  sources: drawing(
    64,
    64,
    `<rect x="12" y="16" width="11" height="38" rx="1" fill="var(--zt-cover-bronze)"/>` +
      `<rect x="25" y="10" width="12" height="44" rx="1" fill="var(--zt-cover-diamond)"/>` +
      `<g transform="rotate(12 46 54)"><rect x="40" y="18" width="11" height="36" rx="1" fill="var(--zt-cover-silver)"/></g>` +
      `<path d="M14 24h7M27 18h8M27 23h8" stroke="${HI}" stroke-opacity=".8" stroke-width="1.4"/>` +
      `<path d="M29 54v7l2-2 2 2v-7" fill="${SIGNAL}"/>` +
      `<path d="M6 54h54" stroke="${WALNUT}" stroke-width="3" stroke-linecap="round"/>`,
  ),
  // A profile with the pace line and the arrival flag.
  pace: drawing(
    64,
    64,
    `<path d="M6 52 18 42l10 4 12-16 10 6 8-16v32Z" fill="${SHADE}"/>` +
      `<path d="M6 52 18 42l10 4 12-16 10 6 8-16" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M6 52h52" stroke="${INK}" stroke-opacity=".4" stroke-width="1.2"/>` +
      `<path d="M30 12v40" stroke="${SIGNAL}" stroke-width="1.6" stroke-dasharray="3.5 3"/>` +
      `<circle cx="23" cy="44" r="3.4" fill="${SIGNAL}" stroke="${HI}" stroke-width="1.4"/>` +
      `<path d="M58 20V8" stroke="${INK}" stroke-width="1.3"/><path d="M58 8l-9 3 9 3Z" fill="${INK}"/>`,
  ),
  // A ring-bound notebook with a pinned slip.
  notebook: drawing(
    64,
    64,
    `<rect x="14" y="10" width="38" height="46" rx="2" fill="${P}" stroke="${INK}" stroke-opacity=".3"/>` +
      [18, 26, 34, 42, 50].map((y) => `<path d="M11 ${y}h7" stroke="${BRASS_DEEP}" stroke-width="2" stroke-linecap="round"/>`).join('') +
      `<path d="M24 22h20M24 29h16M24 36h20M24 43h12" stroke="${SOFT}" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/>` +
      `<circle cx="46" cy="14" r="4" fill="${SIGNAL}"/><path d="M46 18v6" stroke="${INK}" stroke-width="1.3"/>`,
  ),
  // A cairn with the ring that says it is due.
  cairns: drawing(
    64,
    64,
    `<ellipse cx="32" cy="50" rx="24" ry="7" fill="none" stroke="${SIGNAL}" stroke-width="2"/>` +
      `<path d="M16 52c0-6 6-8 16-8s16 2 16 8Z" fill="${surface('rock')}"/>` +
      `<path d="M21 44c0-5 5-7 11-7s11 2 11 7Z" fill="${surface('scree')}"/>` +
      `<path d="M25 37c0-4 3-6 7-6s7 2 7 6Z" fill="${surface('rock')}"/>` +
      `<path d="M28 31c0-3 2-5 4-5s4 2 4 5Z" fill="${surface('scree')}"/>` +
      `<path d="M16 52h32" stroke="${INK}" stroke-opacity=".3"/>`,
  ),
};

/** The compass the cards turn round: a brass bezel, a paper dial and the needle of the mark. */
export const COMPASS = drawing(
  200,
  200,
  `<ellipse cx="100" cy="112" rx="78" ry="78" fill="${INK}" opacity=".16"/>` +
    `<circle cx="100" cy="100" r="78" fill="${BRASS_DEEP}"/>` +
    `<circle cx="100" cy="100" r="74" fill="${BRASS}"/>` +
    `<circle cx="100" cy="100" r="64" fill="${HI}"/>` +
    `<circle cx="100" cy="100" r="64" fill="none" stroke="${BRASS_DEEP}" stroke-width="1.5"/>` +
    Array.from({ length: 36 }, (_, index) => {
      const long = index % 9 === 0;
      const mid = index % 3 === 0;
      return `<path d="M100 ${long ? 40 : 42}v${long ? 12 : mid ? 7 : 4}" stroke="${INK}" stroke-opacity="${long ? 0.9 : 0.45}" stroke-width="${long ? 2 : 1}" transform="rotate(${index * 10} 100 100)"/>`;
    }).join('') +
    `<circle cx="100" cy="100" r="34" fill="none" stroke="${INK}" stroke-opacity=".14"/>` +
    `<g class="zs-needle"><path d="M100 46l9 54h-18Z" fill="${SIGNAL}"/><path d="M100 154l9-54h-18Z" fill="${INK}"/></g>` +
    `<circle cx="100" cy="100" r="5" fill="${BRASS}" stroke="${BRASS_DEEP}"/>`,
);

// ---------------------------------------------------------------------------------------------------------
// Small pieces: the walker of the page, what grows beside the thread, the camp at its end, a signpost.

/** The page walker, 68 by 100: body and pack, two legs hinged at the hip, a stick. */
export const WALKER = drawing(
  68,
  100,
  `<g class="zs-walker-leg zs-walker-leg-b"><path d="M30 50l-3 40h7l4-40Z"/></g>` +
    `<path d="M48 44 54 96" class="zs-walker-stick" fill="none" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M24 26c0-5 5-8 10-8s9 4 10 9l2 24H24Z"/>` +
    `<rect x="13" y="24" width="14" height="24" rx="4"/>` +
    `<circle cx="35" cy="10" r="7.5"/>` +
    `<path d="M26 4h18l5 5H26Z"/>` +
    `<path d="M40 30l9 15" fill="none" stroke-width="5" stroke-linecap="round"/>` +
    `<g class="zs-walker-leg zs-walker-leg-a"><path d="M32 50l-2 40h7l5-40Z"/></g>`,
);

export const TUSSOCK = `<path d="M0 0c-2-6-5-9-8-11M0 0c-1-7-2-11-3-15M0 0c0-7 1-12 2-16M0 0c2-6 4-9 8-12M0 0c3-4 6-5 10-6" fill="none" stroke="${BRASS_DEEP}" stroke-width="1.8" stroke-linecap="round"/>`;
export const STONE = `<path d="M-9 0c-1-5 3-8 8-8s9 2 10 8Z" fill="var(--zt-steel)" opacity=".55"/><path d="M-5-5c2-2 5-2 7-1" fill="none" stroke="var(--zt-text)" stroke-opacity=".35" stroke-width="1"/>`;
export const CAIRN = `<path d="M-11 0c0-4 4-6 11-6s11 2 11 6Z" fill="var(--zt-steel)" opacity=".5"/><path d="M-7-6c0-4 3-5 7-5s7 1 7 5Z" fill="var(--zt-steel)" opacity=".7"/><path d="M-4-11c0-3 2-4 4-4s4 1 4 4Z" fill="var(--zt-steel)" opacity=".55"/>`;

/** The camp at the end of the trail: a tent, a flag and a fire. */
export const CAMP = drawing(
  220,
  120,
  `<ellipse cx="110" cy="108" rx="100" ry="9" fill="var(--zt-text)" opacity=".05"/>` +
    `<path d="M40 106 92 30l52 76Z" fill="${P}"/>` +
    `<path d="M92 30 76 106h32Z" fill="${INK}" opacity=".5"/>` +
    `<path d="M92 30 40 106h16Z" fill="${SHADE}"/>` +
    `<path d="M92 30V8" stroke="var(--zt-text)" stroke-width="2"/><path d="M92 8l24 7-24 7Z" fill="${SIGNAL}"/>` +
    `<path d="M158 106l10-16 10 16Z" fill="${SIGNAL}" class="zs-fire"/><path d="M163 106l5-9 5 9Z" fill="var(--zt-lamp)" class="zs-fire"/>` +
    `<path d="M152 108h32M156 104l24 6M180 104l-24 6" stroke="${WALNUT}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M14 108h196" stroke="var(--zt-text)" stroke-opacity=".2" stroke-width="1.5" stroke-linecap="round"/>`,
);

/** A fingerpost with three arms, for the questions stop. */
export const SIGNPOST = drawing(
  150,
  170,
  `<ellipse cx="75" cy="160" rx="34" ry="6" fill="var(--zt-void)" opacity=".5"/>` +
    `<rect x="70" y="22" width="10" height="138" rx="2" fill="${WALNUT}"/>` +
    `<path d="M80 34h46l12 11-12 11H80Z" fill="${P}"/><path d="M70 66H24L12 77l12 11h46Z" fill="${HI}"/><path d="M80 98h38l12 11-12 11H80Z" fill="${SHADE}"/>` +
    `<path d="M90 45h26M34 77h26M90 109h20" stroke="${SOFT}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="75" cy="22" r="7" fill="${BRASS}"/>`,
);
