/**
 * A roadmap as Markdown: the same outline as the page, for a repository, a note app or a course page. Roadmap
 * text is escaped so it shows exactly as written, and only http and https addresses become links.
 */
import { uiLang, type UiLang } from '../i18n';
import { day as formatDay, hours as formatHours } from '../learn/format';
import { escapeMarkdown, safeUrl } from '../learn/notebook';
import { resourceLine, statusSentence, languageName } from '../learn/resources';
import { say as learnSay } from '../learn/strings';
import { deriveTrek } from '../roadmap/derive';
import type { Check, Resource, Roadmap } from '../roadmap/types';
import { checkedLine, factsLine, percent, tierName } from './outline';
import { say } from './strings';

export interface RoadmapMarkdownOptions {
  readonly ui?: UiLang;
  /** Teacher notes and session plans. Default false. */
  readonly teacher?: boolean;
}

const SEP = ' · ';

function linkTarget(url: string): string {
  return url.replace(/[<>\s]/g, (char) => encodeURIComponent(char));
}

function sourceLines(resource: Resource, roadmapLang: string, ui: UiLang, kind: string | null): string[] {
  const href = safeUrl(resource.url);
  const title = escapeMarkdown(resource.title);
  const kindLine = [
    kind,
    learnSay(`type.${resource.type}` as 'type.docs', undefined, ui),
    resource.lang.split('-')[0] !== roadmapLang.split('-')[0] ? learnSay('inLang', { language: languageName(resource.lang, ui) }, ui) : null,
  ]
    .filter((p): p is string => p !== null)
    .join(SEP);
  const link = href ? `[${title}](<${linkTarget(href)}>)` : `${title} (${say('noLink', undefined, ui)})`;
  const by = resource.by ? `${SEP}${escapeMarkdown(resource.by)}` : '';
  const lines = [`- ${kindLine}: ${link}${by}`, `  ${escapeMarkdown(resource.why)}`, `  *${resourceLine(resource, ui)}*`];
  const sentence = statusSentence(resource, ui);
  if (resource.check.status !== 'verified' && sentence) {
    const word = learnSay(resource.check.status === 'gated' ? 'statusGated' : 'statusUnverified', undefined, ui);
    lines.push(`  **${word}:** ${sentence}${resource.check.note ? ` ${escapeMarkdown(resource.check.note)}` : ''}`);
  }
  return lines;
}

function checkLines(checks: readonly Check[], ui: UiLang): string[] {
  const lines: string[] = [];
  checks.forEach((check, i) => {
    lines.push(`${i + 1}. ${escapeMarkdown(check.q)}`);
    for (const option of check.options ?? []) lines.push(`   - ${escapeMarkdown(option)}`);
    lines.push(check.answer.trim() === '' ? `   *${say('answerWithheld', undefined, ui)}*` : `   *${learnSay('modelAnswer', undefined, ui)}:* ${escapeMarkdown(check.answer)}`);
  });
  return lines;
}

/** The roadmap as Markdown. */
export function roadmapToMarkdown(roadmap: Roadmap, options: RoadmapMarkdownOptions = {}): string {
  const ui = options.ui ?? uiLang();
  const teacher = options.teacher === true;
  const trek = deriveTrek(roadmap);
  const byId = new Map(roadmap.resources.map((r) => [r.id, r]));
  const out: string[] = [];
  const blank = (): void => {
    if (out[out.length - 1] !== '') out.push('');
  };

  out.push(`# ${escapeMarkdown(roadmap.title)}`, '');
  if (roadmap.summary) out.push(escapeMarkdown(roadmap.summary), '');
  out.push(`*${say('kicker', undefined, ui)}${SEP}${factsLine(roadmap, trek, ui)}*`, '');
  if (roadmap.brief.goal) out.push(`**${say('goal', undefined, ui)}:** ${escapeMarkdown(roadmap.brief.goal)}`, '');
  out.push(`${checkedLine(roadmap, ui)}. ${say('estimates', undefined, ui)}`, '');

  roadmap.stages.forEach((stage, si) => {
    const t = trek.stages[si];
    const practice = t && t.minutes > 0 ? t.practiceMinutes / t.minutes : 0;
    out.push(`## ${learnSay('stageOf', { n: si + 1, total: roadmap.stages.length }, ui)}: ${escapeMarkdown(stage.title)}`, '');
    out.push(
      `*${say('stageMeta', { tier: tierName(stage.tier, ui), time: formatHours(t?.minutes ?? 0, { lang: ui }), practice: say('handsOn', { share: percent(practice, ui) }, ui) }, ui)}*`,
      '',
    );
    if (stage.summary) out.push(escapeMarkdown(stage.summary), '');

    stage.waypoints.forEach((w, wi) => {
      const side = w.optional ? ` (${learnSay('sideTrail', undefined, ui)})` : '';
      out.push(`### ${learnSay('stepOf', { n: wi + 1, total: stage.waypoints.length }, ui)}: ${escapeMarkdown(w.title)}${side}`, '');
      out.push(
        `*${say('stepMeta', { time: formatHours(w.minutes, { lang: ui }), practice: formatHours(Math.min(w.practiceMinutes, w.minutes), { lang: ui, approx: false }) }, ui)}*`,
        '',
      );
      out.push(escapeMarkdown(w.note), '');
      if (w.predict) out.push(`> **${learnSay('predictTitle', undefined, ui)}:** ${escapeMarkdown(w.predict)}`, '');
      const resources = w.resources.map((id) => byId.get(id)).filter((r): r is Resource => r !== undefined);
      out.push(`**${learnSay('sources', undefined, ui)}**`, '');
      resources.forEach((r, i) => out.push(...sourceLines(r, roadmap.lang, ui, learnSay(i === 0 ? 'mainSource' : 'otherSource', undefined, ui))));
      if (w.gap) out.push(`- *${learnSay('noSource', undefined, ui)}:* ${escapeMarkdown(w.gap)}`);
      else if (resources.length === 0) out.push(`- *${learnSay('noSource', undefined, ui)}*`);
      blank();
      out.push(`**${learnSay('partDo', undefined, ui)}:** ${escapeMarkdown(w.do)}`, '');
      if (w.checks && w.checks.length > 0) out.push(`**${learnSay('checksTitle', undefined, ui)}**`, '', ...checkLines(w.checks, ui), '');
      if (w.takeaways && w.takeaways.length > 0) {
        out.push(`**${learnSay('keyPoints', undefined, ui)}**`, '', ...w.takeaways.map((k) => `- ${escapeMarkdown(k)}`), '');
      }
      if (teacher && w.teacherNote) out.push(`> **${say('teacherNote', undefined, ui)}:** ${escapeMarkdown(w.teacherNote)}`, '');
    });

    const cp = stage.checkpoint;
    const need = Math.ceil((cp.pass ?? 0.8) * cp.show.length - 1e-9);
    out.push(`### ${learnSay('signpost', undefined, ui)}: ${escapeMarkdown(cp.title)}`, '');
    out.push(`${learnSay('signpostIntro', undefined, ui)} ${learnSay('passRule', { count: need, total: cp.show.length }, ui)}`, '');
    out.push(...cp.show.map((s) => `- [ ] ${escapeMarkdown(s)}`), '');
    if (cp.checks && cp.checks.length > 0) out.push(`**${learnSay('testYourself', undefined, ui)}**`, '', ...checkLines(cp.checks, ui), '');

    const p = stage.project;
    if (p) {
      out.push(`### ${learnSay('camp', undefined, ui)}: ${escapeMarkdown(p.title)}`, '');
      const meta = [p.minutes ? formatHours(p.minutes, { lang: ui }) : null, p.capstone ? learnSay('capstone', undefined, ui) : null].filter(Boolean);
      if (meta.length > 0) out.push(`*${meta.join(SEP)}*`, '');
      out.push(escapeMarkdown(p.brief), '');
      out.push(`**${learnSay('rungs', undefined, ui)}**`, '');
      out.push(...p.rungs.map((r) => `- [ ] ${learnSay(`rung.${r.level}` as 'rung.own', undefined, ui)}: ${escapeMarkdown(r.task)}`), '');
      if (p.choices && p.choices.length > 0) out.push(`**${learnSay('choices', undefined, ui)}**`, '', ...p.choices.map((c) => `- ${escapeMarkdown(c)}`), '');
      if (p.criteria && p.criteria.length > 0) out.push(`**${learnSay('criteria', undefined, ui)}**`, '', ...p.criteria.map((c) => `- ${escapeMarkdown(c)}`), '');
      const res = (p.resources ?? []).map((id) => byId.get(id)).filter((r): r is Resource => r !== undefined);
      if (res.length > 0) {
        out.push(`**${learnSay('campSources', undefined, ui)}**`, '');
        res.forEach((r) => out.push(...sourceLines(r, roadmap.lang, ui, null)));
        blank();
      }
    }
  });

  if (roadmap.capstone) {
    out.push(`## ${say('capstoneTitle', undefined, ui)}: ${escapeMarkdown(roadmap.capstone.title)}`, '', escapeMarkdown(roadmap.capstone.brief), '');
  }

  const sessions = roadmap.class?.sessions ?? [];
  if (sessions.length > 0) {
    out.push(`## ${say('classTitle', undefined, ui)}`, '');
    const title = (id: string): string => escapeMarkdown(roadmap.stages.flatMap((s) => s.waypoints).find((w) => w.id === id)?.title ?? id);
    for (const s of sessions) {
      out.push(`### ${say('sessionTitle', { n: s.n }, ui)}${s.date ? `${SEP}${formatDay(s.date, { lang: ui })}` : ''}: ${escapeMarkdown(s.title)}`, '');
      if (teacher && s.opener) out.push(`**${say('opener', undefined, ui)}:** ${escapeMarkdown(s.opener)}`, '');
      if (s.inClass.length > 0) out.push(`**${say('inClass', undefined, ui)}:** ${s.inClass.map(title).join(', ')}`, '');
      if (s.homework && s.homework.length > 0) out.push(`**${say('homework', undefined, ui)}:** ${s.homework.map(title).join(', ')}`, '');
      if (teacher && s.exit) out.push(`**${say('exit', undefined, ui)}:** ${escapeMarkdown(s.exit)}`, '');
      if (teacher && s.materials && s.materials.length > 0) out.push(`**${say('materials', undefined, ui)}:** ${s.materials.map(escapeMarkdown).join(', ')}`, '');
    }
  }

  out.push('---', '', `*${say('footer', undefined, ui)} ${say('estimates', undefined, ui)}*`);
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`;
}
