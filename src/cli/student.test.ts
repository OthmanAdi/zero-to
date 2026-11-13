// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateRoadmap } from '../roadmap/validate';
import type { Roadmap } from '../roadmap/types';
import { hasTeacherParts, studentCopy } from './student';
import { teacherRoadmap } from './test-helpers';

function valid(input: unknown): Roadmap {
  const result = validateRoadmap(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.roadmap;
}

describe('studentCopy', () => {
  it('removes teacher notes, session plans and the answers to signpost checks, and still validates', () => {
    const teacher = valid(teacherRoadmap('pass'));
    expect(hasTeacherParts(teacher)).toBe(true);
    const { roadmap, removed } = studentCopy(teacher);
    expect(removed).toEqual({ teacherNotes: 2, sessions: 2, answers: 2 });
    expect(validateRoadmap(roadmap).ok).toBe(true);
    expect(hasTeacherParts(roadmap)).toBe(false);

    const text = JSON.stringify(roadmap);
    expect(text).not.toContain('teacherNote');
    expect(text).not.toContain('"sessions"');
    expect(text).not.toContain('Answer key');
    expect(text).not.toContain('cargo run compiles and then runs.');
    expect(text).not.toContain('It names the package');

    const [choice, open] = roadmap.stages[0]!.checkpoint.checks!;
    expect(choice).toEqual({ q: 'Which command builds and runs a project?\nA) cargo new\nB) cargo run\nC) rustc --run', kind: 'recall', answer: '' });
    expect(open).toEqual({ q: 'Explain what Cargo.toml is for.', kind: 'explain', answer: '' });
    expect(roadmap.class).toMatchObject({ size: 24, assessment: { mode: 'pass' } });
  });

  it('keeps the practice answers on waypoints, which spaced review needs', () => {
    const teacher = valid(teacherRoadmap('pass'));
    const { roadmap } = studentCopy(teacher);
    expect(roadmap.stages[0]!.waypoints[1]!.checks).toEqual(teacher.stages[0]!.waypoints[1]!.checks);
  });

  it('withholds every answer for a written test, and none when nothing is assessed', () => {
    const test = studentCopy(valid(teacherRoadmap('test')));
    expect(test.roadmap.stages.flatMap((s) => s.waypoints.flatMap((w) => w.checks ?? [])).every((c) => c.answer === '')).toBe(true);
    expect(validateRoadmap(test.roadmap).ok).toBe(true);
    const none = studentCopy(valid(teacherRoadmap('none')));
    expect(none.removed.answers).toBe(0);
    expect(none.roadmap.stages[0]!.checkpoint.checks![1]!.answer).toBe('It names the package and lists its dependencies.');
  });

  it('does not change the teacher roadmap', () => {
    const teacher = valid(teacherRoadmap('pass'));
    const before = JSON.stringify(teacher);
    studentCopy(teacher);
    expect(JSON.stringify(teacher)).toBe(before);
  });
});
