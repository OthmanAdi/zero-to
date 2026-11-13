import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachDrag, type DragHandlers } from './gesture';

interface PointerInit {
  id?: number;
  x: number;
  y?: number;
  t?: number;
  type?: 'mouse' | 'touch';
  button?: number;
}

function pointer(type: string, init: PointerInit): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: init.id ?? 1,
    clientX: init.x,
    clientY: init.y ?? 0,
    pointerType: init.type ?? 'mouse',
    button: init.button ?? 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: init.t ?? 0 });
  return event;
}

interface Rig {
  element: HTMLElement;
  child: HTMLElement;
  moves: number[];
  starts: number;
  ends: Array<{ velocity: number; cancelled: boolean }>;
  detach: () => void;
  fire: (type: string, init: PointerInit) => void;
}

function rig(handlers: Partial<DragHandlers> = {}, shouldStart?: (event: PointerEvent) => boolean): Rig {
  const element = document.createElement('div');
  const child = document.createElement('span');
  element.appendChild(child);
  document.body.appendChild(element);
  element.setPointerCapture = vi.fn();
  const state: Rig = { element, child, moves: [], starts: 0, ends: [], detach: () => undefined, fire: () => undefined };
  state.detach = attachDrag(
    element,
    {
      onStart: () => {
        state.starts += 1;
      },
      onMove: (dx) => state.moves.push(dx),
      onEnd: (velocity, cancelled) => state.ends.push({ velocity, cancelled }),
      ...handlers,
    },
    { shouldStart },
  );
  state.fire = (type, init) => {
    element.dispatchEvent(pointer(type, init));
  };
  return state;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('attachDrag classification', () => {
  it('starts a drag on a mostly horizontal move past the slop and reports dx', () => {
    const r = rig();
    r.fire('pointerdown', { x: 100, y: 50 });
    r.fire('pointermove', { x: 112, y: 52 });
    r.fire('pointermove', { x: 130, y: 52 });
    expect(r.starts).toBe(1);
    expect(r.moves).toEqual([12, 30]);
    expect(r.element.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('tells onStart where the press began and onMove the pointer x', () => {
    const origins: Array<{ x: number; y: number; target: EventTarget | null; time: number }> = [];
    const xs: number[] = [];
    const r = rig({
      onStart: (_event, origin) => void origins.push(origin),
      onMove: (_dx, _event, x) => void xs.push(x),
    });
    r.child.dispatchEvent(pointer('pointerdown', { x: 100, y: 50, t: 7 }));
    r.fire('pointermove', { x: 112, y: 52, t: 20 });
    r.fire('pointermove', { x: 130, y: 52, t: 30 });
    expect(origins).toEqual([{ x: 100, y: 50, target: r.child, time: 7 }]);
    expect(xs).toEqual([112, 130]);
  });

  it('does not start on a mostly vertical move, and stays out of it afterwards', () => {
    const r = rig();
    r.fire('pointerdown', { x: 100, y: 50 });
    r.fire('pointermove', { x: 104, y: 80 });
    r.fire('pointermove', { x: 160, y: 80 });
    r.fire('pointerup', { x: 160, y: 80 });
    expect(r.starts).toBe(0);
    expect(r.moves).toEqual([]);
    expect(r.ends).toEqual([]);
  });

  it('uses a slop of 4 px for a mouse', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 3 });
    expect(r.starts).toBe(0);
    r.fire('pointermove', { x: 4 });
    expect(r.starts).toBe(1);
  });

  it('uses a slop of 8 px for touch', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0, type: 'touch' });
    r.fire('pointermove', { x: 7, type: 'touch' });
    expect(r.starts).toBe(0);
    r.fire('pointermove', { x: 8, type: 'touch' });
    expect(r.starts).toBe(1);
  });

  it('ignores non-primary mouse buttons', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0, button: 2 });
    r.fire('pointermove', { x: 40, button: 2 });
    expect(r.starts).toBe(0);
  });

  it('ignores a pointerdown when shouldStart returns false', () => {
    const r = rig({}, () => false);
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 40 });
    expect(r.starts).toBe(0);
  });

  it('ignores a second pointer while one is active', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0, id: 1 });
    r.fire('pointerdown', { x: 500, id: 2 });
    r.fire('pointermove', { x: 20, id: 2 });
    expect(r.starts).toBe(0);
    r.fire('pointermove', { x: 20, id: 1 });
    expect(r.moves).toEqual([20]);
  });
});

describe('attachDrag release', () => {
  it('measures release velocity in px per ms over the recent window', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0, t: 0 });
    r.fire('pointermove', { x: 10, t: 10 });
    r.fire('pointermove', { x: 20, t: 20 });
    r.fire('pointerup', { x: 20, t: 20 });
    expect(r.ends).toEqual([{ velocity: 1, cancelled: false }]);
  });

  it('passes the timestamp of the releasing event', () => {
    const times: number[] = [];
    const r = rig({ onEnd: (_velocity, _cancelled, time) => void times.push(time) });
    r.fire('pointerdown', { x: 0, t: 0 });
    r.fire('pointermove', { x: 30, t: 20 });
    r.fire('pointerup', { x: 30, t: 55 });
    expect(times).toEqual([55]);
  });

  it('reports zero velocity when the pointer rested before release', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0, t: 0 });
    r.fire('pointermove', { x: 30, t: 20 });
    r.fire('pointerup', { x: 30, t: 500 });
    expect(r.ends).toEqual([{ velocity: 0, cancelled: false }]);
  });

  it('ends with cancelled true and zero velocity on pointercancel', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0, t: 0 });
    r.fire('pointermove', { x: 10, t: 10 });
    r.fire('pointermove', { x: 40, t: 20 });
    r.fire('pointercancel', { x: 40, t: 20 });
    expect(r.ends).toEqual([{ velocity: 0, cancelled: true }]);
  });

  it('treats lost pointer capture during a drag as a cancel', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 30 });
    r.fire('lostpointercapture', { x: 30 });
    expect(r.ends).toEqual([{ velocity: 0, cancelled: true }]);
  });

  it('does not call onEnd for a press that never became a drag', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointerup', { x: 1 });
    expect(r.ends).toEqual([]);
  });
});

describe('attachDrag click suppression', () => {
  function click(r: Rig): boolean {
    let reached = false;
    r.child.addEventListener(
      'click',
      () => {
        reached = true;
      },
      { once: true },
    );
    r.child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return reached;
  }

  it('swallows the click that follows a drag', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 40 });
    r.fire('pointerup', { x: 40 });
    expect(click(r)).toBe(false);
  });

  it('lets a plain click through', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointerup', { x: 0 });
    expect(click(r)).toBe(true);
  });

  it('stops swallowing on the next task when no click arrived', () => {
    vi.useFakeTimers();
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 40 });
    r.fire('pointerup', { x: 40 });
    vi.advanceTimersByTime(1);
    expect(click(r)).toBe(true);
  });

  it('does not swallow a click after a cancelled drag', () => {
    const r = rig();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 40 });
    r.fire('pointercancel', { x: 40 });
    expect(click(r)).toBe(true);
  });
});

describe('attachDrag element handling', () => {
  it('leaves vertical scrolling and pinching to the browser while attached and restores it after detach', () => {
    const element = document.createElement('div');
    element.style.touchAction = 'manipulation';
    const detach = attachDrag(element, { onMove: () => undefined, onEnd: () => undefined });
    expect(element.style.touchAction).toBe('pan-y pinch-zoom');
    detach();
    expect(element.style.touchAction).toBe('manipulation');
  });

  it('stops reacting after detach', () => {
    const r = rig();
    r.detach();
    r.fire('pointerdown', { x: 0 });
    r.fire('pointermove', { x: 40 });
    expect(r.starts).toBe(0);
  });

  it('prevents native dragstart', () => {
    const r = rig();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    r.child.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
