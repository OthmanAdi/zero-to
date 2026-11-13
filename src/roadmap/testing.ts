/**
 * Helpers for the roadmap tests: a fresh, mutable copy of the sample roadmap.
 */
import sample from './samples/rust-for-a-python-dev.json';
import type { Roadmap } from './types';

/** A mutable deep copy of the sample, for tests that break it on purpose. */
export function draft(): any {
  return structuredClone(sample);
}

/** The sample as a typed roadmap (read-only use). */
export function sampleRoadmap(): Roadmap {
  return structuredClone(sample) as unknown as Roadmap;
}
