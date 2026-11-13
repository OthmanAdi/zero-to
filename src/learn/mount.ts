/**
 * How every card lives: built once into a root that never changes, refreshed from the session on every change,
 * and rebuilt only when the interface language changes.
 */
import { onUiLang, uiLang } from '../i18n';
import type { MountedCard } from './dom';
import type { Session } from './session';

export interface Built {
  update(): void;
  /** Timers and listeners of this build, stopped before a rebuild. */
  dispose?(): void;
}

export function mount(session: Session, root: HTMLElement, build: () => Built): MountedCard {
  let built = build();
  let alive = true;
  const update = (): void => {
    if (alive) built.update();
  };
  const offSession = session.subscribe(update);
  const offLang = onUiLang(() => {
    if (!alive) return;
    built.dispose?.();
    root.replaceChildren();
    root.setAttribute('lang', uiLang());
    built = build();
  });
  return {
    root,
    update,
    destroy() {
      alive = false;
      built.dispose?.();
      offSession();
      offLang();
    },
  };
}
