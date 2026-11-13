/**
 * A small checker for the subset of JSON Schema that `roadmap.schema.json` uses. It reads the schema file itself,
 * so the schema and the validator cannot drift apart, and it words every problem for a learner or an author, not
 * for a JSON Schema expert. No dependency.
 */
import rawSchema from './roadmap.schema.json';
import { parseDay } from './dates';
import type { Issue } from './types';

interface Node {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly pattern?: string;
  readonly format?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly items?: Node;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly properties?: Readonly<Record<string, Node>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | Node;
  readonly dependentRequired?: Readonly<Record<string, readonly string[]>>;
  readonly anyOf?: readonly Node[];
  readonly if?: Node;
  readonly then?: Node;
  readonly else?: Node;
  readonly description?: string;
  readonly $defs?: Readonly<Record<string, Node>>;
}

export const ROADMAP_SCHEMA = rawSchema as unknown as Node;

const PATTERN_HINTS: Readonly<Record<string, string>> = {
  '^[a-z0-9][a-z0-9-]{0,47}$':
    'must be an id: lowercase letters, digits and hyphens, starting with a letter or digit, at most 48 characters',
  '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$': 'must be a language code such as "en" or "de"',
  '^[A-Z]{3}$': 'must be a three-letter currency code such as "EUR"',
  '^https?://': 'must be a web address starting with http:// or https://',
};

const SINGULAR: Readonly<Record<string, string>> = {
  stages: 'stage',
  waypoints: 'waypoint',
  resources: 'resource',
  checks: 'check',
  rungs: 'rung',
  sessions: 'session',
  show: 'show item',
  options: 'option',
  skipDates: 'skip date',
  reviewDays: 'review day',
  requires: 'prerequisite',
  inClass: 'class waypoint',
  homework: 'homework waypoint',
  choices: 'choice',
  criteria: 'criterion',
  materials: 'material',
  resourceLangs: 'language',
  surfaces: 'ground type',
  takeaways: 'takeaway',
};

export function pointer(...segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${String(s).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

function segmentsOf(path: string): string[] {
  if (path === '') return [];
  return path
    .slice(1)
    .split('/')
    .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** "/stages/1/waypoints/0/minutes" becomes `stage 2, waypoint 1, "minutes"`. */
export function describePath(path: string): string {
  const segs = segmentsOf(path);
  if (segs.length === 0) return 'The roadmap';
  const parts: string[] = [];
  let props: string[] = [];
  const flush = (): void => {
    if (props.length > 0) parts.push(`"${props.join('.')}"`);
    props = [];
  };
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i] as string;
    const next = segs[i + 1];
    if (next !== undefined && /^\d+$/.test(next)) {
      flush();
      parts.push(`${SINGULAR[seg] ?? seg} ${Number(next) + 1}`);
      i += 1;
    } else {
      props.push(seg);
    }
  }
  flush();
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function typeWord(type: string): string {
  switch (type) {
    case 'string':
      return 'text';
    case 'number':
      return 'a number';
    case 'integer':
      return 'a whole number';
    case 'boolean':
      return 'true or false';
    case 'object':
      return 'a group of fields in braces';
    case 'array':
      return 'a list in square brackets';
    case 'null':
      return 'null';
    default:
      return type;
  }
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function show(value: unknown): string {
  if (typeof value === 'string') return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return kindOf(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] as number;
      row[j] = Math.min(above + 1, (row[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length] as number;
}

export function closest(word: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Math.min(3, Math.max(1, Math.floor(word.length / 3)) + 1);
  for (const candidate of candidates) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

class Checker {
  readonly issues: Issue[] = [];

  constructor(private readonly root: Node) {}

  private resolve(node: Node): Node {
    if (!node.$ref) return node;
    const name = node.$ref.replace('#/$defs/', '');
    const target = this.root.$defs?.[name];
    if (!target) throw new Error(`roadmap.schema.json: unknown $ref ${node.$ref}`);
    return target;
  }

  private add(path: string, problem: string): void {
    this.issues.push({ path, message: `${describePath(path)} ${problem}` });
  }

  check(node: Node, value: unknown, path: string): void {
    if (node.$ref) this.check(this.resolve(node), value, path);

    if ('const' in node && !sameValue(node.const, value)) {
      this.add(path, `must be ${show(node.const)}, but it is ${show(value)}.`);
      return;
    }
    if (node.enum && !node.enum.some((option) => sameValue(option, value))) {
      const list = node.enum.map((option) => `"${String(option)}"`).join(', ');
      this.add(path, `is ${show(value)}, but it must be one of: ${list}.`);
      return;
    }
    if (node.type !== undefined) {
      const types = typeof node.type === 'string' ? [node.type] : node.type;
      if (!types.some((type) => matchesType(value, type))) {
        const wanted = types.map(typeWord).join(' or ');
        this.add(path, `must be ${wanted}, but it is ${value === null ? 'null' : typeWord(kindOf(value))}.`);
        return;
      }
    }

    if (typeof value === 'string') this.checkString(node, value, path);
    else if (typeof value === 'number') this.checkNumber(node, value, path);
    else if (Array.isArray(value)) this.checkArray(node, value, path);
    else if (typeof value === 'object' && value !== null) this.checkObject(node, value as Record<string, unknown>, path);

    if (node.anyOf && !node.anyOf.some((branch) => this.passes(branch, value, path))) {
      // When exactly one branch is meant for this kind of value, its problems are the useful ones to show.
      const typed = node.anyOf.filter((branch) => typeof branch.type === 'string' && matchesType(value, branch.type));
      const only = typed.length === 1 ? typed[0] : undefined;
      if (only) this.check(only, value, path);
      else this.add(path, `is not valid. ${node.description ?? 'It does not match any allowed form.'}`);
    }
    if (node.if) {
      const branch = this.passes(node.if, value, path) ? node.then : node.else;
      if (branch) this.check(branch, value, path);
    }
  }

  private passes(node: Node, value: unknown, path: string): boolean {
    const scratch = new Checker(this.root);
    scratch.check(node, value, path);
    return scratch.issues.length === 0;
  }

  private checkString(node: Node, value: string, path: string): void {
    if (node.minLength !== undefined && value.length < node.minLength) {
      this.add(path, `is too short: at least ${node.minLength} characters.`);
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      this.add(path, `is too long: ${value.length} characters, at most ${node.maxLength}.`);
    }
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      this.add(path, `${PATTERN_HINTS[node.pattern] ?? `does not have the expected form (${node.pattern})`}, but it is ${show(value)}.`);
      return; // the format check would only say the same thing again
    }
    if (node.format === 'date' && parseDay(value) === null) {
      this.add(path, `must be a real calendar day written like 2026-11-13, but it is ${show(value)}.`);
    }
    if (node.format === 'uri') {
      try {
        new URL(value);
      } catch {
        this.add(path, `is not a valid web address: ${show(value)}.`);
      }
    }
  }

  private checkNumber(node: Node, value: number, path: string): void {
    if (node.minimum !== undefined && value < node.minimum) {
      this.add(path, `must be at least ${node.minimum}, but it is ${value}.`);
    }
    if (node.maximum !== undefined && value > node.maximum) {
      this.add(path, `must be at most ${node.maximum}, but it is ${value}.`);
    }
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
      this.add(path, `must be more than ${node.exclusiveMinimum}, but it is ${value}.`);
    }
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {
      this.add(path, `must be less than ${node.exclusiveMaximum}, but it is ${value}.`);
    }
  }

  private checkArray(node: Node, value: readonly unknown[], path: string): void {
    if (node.minItems !== undefined && value.length < node.minItems) {
      this.add(path, `needs at least ${node.minItems} ${node.minItems === 1 ? 'entry' : 'entries'}, but has ${value.length}.`);
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      this.add(path, `can have at most ${node.maxItems} entries, but has ${value.length}.`);
    }
    if (node.uniqueItems) {
      const seen = new Set<string>();
      value.forEach((item, i) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) this.add(pointer(...segmentsOf(path), i), `repeats an earlier entry (${show(item)}). Each entry may appear once.`);
        seen.add(key);
      });
    }
    if (node.items) {
      const items = node.items;
      value.forEach((item, i) => this.check(items, item, `${path}/${i}`));
    }
  }

  private checkObject(node: Node, value: Record<string, unknown>, path: string): void {
    const own = (key: string): string => `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    for (const key of node.required ?? []) {
      if (!(key in value)) this.add(own(key), 'is missing. This field is required.');
    }
    for (const [key, group] of Object.entries(node.dependentRequired ?? {})) {
      if (!(key in value)) continue;
      for (const needed of group) {
        if (!(needed in value)) this.add(own(needed), `is missing. It is required whenever "${key}" is given.`);
      }
    }
    const known = Object.keys(node.properties ?? {});
    for (const [key, child] of Object.entries(value)) {
      const schema = node.properties?.[key];
      if (schema) {
        this.check(schema, child, own(key));
      } else if (node.additionalProperties === false) {
        const guess = closest(key, known);
        this.add(own(key), `is not a field this roadmap understands.${guess ? ` Did you mean "${guess}"?` : ' Check the spelling or remove it.'}`);
      } else if (typeof node.additionalProperties === 'object') {
        this.check(node.additionalProperties, child, own(key));
      }
    }
  }
}

/** Structural problems of `input` against the roadmap schema. Empty when the shape is right. */
export function checkSchema(input: unknown): Issue[] {
  const checker = new Checker(ROADMAP_SCHEMA);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', message: 'A roadmap must be one JSON object (a group of fields in braces).' }];
  }
  checker.check(ROADMAP_SCHEMA, input, '');
  return checker.issues;
}
