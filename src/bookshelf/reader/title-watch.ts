export interface TitleWatch {
  /** Watches a new heading, or stops watching when there is none. */
  watch(heading: Element | null): void;
  destroy(): void;
}

/**
 * Tells the bar when the heading has scrolled out under it, so the bar can show the title in its place.
 * `onChange(true)` means the heading is gone above the bar.
 */
export function createTitleWatch(scroller: HTMLElement, bar: HTMLElement, onChange: (gone: boolean) => void): TitleWatch {
  let observer: IntersectionObserver | null = null;
  const stop = (): void => {
    observer?.disconnect();
    observer = null;
  };
  return {
    watch(heading) {
      stop();
      if (!heading || typeof IntersectionObserver !== 'function') return;
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          onChange(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 1);
        },
        { root: scroller, rootMargin: `-${Math.round(bar.getBoundingClientRect().height)}px 0px 0px 0px`, threshold: [0, 1] },
      );
      observer.observe(heading);
    },
    destroy: stop,
  };
}
