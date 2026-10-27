// catchup.mjs - "Previously in the Village", checked against the log (16 Oct 2026).
//
// Ben, 15 Oct evening: the Village goes on the home page with "some sort of TLDR like a summary
// of what's happened... like at the beginning of a TV episode... they seem to be discussing
// something about a step and fire... rules and stuff... people aren't going to know this"
// (docs/design/village-2026-10-14.md, "On the home page"). So above the street sit three or four
// plain lines of the running stories, each saying what its in-joke means.
//
// A free model drafts candidate lines from the closed days (run-catchup.mjs); Builder reads each
// one beside the entries it cites and keeps, rewords or drops it. This file is the matcher both
// steps share, and the site's build runs it too (src/components/village/catchup.ts): a line must
// cite the log entries it rests on ("D4#131", or "D3#close" for an evening close), and
//   1. every cite must name an entry that exists in the closed days' logs;
//   2. every resident, time, number and place the line names, and every in-joke term it explains
//      (`terms`), must appear in at least one of its cited entries.
// A line that fails either stops the build. A line prints its "checked against the log" stamp
// only when it passes and Builder's review is recorded on it (`reviewedBy`).
//
// No Node imports: the site's build imports this file.

import { resolveCite } from "./gazette.mjs";

/** The high street's places, by the words a line would use for each. */
export const PLACES = [
  { name: "The Old Oak", words: ["old oak"] },
  { name: "Village Hall", words: ["village hall", "the hall", "hall"] },
  { name: "Scout Hut", words: ["scout hut"] },
  { name: "Harbour Café", words: ["harbour café", "harbour cafe", "café", "cafe"] },
  { name: "The Fig Tree", words: ["fig tree"] },
  { name: "Post Office", words: ["post office"] },
  { name: "the library", words: ["library"] },
  { name: "the green", words: ["village green", "the green"] },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (hay, word) => new RegExp(`(^|[^a-z0-9])${esc(word)}($|[^a-z0-9])`, "i").test(hay);

/** One cited entry as searchable text: who, what, the arguments and what the log answered. */
const entryText = (hit) => {
  const e = hit.event;
  return JSON.stringify([e.resident, e.tool, e.args, e.result, e.shown ?? null])
    .toLowerCase()
    .replace(/\\u2011|\\u2010|‑|‐/g, "-") // non-breaking hyphens, as some models type them
    .replace(/(\d)\.(\d\d)/g, "$1:$2");
};

/** What a line asserts, each of which one of its cited entries must contain. */
export function lineTokens(text, residents, terms = []) {
  const toks = [];
  const t = String(text);
  for (const r of residents) {
    if (has(t, r.name)) toks.push({ kind: "resident", value: r.name, find: [r.name] });
    else {
      // "Nemotron" for Nemotron 3 Super, "Claude Haiku" for Claude Haiku 5.5
      const short = r.name.split(/\s+/)[0];
      if (short.length > 3 && has(t, short))
        toks.push({ kind: "resident", value: r.name, find: [short] });
    }
  }
  const times = new Set();
  for (const m of t.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)) {
    const v = `${m[1].padStart(2, "0")}:${m[2]}`;
    times.add(m.index);
    toks.push({ kind: "time", value: v, find: [v, v.replace(/^0/, "")] });
  }
  // bare numbers ("20 people", "25"), not the digits of a time or of a resident's name
  let bare = t;
  for (const r of residents) bare = bare.replace(new RegExp(esc(r.name), "gi"), " ");
  bare = bare.replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, " ");
  for (const m of bare.matchAll(/\b\d+\b/g))
    toks.push({ kind: "number", value: m[0], find: [m[0]] });
  for (const p of PLACES) {
    const w = p.words.find((x) => has(t, x));
    if (w) toks.push({ kind: "place", value: p.name, find: [w] });
  }
  for (const term of terms) toks.push({ kind: "term", value: term, find: [term] });
  return toks;
}

/**
 * Check one line against the closed days. Returns {ok, problems, hits}; never throws.
 * `days` are day files (each {day, events, civic?}); `residents` every resident who lived in them.
 */
export function checkLine(line, days, residents) {
  const problems = [];
  const cites = Array.isArray(line?.cites) ? line.cites.map(String) : [];
  if (!cites.length) problems.push("it cites nothing");
  const hits = [];
  for (const c of cites) {
    const hit = resolveCite(days, c);
    if (!hit) problems.push(`${c} is not in the log`);
    else hits.push({ cite: c, ...hit });
  }
  const hay = hits.map(entryText).join(" ");
  if (hits.length) {
    for (const tok of lineTokens(line.text, residents, line.terms ?? [])) {
      if (!tok.find.some((w) => has(hay, w.toLowerCase())))
        problems.push(
          `it names ${tok.kind} "${tok.value}", which none of its cited entries contain`,
        );
    }
  }
  return { ok: problems.length === 0, problems, hits };
}

/** Every resident who lived in any of the days, once each, first appearance first. */
const residentsOf = (days) => {
  const out = [];
  for (const d of days)
    for (const r of d.residents ?? []) if (!out.some((x) => x.name === r.name)) out.push(r);
  return out;
};

/** One reviewed line, checked, in the shape the pages print (shared by every list here). */
function printable(line, days, residents, where) {
  if (typeof line?.text !== "string" || !line.text.trim()) throw new Error(`${where} has no text`);
  if (/—|&mdash;/.test(line.text)) throw new Error(`${where} has an em dash`);
  const r = checkLine(line, days, residents);
  if (!r.ok) throw new Error(`${where} fails the log: ${r.problems.join("; ")}`);
  return {
    text: line.text,
    cites: line.cites,
    terms: line.terms ?? [],
    // who the line is about, in the order it names them, for the sprites beside it
    who: lineTokens(line.text, residents)
      .filter((t) => t.kind === "resident")
      .map((t) => ({ t, at: line.text.toLowerCase().indexOf(t.find[0].toLowerCase()) }))
      .sort((a, b) => a.at - b.at)
      .map(({ t }) => residents.find((x) => x.name === t.value)),
    reviewedBy: typeof line.reviewedBy === "string" && line.reviewedBy ? line.reviewedBy : null,
    stamp: typeof line.reviewedBy === "string" && line.reviewedBy.length > 0,
    hits: r.hits.map((h) => ({ cite: h.cite, day: h.day, event: h.event })),
  };
}

/**
 * "The story so far" and "the day in three lines" (Ben, 16 Oct, on the record page: "what are we
 * learning from it... the TLDR of the day... or of the entire situation"). Same matcher, same
 * rules as the catch-up, plus:
 *   - the story holds three to five beats, newest first (by the newest day each one cites), and
 *     every beat carries Builder's review, because every beat prints "checked against the log";
 *   - a day's recap is two or three lines, every cite from that day, reviewed, one recap a day.
 * file: {days, story: [{id, text, cites, terms?, reviewedBy}], recaps: [{day, lines: [...],
 * reviewedBy}]}. Throws naming the beat or the day, so the build stops. Never reads the network.
 */
export function storyOf(file, days) {
  if (!file || !Array.isArray(file.story)) throw new Error("story: the file has no story");
  const residents = residentsOf(days);
  const n = file.story.length;
  if (n < 3 || n > 5) throw new Error(`story: ${n} beats; the story holds three to five`);
  const ids = new Set();
  const story = file.story.map((beat, i) => {
    const where = `story beat "${beat?.id ?? i + 1}"`;
    if (typeof beat?.id !== "string" || !beat.id) throw new Error(`story beat ${i + 1} has no id`);
    if (ids.has(beat.id)) throw new Error(`story: two beats are called "${beat.id}"`);
    ids.add(beat.id);
    if (typeof beat.reviewedBy !== "string" || !beat.reviewedBy)
      throw new Error(`${where} has no review on it; every beat prints "checked against the log"`);
    const p = printable(beat, days, residents, where);
    return { id: beat.id, ...p, newest: Math.max(...p.hits.map((h) => h.day)) };
  });
  story.forEach((b, i) => {
    if (i && b.newest > story[i - 1].newest)
      throw new Error(
        `story: "${b.id}" cites day ${b.newest}, newer than "${story[i - 1].id}" above it; newest first`,
      );
  });

  const recaps = (Array.isArray(file.recaps) ? file.recaps : []).map((rc, i) => {
    const where = `recap ${i + 1}`;
    if (!Number.isInteger(rc?.day)) throw new Error(`${where} names no day`);
    if (!days.some((d) => d.day === rc.day))
      throw new Error(`the day ${rc.day} recap is for a day the log does not hold`);
    const lines = Array.isArray(rc.lines) ? rc.lines : [];
    if (lines.length < 2 || lines.length > 3)
      throw new Error(`the day ${rc.day} recap has ${lines.length} lines; it holds two or three`);
    if (typeof rc.reviewedBy !== "string" || !rc.reviewedBy)
      throw new Error(`the day ${rc.day} recap has no review on it`);
    return {
      day: rc.day,
      reviewedBy: rc.reviewedBy,
      lines: lines.map((line, k) => {
        const at = `the day ${rc.day} recap, line ${k + 1}`;
        const own = { ...line, reviewedBy: rc.reviewedBy };
        const p = printable(own, days, residents, at);
        const other = p.hits.find((h) => h.day !== rc.day);
        if (other) throw new Error(`${at} cites ${other.cite}, which is not from day ${rc.day}`);
        return p;
      }),
    };
  });
  const seen = new Set();
  for (const r of recaps) {
    if (seen.has(r.day)) throw new Error(`two recaps for day ${r.day}`);
    seen.add(r.day);
  }
  return { story, recaps };
}

/**
 * The catch-up file, checked. Throws on any line that fails, naming it, so the build stops.
 * file: {lines: [{id, text, cites, terms?, reviewedBy?, draft?, edited?}], ...}.
 * Returns the lines that may print, each with `stamp` true when Builder's review is recorded.
 */
export function catchupOf(file, days) {
  const at = (i) => `catch-up line ${i + 1}`;
  if (!file || !Array.isArray(file.lines)) throw new Error("catch-up: the file has no lines");
  if (file.lines.length > 4)
    throw new Error(`catch-up: ${file.lines.length} lines; the catch-up holds four at most`);
  const residents = [];
  for (const d of days)
    for (const r of d.residents ?? [])
      if (!residents.some((x) => x.name === r.name)) residents.push(r);
  const out = [];
  const ids = new Set();
  file.lines.forEach((line, i) => {
    if (typeof line?.id !== "string" || !line.id) throw new Error(`${at(i)} has no id`);
    if (ids.has(line.id)) throw new Error(`catch-up: two lines are called "${line.id}"`);
    ids.add(line.id);
    if (typeof line.text !== "string" || !line.text.trim()) throw new Error(`${at(i)} has no text`);
    if (/—|&mdash;/.test(line.text)) throw new Error(`${at(i)} has an em dash`);
    const r = checkLine(line, days, residents);
    if (!r.ok)
      throw new Error(`catch-up line "${line.id}" fails the log: ${r.problems.join("; ")}`);
    out.push({
      id: line.id,
      text: line.text,
      cites: line.cites,
      terms: line.terms ?? [],
      // who the line is about, in the order it names them, for the sprites beside it
      who: lineTokens(line.text, residents)
        .filter((t) => t.kind === "resident")
        .map((t) => ({ t, at: line.text.toLowerCase().indexOf(t.find[0].toLowerCase()) }))
        .sort((a, b) => a.at - b.at)
        .map(({ t }) => residents.find((x) => x.name === t.value)),
      reviewedBy: typeof line.reviewedBy === "string" && line.reviewedBy ? line.reviewedBy : null,
      stamp: typeof line.reviewedBy === "string" && line.reviewedBy.length > 0,
      hits: r.hits.map((h) => ({ cite: h.cite, day: h.day, event: h.event })),
    });
  });
  return out;
}
