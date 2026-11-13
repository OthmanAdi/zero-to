import type { Flight, FlightOptions } from '../bookshelf/app/flight';
import type { ShelfHandle } from '../bookshelf/shelf';
import type { StudioHandle } from '../bookshelf/studio';
import { isSoftwareRenderer } from '../bookshelf/studio/budget';

// A failed or software renderer applies to this page, including when the dock is rebuilt for another roadmap.
let studioSupported: boolean | undefined;

function supportsStudio(): boolean {
  const { hardwareConcurrency, deviceMemory } = navigator as Navigator & { deviceMemory?: number };
  if ((hardwareConcurrency > 0 && hardwareConcurrency <= 4) || (deviceMemory !== undefined && deviceMemory <= 2)) return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2', {
      failIfMajorPerformanceCaveat: true,
      powerPreference: 'high-performance',
    });
    if (!gl) return false;
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? '');
      return !isSoftwareRenderer(name);
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    return false;
  }
}

function afterPaint(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 1200 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 300);
  return () => window.clearTimeout(id);
}

/** Start with the interactive Classic shelf, then let Studio paint the same books if the device can draw it. */
export function adaptiveShelfPaint(shelf: ShelfHandle, reducedMotion: () => boolean) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const colors = window.matchMedia('(forced-colors: active)');
  let studio: StudioHandle | null = null;
  let cancelStart: (() => void) | null = null;
  let loading = false;
  let visible = false;
  let disposed = false;

  const wantsStudio = (): boolean => visible && !disposed && !reducedMotion() && !colors.matches;
  const canStart = (): boolean => wantsStudio() && !document.hidden && studioSupported !== false;
  const dropStudio = (): void => {
    studio?.destroy();
    studio = null;
  };
  const fallback = (): void => {
    studioSupported = false;
    dropStudio();
  };

  async function loadStudio(): Promise<void> {
    cancelStart = null;
    if (!canStart()) return;
    studioSupported ??= supportsStudio();
    if (!studioSupported) return;
    loading = true;
    try {
      const [renderer, materials] = await Promise.all([
        import('../bookshelf/studio'),
        import('../bookshelf/studio/kit'),
      ]);
      if (canStart()) {
        studio = renderer.mountStudio(shelf, { onFailure: fallback, kit: materials.createKit });
      }
    } catch {
      if (canStart()) fallback();
    } finally {
      loading = false;
    }
  }

  function update(): void {
    if (!wantsStudio()) dropStudio();
    if (!canStart()) {
      cancelStart?.();
      cancelStart = null;
    } else if (!studio && !loading && !cancelStart) {
      cancelStart = afterPaint(() => void loadStudio());
    }
  }
  motion.addEventListener('change', update);
  colors.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);

  return {
    setVisible(value: boolean): void {
      if (visible === value) return;
      visible = value;
      update();
    },
    flight(options: FlightOptions, id: string): Flight | null {
      if (!studio || shelf.element.dataset.paint !== 'studio') return null;
      try {
        return studio.createFlight(options, id);
      } catch {
        return null;
      }
    },
    destroy(): void {
      disposed = true;
      update();
      motion.removeEventListener('change', update);
      colors.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    },
  };
}
