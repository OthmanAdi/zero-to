/**
 * The hero copy: the headline whose letters pop up one word after another, the lede and the hint.
 *
 * With the gallery on the table the headline is the site's own line. With a person's roadmap on the table it is
 * that roadmap's title, set in the roadmap's language and never upper-cased.
 */
import { isUnjoined, uiLang } from '../i18n';
import { easeOutElastic } from '../paper/motion';
import { el, fitLines, prefersReducedMotion, setRoadText, setText } from './dom';
import { say } from './strings';

/** The pop of the headline: elastic out with a period of 0.42 over 1.45 s, one word 0.11 s after the other. */
export const POP = {
  duration: 1450,
  period: 0.42,
  wordGap: 110,
  /** Letters inside a word follow each other this closely, so a word still lands as one. */
  letterGap: 16,
  /** How far below its line a letter starts, in em. */
  rise: 0.9,
  samples: 28,
} as const;

export interface HeroText {
  /** The roadmap's own title, or null for the site's line. */
  readonly title: string | null;
  /** Language of `title`. */
  readonly lang?: string;
  /** The roadmap's summary, or null for the site's lede. */
  readonly lede?: string | null;
  /** True on a touch screen: the hint says "tap". */
  readonly touch?: boolean;
}

export interface HeroCopy {
  readonly element: HTMLElement;
  readonly headline: HTMLElement;
  set(text: HeroText): void;
  /** Plays the pop. The headline is whole and still once it ends. */
  pop(): void;
  /** Fits the headline into three lines again, after the window or the fonts changed. */
  fit(): void;
  relabel(): void;
}

/** Words of a text, with the white space between them kept as its own entries. */
export function words(text: string, lang?: string): { readonly text: string; readonly space: boolean }[] {
  const out: { text: string; space: boolean }[] = [];
  const push = (part: string, space: boolean): void => {
    const last = out[out.length - 1];
    // Punctuation stays with its word, so no line starts with a comma or ends with an opening quote.
    if (last && !space && !last.space && (!/^[\p{L}\p{N}]/u.test(part) || !/[\p{L}\p{N}]/u.test(last.text))) last.text += part;
    else if (last && space && last.space) last.text += part;
    else out.push({ text: part, space });
  };
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
      for (const part of segmenter.segment(text)) push(part.segment, /^\s+$/.test(part.segment));
      return out;
    } catch {
      // An unknown language tag: fall through to white space.
    }
  }
  for (const part of text.split(/(\s+)/)) if (part !== '') push(part, /^\s+$/.test(part));
  return out;
}

/** The keyframes of one letter: it rises from below its line and overshoots a little. */
export function popKeyframes(): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= POP.samples; i++) {
    const t = i / POP.samples;
    const e = easeOutElastic(t, POP.period);
    frames.push({
      offset: t,
      transform: `translate3d(0, ${((1 - e) * POP.rise).toFixed(4)}em, 0)`,
      opacity: Math.min(1, t * 9),
    });
  }
  return frames;
}

export function createHero(host: HTMLElement, reducedMotion: () => boolean = prefersReducedMotion): HeroCopy {
  const headline = el('h1', { class: 'zh-headline zt-headline' });
  const lede = el('p', { class: 'zh-lede zt-body' });
  const hintText = el('span');
  const hint = el('p', { class: 'zh-hint zt-label' }, el('span', { class: 'zh-dot', 'aria-hidden': 'true' }), hintText);
  const root = el('section', { class: 'zh-hero' }, headline, lede, hint);
  let text: HeroText = { title: null };
  let running: Animation[] = [];
  let settle: ReturnType<typeof setTimeout> | undefined;

  interface Piece {
    readonly text: string;
    readonly space: boolean;
    readonly goal: boolean;
  }

  const pieces = (): { parts: Piece[]; plain: string; lang: string } => {
    if (text.title !== null) {
      const lang = text.lang ?? 'en';
      return { parts: words(text.title, lang).map((w) => ({ ...w, goal: false })), plain: text.title, lang };
    }
    const lang = uiLang();
    const lead = say('headlineLead');
    const goal = say('headlineGoal');
    return {
      parts: [...words(lead, lang).map((w) => ({ ...w, goal: false })), { text: ' ', space: true, goal: false }, { text: `${goal}.`, space: false, goal: true }],
      plain: `${lead} ${goal}.`,
      lang,
    };
  };

  /** The headline as plain text nodes and one `em`: natural kerning, nothing left of the animation. */
  const renderStill = (): void => {
    const { parts, plain, lang } = pieces();
    headline.replaceChildren();
    headline.lang = lang;
    headline.dir = 'auto';
    headline.removeAttribute('aria-label');
    headline.classList.toggle('is-title', text.title !== null);
    let run = '';
    const flush = (): void => {
      if (run) headline.append(document.createTextNode(run));
      run = '';
    };
    for (const part of parts) {
      if (!part.goal) {
        run += part.text;
        continue;
      }
      flush();
      // The goal word is in the colour of the route. Its full stop is not.
      const stop = part.text.endsWith('.') ? '.' : '';
      headline.append(el('em', null, stop ? part.text.slice(0, -1) : part.text));
      run = stop;
    }
    flush();
    headline.dataset.text = plain;
    fitLines(headline);
  };

  const stop = (): void => {
    clearTimeout(settle);
    for (const animation of running) animation.cancel();
    running = [];
  };

  const render = (): void => {
    stop();
    renderStill();
    if (text.title === null) {
      lede.lang = uiLang();
      setText(lede, say('lede'));
    } else {
      setRoadText(lede, text.lede ?? '', text.lang ?? 'en');
    }
    lede.hidden = lede.textContent === '';
    hintText.lang = uiLang();
    setText(hintText, say(text.touch ? 'hintTouch' : 'hint'));
  };

  const pop = (): void => {
    stop();
    if (reducedMotion() || typeof headline.animate !== 'function') {
      renderStill();
      return;
    }
    const { parts, plain, lang } = pieces();
    const frames = popKeyframes();
    headline.replaceChildren();
    headline.lang = lang;
    // Screen readers get the line once, whole. The moving pieces are hidden from them.
    headline.setAttribute('aria-label', plain);
    let wordIndex = 0;
    let longest = 0;
    for (const part of parts) {
      if (part.space) {
        headline.append(document.createTextNode(part.text));
        continue;
      }
      const stopMark = part.goal && part.text.endsWith('.') ? '.' : '';
      const body = stopMark ? part.text.slice(0, -1) : part.text;
      const word = el(part.goal ? 'em' : 'span', { class: 'zh-word', 'aria-hidden': 'true' });
      // Joined scripts (Arabic, Devanagari and others) are never cut into letters: the word moves as one.
      const letters = isUnjoined(body) ? Array.from(body) : [body];
      const targets: HTMLElement[] = [];
      for (const letter of letters) {
        const span = el('span', { class: 'zh-letter' }, letter);
        word.append(span);
        targets.push(span);
      }
      headline.append(word);
      if (stopMark) {
        const dot = el('span', { class: 'zh-letter zh-word', 'aria-hidden': 'true' }, stopMark);
        headline.append(dot);
        targets.push(dot);
      }
      targets.forEach((target, letterIndex) => {
        const delay = wordIndex * POP.wordGap + Math.min(letterIndex, 12) * POP.letterGap;
        longest = Math.max(longest, delay + POP.duration);
        running.push(target.animate(frames, { duration: POP.duration, delay, fill: 'backwards', easing: 'linear' }));
      });
      wordIndex += 1;
    }
    settle = setTimeout(() => {
      running = [];
      renderStill();
    }, longest + 60);
  };

  render();
  host.append(root);

  return {
    element: root,
    headline,
    set(next) {
      const same = next.title === text.title && next.lang === text.lang && (next.lede ?? null) === (text.lede ?? null) && !!next.touch === !!text.touch;
      text = next;
      if (!same) render();
    },
    pop,
    fit: () => {
      if (running.length === 0) fitLines(headline);
    },
    relabel: render,
  };
}
