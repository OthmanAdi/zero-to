import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRandom } from '../core/random';
import { canCompress, decodeRoadmap, encodeRoadmap, fromBase64Url, MAX_FRAGMENT_LENGTH, ShareTooLargeError, toBase64Url } from './share';
import { draft, sampleRoadmap } from './testing';
import type { Roadmap } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A deflate-raw stand-in, for environments without CompressionStream. It is only a reversible transform. */
function installFakeStreams(): void {
  const wrap = (xor: number) =>
    class {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;
      constructor(_format: string) {
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk.map((b) => b ^ xor));
          },
        });
        this.readable = readable;
        this.writable = writable;
      }
    };
  vi.stubGlobal('CompressionStream', wrap(0x5a));
  vi.stubGlobal('DecompressionStream', wrap(0x5a));
}

describe('base64url', () => {
  it('round-trips every byte value without padding or unsafe characters', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...fromBase64Url(text)]).toEqual([...bytes]);
    expect(toBase64Url(new Uint8Array(0))).toBe('');
  });

  it('refuses characters outside the alphabet', () => {
    expect(() => fromBase64Url('abc+/=')).toThrow();
  });
});

describe('encodeRoadmap and decodeRoadmap', () => {
  beforeEach(() => {
    if (!canCompress()) installFakeStreams();
  });

  it('round-trips the sample', async () => {
    const roadmap = sampleRoadmap();
    const fragment = await encodeRoadmap(roadmap);
    expect(fragment.startsWith('z1.')).toBe(true);
    expect(fragment).toMatch(/^z1\.[A-Za-z0-9_-]+$/);
    expect(fragment.length).toBeLessThan(MAX_FRAGMENT_LENGTH);
    const back = await decodeRoadmap(fragment);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.roadmap).toEqual(roadmap);
      expect(back.warnings).toEqual([]);
    }
  });

  it('compresses the sample well below its plain size', async () => {
    const roadmap = sampleRoadmap();
    const fragment = await encodeRoadmap(roadmap);
    expect(fragment.length).toBeLessThan(JSON.stringify(roadmap).length * 0.75);
  });

  it('accepts a leading hash, as it comes from location.hash', async () => {
    const fragment = await encodeRoadmap(sampleRoadmap());
    expect((await decodeRoadmap(`#${fragment}`)).ok).toBe(true);
  });

  it('keeps non-ASCII text intact', async () => {
    const r = draft();
    r.title = 'Rust für Pythonistas: Eigentümerschaft, 所有権, 🦀';
    const back = await decodeRoadmap(await encodeRoadmap(r as Roadmap));
    expect(back.ok && back.roadmap.title).toBe(r.title);
  });

  it('throws a clear error past 60,000 characters', async () => {
    const noise = createRandom('noise');
    const big = draft();
    big.topic = Array.from({ length: 70_000 }, () => String.fromCharCode(33 + Math.floor(noise() * 90))).join('');
    const error = await encodeRoadmap(big as Roadmap).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShareTooLargeError);
    const typed = error as ShareTooLargeError;
    expect(typed.limit).toBe(60_000);
    expect(typed.length).toBeGreaterThan(60_000);
    expect(typed.message).toContain('too large to share as a link');
    expect(typed.message).toContain('60,000');
  });

  it('refuses links that are too long to read', async () => {
    const result = await decodeRoadmap(`z1.${'A'.repeat(MAX_FRAGMENT_LENGTH)}`);
    expect(result.ok).toBe(false);
  });

  it('explains links that are not roadmaps', async () => {
    for (const text of ['', 'hello', 'x9.abcd', 'z1', '#']) {
      const result = await decodeRoadmap(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('does not hold a zero-to roadmap');
    }
  });

  it('explains damaged links without throwing', async () => {
    const good = await encodeRoadmap(sampleRoadmap());
    for (const text of ['z1.***', 'z1.AAAA', `${good.slice(0, 40)}`, 'j1.AAAA', `z1.${good.slice(3).replace(/[A-Z]/, '!')}`]) {
      const result = await decodeRoadmap(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(10);
    }
  });

  it('returns the validation problems of a roadmap that decodes but is wrong', async () => {
    const broken = draft();
    delete broken.brief.audience;
    const result = await decodeRoadmap(await encodeRoadmap(broken as Roadmap));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toEqual(['/brief/audience']);
      expect(result.error).toContain('has problems');
    }
  });

  it('does not unpack a link that inflates beyond any roadmap', async () => {
    const zeros = new Uint8Array(3_000_000);
    const packed = await new Response(
      new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer();
    if (!canCompress() || packed.byteLength >= zeros.length) return; // fake streams do not shrink data
    const result = await decodeRoadmap(`z1.${toBase64Url(new Uint8Array(packed))}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('far larger');
  });
});

describe('without CompressionStream', () => {
  it('sends the roadmap uncompressed and reads it back', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(canCompress()).toBe(false);
    const roadmap = sampleRoadmap();
    const fragment = await encodeRoadmap(roadmap);
    expect(fragment.startsWith('j1.')).toBe(true);
    const back = await decodeRoadmap(fragment);
    expect(back.ok && back.roadmap).toEqual(roadmap);
  });

  it('says plainly that a compressed link cannot be opened', async () => {
    const withStreams = await encodeRoadmap(sampleRoadmap());
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    const result = await decodeRoadmap(withStreams);
    expect(result.ok).toBe(false);
    if (!result.ok && withStreams.startsWith('z1.')) expect(result.error).toContain('cannot unpack compressed');
  });
});
