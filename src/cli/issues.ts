/**
 * Loading a roadmap file and printing what the validator found, with each problem's JSON pointer.
 */
import { basename } from 'node:path';
import { validateRoadmap, type ValidationResult } from '../roadmap/validate';
import type { Issue, Roadmap } from '../roadmap/types';
import { CliError, EXIT_PROBLEM, readJsonFile } from './io';

export interface LoadedRoadmap {
  readonly path: string;
  readonly data: unknown;
  readonly result: ValidationResult;
}

export function loadRoadmap(path: string): LoadedRoadmap {
  const data = readJsonFile(path, 'roadmap file');
  return { path, data, result: validateRoadmap(data) };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function issueList(heading: string, issues: readonly Issue[]): string[] {
  if (issues.length === 0) return [];
  const lines = ['', `${heading} (${issues.length})`];
  issues.forEach((issue, i) => {
    lines.push(`  ${i + 1}. at ${issue.path === '' ? '/ (the whole file)' : issue.path}`);
    lines.push(`     ${issue.message}`);
  });
  return lines;
}

/** A short report: one summary line, then every error and warning with its pointer. */
export function formatValidation(path: string, result: ValidationResult): string {
  const name = basename(path);
  const errors = result.ok ? [] : result.errors;
  const { warnings } = result;
  const summary = result.ok
    ? warnings.length === 0
      ? `${name} is a valid zero-to roadmap.`
      : `${name} is a valid zero-to roadmap, with ${plural(warnings.length, 'warning')}.`
    : `${name} has ${plural(errors.length, 'error')} and ${plural(warnings.length, 'warning')}. Fix the errors before building.`;
  return [summary, ...issueList('Errors', errors), ...issueList('Warnings', warnings)].join('\n');
}

/** The roadmap when it validates; otherwise a CliError that carries the full report. */
export function requireValid(loaded: LoadedRoadmap, action: string): { roadmap: Roadmap; warnings: Issue[] } {
  if (!loaded.result.ok) {
    throw new CliError(`${formatValidation(loaded.path, loaded.result)}\n\nNothing was ${action}.`, EXIT_PROBLEM);
  }
  return { roadmap: loaded.result.roadmap, warnings: loaded.result.warnings };
}
