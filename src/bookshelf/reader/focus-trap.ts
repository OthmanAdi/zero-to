const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside the dialog by wrapping from the last stop to the first and back. */
export function trapTab(event: KeyboardEvent, root: HTMLElement, sheet: HTMLElement): void {
  const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = root.ownerDocument.activeElement;
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const backwards = event.shiftKey && (active === first || active === sheet || active === root || !root.contains(active));
  const forwards = !event.shiftKey && (active === last || !root.contains(active));
  if (backwards) {
    event.preventDefault();
    last.focus();
  } else if (forwards) {
    event.preventDefault();
    first.focus();
  }
}
