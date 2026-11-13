import type { Roadmap } from '../roadmap/types';

/**
 * What the overlay asks of the page. The overlay never turns the table, scrolls or changes the mode itself: it
 * says what the visitor asked for, and the director answers by calling the overlay's setters.
 */
export type HudMode = 'table' | 'walk' | 'list';

/** Who asked: the same words the table uses for a pick. */
export type HudBy = 'arrow' | 'key' | 'swipe';

export type HudEvent =
  /** Turn the table by one sheet: -1 is the previous roadmap, 1 the next. */
  | { readonly type: 'turn'; readonly step: -1 | 1; readonly by: HudBy }
  /** Go into the lit roadmap. `reviews` is true when the button offered due reviews first. */
  | { readonly type: 'enter'; readonly reviews: boolean }
  /** Walk to this share of the route, 0 to 1 by minutes. */
  | { readonly type: 'seek'; readonly along: number }
  /** Walk to a waypoint or a stage (a card, a profile mark or a mini map dot asked). */
  | { readonly type: 'go'; readonly waypointId?: string; readonly stageId?: string }
  /** The previous or next waypoint. */
  | { readonly type: 'step'; readonly step: -1 | 1 }
  /** Switch between the map and the list view. */
  | { readonly type: 'mode'; readonly mode: HudMode }
  /** Fold the map and go back to the table. */
  | { readonly type: 'fold' }
  /** The brand was pressed: back to the top of the table. */
  | { readonly type: 'home' }
  /** The start chip was pressed: go to the start ticket. */
  | { readonly type: 'start' }
  /** The teacher view was switched. */
  | { readonly type: 'teacher'; readonly on: boolean }
  /** The visitor confirmed the preview: put this roadmap on the table. */
  | { readonly type: 'open'; readonly roadmap: Roadmap; readonly source: 'link' | 'file' }
  /** Download the roadmap file (the share dialog offers it when a link would be too long). */
  | { readonly type: 'download'; readonly roadmap: Roadmap }
  /** The space the overlay takes changed: fit the camera again. */
  | { readonly type: 'insets' };

export type HudEventType = HudEvent['type'];

export interface HudBus {
  emit(event: HudEvent): void;
  /** Hears every event. Returns the function that stops it. */
  on(listener: (event: HudEvent) => void): () => void;
}

export function createHudBus(): HudBus {
  const listeners = new Set<(event: HudEvent) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
