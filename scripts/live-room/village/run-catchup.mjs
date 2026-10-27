#!/usr/bin/env node
// run-catchup.mjs - drafts "Previously in the Village" from the closed days (16 Oct 2026).
//
// Ben, 15 Oct evening: a TV-style catch-up above the Village on the home page, so a stranger can
// follow the in-jokes (docs/design/village-2026-10-14.md, "On the home page"). The brief: "drafted
// from each closed day by a free model, every line checked against the events by Builder... before
// it shows". This script is the drafting half:
//   1. reads the closed days asked for: the repo's day files, and any day the Village Worker
//      serves that the repo does not hold (pinned to src/data/live-room/village/catchup/day-NN.json
//      as served, so the site's build checks every cite against a fixed copy);
//   2. hands a free model, from a lab with no resident, the public record of those days and asks
//      for three or four lines, each citing the entries it rests on;
//   3. runs every candidate through the matcher (catchup.mjs) and writes them, with the
//      matcher's verdict, to the `drafts` of src/data/live-room/village/catchup/catchup.json.
// It never touches `lines`: those are the lines that print, and only Builder's review puts one
// there (each with `reviewedBy`), after reading it beside its cited entries.
//
// Lanes: OpenRouter's free models only, through the engine's callModel (lanes.mjs), which refuses
// any model id without `:free`; a reply that reports spend stops the run. No paid route exists here.
// Auth: OPENROUTER_API_KEY or ~/.claude/openrouter-api.json, { "key": "sk-or-v1-..." }.
//
// Usage: node scripts/live-room/village/run-catchup.mjs [--days 2,3,4,5] [--offline]
//   --offline  no network: pins nothing new and drafts nothing; re-runs the matcher on the drafts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkLine } from "./catchup.mjs";
import { digest, parsePiece } from "./gazette.mjs";
import { callModel } from "./lanes.mjs";

// The drafters: OpenRouter free models from labs with no resident in the Village, tried in order
// (the margins' judges, picked 15 Oct: dots first; Poolside's Laguna as the stand-by).
const DRAFTERS = [
  {
    name: "dots.3 Note",
    lab: "dots",
    lane: "openrouter-free",
    model: "dots-studio/dots-3-note-preview:free",
  },
  {
    name: "Laguna S 2.1",
    lab: "Poolside",
    lane: "openrouter-free",
    model: "poolside/laguna-s-2.1:free",
  },
];

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const OFFLINE = argv.includes("--offline");
const WANT = String(flag("days", "2,3,4,5"))
  .split(",")
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0);
const API = "https://village.benjamesdixon.workers.dev";
const DATA = join(process.cwd(), "src", "data", "live-room", "village");
const DIR = join(DATA, "catchup");
const FILE = join(DIR, "catchup.json");
const pad = (n) => String(n).padStart(2, "0");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ── the closed days ──
async function served(path) {
  const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
const index = OFFLINE ? null : await served("/api/index");
const days = [];
for (const n of WANT) {
  const repo = join(DATA, `day-${pad(n)}.json`);
  const pinned = join(DIR, `day-${pad(n)}.json`);
  if (existsSync(repo)) days.push(readJson(repo));
  else if (index?.days?.some((d) => d.day === n)) {
    // a closed day the Worker serves: pinned as served, with when it was read
    const d = await served(`/api/day/${n}`);
    mkdirSync(DIR, { recursive: true });
    writeFileSync(
      pinned,
      `${JSON.stringify({ ...d, pinnedFrom: `${API}/api/day/${n}`, pinnedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    days.push(d);
  } else if (existsSync(pinned)) days.push(readJson(pinned));
  else throw new Error(`day ${n} is neither in the repo nor closed on the Village Worker`);
}
const residents = [];
for (const d of days)
  for (const r of d.residents) if (!residents.some((x) => x.name === r.name)) residents.push(r);

const file = existsSync(FILE) ? readJson(FILE) : { lines: [], drafts: [] };

// ── the record the drafter reads: the public log as the Gazette's writers get it, minus any
// one resident's diary (gazette.mjs digest). A library read logs only the page's name, so the
// residents' own notes and posts are where a page's words reach the record. ──
const record = () => digest(days, null);

const SYSTEM = [
  "You write the 'Previously in the Village' catch-up: the few lines at the start of a TV episode that tell a stranger what has been going on.",
  "The Village is a small pretend village where AI models live, take jobs, book tables and rooms, and report back. Strangers arrive knowing nothing and see the residents arguing about in-jokes (a step-free entrance, the fire rules, the knitting group).",
  "Write three or four lines, each one running story across the days, best story first. Each line is one or two plain sentences, at most 45 words, British spelling, no dashes. Say who did what, and say in plain words what the in-joke means (for example why 'step-free' matters, or what 'the fire rules' are), so a stranger can follow.",
  "Use only what the record says. Every line must cite the entries it rests on by their reference (for example D4#131, or D3#close for an evening close). Use residents' full names as the record gives them, and write times and numbers as digits.",
  "List in `terms` the in-joke words the line explains (for example 'step-free', 'fire rules').",
  "Reply with exactly one JSON object and nothing else:",
  '{"headline": "Previously in the Village", "sentences": [{"text": "...", "cites": ["D4#131"], "terms": ["fire rules"]}]}',
].join("\n");

async function draft() {
  const keyFile = join(homedir(), ".claude", "openrouter-api.json");
  const openrouterKey =
    process.env.OPENROUTER_API_KEY ||
    (existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")).key : null);
  if (!openrouterKey)
    throw new Error("no OpenRouter key: set OPENROUTER_API_KEY or ~/.claude/openrouter-api.json");
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `The record, days ${WANT.join(", ")}:\n${record().join("\n")}` },
  ];
  for (const who of DRAFTERS) {
    const r = await callModel(who, messages, { openrouterKey }, { maxTokens: 2500 });
    if (r.usd)
      throw new Error(`a free lane reported spend (${r.usd}) on ${r.servedModel}: stopping`);
    if (r.error) {
      console.warn(`${who.name}: ${r.error}`);
      continue;
    }
    // parsePiece keeps text and cites; the terms are read from the same object
    const piece = parsePiece(r.content);
    if (!piece?.sentences.length) {
      console.warn(`${who.name}: no usable lines in its reply`);
      continue;
    }
    const raw = (() => {
      try {
        return JSON.parse(r.content.slice(r.content.indexOf("{"), r.content.lastIndexOf("}") + 1));
      } catch {
        return null;
      }
    })();
    return {
      drafter: {
        name: who.name,
        lab: who.lab,
        model: who.model,
        servedModel: r.servedModel ?? who.model,
      },
      lines: piece.sentences.slice(0, 4).map((s, i) => ({
        text: s.text,
        cites: s.cites,
        terms: Array.isArray(raw?.sentences?.[i]?.terms) ? raw.sentences[i].terms.map(String) : [],
      })),
    };
  }
  throw new Error("no free drafter answered");
}

if (!OFFLINE) {
  const d = await draft();
  file.drafter = d.drafter;
  file.draftedOn = new Date().toISOString().slice(0, 10);
  file.days = WANT;
  file.drafts = d.lines;
}
file.drafts = (file.drafts ?? []).map((l) => {
  const r = checkLine(l, days, residents);
  return {
    text: l.text,
    cites: l.cites,
    terms: l.terms ?? [],
    matcher: { ok: r.ok, problems: r.problems },
  };
});
mkdirSync(DIR, { recursive: true });
writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
for (const l of file.drafts)
  console.log(
    `${l.matcher.ok ? "PASS" : "FAIL"}  ${l.text}\n      cites ${l.cites.join(", ")}${l.matcher.ok ? "" : `\n      ${l.matcher.problems.join("; ")}`}`,
  );
console.log(
  `\n${file.drafts.filter((l) => l.matcher.ok).length} of ${file.drafts.length} drafts pass the matcher; ${file.lines.length} reviewed lines print. Review: read each draft beside its cites, then put the kept lines in "lines" with "reviewedBy".`,
);
