// run-lines.mjs - the residents write their own lines for the home page's sign-up box and its
// noticeboard (20 Oct 2026). Rules and checks: lines.mjs. Free lanes only (free-lanes.mjs).
//
// Each reachable resident of the engine's cast (lanes.mjs CAST) is asked once, in the Village's
// own persona (margins.mjs VILLAGE), for both lines. Each line passes lines.mjs mechanical, then a
// judge from a lab with no resident (dots, on OpenRouter's free list) says show, correct (show it
// with the checker's scribbled correction) or hold; a judge that cannot be reached means not shown. Everything is kept word for word, shown or not, with
// the reason, the lane, the model that answered and the cost. A resident that cannot be reached
// is listed in `skipped` with the reason; nobody answers for it.
//
// Usage:
//   node scripts/live-room/village/run-lines.mjs [--only "Gemma 4 26B"] [--dry]
// Writes src/data/live-room/village/lines/<UK date>.json; a second run the same day replaces only
// the residents it asked (so --only fills in a resident later without touching the rest).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freeLanes } from "../free-lanes.mjs";
import { formatWritten } from "../margins/format.mjs";
import { firstJson, VILLAGE } from "../margins/margins.mjs";
import { CAST } from "./lanes.mjs";
import {
  evidencePrompt,
  lineJudgePrompt,
  linesPrompt,
  mechanical,
  openReply,
  othersNotes,
  pickCards,
  readVerdict,
  replyTarget,
} from "./lines.mjs";

const JUDGE = {
  name: "dots.3 Note",
  lab: "dots",
  lane: "openrouter-free",
  model: "dots-studio/dots-3-note-preview:free",
};
const DIR = join(process.cwd(), "src", "data", "live-room", "village", "lines");
// Builder's replies on the board (lines.mjs openReply) and every earlier day's lines, to find each
// reply's note and whether it has been answered
const REPLIES_FILE = join(process.cwd(), "src", "data", "live-room", "village", "replies.json");
const REPLIES = existsSync(REPLIES_FILE)
  ? (JSON.parse(readFileSync(REPLIES_FILE, "utf8")).replies ?? [])
  : [];
const FILES = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")))
  : [];
/** The reply the resident is handed today, with its note's own words, or null. */
function replyFor(name) {
  const r = openReply(REPLIES, FILES, name);
  if (!r) return null;
  const note = FILES.find((f) => f.date === r.on.date)?.lines?.find((e) => e.resident === name)?.[
    r.on.kind
  ]?.text;
  return note ? { ...r, note } : null;
}
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
// the board as it stood before today (list row 39): each resident may reply to one of the others'
// newest shown notes from an earlier day, so a second run the same day hands out the same notes
const EARLIER = FILES.filter((f) => f.date < TODAY);

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const dry = args.includes("--dry");

const lanes = freeLanes();
// the always-on cast on free lanes; the paid seats are named after the apps the tracker tests,
// which are never drawn as residents on the site (pixel-site's APP_NAMES), and cost money
const FREE = new Set(["openrouter-free", "workers-ai"]);
const asked = CAST.filter((c) => FREE.has(c.lane) && (!only || c.name === only));
if (only && !asked.length) throw new Error(`no resident called ${only}`);

const skipped = [];
const plan = asked
  .map((c) => {
    const who = lanes.reachable(c);
    if (!who) skipped.push({ resident: c.name, why: `${c.lane} is not reachable from here` });
    return who;
  })
  .filter(Boolean);
console.log(
  `asking ${plan.length}: ${plan.map((w) => `${w.name} (${w.lane})`).join(", ") || "nobody"}`,
);
for (const s of skipped) console.log(`  skipped ${s.resident}: ${s.why}`);
if (dry) process.exit(0);

// the day's evidence cards (lines.mjs pickCards): the public register, read once; without it the
// residents write their two lines and no evidence notes, and the record says why
const REGISTER = "https://dixon.ai/evidence.json";
let cards = new Map();
let noCards = null;
try {
  const res = await fetch(REGISTER, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  cards = pickCards(
    (await res.json()).entries ?? [],
    plan.map((w) => w.name),
    TODAY,
  );
  if (!cards.size) noCards = "the register has no tracker wrong answers";
} catch (e) {
  noCards = `${REGISTER} could not be read (${e.message})`;
}
if (noCards) console.log(`  no evidence notes today: ${noCards}`);

async function judge(kind, who, text, card) {
  const why = mechanical(kind, text);
  if (why) return { show: false, why, by: "rules" };
  const r = await lanes.call(JUDGE, lineJudgePrompt(kind, who, text, card), 4000);
  const v = r.error ? null : readVerdict(firstJson(r.content));
  if (!v)
    return {
      show: false,
      why: `the judge gave no verdict (${r.error || "unreadable reply"})`,
      by: JUDGE.name,
    };
  return { ...v, by: JUDGE.name };
}

const entries = [];
for (const who of plan) {
  const others = CAST.filter((c) => c.name !== who.name).map((c) => c.name);
  console.log(`${who.name}…`);
  const reply = replyFor(who.name);
  if (reply) console.log(`  handed ${reply.by}'s reply ${reply.id}`);
  const board = othersNotes(EARLIER, who.name);
  let r = await lanes.call(who, linesPrompt(VILLAGE(who, others), reply, board), 6000);
  let got = r.error ? null : firstJson(r.content);
  if (!r.error && (!got || typeof got.signup !== "string" || typeof got.sticky !== "string")) {
    // one more go for a reply that holds no JSON object
    r = await lanes.call(who, linesPrompt(VILLAGE(who, others), reply, board), 6000);
    got = r.error ? null : firstJson(r.content);
  }
  if (!got || typeof got.signup !== "string" || typeof got.sticky !== "string") {
    skipped.push({ resident: who.name, why: r.error || "no JSON with both lines in its reply" });
    console.log(`  no lines: ${r.error || "unreadable reply"}`);
    continue;
  }
  const signup = { text: got.signup.trim(), ...(await judge("signup", who.name, got.signup)) };
  const sticky = { text: got.sticky.trim(), ...(await judge("sticky", who.name, got.sticky)) };
  // its answer to Builder's reply, judged as a sticky is; a reply it did not answer stays open
  const answer =
    reply && typeof got.answer === "string"
      ? {
          reply: reply.id,
          text: got.answer.trim(),
          ...(await judge("sticky", who.name, got.answer)),
        }
      : null;
  // its reply to another resident's note (list row 39), judged as a sticky is; one naming a
  // resident it was not handed is dropped and logged, never matched to a guess
  const target = replyTarget(got.replyTo, board);
  if (target.drop) console.log(`  reply dropped: ${target.drop}`);
  const replyTo = target.note
    ? {
        to: target.note.resident,
        onDate: target.note.date,
        text: target.text,
        ...(await judge("sticky", who.name, target.text)),
      }
    : null;
  // a note on its evidence card, asked apart so the two lines' prompt stays as it was
  const card = cards.get(who.name);
  let evidence;
  if (card) {
    const er = await lanes.call(who, evidencePrompt(VILLAGE(who, others), card), 3000);
    const eg = er.error ? null : firstJson(er.content);
    if (eg && typeof eg.note === "string")
      evidence = {
        card: card.id,
        text: eg.note.trim(),
        ...(await judge("evidence", who.name, eg.note, card)),
      };
    else console.log(`  no evidence note: ${er.error || "unreadable reply"}`);
  }
  for (const [k, v] of [
    ["signup", signup],
    ["sticky", sticky],
    ...(evidence ? [["evidence", evidence]] : []),
    ...(answer ? [["answer", answer]] : []),
    ...(replyTo ? [[`reply to ${replyTo.to}`, replyTo]] : []),
  ])
    console.log(
      `  ${k} ${v.correction ? "SHOW+FIX" : v.show ? "SHOW" : "HELD"}: ${v.text}${v.correction ? `  [${v.correction}]` : v.show ? "" : `  [${v.why}]`}`,
    );
  entries.push({
    resident: who.name,
    lab: who.lab,
    colour: who.colour,
    lane: r.lane,
    route: r.route,
    servedModel: r.servedModel,
    signup,
    sticky,
    ...(evidence ? { evidence } : {}),
    ...(answer ? { answer } : {}),
    ...(replyTo ? { replyTo } : {}),
  });
}

mkdirSync(DIR, { recursive: true });
const path = join(DIR, `${TODAY}.json`);
const before = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const names = new Set(asked.map((c) => c.name));
const out = {
  date: TODAY,
  judge: { name: JUDGE.name, lab: JUDGE.lab, model: JUDGE.model },
  lines: [...(before?.lines ?? []).filter((e) => !names.has(e.resident)), ...entries],
  skipped: [...(before?.skipped ?? []).filter((s) => !names.has(s.resident)), ...skipped],
  ...(noCards ? { noEvidenceNotes: noCards } : {}),
  cost: lanes.cost,
};
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
formatWritten([path]);
console.log(
  `wrote ${path}: ${entries.length} resident(s), ${skipped.length} skipped; ${lanes.cost.calls} calls, US$${lanes.cost.usd}`,
);
