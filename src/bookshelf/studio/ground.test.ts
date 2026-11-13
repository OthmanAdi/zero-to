import { describe, expect, it } from 'vitest';
import { contactAlpha, CREASE_PX, FRONT } from './ground';

describe('contact shadow', () => {
  it('is darkest at the foot and gone where the patch ends', () => {
    expect(contactAlpha(0)).toBeGreaterThan(0.9);
    expect(contactAlpha(FRONT)).toBe(0);
    expect(contactAlpha(FRONT + 20)).toBe(0);
  });

  it('has a tight crease on top of a soft patch', () => {
    // More than half of the dark is gone two crease widths out, yet the patch still shows there.
    const out = contactAlpha(CREASE_PX * 2);
    expect(out).toBeLessThan(contactAlpha(0) * 0.5);
    expect(out).toBeGreaterThan(0.1);
  });

  it('only gets fainter with distance', () => {
    let last = contactAlpha(0);
    for (let d = 0.5; d <= FRONT; d += 0.5) {
      const alpha = contactAlpha(d);
      expect(alpha).toBeLessThanOrEqual(last);
      last = alpha;
    }
  });

  it('is the same under the volume as at its foot', () => {
    expect(contactAlpha(-12)).toBe(contactAlpha(0));
  });

  it('loses the crease before the patch as a volume is lifted', () => {
    const standing = contactAlpha(0, 1);
    const raised = contactAlpha(0, 0.35);
    expect(raised).toBeLessThan(standing * 0.4);
    expect(contactAlpha(FRONT / 2, 0.35)).toBeGreaterThan(0);
  });

  it('never leaves the range of an alpha', () => {
    for (let d = -5; d <= FRONT + 5; d += 0.25) {
      for (const lifted of [0.35, 0.6, 1]) {
        const alpha = contactAlpha(d, lifted);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});
