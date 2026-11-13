/**
 * Sharing a roadmap as a link: the JSON is compacted, compressed with the browser's own `CompressionStream`
 * (raw deflate) and written as base64url, so the whole roadmap travels in the part of the address after `#` and
 * no server ever sees it. Where the browser has no CompressionStream the roadmap is sent uncompressed instead
 * (marked `j1.`), which only makes the link longer.
 *
 * Fragment format: `z1.<base64url>` (deflate-raw) or `j1.<base64url>` (plain JSON).
 */
import { validateRoadmap, type ValidationResult } from './validate';
import type { Issue, Roadmap } from './types';

/** Longest fragment this module writes or reads, in characters. */
export const MAX_FRAGMENT_LENGTH = 60_000;
/** Longest roadmap JSON accepted after decompression, in bytes. Stops a tiny link from inflating without bound. */
export const MAX_JSON_BYTES = 2_000_000;

export class ShareTooLargeError extends Error {
  readonly length: number;
  readonly limit: number;

  constructor(length: number, limit: number) {
    super(
      `This roadmap is too large to share as a link: it needs ${length.toLocaleString('en-US')} characters and a link can carry ${limit.toLocaleString('en-US')}. Share the roadmap file instead, or remove some waypoints.`,
    );
    this.name = 'ShareTooLargeError';
    this.length = length;
    this.limit = limit;
  }
}

export type DecodeResult =
  | { readonly ok: true; readonly roadmap: Roadmap; readonly warnings: Issue[] }
  | { readonly ok: false; readonly error: string; readonly errors: Issue[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('The link contains characters that cannot be part of a roadmap.');
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('The link unpacks to something far larger than any roadmap, so it was not opened.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when this environment can compress and decompress links. */
export function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>), MAX_JSON_BYTES);
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>), MAX_JSON_BYTES);
}

/**
 * The text to put after `#` in a link. Throws `ShareTooLargeError` past `MAX_FRAGMENT_LENGTH` characters.
 * The roadmap is written as it is: remove teacher-only parts before sharing with students.
 */
export async function encodeRoadmap(roadmap: Roadmap): Promise<string> {
  const json = encoder.encode(JSON.stringify(roadmap));
  const fragment = canCompress() ? `z1.${toBase64Url(await deflate(json))}` : `j1.${toBase64Url(json)}`;
  if (fragment.length > MAX_FRAGMENT_LENGTH) throw new ShareTooLargeError(fragment.length, MAX_FRAGMENT_LENGTH);
  return fragment;
}

/** Reads a fragment (with or without the leading `#`) back into a validated roadmap. Never throws. */
export async function decodeRoadmap(fragment: string): Promise<DecodeResult> {
  const fail = (error: string): DecodeResult => ({ ok: false, error, errors: [] });
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (text.length > MAX_FRAGMENT_LENGTH) {
    return fail(`This link is longer than the ${MAX_FRAGMENT_LENGTH.toLocaleString('en-US')} characters a roadmap link can have, so it was not opened.`);
  }
  const dot = text.indexOf('.');
  const kind = dot < 0 ? '' : text.slice(0, dot);
  if (kind !== 'z1' && kind !== 'j1') return fail('This link does not hold a zero-to roadmap, or it comes from a newer version of the site.');

  let json: string;
  try {
    const packed = fromBase64Url(text.slice(dot + 1));
    if (kind === 'z1') {
      if (!canCompress()) return fail('This browser cannot unpack compressed roadmap links. Try a current version of Chrome, Firefox or Safari.');
      json = decoder.decode(await inflate(packed));
    } else {
      json = decoder.decode(packed);
    }
  } catch (cause) {
    const reason = cause instanceof Error && cause.message.startsWith('The link') ? cause.message : 'The link is damaged: its roadmap could not be unpacked.';
    return fail(reason);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail('The link is damaged: what it holds is not a roadmap.');
  }
  const result: ValidationResult = validateRoadmap(parsed);
  if (!result.ok) return { ok: false, error: 'The link holds a roadmap, but the roadmap has problems.', errors: result.errors };
  return { ok: true, roadmap: result.roadmap, warnings: result.warnings };
}
