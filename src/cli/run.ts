/**
 * The zero-to command-line tool: validate, check-links, build, link, student and catalogue.
 * `run` takes the arguments and an Io object and resolves to the exit code; it never calls process.exit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeRoadmap, MAX_FRAGMENT_LENGTH, ShareTooLargeError } from '../roadmap/share';
import { validateRoadmap } from '../roadmap/validate';
import type { CheckStatus, Resource, ResourceCheck } from '../roadmap/types';
import { CliError, EXIT_OK, EXIT_PROBLEM, EXIT_USAGE, localDay, readJsonFile, resolvePath, toJsonText, type Io } from './io';
import { formatValidation, loadRoadmap, requireValid } from './issues';
import { checkResources, formatTotals, keptDetail, nextCheck, totalsOf, type LinkResult, type Totals } from './links';
import { hasTeacherParts, studentCopy } from './student';
import { injectRoadmap, ViewerTemplateError, type ReceiptCounts } from './viewer';

declare const __ZERO_TO_VERSION__: string | undefined;

export const VERSION: string = typeof __ZERO_TO_VERSION__ === 'string' ? __ZERO_TO_VERSION__ : '0.0.0-dev';
export const DEFAULT_SHARE_BASE = 'https://othmanadi.github.io/zero-to/';
export const RECEIPT_FORMAT = 'zero-to/links-1';

export const HELP = `zero-to ${VERSION}: check, build and share zero-to roadmap files.

Usage: node zero-to.mjs <command> <roadmap.json> [options]

Commands
  validate <roadmap.json>
      Check the file against the schema and the roadmap rules. Prints every
      error and warning with its JSON pointer.

  check-links <roadmap.json> [--write] [--receipt <file>] [--trust-200]
      Open every resource address (at most 4 at once, 15 s each, up to 5
      redirects; YouTube videos through the oEmbed lookup) and print a table
      with the totals "N opened, N kept, N dead, N flagged".
      --write          Write each result into the resource's "check" and set
                       "checkedOn" to today. Nothing is deleted.
      --receipt <file> Save every result as a JSON receipt.
      --trust-200      Mark a link that answers 200 as verified. Use it only
                       after reading the pages: a 200 proves the address is
                       reachable, not that the page is the right resource.

  build <roadmap.json> [--viewer <path>] [--out <file.html>] [--receipt <file>]
      Validate, then write one self-contained HTML file that opens offline.
      --viewer         Viewer template. Default: ../viewer/zero-to.html next
                       to this script.
      --out            Output file. Default: <roadmap id>.html next to the
                       roadmap.
      --receipt        A check-links receipt whose counts the page shows.

  link <roadmap.json> [--base <url>]
      Print a share link that carries the whole roadmap after "#r=".
      Default base: ${DEFAULT_SHARE_BASE}

  student <roadmap.json> [--out <file>]
      Write the student copy: no teacher notes, no session plans, no answers
      to assessed checks. Default: <name>.student.json next to the roadmap.

  catalogue
      Print the map options as JSON: terrain and trail templates, surfaces,
      signpost keys and themes.

  --help, --version

Exit codes: 0 done, 1 the roadmap has problems (or check-links found dead
links), 2 the command could not run (wrong usage, a missing file).`;

type Flags = Record<string, string | boolean | undefined>;

interface Parsed {
  readonly positionals: string[];
  readonly flags: Flags;
}

function parse(args: readonly string[], strings: readonly string[], booleans: readonly string[]): Parsed {
  const options: Record<string, { type: 'string' | 'boolean' }> = { help: { type: 'boolean' } };
  for (const name of strings) options[name] = { type: 'string' };
  for (const name of booleans) options[name] = { type: 'boolean' };
  try {
    const { values, positionals } = parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
    return { positionals, flags: values as Flags };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new CliError(`${message}\nRun "zero-to --help" for the commands and their options.`, EXIT_USAGE);
  }
}

function onePath(parsed: Parsed, command: string): string {
  const [path, ...extra] = parsed.positionals;
  if (path === undefined) throw new CliError(`"${command}" needs a roadmap file, for example: zero-to ${command} my-roadmap.json`, EXIT_USAGE);
  if (extra.length > 0) throw new CliError(`"${command}" takes one roadmap file, but got ${parsed.positionals.length}: ${parsed.positionals.join(', ')}`, EXIT_USAGE);
  return path;
}

function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === 'string' ? value : undefined;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------------------------------------------

function validateCommand(args: readonly string[], io: Io): number {
  const parsed = parse(args, [], []);
  const loaded = loadRoadmap(resolvePath(io, onePath(parsed, 'validate')));
  const report = formatValidation(loaded.path, loaded.result);
  if (loaded.result.ok) {
    io.out(report);
    return EXIT_OK;
  }
  io.err(report);
  return EXIT_PROBLEM;
}

function resourcesOf(data: unknown, path: string): Resource[] {
  const list = (data as { resources?: unknown } | null)?.resources;
  if (!Array.isArray(list)) throw new CliError(`${basename(path)} has no "resources" list, so there are no links to check.`, EXIT_PROBLEM);
  list.forEach((item: unknown, i) => {
    const r = item as { id?: unknown; url?: unknown } | null;
    if (r === null || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.url !== 'string') {
      throw new CliError(`Resource ${i + 1} in ${basename(path)} needs a text "id" and a text "url" before its link can be checked.`, EXIT_PROBLEM);
    }
  });
  return list as Resource[];
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function cut(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

export function linkTable(results: readonly LinkResult[], before: ReadonlyMap<string, CheckStatus | undefined>, trust200: boolean): string {
  const idWidth = Math.min(28, Math.max(8, ...results.map((r) => r.resourceId.length)));
  const rows = results.map((r, i) => {
    const detail = r.outcome === 'kept' ? keptDetail(r, before.get(r.resourceId), trust200) : r.reason;
    return [String(i + 1).padStart(3), pad(cut(r.resourceId, idWidth), idWidth), pad(r.outcome, 10), pad(r.http === null ? '-' : String(r.http), 4), cut(detail, 90)].join('  ');
  });
  const head = ['  #', pad('resource', idWidth), pad('result', 10), 'http', 'detail'].join('  ');
  return [head, ...rows].join('\n');
}

async function checkLinksCommand(args: readonly string[], io: Io): Promise<number> {
  const parsed = parse(args, ['receipt'], ['write', 'trust-200']);
  const path = resolvePath(io, onePath(parsed, 'check-links'));
  const data = readJsonFile(path, 'roadmap file');
  const resources = resourcesOf(data, path);
  const trust200 = parsed.flags['trust-200'] === true;
  const before = validateRoadmap(data);
  if (!before.ok) io.err(`Note: ${basename(path)} does not validate yet (${before.errors.length} errors). Checking the links anyway.`);

  const started = io.now();
  const today = localDay(started);
  io.err(`Opening ${resources.length} links, at most 4 at once. This can take a minute.`);
  const results = await checkResources(resources, { fetch: io.fetch });
  const finished = io.now();
  const statusBefore = new Map<string, CheckStatus | undefined>(resources.map((r) => [r.id, r.check?.status]));
  const totals = totalsOf(results);

  const nextChecks = new Map<string, ResourceCheck>();
  resources.forEach((r, i) => {
    const result = results[i];
    if (result) nextChecks.set(r.id, nextCheck(r.check, result, today, trust200));
  });

  io.out(linkTable(results, statusBefore, trust200));
  io.out('');
  io.out(formatTotals(totals));
  const unread = results.filter((r) => r.outcome === 'kept' && statusBefore.get(r.resourceId) !== 'verified' && !trust200).length;
  if (unread > 0) {
    io.out(`${unread} reachable but not marked verified: read each page, then set its status to "verified" (or run again with --trust-200 once read).`);
  }

  const receiptPath = stringFlag(parsed, 'receipt');
  if (receiptPath !== undefined) {
    const id = (data as { id?: unknown }).id;
    const receipt = {
      receipt: RECEIPT_FORMAT,
      tool: `zero-to ${VERSION}`,
      roadmap: typeof id === 'string' ? id : null,
      file: basename(path),
      checkedOn: today,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      trust200,
      totals,
      results: results.map((r) => ({
        ...r,
        statusBefore: statusBefore.get(r.resourceId) ?? null,
        statusAfter: nextChecks.get(r.resourceId)?.status ?? null,
        decision: r.outcome === 'kept' ? 'kept' : r.outcome === 'dead' ? 'dropped' : 'flagged',
      })),
    };
    const out = resolvePath(io, receiptPath);
    writeText(out, toJsonText(receipt));
    io.err(`Receipt written to ${out}.`);
  }

  if (parsed.flags.write === true) {
    const roadmap = data as { checkedOn?: string; resources: Resource[] };
    roadmap.resources = resources.map((r) => {
      const check = nextChecks.get(r.id);
      return check === undefined ? r : { ...r, check };
    });
    roadmap.checkedOn = today;
    writeFileSync(path, toJsonText(roadmap), 'utf8');
    io.err(`Updated the checks in ${path} and set checkedOn to ${today}. No resource was removed.`);
    const after = validateRoadmap(roadmap);
    if (!after.ok) {
      io.err(`\nAfter this check the roadmap no longer validates. Replace dead links, read reachable ones, or add "gap" lines:\n${formatValidation(path, after)}`);
    }
  }
  return totals.dead > 0 ? EXIT_PROBLEM : EXIT_OK;
}

function readReceiptCounts(path: string): ReceiptCounts {
  const data = readJsonFile(path, 'receipt') as { totals?: Partial<Totals>; checkedOn?: unknown } | null;
  const totals = data?.totals;
  const numbers = ['opened', 'kept', 'dead', 'flagged'] as const;
  if (!totals || numbers.some((k) => typeof totals[k] !== 'number') || typeof data?.checkedOn !== 'string') {
    throw new CliError(`${path} is not a check-links receipt: it needs "totals" with opened, kept, dead and flagged, and "checkedOn".`, EXIT_PROBLEM);
  }
  return { opened: totals.opened as number, kept: totals.kept as number, dead: totals.dead as number, flagged: totals.flagged as number, checkedOn: data.checkedOn };
}

function defaultViewer(io: Io): string {
  return resolve(io.scriptDir, '..', 'viewer', 'zero-to.html');
}

function buildCommand(args: readonly string[], io: Io): number {
  const parsed = parse(args, ['viewer', 'out', 'receipt'], []);
  const path = resolvePath(io, onePath(parsed, 'build'));
  const { roadmap, warnings } = requireValid(loadRoadmap(path), 'built');
  const viewerFlag = stringFlag(parsed, 'viewer');
  const viewer = viewerFlag === undefined ? defaultViewer(io) : resolvePath(io, viewerFlag);
  if (!existsSync(viewer)) {
    io.err(
      [
        `The viewer template is missing: ${viewer}`,
        viewerFlag === undefined
          ? 'The skill ships it as viewer/zero-to.html, next to the scripts folder. Reinstall the skill, or pass --viewer <path> to a zero-to viewer build.'
          : 'Check the path given to --viewer.',
      ].join('\n'),
    );
    return EXIT_USAGE;
  }
  const receiptFlag = stringFlag(parsed, 'receipt');
  const receipt = receiptFlag === undefined ? undefined : readReceiptCounts(resolvePath(io, receiptFlag));
  let html: string;
  try {
    html = injectRoadmap(readFileSync(viewer, 'utf8'), roadmap, receipt);
  } catch (cause) {
    if (cause instanceof ViewerTemplateError) {
      io.err(`${cause.message}\nTemplate: ${viewer}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
  const outFlag = stringFlag(parsed, 'out');
  const out = outFlag === undefined ? join(dirname(path), `${roadmap.id}.html`) : resolvePath(io, outFlag);
  writeText(out, html);
  const advice = warnings.length > 0 ? ` The roadmap has ${warnings.length} warning${warnings.length === 1 ? '' : 's'}; "validate" lists them.` : '';
  io.out(`Wrote ${out} (${kb(Buffer.byteLength(html, 'utf8'))}). It opens offline in any browser.${advice}`);
  return EXIT_OK;
}

async function linkCommand(args: readonly string[], io: Io): Promise<number> {
  const parsed = parse(args, ['base'], []);
  const path = resolvePath(io, onePath(parsed, 'link'));
  const { roadmap } = requireValid(loadRoadmap(path), 'shared');
  const baseText = stringFlag(parsed, 'base') ?? DEFAULT_SHARE_BASE;
  let base: URL;
  try {
    base = new URL(baseText);
  } catch {
    throw new CliError(`--base must be a full web address such as ${DEFAULT_SHARE_BASE}, not "${baseText}".`, EXIT_USAGE);
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new CliError(`--base must start with https:// or http://, not "${baseText}".`, EXIT_USAGE);
  base.hash = '';
  let fragment: string;
  try {
    fragment = await encodeRoadmap(roadmap);
  } catch (cause) {
    if (cause instanceof ShareTooLargeError) {
      io.err(cause.message);
      return EXIT_PROBLEM;
    }
    throw cause;
  }
  if (hasTeacherParts(roadmap)) {
    io.err('This roadmap holds teacher notes or session plans, and the link carries them. For students, share the student copy: zero-to student <roadmap.json>.');
  }
  io.out(`${base.href}#r=${fragment}`);
  io.err(`The link is ${fragment.length.toLocaleString('en-US')} characters after "#r=" (the limit is ${MAX_FRAGMENT_LENGTH.toLocaleString('en-US')}).`);
  return EXIT_OK;
}

function studentCommand(args: readonly string[], io: Io): number {
  const parsed = parse(args, ['out'], []);
  const path = resolvePath(io, onePath(parsed, 'student'));
  const { roadmap } = requireValid(loadRoadmap(path), 'written');
  const { roadmap: copy, removed } = studentCopy(roadmap);
  const check = validateRoadmap(copy);
  if (!check.ok) {
    io.err(`The student copy did not validate, so it was not written:\n${formatValidation(path, check)}`);
    return EXIT_PROBLEM;
  }
  const outFlag = stringFlag(parsed, 'out');
  const out = outFlag === undefined ? join(dirname(path), `${basename(path, extname(path))}.student.json`) : resolvePath(io, outFlag);
  if (resolve(out) === resolve(path)) throw new CliError('The student copy would overwrite the teacher file. Pass a different --out.', EXIT_USAGE);
  writeText(out, toJsonText(copy));
  const n = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
  io.out(`Wrote ${out}. Removed ${n(removed.teacherNotes, 'teacher note')} and ${n(removed.sessions, 'session plan')}, withheld ${n(removed.answers, 'answer')} to assessed checks.`);
  return EXIT_OK;
}

async function catalogueCommand(args: readonly string[], io: Io): Promise<number> {
  const parsed = parse(args, [], []);
  if (parsed.positionals.length > 0) throw new CliError('"catalogue" takes no file.', EXIT_USAGE);
  // Loaded on demand: the signpost catalogue lives next to drawing code that no other command needs.
  const { mapCatalogue } = await import('./catalogue');
  io.out(JSON.stringify(mapCatalogue(), null, 2));
  return EXIT_OK;
}

// ---------------------------------------------------------------------------------------------------------------

const COMMANDS: Readonly<Record<string, (args: readonly string[], io: Io) => number | Promise<number>>> = {
  validate: validateCommand,
  'check-links': checkLinksCommand,
  build: buildCommand,
  link: linkCommand,
  student: studentCommand,
  catalogue: catalogueCommand,
};

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.out(HELP);
    return command === undefined ? EXIT_USAGE : EXIT_OK;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    io.out(VERSION);
    return EXIT_OK;
  }
  const handler = COMMANDS[command];
  if (handler === undefined) {
    io.err(`Unknown command "${command}". The commands are: ${Object.keys(COMMANDS).join(', ')}. Run "zero-to --help" for details.`);
    return EXIT_USAGE;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(HELP);
    return EXIT_OK;
  }
  try {
    return await handler(rest, io);
  } catch (cause) {
    if (cause instanceof CliError) {
      io.err(cause.message);
      return cause.exitCode;
    }
    io.err(`zero-to stopped on an unexpected problem: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`);
    return EXIT_USAGE;
  }
}
