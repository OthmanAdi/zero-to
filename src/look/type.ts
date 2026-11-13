import { dirOf, graphemes, isUnjoined } from '../i18n';
import './fonts.css';

/**
 * Type: three faces, each with one job.
 *
 * - `display` (Fraunces) sets titles: the headline, roadmap titles, cover titles, big numbers.
 * - `text` (Atkinson Hyperlegible Next) sets everything that is read: notes, tasks, buttons.
 * - `label` (IBM Plex Mono) annotates: map print, readouts, eyebrows, index numbers.
 *
 * Every stack ends in system faces, so a title in Arabic, Chinese or Devanagari is still set, in the reader's
 * own system face, when our three have no glyph for it.
 */
export const FONTS = {
  display: {
    family: 'Fraunces',
    stack: "'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Noto Serif', serif",
    weights: { min: 100, max: 900 },
    /** The weights the canvas prints with. `loadFonts` waits for these. */
    used: [500, 600],
    italic: true,
  },
  text: {
    family: 'Atkinson Hyperlegible Next',
    stack: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, -apple-system, 'Noto Sans', sans-serif",
    weights: { min: 200, max: 800 },
    used: [400, 600],
    italic: true,
  },
  label: {
    family: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace",
    weights: { min: 400, max: 500 },
    used: [400, 500],
    italic: false,
  },
} as const;

export type FontRole = keyof typeof FONTS;
export const FONT_ROLES = Object.keys(FONTS) as FontRole[];

/**
 * The type scale. Sizes are CSS pixels at a 1440 px wide window. The headline shrinks to its phone size on
 * narrow windows. Tracking is in em.
 */
export const TYPE = {
  headline: { role: 'display', size: 64, phoneSize: 40, weight: 500, lineHeight: 1.0, tracking: -0.02, opticalSize: 144 },
  title: { role: 'display', size: 26, weight: 500, lineHeight: 1.12, tracking: -0.01 },
  number: { role: 'display', size: 44, weight: 400, lineHeight: 1.0, tracking: -0.02 },
  body: { role: 'text', size: 16, weight: 400, lineHeight: 1.5, tracking: 0 },
  small: { role: 'text', size: 14, weight: 400, lineHeight: 1.45, tracking: 0 },
  /** Interface labels: upper case with wide tracking. Never used for roadmap text. */
  label: { role: 'label', size: 10.5, weight: 500, lineHeight: 1.3, tracking: 0.14 },
  /** Roadmap text in the label face: as written, tracked at most 0.02 em. */
  data: { role: 'label', size: 12, weight: 400, lineHeight: 1.4, tracking: 0.02 },
} as const;

export type TypeStyle = keyof typeof TYPE;

/** The widest tracking roadmap text may get. Wider tracking is for interface labels in Latin capitals only. */
export const MAX_ROADMAP_TRACKING = 0.02;

/** The custom properties of the type system, for `tokensCss` and `injectTokens`. */
export function typeTokens(): [name: string, value: string][] {
  return [
    ['--zt-font-display', FONTS.display.stack],
    ['--zt-font-text', FONTS.text.stack],
    ['--zt-font-label', FONTS.label.stack],
    ['--zt-size-headline', `clamp(${TYPE.headline.phoneSize}px, 31.09px + 2.286vw, ${TYPE.headline.size}px)`],
    ['--zt-size-title', `${TYPE.title.size}px`],
    ['--zt-size-number', `${TYPE.number.size}px`],
    ['--zt-size-body', `${TYPE.body.size}px`],
    ['--zt-size-small', `${TYPE.small.size}px`],
    ['--zt-size-label', `${TYPE.label.size}px`],
    ['--zt-size-data', `${TYPE.data.size}px`],
  ];
}

/**
 * A canvas `font` string for a role: `canvasFont('display', 48, 600)` is `600 48px 'Fraunces', …`. The size is
 * in canvas pixels, so multiply by the device scale of the canvas first.
 */
export function canvasFont(role: FontRole, px: number, weight?: number, style: 'normal' | 'italic' = 'normal'): string {
  const face = FONTS[role];
  const wanted = weight ?? face.used[0];
  const clamped = Math.min(face.weights.max, Math.max(face.weights.min, Math.round(wanted)));
  const size = Math.max(1, Math.round(px * 100) / 100);
  return `${style === 'italic' && face.italic ? 'italic ' : ''}${clamped} ${size}px ${face.stack}`;
}

export interface FontReport {
  /** True when every face arrived before the cap. */
  readonly ready: boolean;
  readonly loaded: readonly FontRole[];
  /** Roles that are still on a fallback face. Text in them is printed anyway. */
  readonly missing: readonly FontRole[];
}

export interface LoadFontsOptions {
  /** Longest wait in milliseconds. After it, printing goes ahead with whatever has arrived. */
  readonly timeout?: number;
  /**
   * Text that is about to be printed, for example every roadmap title. Faces are cut by character range, so
   * naming the text makes sure the Latin Extended files are fetched when a title needs them.
   */
  readonly text?: string;
  /** Roles to wait for. All three by default. */
  readonly roles?: readonly FontRole[];
}

const SAMPLE = 'Hamburgefonstiv 0123456789';

/**
 * Waits until the faces a canvas prints with are usable, or until the cap of 2.5 s. It never rejects: a canvas
 * that cannot get its face prints in the fallback, and the report says which roles are affected.
 */
export async function loadFonts(options: LoadFontsOptions = {}): Promise<FontReport> {
  const roles = options.roles ?? FONT_ROLES;
  const set = typeof document === 'undefined' ? undefined : document.fonts;
  if (!set || typeof set.load !== 'function') return { ready: false, loaded: [], missing: [...roles] };

  const text = `${SAMPLE}${options.text ?? ''}`;
  const jobs: Promise<unknown>[] = [];
  for (const role of roles) {
    const face = FONTS[role];
    for (const weight of face.used) {
      jobs.push(set.load(canvasFont(role, 16, weight), text));
      if (face.italic && role === 'display') jobs.push(set.load(canvasFont(role, 16, weight, 'italic'), text));
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, options.timeout ?? 2500);
  });
  await Promise.race([Promise.allSettled(jobs), cap]);
  if (timer !== undefined) clearTimeout(timer);

  const loaded: FontRole[] = [];
  const missing: FontRole[] = [];
  for (const role of roles) {
    let ok = true;
    try {
      for (const weight of FONTS[role].used) ok = ok && set.check(`${weight} 16px '${FONTS[role].family}'`, SAMPLE);
    } catch {
      ok = false;
    }
    (ok ? loaded : missing).push(role);
  }
  return { ready: missing.length === 0, loaded, missing };
}

// ---------------------------------------------------------------------------------------------------------
// Printing text on a canvas.

/** The part of a 2D context that text drawing needs. Both canvas kinds fit, and so does a test double. */
export interface TextContext {
  font: string;
  textAlign: CanvasTextAlign;
  direction: CanvasDirection;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface DrawTextOptions {
  /** Extra space between characters in em. Negative tightens. Applied only to Latin, Greek and Cyrillic. */
  readonly tracking?: number;
  /** Language tag of the text, from the roadmap or the interface. It picks the right letter shapes. */
  readonly lang?: string;
  /** Where `x` is: the left end, the middle or the right end of the text. */
  readonly align?: 'left' | 'center' | 'right';
}

function fontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 10;
}

function setLang(ctx: TextContext, lang: string | undefined): void {
  // Newer browsers let a canvas know the language of its text. Where they do not, nothing is lost.
  if (lang && 'lang' in ctx) {
    try {
      (ctx as { lang: string }).lang = lang;
    } catch {
      // A read-only or unsupported property.
    }
  }
}

interface Layout {
  readonly parts: readonly string[];
  readonly offsets: readonly number[];
  readonly width: number;
}

/**
 * Lays tracked text out character by character. The step from one character to the next is measured on the
 * pair, so kerning survives: "To" stays tucked even when it is tracked.
 */
function layoutTracked(ctx: TextContext, text: string, trackingPx: number, lang: string | undefined): Layout {
  const parts = graphemes(text, lang);
  const offsets: number[] = [];
  let x = 0;
  for (let i = 0; i < parts.length; i += 1) {
    offsets.push(x);
    const part = parts[i] as string;
    const next = parts[i + 1];
    const advance =
      next === undefined ? ctx.measureText(part).width : ctx.measureText(part + next).width - ctx.measureText(next).width;
    x += advance + (next === undefined ? 0 : trackingPx);
  }
  return { parts, offsets, width: x };
}

function isTracked(text: string, tracking: number): boolean {
  return Math.abs(tracking) > 1e-6 && text.length > 1 && isUnjoined(text);
}

/** The width `drawText` would use for this text with the context's current font. */
export function measureTextWidth(ctx: TextContext, text: string, options: DrawTextOptions = {}): number {
  const tracking = options.tracking ?? 0;
  if (!isTracked(text, tracking)) return ctx.measureText(text).width;
  return layoutTracked(ctx, text, tracking * fontPx(ctx.font), options.lang).width;
}

/**
 * Prints text on a canvas with the context's current font and fill, and returns its width.
 *
 * Latin, Greek and Cyrillic text with tracking is placed character by character, so a tracked label has the
 * same spacing in every browser. Anything else is drawn in one call with the direction of its first letter:
 * Arabic joins, Devanagari stacks and a right-to-left title starts from the right. Such text is never tracked.
 *
 * `x` is the left end of the text by default, also for right-to-left text, so layouts stay simple.
 */
export function drawText(ctx: TextContext, text: string, x: number, y: number, options: DrawTextOptions = {}): number {
  if (text === '') return 0;
  const tracking = options.tracking ?? 0;
  const align = options.align ?? 'left';
  const savedAlign = ctx.textAlign;
  const savedDirection = ctx.direction;
  setLang(ctx, options.lang);

  let width: number;
  if (isTracked(text, tracking)) {
    const layout = layoutTracked(ctx, text, tracking * fontPx(ctx.font), options.lang);
    width = layout.width;
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    for (let i = 0; i < layout.parts.length; i += 1) {
      const part = layout.parts[i] as string;
      if (part.trim() !== '') ctx.fillText(part, left + (layout.offsets[i] as number), y);
    }
  } else {
    width = ctx.measureText(text).width;
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    const direction = dirOf(text);
    ctx.direction = direction;
    // With an explicit side, the anchor does not depend on the direction.
    ctx.textAlign = direction === 'rtl' ? 'right' : 'left';
    ctx.fillText(text, direction === 'rtl' ? left + width : left, y);
  }

  ctx.textAlign = savedAlign;
  ctx.direction = savedDirection;
  return width;
}
