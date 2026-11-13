/**
 * The camp at the end of a stage: the project. Its brief, the rungs of the ladder (guided, changed, your own) as
 * ticks, the menu of choices that is the same for everyone, what "done" means, and the sources for it.
 */
import { hours as formatHours } from './format';
import type { Resource } from '../roadmap/types';
import { cardRoot, h, headingTag, pinButton, roadText, setPressed, uid, type CardOptions, type MountedCard } from './dom';
import { mount } from './mount';
import { pinId } from './notebook';
import { storageNotice } from './notice';
import { resourceList } from './resources';
import { findStage, type Session } from './session';
import { say } from './strings';

const SVG = 'http://www.w3.org/2000/svg';

/** A small flag on a pole: hollow until the rung is done, then filled (by CSS on the ticked row). */
function flagIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'zl-flag');
  svg.setAttribute('viewBox', '0 0 15 17');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '17');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const pole = document.createElementNS(SVG, 'path');
  pole.setAttribute('d', 'M1.5 0.8 V16.2');
  pole.setAttribute('class', 'zl-flag-pole');
  const cloth = document.createElementNS(SVG, 'path');
  cloth.setAttribute('d', 'M2.4 1.5 L13.8 5.8 L2.4 10.1 Z');
  cloth.setAttribute('class', 'zl-flag-cloth');
  svg.append(pole, cloth);
  return svg;
}

export function campCard(session: Session, stageId: string, options: CardOptions = {}): MountedCard {
  const found = findStage(session.roadmap, stageId);
  if (!found?.stage.project) throw new Error(`campCard: stage "${stageId}" has no project`);
  const { roadmap } = session;
  const { stage, index: stageIndex } = found;
  const project = found.stage.project;
  const lang = roadmap.lang;
  const level = options.headingLevel ?? 3;
  const root = cardRoot('article', 'zl-camp', { 'data-stage': stage.id });

  const build = () => {
    const titleId = uid('zl-title');
    root.setAttribute('aria-labelledby', titleId);
    const meta = project.minutes ? formatHours(project.minutes) : '';

    const pinId_ = pinId('task', stage.id, 'project');
    const pin = pinButton(say('pin'), say('pinProject'));
    pin.addEventListener('click', () => {
      if (session.notebook.has(pinId_)) session.unpin(pinId_);
      else session.pin({ id: pinId_, kind: 'task', text: `${project.title}: ${project.brief}`, stageId: stage.id });
    });

    const header = h(
      'header',
      { class: 'zl-head' },
      h('p', { class: 'zl-kicker zl-label' }, say('stageOf', { n: stageIndex + 1, total: roadmap.stages.length }), ' · ', say('camp')),
      roadText(headingTag(level), project.title, lang, { class: 'zl-title', id: titleId }),
      meta ? h('p', { class: 'zl-meta' }, meta) : null,
    );
    const brief = h(
      'div',
      { class: 'zl-brief' },
      roadText('p', project.brief, lang, { class: 'zl-note' }),
      project.capstone
        ? h('p', { class: 'zl-capstone' }, say('capstone'), roadmap.capstone ? ': ' : '', roadmap.capstone ? roadText('span', roadmap.capstone.title, lang) : null)
        : null,
      h('div', { class: 'zl-row' }, pin),
    );

    const rungs = project.rungs.map((rung, i) => {
      const id = uid('zl-rung');
      const box = h('input', { type: 'checkbox', id, class: 'zl-check-box' });
      box.addEventListener('change', () => session.rung(stage.id, box.checked ? i + 1 : i));
      const row = h(
        'li',
        { class: 'zl-rung', 'data-level': rung.level },
        h(
          'label',
          { class: 'zl-arm-label', for: id },
          box,
          h(
            'span',
            { class: 'zl-rung-body' },
            h('span', { class: 'zl-label zl-rung-level' }, flagIcon(), say(`rung.${rung.level}`)),
            roadText('span', rung.task, lang, { class: 'zl-arm-text' }),
          ),
        ),
      );
      return { box, row };
    });
    const tally = h('p', { class: 'zl-tally', role: 'status' });
    const rungsHeadId = uid('zl-rungs');
    const ladder = h(
      'div',
      { class: 'zl-arms', role: 'group', 'aria-labelledby': rungsHeadId },
      h(headingTag(level + 1), { class: 'zl-part-head zl-label', id: rungsHeadId }, say('rungs')),
      h('ol', { class: 'zl-arm-list zl-ladder', role: 'list' }, ...rungs.map((r) => r.row)),
      tally,
    );
    const notice = storageNotice(session);

    const choices =
      project.choices && project.choices.length > 0
        ? h(
            'section',
            { class: 'zl-part' },
            h(headingTag(level + 1), { class: 'zl-part-head zl-label' }, say('choices')),
            h('p', { class: 'zl-hint' }, say('choicesHint')),
            h('ul', { class: 'zl-plain-list' }, ...project.choices.map((c) => roadText('li', c, lang))),
          )
        : null;
    const criteria =
      project.criteria && project.criteria.length > 0
        ? h(
            'section',
            { class: 'zl-part' },
            h(headingTag(level + 1), { class: 'zl-part-head zl-label' }, say('criteria')),
            h('ul', { class: 'zl-plain-list zl-criteria' }, ...project.criteria.map((c) => roadText('li', c, lang))),
          )
        : null;
    const resources = (project.resources ?? [])
      .map((id) => roadmap.resources.find((r) => r.id === id))
      .filter((r): r is Resource => r !== undefined);
    const sources =
      resources.length > 0
        ? h(
            'section',
            { class: 'zl-part' },
            h(headingTag(level + 1), { class: 'zl-part-head zl-label' }, say('campSources')),
            resourceList({ resources, lang }).root,
          )
        : null;

    root.append(header, brief, ladder, notice.root);
    for (const part of [choices, criteria, sources]) if (part) root.append(part);

    const update = (): void => {
      const done = session.progress.rungs[stage.id] ?? 0;
      rungs.forEach(({ box, row }, i) => {
        box.checked = i < done;
        row.toggleAttribute('data-ticked', i < done);
      });
      const line = say('rungsDone', { count: Math.min(done, rungs.length), total: rungs.length });
      if (tally.textContent !== line) tally.textContent = line;
      root.toggleAttribute('data-complete', done >= rungs.length);
      setPressed(pin, session.notebook.has(pinId_));
      notice.update();
    };
    update();
    return { update };
  };

  return mount(session, root, build);
}
