/**
 * Made-up resources for tests and the dev page: one per resource type, with every cost and every check status,
 * on the reserved example.org domain. They are not real sources and are never shown as if they were: their
 * titles say "Fixture", and no roadmap file contains them.
 */
import type { Resource, ResourceType, Roadmap, Stage } from '../roadmap/types';

const TYPES: readonly ResourceType[] = ['docs', 'reference', 'book', 'course', 'video', 'article', 'interactive', 'exercises', 'tool', 'community'];

export function fixtureResource(type: ResourceType, overrides: Partial<Resource> = {}): Resource {
  return {
    id: `fixture-${type}`,
    title: `Fixture ${type}`,
    by: 'Fixture author',
    url: `https://example.org/${type}`,
    type,
    cost: 'free',
    lang: 'en',
    level: 'bronze',
    minutes: 45,
    why: `A made-up ${type} entry for checking how the shelf draws this type.`,
    check: { status: 'verified', on: '2026-11-13', http: 200 },
    ...overrides,
  };
}

/** Ten resources, one of each type. Three carry a marked state or a price so the caption and header show them. */
export function fixtureResources(): Resource[] {
  return TYPES.map((type) => {
    if (type === 'course') {
      return fixtureResource(type, {
        title: 'Fixture course behind a login',
        cost: 'paid',
        price: { amount: 29, currency: 'EUR', per: 'month', seenOn: '2026-11-12' },
        minutes: 600,
        level: 'silver',
        check: { status: 'gated', on: '2026-11-13', http: 200, note: 'Only the syllabus is public.' },
      });
    }
    if (type === 'video') {
      return fixtureResource(type, {
        title: 'Fixture video that refused the checker',
        minutes: 18,
        check: { status: 'unverified', on: '2026-11-13', http: 403, note: 'Automated access was refused.' },
      });
    }
    if (type === 'tool') return fixtureResource(type, { cost: 'freemium', minutes: undefined, level: 'gold' });
    if (type === 'book') return fixtureResource(type, { minutes: 240, level: 'diamond' });
    return fixtureResource(type);
  });
}

/** A one-stage roadmap whose waypoints use the given resources, two to a waypoint, the first as the main one. */
export function fixtureRoadmap(resources: readonly Resource[] = fixtureResources()): Roadmap {
  const waypoints: Stage['waypoints'][number][] = [];
  for (let i = 0; i < resources.length; i += 2) {
    const ids = resources.slice(i, i + 2).map((r) => r.id);
    waypoints.push({
      id: `fixture-step-${i / 2 + 1}`,
      title: `Fixture step ${i / 2 + 1}`,
      note: 'A made-up step.',
      do: 'Run `fixture --check` and read what it prints.',
      minutes: 60,
      practiceMinutes: 40,
      resources: ids,
    });
  }
  return {
    schema: 'zero-to/1',
    id: 'fixture-shelf',
    title: 'Fixture shelf',
    topic: 'fixture',
    lang: 'en',
    checkedOn: '2026-11-13',
    brief: { audience: 'self', startLevel: 'zero', targetTier: 'gold', hoursPerWeek: 5 },
    stages: [
      {
        id: 'fixture-stage',
        title: 'Fixture stage',
        tier: 'bronze',
        waypoints,
        checkpoint: { title: 'Fixture checkpoint', show: ['Show the fixture'] },
        project: {
          title: 'Fixture project',
          brief: 'Build the fixture tool from the shelf you have.',
          minutes: 120,
          rungs: [{ level: 'guided', task: 'Follow the guide.' }],
          resources: [],
        },
      },
    ],
    resources: [...resources],
  };
}
