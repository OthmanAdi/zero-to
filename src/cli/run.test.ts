// @vitest-environment node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeRoadmap, MAX_FRAGMENT_LENGTH } from '../roadmap/share';
import { draft, sampleRoadmap } from '../roadmap/testing';
import { validateRoadmap } from '../roadmap/validate';
import { DEFAULT_SHARE_BASE, HELP, run, VERSION } from './run';
import { fakeFetch, htmlPage, recordingIo, teacherRoadmap, tempDir, type FakeRoute } from './test-helpers';
import { extractRoadmapJson, RECEIPT_ELEMENT_ID } from './viewer';

const fixtureViewer = join(import.meta.dirname, 'fixtures', 'viewer.html');

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => {
  dir.cleanup();
});

/** Every resource of the sample answers 200 with its title. */
function sampleRoutes(overrides: Record<string, FakeRoute> = {}): Record<string, FakeRoute> {
  const routes: Record<string, FakeRoute> = {};
  for (const r of sampleRoadmap().resources) routes[r.url] = { body: htmlPage(r.title) };
  return { ...routes, ...overrides };
}

describe('help and version', () => {
  it('prints help and the version', async () => {
    const io = recordingIo(dir.path);
    expect(await run(['--help'], io)).toBe(0);
    expect(io.stdout[0]).toBe(HELP);
    expect(HELP).toContain('check-links <roadmap.json>');
    expect(await run(['--version'], io)).toBe(0);
    expect(io.stdout[1]).toBe(VERSION);
  });

  it('exits 2 on no command, an unknown command and an unknown option', async () => {
    const io = recordingIo(dir.path);
    expect(await run([], io)).toBe(2);
    expect(await run(['explode'], io)).toBe(2);
    expect(io.stderr.join('\n')).toContain('Unknown command "explode"');
    const file = dir.file('r.json', draft());
    expect(await run(['validate', file, '--loud'], io)).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/--loud/);
    expect(await run(['validate'], io)).toBe(2);
  });
});

describe('validate', () => {
  it('passes the sample', async () => {
    const io = recordingIo(dir.path);
    const file = dir.file('rust.json', draft());
    expect(await run(['validate', 'rust.json'], io)).toBe(0);
    expect(io.stdout.join('\n')).toContain('rust.json is a valid zero-to roadmap');
    expect(file).toBeTruthy();
  });

  it('prints each error with its JSON pointer and exits 1', async () => {
    const broken = draft();
    broken.stages[0].waypoints[1].resources = ['no-such-book'];
    broken.title = 7;
    dir.file('broken.json', broken);
    const io = recordingIo(dir.path);
    expect(await run(['validate', 'broken.json'], io)).toBe(1);
    const text = io.stderr.join('\n');
    expect(text).toContain('broken.json has 1 error');
    expect(text).toContain('at /title');
    const io2 = recordingIo(dir.path);
    broken.title = 'Fine again';
    dir.file('broken.json', broken);
    expect(await run(['validate', 'broken.json'], io2)).toBe(1);
    expect(io2.stderr.join('\n')).toContain('at /stages/0/waypoints/1/resources/0');
    expect(io2.stderr.join('\n')).toContain('no-such-book');
  });

  it('exits 2 for a missing file and 1 for broken JSON', async () => {
    const io = recordingIo(dir.path);
    expect(await run(['validate', 'nowhere.json'], io)).toBe(2);
    expect(io.stderr.join('\n')).toContain('Cannot find the roadmap file');
    dir.file('bad.json', '{ "schema": ');
    expect(await run(['validate', 'bad.json'], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('is not valid JSON');
  });
});

describe('check-links', () => {
  it('prints a table and the totals, and changes nothing without --write', async () => {
    const file = dir.file('rust.json', draft());
    const before = readFileSync(file, 'utf8');
    const io = recordingIo(dir.path, { fetch: fakeFetch(sampleRoutes()) });
    expect(await run(['check-links', 'rust.json'], io)).toBe(0);
    const out = io.stdout.join('\n');
    expect(out).toMatch(/^\s+#\s+resource\s+result\s+http\s+detail/);
    expect(out).toContain('24 opened, 24 kept, 0 dead, 0 flagged');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(io.calls).toHaveLength(24);
  });

  it('with --write updates each check and checkedOn, keeps dead resources and exits 1', async () => {
    const roadmap = draft();
    roadmap.checkedOn = '2026-01-01';
    roadmap.resources[1].check = { status: 'unverified', on: '2026-01-01', http: 403, note: 'Could not be opened.' };
    const deadUrl = roadmap.resources[2].url;
    const file = dir.file('rust.json', roadmap);
    const io = recordingIo(dir.path, { fetch: fakeFetch(sampleRoutes({ [deadUrl]: { status: 404 } })), now: new Date(2026, 10, 14, 8, 0) });
    expect(await run(['check-links', 'rust.json', '--write', '--receipt', 'out/receipt.json'], io)).toBe(1);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.checkedOn).toBe('2026-11-14');
    expect(written.resources).toHaveLength(roadmap.resources.length);
    expect(written.resources[0].check).toEqual({ status: 'verified', on: '2026-11-14', http: 200 });
    expect(written.resources[1].check.status).toBe('unverified');
    expect(written.resources[1].check.note).toContain('not read yet');
    expect(written.resources[2].check).toMatchObject({ status: 'unverified', http: 404 });
    expect(written.resources[2].check.note).toMatch(/^Dead on 2026-11-14/);
    const out = io.stdout.join('\n');
    expect(out).toContain('24 opened, 23 kept, 1 dead, 0 flagged');
    expect(out).toContain('reachable, read it before marking verified');

    const receipt = JSON.parse(readFileSync(join(dir.path, 'out', 'receipt.json'), 'utf8'));
    expect(receipt.totals).toEqual({ opened: 24, kept: 23, dead: 1, flagged: 0 });
    expect(receipt.checkedOn).toBe('2026-11-14');
    expect(receipt.roadmap).toBe('rust-for-a-python-dev');
    expect(receipt.results).toHaveLength(24);
    expect(receipt.results[2]).toMatchObject({ resourceId: roadmap.resources[2].id, outcome: 'dead', decision: 'dropped', statusBefore: 'verified', statusAfter: 'unverified' });
    expect(receipt.results[1]).toMatchObject({ outcome: 'kept', statusBefore: 'unverified', statusAfter: 'unverified' });
  });

  it('marks reachable links verified only with --trust-200', async () => {
    const roadmap = draft();
    roadmap.resources[1].check = { status: 'unverified', on: '2026-01-01', http: 403, note: 'Could not be opened.' };
    const file = dir.file('rust.json', roadmap);
    const io = recordingIo(dir.path, { fetch: fakeFetch(sampleRoutes()) });
    expect(await run(['check-links', 'rust.json', '--write', '--trust-200'], io)).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).resources[1].check).toEqual({ status: 'verified', on: '2026-11-13', http: 200 });
  });

  it('refuses a file without resources', async () => {
    dir.file('empty.json', { title: 'nothing' });
    const io = recordingIo(dir.path);
    expect(await run(['check-links', 'empty.json'], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('has no "resources" list');
  });
});

describe('build', () => {
  it('writes one HTML file with the roadmap, the receipt counts and the title', async () => {
    dir.file('rust.json', draft());
    dir.file('receipt.json', { totals: { opened: 24, kept: 24, dead: 0, flagged: 0 }, checkedOn: '2026-11-13' });
    const io = recordingIo(dir.path);
    expect(await run(['build', 'rust.json', '--viewer', fixtureViewer, '--receipt', 'receipt.json'], io)).toBe(0);
    const out = join(dir.path, 'rust-for-a-python-dev.html');
    const html = readFileSync(out, 'utf8');
    expect(extractRoadmapJson(html)).toEqual(sampleRoadmap());
    expect(extractRoadmapJson(html, RECEIPT_ELEMENT_ID)).toEqual({ opened: 24, kept: 24, dead: 0, flagged: 0, checkedOn: '2026-11-13' });
    expect(html).toContain('<title>Zero to Rust, coming from Python · zero-to</title>');
    expect(io.stdout.join('\n')).toContain(`Wrote ${out}`);
  });

  it('uses ../viewer/zero-to.html next to the script by default, and --out', async () => {
    mkdirSync(join(dir.path, 'skill', 'viewer'), { recursive: true });
    copyFileSync(fixtureViewer, join(dir.path, 'skill', 'viewer', 'zero-to.html'));
    dir.file('rust.json', draft());
    const io = recordingIo(dir.path);
    expect(await run(['build', 'rust.json', '--out', 'site/rust.html'], io)).toBe(0);
    expect(existsSync(join(dir.path, 'site', 'rust.html'))).toBe(true);
  });

  it('exits 2 with a clear message when the viewer template is missing', async () => {
    dir.file('rust.json', draft());
    const io = recordingIo(dir.path);
    expect(await run(['build', 'rust.json'], io)).toBe(2);
    const text = io.stderr.join('\n');
    expect(text).toContain('The viewer template is missing');
    expect(text).toContain(join(dir.path, 'skill', 'viewer', 'zero-to.html'));
  });

  it('exits 2 for a template without the roadmap element', async () => {
    dir.file('rust.json', draft());
    dir.file('plain.html', '<html><head><title>x</title></head><body></body></html>');
    const io = recordingIo(dir.path);
    expect(await run(['build', 'rust.json', '--viewer', 'plain.html'], io)).toBe(2);
    expect(io.stderr.join('\n')).toContain('not a zero-to viewer build');
  });

  it('refuses to build a roadmap with errors', async () => {
    const broken = draft();
    broken.stages[0].waypoints[0].requires = ['toolchain'];
    dir.file('broken.json', broken);
    const io = recordingIo(dir.path);
    expect(await run(['build', 'broken.json', '--viewer', fixtureViewer], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('Nothing was built.');
    expect(existsSync(join(dir.path, 'rust-for-a-python-dev.html'))).toBe(false);
  });
});

describe('link', () => {
  it('prints a share link that decodes back to the roadmap', async () => {
    dir.file('rust.json', draft());
    const io = recordingIo(dir.path);
    expect(await run(['link', 'rust.json'], io)).toBe(0);
    const link = io.stdout[0] ?? '';
    expect(link.startsWith(`${DEFAULT_SHARE_BASE}#r=z1.`)).toBe(true);
    const decoded = await decodeRoadmap(link.slice(link.indexOf('#r=') + 3));
    expect(decoded.ok && decoded.roadmap).toEqual(sampleRoadmap());
  });

  it('takes --base and warns when teacher parts would travel', async () => {
    dir.file('teacher.json', teacherRoadmap());
    const io = recordingIo(dir.path);
    expect(await run(['link', 'teacher.json', '--base', 'https://example.org/trek/#old'], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^https:\/\/example\.org\/trek\/#r=z1\./);
    expect(io.stderr.join('\n')).toContain('share the student copy');
  });

  it('refuses a bad base and a roadmap too large for a link', async () => {
    dir.file('rust.json', draft());
    const io = recordingIo(dir.path);
    expect(await run(['link', 'rust.json', '--base', 'not a url'], io)).toBe(2);
    expect(await run(['link', 'rust.json', '--base', 'ftp://example.org/'], io)).toBe(2);

    // Random text does not compress, so a long enough note pushes the link over the limit.
    const big = draft();
    let seed = 7;
    const noise = (n: number): string =>
      Array.from({ length: n }, () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        seed >>>= 0;
        return String.fromCharCode(33 + (seed % 90));
      }).join('');
    big.stages.forEach((stage: any) => stage.waypoints.forEach((w: any) => (w.do = noise(Math.ceil((MAX_FRAGMENT_LENGTH * 1.2) / 20)))));
    dir.file('big.json', big);
    const io2 = recordingIo(dir.path);
    expect(await run(['link', 'big.json'], io2)).toBe(1);
    expect(io2.stderr.join('\n')).toContain('too large to share as a link');
    expect(io2.stdout).toEqual([]);
  });
});

describe('student', () => {
  it('writes a valid student copy next to the teacher file', async () => {
    dir.file('class.json', teacherRoadmap());
    const io = recordingIo(dir.path);
    expect(await run(['student', 'class.json'], io)).toBe(0);
    const copy = JSON.parse(readFileSync(join(dir.path, 'class.student.json'), 'utf8'));
    expect(validateRoadmap(copy).ok).toBe(true);
    expect(JSON.stringify(copy)).not.toContain('teacherNote');
    expect(copy.class.sessions).toBeUndefined();
    expect(io.stdout.join('\n')).toContain('Removed 2 teacher notes and 2 session plans, withheld 2 answers to assessed checks.');
  });

  it('takes --out and refuses to overwrite the teacher file', async () => {
    dir.file('class.json', teacherRoadmap());
    const io = recordingIo(dir.path);
    expect(await run(['student', 'class.json', '--out', 'share/students.json'], io)).toBe(0);
    expect(existsSync(join(dir.path, 'share', 'students.json'))).toBe(true);
    expect(await run(['student', 'class.json', '--out', 'class.json'], io)).toBe(2);
  });
});

describe('catalogue', () => {
  it('prints the map options as JSON', async () => {
    const io = recordingIo(dir.path);
    expect(await run(['catalogue'], io)).toBe(0);
    const catalogue = JSON.parse(io.stdout[0] ?? '');
    expect(Object.keys(catalogue)).toEqual(['terrain', 'trail', 'surfaces', 'signposts', 'themes']);
    expect(catalogue.terrain.options.map((o: { id: string }) => o.id)).toContain('twin-peaks');
    expect(await run(['catalogue', 'extra.json'], io)).toBe(2);
  });
});
