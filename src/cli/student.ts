/**
 * The student copy of a teacher's roadmap: no teacher notes, no session plans and no answers to assessed checks,
 * and still a valid roadmap file.
 *
 * Which checks are assessed follows `class.assessment.mode`:
 * - "none": nothing is assessed, every answer stays.
 * - "test": every check is assessed (a written test can use any question).
 * - "pass", "graded" or no mode given: the signpost checks are assessed, the practice checks on waypoints keep
 *   their answers, because spaced review needs them.
 *
 * A withheld answer becomes an empty string. A multiple-choice check keeps its options, written into the
 * question as "A) ... B) ...", because the schema allows options only together with the index of the correct one.
 */
import type { Check, ClassPlan, Roadmap, Stage, Waypoint } from '../roadmap/types';

export interface StudentCopyReport {
  readonly teacherNotes: number;
  readonly sessions: number;
  readonly answers: number;
}

const LETTERS = 'ABCDE';

function withhold(check: Check): Check {
  const { answer: _answer, correct: _correct, options, ...rest } = check;
  if (options === undefined) return { ...rest, answer: '' };
  const listed = options.map((option, i) => `${LETTERS[i] ?? String(i + 1)}) ${option}`).join('\n');
  return { ...rest, q: `${check.q}\n${listed}`, answer: '' };
}

export function studentCopy(roadmap: Roadmap): { roadmap: Roadmap; removed: StudentCopyReport } {
  const mode = roadmap.class?.assessment?.mode;
  const assessCheckpoints = mode !== 'none';
  const assessWaypoints = mode === 'test';
  let teacherNotes = 0;
  let answers = 0;

  const strip = (checks: readonly Check[] | undefined, assessed: boolean): readonly Check[] | undefined => {
    if (checks === undefined || !assessed) return checks;
    answers += checks.length;
    return checks.map(withhold);
  };

  const stages: Stage[] = roadmap.stages.map((stage) => {
    const waypoints: Waypoint[] = stage.waypoints.map((waypoint) => {
      const { teacherNote, checks, ...rest } = waypoint;
      if (teacherNote !== undefined) teacherNotes += 1;
      const kept = strip(checks, assessWaypoints);
      return kept === undefined ? rest : { ...rest, checks: kept };
    });
    const { checks, ...checkpoint } = stage.checkpoint;
    const kept = strip(checks, assessCheckpoints);
    return { ...stage, waypoints, checkpoint: kept === undefined ? checkpoint : { ...checkpoint, checks: kept } };
  });

  let sessions = 0;
  let plan: ClassPlan | undefined;
  if (roadmap.class !== undefined) {
    const { sessions: list, ...rest } = roadmap.class;
    sessions = list?.length ?? 0;
    plan = rest;
  }

  const { class: _class, ...base } = roadmap;
  const copy: Roadmap = plan === undefined ? { ...base, stages } : { ...base, stages, class: plan };
  return { roadmap: structuredClone(copy), removed: { teacherNotes, sessions, answers } };
}

/** True when sharing this roadmap as it is would hand teacher-only parts to students. */
export function hasTeacherParts(roadmap: Roadmap): boolean {
  if ((roadmap.class?.sessions?.length ?? 0) > 0) return true;
  return roadmap.stages.some((s) => s.waypoints.some((w) => w.teacherNote !== undefined));
}
