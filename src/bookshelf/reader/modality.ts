/**
 * Whether the last thing the person did was use a pointer (a mouse or a finger) rather than the keyboard.
 * The reader uses it to decide if its first focus should show a ring: a ring after a tap looks like a
 * mistake, and a keyboard user needs it.
 */
let pointerLast = false;

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pointerLast = true), true);
  document.addEventListener('keydown', () => (pointerLast = false), true);
}

export const lastInputWasPointer = (): boolean => pointerLast;
