/**
 * The learning session as the resource shelf sees it. The shelf writes nothing itself: "used", the pin and the
 * private note of a volume all go through the session, so they are saved with the learner's progress and the
 * cards show the same state.
 *
 * Where each lives:
 * - used: an answer under `used:<resource id>` whose `correct` is true.
 * - pinned: a notebook entry of kind `link`. Its id is `link:<waypoint or stage id>:<resource id>`, the same id
 *   the step's own "Take with you" tab gives a link, so a link pinned in one place shows as pinned in the other.
 * - note: the progress note under `resource:<resource id>`.
 */
import { pinId, type Session } from '../learn';
import type { ShelfSession } from '../shelf';

export const usedKey = (resourceId: string): string => `used:${resourceId}`;
export const resourceNoteKey = (resourceId: string): string => `resource:${resourceId}`;

function linkEntries(session: Session, resourceId: string): string[] {
  const tail = `:${resourceId}`;
  return session.notebook.entries.filter((entry) => entry.kind === 'link' && entry.id.endsWith(tail)).map((entry) => entry.id);
}

export function shelfSessionOf(session: Session): ShelfSession {
  return {
    roadmap: session.roadmap,
    isUsed: (id) => session.progress.answers[usedKey(id)]?.correct === true,
    setUsed(id, used) {
      session.answer(usedKey(id), { correct: used });
    },
    isPinned: (id) => linkEntries(session, id).length > 0,
    pin(pin) {
      session.pin({
        id: pinId('link', pin.waypointId ?? pin.stageId, pin.resourceId),
        kind: 'link',
        text: pin.text,
        ...(pin.url ? { url: pin.url } : {}),
        stageId: pin.stageId,
        ...(pin.waypointId ? { waypointId: pin.waypointId } : {}),
      });
    },
    unpin(id) {
      for (const entryId of linkEntries(session, id)) session.unpin(entryId);
    },
    note: (id) => session.progress.notes[resourceNoteKey(id)] ?? '',
    setNote(id, text) {
      session.note(resourceNoteKey(id), text);
    },
    subscribe: (listener) => session.subscribe(() => listener()),
  };
}
