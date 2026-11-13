// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSkill, foreignImports, SCHEMA_COPY, SCHEMA_SOURCE, TOOL_FILE } from '../../scripts/build-skill';

const root = join(import.meta.dirname, '..', '..');
const sample = join(root, 'src', 'roadmap', 'samples', 'rust-for-a-python-dev.json');

function runTool(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TOOL_FILE, ...args], { encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the built tool', () => {
  it('builds one file that imports only node: built-ins and runs --help', { timeout: 120_000 }, async () => {
    const result = await buildSkill({ quiet: true });
    expect(result.file).toBe(TOOL_FILE);
    const code = readFileSync(TOOL_FILE, 'utf8');
    expect(code.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(foreignImports(code)).toEqual([]);

    const help = runTool('--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: node zero-to.mjs');
  });

  it('reports the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    const version = runTool('--version');
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);
  });

  it('validates the sample when run by node', () => {
    const result = runTool('validate', sample);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('is a valid zero-to roadmap');
  });

  it('keeps the schema copy in the skill identical to the source', () => {
    expect(readFileSync(SCHEMA_COPY, 'utf8')).toBe(readFileSync(SCHEMA_SOURCE, 'utf8'));
  });
});

describe('foreignImports', () => {
  it('finds every import that is not a node: built-in', () => {
    const code = [
      'import { a } from "node:fs";',
      "import b from 'three';",
      'import "./side-effect.js";',
      'const c = await import("lodash");',
      'const d = require("node:path");',
      'const e = require("left-pad");',
    ].join('\n');
    expect(foreignImports(code)).toEqual(['three', './side-effect.js', 'lodash', 'left-pad']);
  });
});
