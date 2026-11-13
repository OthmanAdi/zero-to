import { describe, expect, it } from 'vitest';
import { draft } from './testing';
import { validateRoadmap, type ValidationResult } from './validate';

function errorsOf(result: ValidationResult) {
  return result.ok ? [] : result.errors;
}
function paths(result: ValidationResult): string[] {
  return errorsOf(result).map((e) => e.path);
}
function warningPaths(result: ValidationResult): string[] {
  return result.warnings.map((w) => w.path);
}

describe('validateRoadmap: the sample', () => {
  it('passes with no errors and no warnings', () => {
    const result = validateRoadmap(draft());
    expect(errorsOf(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('has five stages, the massif map and only verified resources', () => {
    const result = validateRoadmap(draft());
    if (!result.ok) throw new Error('sample is invalid');
    expect(result.roadmap.stages).toHaveLength(5);
    expect(result.roadmap.map).toEqual({ terrain: 'massif', trail: 'switchback', surfaces: 'auto' });
    expect(result.roadmap.resources.every((r) => r.check.status === 'verified' && r.check.on === '2026-11-13')).toBe(true);
  });
});

describe('validateRoadmap: shape', () => {
  it('rejects things that are not an object', () => {
    for (const input of [null, 5, 'text', [], undefined]) {
      const result = validateRoadmap(input);
      expect(result.ok).toBe(false);
      expect(paths(result)).toEqual(['']);
    }
  });

  it('reports a missing required field with its pointer', () => {
    const r = draft();
    delete r.brief.audience;
    const result = validateRoadmap(r);
    expect(paths(result)).toEqual(['/brief/audience']);
    expect(errorsOf(result)[0]?.message).toContain('"brief.audience" is missing');
  });

  it('treats unknown properties as errors and suggests the closest name', () => {
    const r = draft();
    r.stages[0].waypoints[0].minuts = 5;
    r.extra = true;
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(['/extra', '/stages/0/waypoints/0/minuts']);
    const typo = errorsOf(result).find((e) => e.path.endsWith('minuts'));
    expect(typo?.message).toContain('Did you mean "minutes"?');
    expect(typo?.message.startsWith('Stage 1, waypoint 1')).toBe(true);
  });

  it('checks types, lengths, minimums and patterns in plain words', () => {
    const r = draft();
    r.title = 'x'.repeat(81);
    r.stages[0].waypoints[0].minutes = 3;
    r.stages[0].waypoints[1].minutes = 'long';
    r.stages[1].id = 'Not An Id';
    r.lang = 'English';
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(
      ['/title', '/lang', '/stages/0/waypoints/0/minutes', '/stages/0/waypoints/1/minutes', '/stages/1/id'].sort(),
    );
    const messages = errorsOf(result).map((e) => e.message).join('\n');
    expect(messages).toContain('too long: 81 characters, at most 80');
    expect(messages).toContain('must be at least 5, but it is 3');
    expect(messages).toContain('must be a whole number, but it is text');
    expect(messages).toContain('must be an id');
    expect(messages).toContain('must be a language code');
  });

  it('rejects a wrong tier and a wrong schema marker', () => {
    const r = draft();
    r.stages[2].tier = 'platinum';
    r.schema = 'zero-to/2';
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(['/schema', '/stages/2/tier']);
    expect(errorsOf(result).find((e) => e.path === '/stages/2/tier')?.message).toContain('"bronze", "silver", "gold", "diamond"');
  });

  it('rejects dates that are not real days', () => {
    const r = draft();
    r.checkedOn = '2026-02-30';
    r.brief.startDate = '16.11.2026';
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(['/brief/startDate', '/checkedOn']);
  });

  it('counts stages and waypoints against the limits', () => {
    const r = draft();
    r.stages = [r.stages[0]];
    expect(paths(validateRoadmap(r))).toContain('/stages');
    const many = draft();
    many.stages[0].waypoints = Array.from({ length: 10 }, (_, i) => ({ ...many.stages[0].waypoints[0], id: `w${i}` }));
    expect(paths(validateRoadmap(many))).toContain('/stages/0/waypoints');
  });

  it('requires a note when a resource is not verified, and options need a correct answer', () => {
    const r = draft();
    r.resources[0].check = { status: 'unverified', on: '2026-11-13', http: 403 };
    delete r.stages[0].waypoints[1].checks[0].correct;
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(['/resources/0/check/note', '/stages/0/waypoints/1/checks/0/correct']);
  });

  it('gives every sample waypoint one to four takeaways of at most 140 characters', () => {
    const r = draft();
    for (const stage of r.stages) {
      for (const w of stage.waypoints) {
        expect(w.takeaways?.length, w.id).toBeGreaterThanOrEqual(1);
        expect(w.takeaways.length, w.id).toBeLessThanOrEqual(4);
        for (const t of w.takeaways) expect(t.length, `${w.id}: ${t}`).toBeLessThanOrEqual(140);
      }
    }
  });

  it('limits takeaways to four entries of 140 characters, all text', () => {
    const r = draft();
    r.stages[0].waypoints[0].takeaways = ['a', 'b', 'c', 'd', 'e'];
    r.stages[0].waypoints[1].takeaways = ['x'.repeat(141)];
    r.stages[0].waypoints[2].takeaways = 'one long string';
    r.stages[1].waypoints[0].takeaways = ['fine', 7];
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(
      [
        '/stages/0/waypoints/0/takeaways',
        '/stages/0/waypoints/1/takeaways/0',
        '/stages/0/waypoints/2/takeaways',
        '/stages/1/waypoints/0/takeaways/1',
      ].sort(),
    );
    const long = errorsOf(result).find((e) => e.path === '/stages/0/waypoints/1/takeaways/0');
    expect(long?.message).toContain('takeaway 1');
    expect(long?.message).toContain('too long: 141 characters, at most 140');
  });

  it('accepts a waypoint with no takeaways and with exactly four', () => {
    const r = draft();
    delete r.stages[0].waypoints[0].takeaways;
    r.stages[0].waypoints[1].takeaways = ['a', 'b', 'c', 'd'];
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('only accepts web addresses as resource urls', () => {
    const r = draft();
    r.resources[0].url = 'ftp://example.org/file';
    r.resources[1].url = 'not a url';
    expect(paths(validateRoadmap(r))).toEqual(['/resources/0/url', '/resources/1/url']);
  });
});

describe('validateRoadmap: map', () => {
  it('accepts every terrain, trail and a list of surfaces', () => {
    for (const terrain of ['volcano', 'ridge', 'massif', 'twin-peaks', 'plateau', 'canyon', 'random']) {
      for (const trail of ['switchback', 'ridge-walk', 'spiral', 'valley-first', 'traverse', 'random']) {
        const r = draft();
        r.map = { terrain, trail };
        expect(validateRoadmap(r).ok).toBe(true);
      }
    }
    const r = draft();
    r.map = { terrain: 'canyon', seed: 'abc', surfaces: ['water', 'sand', 'grass', 'forest', 'dirt', 'scree', 'rock', 'snow'], signpost: 'timber', theme: 'night' };
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('rejects unknown terrain, unknown surfaces and empty surface lists', () => {
    const r = draft();
    r.map = { terrain: 'lava-field' };
    expect(paths(validateRoadmap(r))).toEqual(['/map/terrain']);

    const s = draft();
    s.map = { surfaces: ['water', 'lava'] };
    const result = validateRoadmap(s);
    expect(paths(result)).toEqual(['/map/surfaces/1']);

    const t = draft();
    t.map = { surfaces: 'many' };
    const bad = validateRoadmap(t);
    expect(paths(bad)).toEqual(['/map/surfaces']);
    expect(errorsOf(bad)[0]?.message).toContain('or the word auto');

    const u = draft();
    u.map = { surfaces: [] };
    expect(paths(validateRoadmap(u))).toEqual(['/map/surfaces']);
  });

  it('rejects unknown map fields', () => {
    const r = draft();
    r.map = { terain: 'ridge' };
    const result = validateRoadmap(r);
    expect(paths(result)).toEqual(['/map/terain']);
    expect(errorsOf(result)[0]?.message).toContain('Did you mean "terrain"?');
  });
});

describe('validateRoadmap: lint rules', () => {
  it('finds a duplicate waypoint id', () => {
    const r = draft();
    r.stages[2].waypoints[0].id = 'moves';
    const result = validateRoadmap(r);
    expect(paths(result)).toContain('/stages/2/waypoints/0/id');
    expect(errorsOf(result).find((e) => e.path === '/stages/2/waypoints/0/id')?.message).toContain('Stage 2, waypoint 1');
  });

  it('finds a stage id that is also used by a waypoint', () => {
    const r = draft();
    r.stages[1].waypoints[0].id = 'first-binary';
    expect(paths(validateRoadmap(r))).toContain('/stages/1/waypoints/0/id');
  });

  it('finds a duplicate resource id', () => {
    const r = draft();
    r.resources[3].id = r.resources[0].id;
    expect(paths(validateRoadmap(r))).toContain('/resources/3/id');
  });

  it('finds references that point nowhere', () => {
    const r = draft();
    r.brief.entry = 'nowhere';
    r.stages[1].requires = ['first-binry'];
    r.stages[1].waypoints[0].resources = ['book-ownership', 'missing-book'];
    r.stages[1].waypoints[3].requires = ['bororwing'];
    r.stages[1].waypoints[0].checks[0].onMiss = 'ghost';
    r.stages[0].project.resources = ['cli-boook'];
    r.stages[2].checkpoint.checks = [{ q: 'q', kind: 'recall', answer: 'a', onMiss: 'also-missing' }];
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(
      [
        '/brief/entry',
        // Replacing these references leaves two resources on the shelf with no user.
        '/resources/3',
        '/resources/5',
        '/stages/0/project/resources/0',
        '/stages/1/requires/0',
        '/stages/1/waypoints/0/checks/0/onMiss',
        '/stages/1/waypoints/0/resources/1',
        '/stages/1/waypoints/3/requires/0',
        '/stages/2/checkpoint/checks/0/onMiss',
      ].sort(),
    );
    const near = errorsOf(result).find((e) => e.path === '/stages/1/requires/0');
    expect(near?.message).toContain('Did you mean "first-binary"?');
  });

  it('explains when a waypoint requires a stage id', () => {
    const r = draft();
    r.stages[1].waypoints[3].requires = ['first-binary'];
    const result = validateRoadmap(r);
    expect(errorsOf(result)[0]?.message).toContain('That is a stage id');
  });

  it('checks class sessions against waypoint ids', () => {
    const r = draft();
    r.class = {
      size: 20,
      sessionsPerWeek: 1,
      sessionMinutes: 90,
      sessions: [
        { n: 1, date: '2026-11-19', title: 'Start', inClass: ['toolchain', 'nothing'], homework: ['guessing-game'] },
        { n: 2, date: '2026-11-12', title: 'Next', inClass: ['moves'], homework: ['nope'] },
      ],
    };
    const result = validateRoadmap(r);
    expect(paths(result).sort()).toEqual(['/class/sessions/0/inClass/1', '/class/sessions/1/homework/0']);
    expect(warningPaths(result)).toEqual(['/class/sessions/1/date']);
  });

  it('accepts a class block whose sessions resolve', () => {
    const r = draft();
    r.class = {
      size: 26,
      ages: '14-15',
      sessionsPerWeek: 1,
      sessionMinutes: 90,
      weeks: 8,
      devices: 'shared',
      assessment: { mode: 'pass', note: 'met or not yet' },
      handout: 'session',
      homework: true,
      skipDates: ['2026-12-24'],
      sessions: [{ n: 1, date: '2026-11-19', title: 'Pulse', opener: 'Clap', inClass: ['toolchain'], homework: ['guessing-game'], exit: 'Write it', materials: ['Handout'] }],
    };
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('finds a prerequisite cycle between waypoints, at the entry that closes it', () => {
    const r = draft();
    r.stages[0].waypoints[0].requires = ['first-drills'];
    const result = validateRoadmap(r);
    expect(paths(result)).toEqual(['/stages/0/waypoints/0/requires/0']);
    expect(errorsOf(result)[0]?.message).toContain('circle of steps');
  });

  it('finds a waypoint that requires itself', () => {
    const r = draft();
    r.stages[1].waypoints[1].requires = ['borrowing'];
    expect(paths(validateRoadmap(r))).toEqual(['/stages/1/waypoints/1/requires/0']);
  });

  it('finds a prerequisite cycle between stages', () => {
    const r = draft();
    r.stages[0].requires = ['collections-traits'];
    const result = validateRoadmap(r);
    expect(paths(result)).toEqual(['/stages/0/requires/0']);
    expect(errorsOf(result)[0]?.message).toContain('stages that wait for each other');
  });

  it('finds a cycle that runs through a stage and a waypoint', () => {
    const r = draft();
    // Step in stage 1 waits for a step in stage 2, but stage 2 waits for stage 1 to be finished.
    r.stages[0].waypoints[0].requires = ['moves'];
    expect(paths(validateRoadmap(r)).length).toBeGreaterThan(0);
  });

  it('finds a resource that nothing uses', () => {
    const r = draft();
    r.resources.push({ ...r.resources[0], id: 'orphan' });
    const result = validateRoadmap(r);
    expect(paths(result)).toEqual([`/resources/${r.resources.length - 1}`]);
    expect(errorsOf(result)[0]?.message).toContain('orphan');
  });

  it('counts a resource used only by a project as used', () => {
    const r = draft();
    r.stages[3].project = { title: 'p', brief: 'b', rungs: [{ level: 'guided', task: 't' }], resources: ['cli-book'] };
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('wants a verified resource or a gap on every waypoint', () => {
    const r = draft();
    r.resources.find((x: any) => x.id === 'rust-install').check = { status: 'gated', on: '2026-11-13', http: 200, note: 'Needs a login.' };
    const result = validateRoadmap(r);
    expect(paths(result)).toEqual(['/stages/0/waypoints/0/resources']);

    r.stages[0].waypoints[0].gap = 'No source could be verified for this step.';
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('wants a verified resource even when a waypoint lists nothing', () => {
    const r = draft();
    r.stages[0].waypoints[2].resources = [];
    const result = validateRoadmap(r);
    expect(paths(result)).toContain('/stages/0/waypoints/2/resources');
    // rustlings is still used elsewhere, so no unused-resource error is expected.
    expect(paths(result)).not.toContain('/resources/2');
  });

  it('accepts one verified resource next to unverified ones', () => {
    const r = draft();
    r.resources.find((x: any) => x.id === 'book-ownership-de').check = { status: 'unverified', on: '2026-11-13', http: 403, note: 'Refused automated access.' };
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('rejects practice time longer than the step', () => {
    const r = draft();
    r.stages[0].waypoints[0].practiceMinutes = 60;
    expect(paths(validateRoadmap(r))).toEqual(['/stages/0/waypoints/0/practiceMinutes']);
  });

  it('warns when a stage has under 60 percent practice, but stays valid', () => {
    const r = draft();
    for (const w of r.stages[4].waypoints) w.practiceMinutes = Math.floor(w.minutes * 0.4);
    const result = validateRoadmap(r);
    expect(result.ok).toBe(true);
    expect(warningPaths(result)).toContain('/stages/4');
    expect(result.warnings.find((w) => w.path === '/stages/4')?.message).toContain('Stage 5');
  });

  it('warns when the whole roadmap is under 70 percent practice', () => {
    const r = draft();
    for (const stage of r.stages) for (const w of stage.waypoints) w.practiceMinutes = Math.ceil(w.minutes * 0.62);
    const result = validateRoadmap(r);
    expect(result.ok).toBe(true);
    expect(warningPaths(result)).toEqual(['/stages']);
    expect(result.warnings[0]?.message).toContain('hands-on');
  });

  it('requires the deadline to be after the start date', () => {
    const r = draft();
    r.brief.deadline = '2026-11-16';
    expect(paths(validateRoadmap(r))).toEqual(['/brief/deadline']);
    r.brief.deadline = '2026-11-01';
    expect(paths(validateRoadmap(r))).toEqual(['/brief/deadline']);
    r.brief.deadline = '2026-11-17';
    expect(validateRoadmap(r).ok).toBe(true);
  });

  it('flags a correct index that is outside the options', () => {
    const r = draft();
    r.stages[0].waypoints[1].checks[0].correct = 3;
    expect(paths(validateRoadmap(r))).toEqual(['/stages/0/waypoints/1/checks/0/correct']);
  });

  it('warns about tiers that fall, a goal that differs from the summit and odd resource data', () => {
    const r = draft();
    r.stages[3].tier = 'bronze';
    r.brief.targetTier = 'diamond';
    r.resources[0].price = { amount: 5, currency: 'EUR', seenOn: '2026-11-13' };
    r.resources[1].check.http = 404;
    const result = validateRoadmap(r);
    expect(result.ok).toBe(true);
    expect(warningPaths(result).sort()).toEqual(['/brief/targetTier', '/resources/0/price', '/resources/1/check/http', '/stages/3/tier'].sort());
  });

  it('warns when a teacher roadmap has no class', () => {
    const r = draft();
    r.brief.audience = 'teacher';
    const result = validateRoadmap(r);
    expect(result.ok).toBe(true);
    expect(warningPaths(result)).toEqual(['/class']);
  });

  it('skips lint when the shape is wrong, so messages are not noise', () => {
    const r = draft();
    r.stages[0].waypoints[0].minutes = 'x';
    r.resources.push({ ...r.resources[0], id: 'orphan' });
    expect(paths(validateRoadmap(r))).toEqual(['/stages/0/waypoints/0/minutes']);
  });
});
