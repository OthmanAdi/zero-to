import { describe, expect, it } from 'vitest';
import { MODES, createModeMachine, isLocked, nextModes, viewOf, type Mode } from './modes';

/** Every way through the machine from its start, up to `depth` steps. */
function paths(depth: number): Mode[][] {
  const found: Mode[][] = [];
  const walk = (trail: Mode[]): void => {
    found.push(trail);
    if (trail.length > depth) return;
    const machine = createModeMachine();
    for (const mode of trail.slice(1)) machine.go(mode);
    for (const next of MODES) {
      if (machine.can(next)) walk([...trail, next]);
    }
  };
  walk(['boot']);
  return found;
}

describe('the mode machine', () => {
  it('starts in boot and goes to the table or to the list view', () => {
    const machine = createModeMachine();
    expect(machine.mode).toBe('boot');
    expect(nextModes('boot', 'boot')).toEqual(['table', 'list']);
    expect(machine.go('walk')).toBe(false);
    expect(machine.mode).toBe('boot');
  });

  it('cannot reach the walk without passing the cut or the reduced-motion fade', () => {
    const all = paths(9);
    const reached = all.filter((trail) => trail.includes('walk'));
    expect(reached.length).toBeGreaterThan(0);
    for (const trail of reached) {
      const before = trail.slice(0, trail.indexOf('walk'));
      expect(before.includes('cut') || before.includes('fade'), trail.join(' > ')).toBe(true);
    }
    // And never by one step from the table, the dive or the boot.
    for (const from of ['boot', 'table', 'dive', 'return'] as const) {
      for (const origin of MODES) expect(nextModes(from, origin)).not.toContain('walk');
    }
  });

  it('walks the whole loop: table, dive, cut, landing, walk, finish, return, table', () => {
    const machine = createModeMachine();
    for (const mode of ['table', 'dive', 'cut', 'landing', 'walk', 'finish', 'return', 'table'] as const) expect(machine.go(mode), mode).toBe(true);
    expect(machine.history).toEqual(['boot', 'table', 'dive', 'cut', 'landing', 'walk', 'finish', 'return', 'table']);
  });

  it('refuses to skip the cut or the landing', () => {
    const machine = createModeMachine();
    machine.go('table');
    machine.go('dive');
    expect(machine.go('landing')).toBe(false);
    expect(machine.go('walk')).toBe(false);
    expect(machine.go('table')).toBe(false);
    expect(machine.go('cut')).toBe(true);
    expect(machine.go('walk')).toBe(false);
  });

  it('lets the fade lead across: from the table into the walk, from the walk back to the table', () => {
    const machine = createModeMachine();
    machine.go('table');
    expect(machine.go('fade')).toBe(true);
    expect(machine.can('table')).toBe(false);
    expect(machine.go('walk')).toBe(true);
    expect(machine.go('fade')).toBe(true);
    expect(machine.can('walk')).toBe(false);
    expect(machine.go('table')).toBe(true);
  });

  it('opens the list view from the table and from the walk, and goes back only where it came from', () => {
    const fromTable = createModeMachine();
    fromTable.go('table');
    fromTable.go('list');
    expect(fromTable.can('walk')).toBe(false);
    expect(fromTable.go('table')).toBe(true);

    const fromWalk = createModeMachine();
    for (const mode of ['table', 'dive', 'cut', 'landing', 'walk', 'list'] as const) fromWalk.go(mode);
    expect(fromWalk.can('table')).toBe(false);
    expect(fromWalk.go('walk')).toBe(true);

    const noMap = createModeMachine();
    noMap.go('list');
    expect(noMap.can('walk')).toBe(false);
  });

  it('keeps where the walk was entered from while it steps between walk and finish', () => {
    const machine = createModeMachine();
    for (const mode of ['table', 'dive', 'cut', 'landing', 'walk', 'finish', 'walk', 'finish'] as const) machine.go(mode);
    expect(machine.from).toBe('landing');
  });

  it('tells its listeners of every change', () => {
    const machine = createModeMachine();
    const seen: string[] = [];
    const stop = machine.onChange((mode, previous) => seen.push(`${previous}>${mode}`));
    machine.go('table');
    machine.go('walk');
    machine.go('dive');
    stop();
    machine.go('cut');
    expect(seen).toEqual(['boot>table', 'table>dive']);
  });

  it('names the view of every mode and locks the page while it moves by itself', () => {
    expect(viewOf('table')).toBe('table');
    expect(viewOf('dive')).toBe('table');
    expect(viewOf('landing')).toBe('walk');
    expect(viewOf('finish')).toBe('walk');
    expect(viewOf('list')).toBe('list');
    expect(viewOf('fade', 'walk')).toBe('walk');
    expect(MODES.filter(isLocked)).toEqual(['boot', 'dive', 'cut', 'landing', 'fade', 'return']);
  });
});
