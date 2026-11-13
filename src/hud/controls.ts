/**
 * What the visitor touches on the table: the two crease arrows with the counter beside them, and the enter
 * button.
 *
 * Each control is a native button with a name in the interface language. Their look is paper, not a widget: the
 * arrow is a strip of paper with its lower half folded back, and the enter button is the head of the red pin.
 */
import { uiLang } from '../i18n';
import { easeOutBounce } from '../paper/motion';
import { el, prefersReducedMotion, setText, svg } from './dom';
import { say } from './strings';

// ---------------------------------------------------------------------------------------------------------
// Crease arrows

/** The arrow's fold: resting angle, the angle under the pointer, and the press. Degrees and milliseconds. */
export const CREASE = { rest: -44, hover: -6, press: -78, pressIn: 140, pressHold: 600, width: 28, height: 18.7, narrowWidth: 22, narrowHeight: 14.7 } as const;

function arrowDrawing(): SVGElement {
  // Our own arrow on a 24 by 16 grid: a round-ended shaft and an open head.
  const root = svg('svg', { viewBox: '0 0 24 16', 'aria-hidden': 'true', focusable: 'false' });
  root.append(
    svg('path', {
      d: 'M3 8h17.2M14.6 2.6 20.4 8l-5.8 5.4',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.3,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
  return root;
}

export interface CreaseArrow {
  readonly element: HTMLButtonElement;
  relabel(): void;
}

/**
 * One arrow. It is two halves of the same drawing, each clipped at the middle: the upper lies flat, the lower is
 * folded back along the crease. HTML halves, because 3D transforms on parts of an SVG are unreliable.
 */
export function createCreaseArrow(direction: 'previous' | 'next', onPress: () => void): CreaseArrow {
  const half = (name: string): HTMLElement => el('span', { class: `zh-crease-half ${name}`, 'aria-hidden': 'true' }, arrowDrawing());
  const glyph = el('span', { class: 'zh-crease' }, half('is-flat'), half('is-fold'));
  const button = el('button', { type: 'button', class: 'zh-arrow', 'data-dir': direction }, glyph);
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener('click', () => {
    // The fold snaps shut, holds, then springs back, whatever the pointer does meanwhile.
    button.classList.add('is-pressed');
    clearTimeout(timer);
    timer = setTimeout(() => button.classList.remove('is-pressed'), CREASE.pressHold);
    onPress();
  });
  const relabel = (): void => {
    const name = say(direction);
    button.setAttribute('aria-label', name);
    button.title = name;
    button.lang = uiLang();
  };
  relabel();
  return { element: button, relabel };
}

// ---------------------------------------------------------------------------------------------------------
// The counter

export function two(n: number): string {
  return String(n).padStart(2, '0');
}

export interface Counter {
  readonly element: HTMLElement;
  /** Which roadmap is in the light, counted from 0, and how many lie on the table. */
  set(selected: number, total: number): void;
  relabel(): void;
}

/**
 * "02 / 05" in the label face beside the arrows: which roadmap is in the light. It is plain text, not a picker.
 * The arrows, the arrow keys, a swipe and a click on a sheet turn the table. A screen reader hears the change.
 */
export function createCounter(): Counter {
  const now = el('span', { class: 'zh-counter-now' });
  const all = el('span', { class: 'zh-counter-total' });
  const spoken = el('span', { class: 'zh-sr' });
  const root = el('p', { class: 'zh-counter zt-label', role: 'status' }, el('span', { 'aria-hidden': 'true' }, now, ' / ', all), spoken);
  let selected = 0;
  let total = 0;
  const render = (): void => {
    root.lang = uiLang();
    root.hidden = total === 0;
    setText(now, two(selected + 1));
    setText(all, two(total));
    setText(spoken, total > 0 ? say('counter', { n: selected + 1, total }) : '');
  };
  render();
  return {
    element: root,
    set(nextSelected, nextTotal) {
      selected = nextSelected;
      total = nextTotal;
      render();
    },
    relabel: render,
  };
}

// ---------------------------------------------------------------------------------------------------------
// The enter button

export type EnterState =
  | { readonly kind: 'walk' }
  | { readonly kind: 'continue'; readonly stage: number }
  | { readonly kind: 'summit' }
  | { readonly kind: 'reviews'; readonly count: number };

/** The two lines of the button for a state. */
export function enterLabel(state: EnterState): { readonly title: string; readonly sub: string } {
  if (state.kind === 'reviews') return { title: say('enterReviews', { count: state.count }), sub: say('enterReviewsSub') };
  if (state.kind === 'continue') return { title: say('enterContinue'), sub: say('enterContinueSub', { i: state.stage }) };
  if (state.kind === 'summit') return { title: say('enterContinue'), sub: say('enterSummitSub') };
  return { title: say('enterWalk'), sub: say('enterWalkSub') };
}

/** Which state the button is in for a roadmap: due reviews first, then where the learner left off. */
export function enterState(started: boolean, hereStage: number, stages: number, due: number): EnterState {
  if (due > 0) return { kind: 'reviews', count: due };
  if (hereStage >= stages) return { kind: 'summit' };
  if (started) return { kind: 'continue', stage: hereStage + 1 };
  return { kind: 'walk' };
}

export const ENTER = { ball: 38, narrowBall: 32, pulse: 2600, drop: 1000, labelDelay: 500 } as const;

export interface EnterButton {
  readonly element: HTMLButtonElement;
  readonly state: EnterState;
  set(state: EnterState): void;
  /** The ball drops in with a bounce over one second. The label follows half a second later. */
  drop(): void;
  relabel(): void;
}

export function createEnterButton(onEnter: (state: EnterState) => void, reducedMotion: () => boolean = prefersReducedMotion): EnterButton {
  const ball = el('span', { class: 'zh-enter-ball', 'aria-hidden': 'true' }, el('span', { class: 'zh-enter-ring' }), el('span', { class: 'zh-enter-ring is-late' }), el('span', { class: 'zh-enter-head' }));
  const title = el('span', { class: 'zh-enter-title zt-label' });
  const sub = el('span', { class: 'zh-enter-sub zt-small' });
  const label = el('span', { class: 'zh-enter-label' }, title, sub);
  const button = el('button', { type: 'button', class: 'zh-enter' }, ball, label);
  let state: EnterState = { kind: 'walk' };
  button.addEventListener('click', () => onEnter(state));

  const render = (): void => {
    const text = enterLabel(state);
    button.lang = uiLang();
    button.dataset.state = state.kind;
    setText(title, text.title);
    setText(sub, text.sub);
  };
  render();

  return {
    element: button,
    get state() {
      return state;
    },
    set(next) {
      state = next;
      render();
    },
    drop() {
      if (reducedMotion() || typeof ball.animate !== 'function') return;
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        frames.push({ offset: t, transform: `translate3d(0, ${((easeOutBounce(t) - 1) * 64).toFixed(2)}px, 0)`, opacity: Math.min(1, t * 8) });
      }
      ball.animate(frames, { duration: ENTER.drop, easing: 'linear', fill: 'backwards' });
      label.animate(
        [
          { opacity: 0, transform: 'translate3d(-8px, 0, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 600, delay: ENTER.labelDelay, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
      );
    },
    relabel: render,
  };
}
