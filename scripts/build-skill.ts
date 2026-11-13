/**
 * Builds the skill's command-line tool: one plain ES module, `.agents/skills/zero-to/scripts/zero-to.mjs`, that
 * runs with `node` and imports nothing but Node's built-in modules. Also copies the roadmap schema into the skill
 * folder, so the copy never drifts from `src/roadmap/roadmap.schema.json`.
 *
 * Run: npm run build:skill (Node 22.18 or later strips the types of this file by itself).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SKILL_DIR = join(root, '.agents', 'skills', 'zero-to');
export const TOOL_FILE = join(SKILL_DIR, 'scripts', 'zero-to.mjs');
export const SCHEMA_SOURCE = join(root, 'src', 'roadmap', 'roadmap.schema.json');
export const SCHEMA_COPY = join(SKILL_DIR, 'schema', 'roadmap.schema.json');

const SHEBANG = '#!/usr/bin/env node\n';
/** The tool is read and run by agents on any machine; it stays small. */
export const MAX_TOOL_BYTES = 400 * 1024;

export interface BuildSkillOptions {
  /** Folder for zero-to.mjs. Default: the skill's scripts folder. */
  readonly outDir?: string;
  readonly quiet?: boolean;
}

export interface BuildSkillResult {
  readonly file: string;
  readonly bytes: number;
  readonly schema: string;
}

/** Every import or require in the bundle that is not a node: built-in. */
export function foreignImports(code: string): string[] {
  const found = new Set<string>();
  const patterns = [/\bimport\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined && !specifier.startsWith('node:')) found.add(specifier);
    }
  }
  return [...found];
}

export async function buildSkill(options: BuildSkillOptions = {}): Promise<BuildSkillResult> {
  const outDir = options.outDir ?? dirname(TOOL_FILE);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: options.quiet ? 'silent' : 'info',
    define: { __ZERO_TO_VERSION__: JSON.stringify(pkg.version) },
    ssr: { target: 'node', noExternal: true },
    build: {
      ssr: join(root, 'src', 'cli', 'bin.ts'),
      target: 'node22',
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rolldownOptions: {
        output: { format: 'es', entryFileNames: 'zero-to.mjs', codeSplitting: false },
      },
    },
  });

  const file = join(outDir, 'zero-to.mjs');
  let code = readFileSync(file, 'utf8');
  if (code.startsWith('#!')) code = code.slice(code.indexOf('\n') + 1);
  code = SHEBANG + code;
  const foreign = foreignImports(code);
  if (foreign.length > 0) throw new Error(`zero-to.mjs must import only node: built-ins, but it imports: ${foreign.join(', ')}`);
  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > MAX_TOOL_BYTES) {
    throw new Error(`zero-to.mjs is ${Math.round(bytes / 1024)} KB, over the ${MAX_TOOL_BYTES / 1024} KB limit. A module it imports probably pulled in scene code (three.js).`);
  }
  writeFileSync(file, code, 'utf8');

  mkdirSync(dirname(SCHEMA_COPY), { recursive: true });
  copyFileSync(SCHEMA_SOURCE, SCHEMA_COPY);

  return { file, bytes, schema: SCHEMA_COPY };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = await buildSkill();
  process.stdout.write(`Built ${result.file} (${(result.bytes / 1024).toFixed(1)} KB) and copied the schema to ${result.schema}.\n`);
}
