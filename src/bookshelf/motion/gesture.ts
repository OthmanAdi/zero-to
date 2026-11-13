/**
 * Horizontal drag recogniser on Pointer Events.
 *
 * The element keeps `touch-action: pan-y pinch-zoom`, so the browser still owns
 * vertical scrolling and pinching on touch screens. A gesture becomes a drag only after it leaves the
 * slop radius while moving mostly sideways; otherwise it is left alone and stays
 * a tap or a page scroll.
 */
/** Where the press that became a drag began. */
export interface DragOrigin {
  /** Pointer x at the press, in client px. */
  x: number;
  y: number;
  /** What the press landed on, so a host can tell which part of the element was grabbed. */
  target: EventTarget | null;
  /** Timestamp of the press. */
  time: number;
}

export interface DragHandlers {
  /** `event` is the move that crossed the slop; `origin` describes the press before it. */
  onStart?(event: PointerEvent, origin: DragOrigin): void;
  /** `dx` is the horizontal distance from where the pointer went down, in px. `x` is the pointer's client x. */
  onMove(dx: number, event: PointerEvent, x: number): void;
  /**
   * `velocityX` is in px per millisecond. `cancelled` is true after pointercancel or lost capture. `time` is the
   * timestamp of the releasing event, on the same scale as the `timeStamp` of the move events.
   */
  onEnd(velocityX: number, cancelled: boolean, time: number): void;
}

export interface DragOptions {
  /** Movement allowed before a gesture is classified, in px. */
  mouseSlop?: number;
  touchSlop?: number;
  /** Sideways travel must exceed vertical travel by this factor to become a drag. */
  dominance?: number;
  /** Window used to measure release velocity, in ms. */
  velocityWindow?: number;
  /** Return false to ignore a pointerdown, for example on a form control. */
  shouldStart?(event: PointerEvent): boolean;
}

interface Sample {
  time: number;
  x: number;
}

const DEFAULTS = { mouseSlop: 4, touchSlop: 8, dominance: 1.2, velocityWindow: 80 };

export function attachDrag(element: HTMLElement, handlers: DragHandlers, options: DragOptions = {}): () => void {
  const config = { ...DEFAULTS, ...options };
  const previousTouchAction = element.style.touchAction;
  // Vertical scrolling and pinching stay with the browser: a row of small spines must be zoomable.
  element.style.touchAction = 'pan-y pinch-zoom';

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startTarget: EventTarget | null = null;
  let startTime = 0;
  let dragging = false;
  let samples: Sample[] = [];
  let suppressClick = false;

  const reset = (): void => {
    pointerId = null;
    dragging = false;
    samples = [];
  };

  const releaseVelocity = (now: number): number => {
    const recent = samples.filter((sample) => now - sample.time <= config.velocityWindow);
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (!first || !last || last.time === first.time) return 0;
    return (last.x - first.x) / (last.time - first.time);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (config.shouldStart && !config.shouldStart(event)) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTarget = event.target;
    startTime = event.timeStamp;
    dragging = false;
    samples = [{ time: event.timeStamp, x: event.clientX }];
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!dragging) {
      const slop = event.pointerType === 'mouse' ? config.mouseSlop : config.touchSlop;
      if (Math.hypot(dx, dy) < slop) return;
      if (Math.abs(dx) <= Math.abs(dy) * config.dominance) {
        // Mostly vertical: this is a scroll, not ours.
        reset();
        return;
      }
      dragging = true;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; the drag still works while it stays over the element.
      }
      handlers.onStart?.(event, { x: startX, y: startY, target: startTarget, time: startTime });
    }

    samples.push({ time: event.timeStamp, x: event.clientX });
    if (samples.length > 12) samples.shift();
    handlers.onMove(dx, event, event.clientX);
  };

  const finish = (event: PointerEvent, cancelled: boolean): void => {
    if (event.pointerId !== pointerId) return;
    const wasDragging = dragging;
    const velocity = cancelled ? 0 : releaseVelocity(event.timeStamp);
    reset();
    if (!wasDragging) return;
    if (!cancelled) {
      // The browser still fires a click after a drag that ends over the element. Swallow that one.
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    handlers.onEnd(velocity, cancelled, event.timeStamp);
  };

  const onPointerUp = (event: PointerEvent): void => finish(event, false);
  const onPointerCancel = (event: PointerEvent): void => finish(event, true);
  const onLostCapture = (event: PointerEvent): void => {
    // On touch the element under the finger captures the pointer implicitly. When this element then takes
    // capture, that descendant fires lostpointercapture, which bubbles here. Only our own loss ends the drag.
    if (event.target !== element) return;
    if (dragging) finish(event, true);
  };

  const onClickCapture = (event: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // Native image and text dragging would steal the gesture from a mouse.
  const onDragStart = (event: Event): void => event.preventDefault();

  // Once a touch drag is ours, consume its moves. Otherwise the browser still tracks the gesture, treats a
  // quick release as a fling, and swallows the next tap anywhere on the page to "stop" that fling.
  // Vertical gestures never reach this point as drags, so page scrolling is untouched.
  const onTouchMove = (event: TouchEvent): void => {
    if (dragging && event.cancelable) event.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onLostCapture);
  element.addEventListener('click', onClickCapture, true);
  element.addEventListener('dragstart', onDragStart);
  element.addEventListener('touchmove', onTouchMove, { passive: false });

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onLostCapture);
    element.removeEventListener('click', onClickCapture, true);
    element.removeEventListener('dragstart', onDragStart);
    element.removeEventListener('touchmove', onTouchMove);
    element.style.touchAction = previousTouchAction;
  };
}
