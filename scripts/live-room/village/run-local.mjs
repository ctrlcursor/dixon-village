// run-local.mjs - prove the Village Worker on this PC before it goes to Cloudflare (s437, 15 Oct).
//
// Purpose: the live room's Village residents (Ben, 14 and 15 Oct; brief docs/design/village-
// 2026-10-14.md). Runs the Worker's own runTick (workers/village/src/index.js) on a fast clock:
// for each pretend day it ticks every 10 minutes of village time from 07:20 to 23:50, exactly as
// the cron would, against a file-backed store instead of KV. Real model calls:
//   openrouter-free  the three OpenRouter residents on their :free models ($0)
//   workers-ai       the Workers AI binding needs Ben's Cloudflare sign-in, so the three Workers
//                    AI residents and the Gazette's judge answer through the same open weights on
//                    OpenRouter's paid route (lanes.mjs standInAI), a fraction of a cent a day
// HARD SPEND CAP: the stand-in's spend goes into the Village's own ledger
// (docs/research/live-room/village/_spend.json, $2.00 cap shared with day one). A call is
// refused once the ledger passes $1.90.
//
// Usage (one process at a time; the ledger is not locked):
//   node scripts/live-room/village/run-local.mjs --from 2026-10-16 --days 3 --season 3
//        --store <dir> [--first-day 2] [--export src/data/live-room/village]
//        [--raw docs/research/live-room/village/trial] [--note "..."]
//   node scripts/live-room/village/run-local.mjs --fake --from 2026-10-16 --days 3 --store <dir>
//        (scripted replies, no network and no spend: tests the plumbing)
// Auth: ~/.claude/openrouter-api.json, { "key": "sk-or-v1-..." } (outside the repo).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runTick } from "../../../workers/village/src/index.js";
import { combine, judgePrompt, mechanical, parseVerdicts, tallyGazette } from "./gazette.mjs";
import { CAST, callModel, JUDGE, standInAI } from "./lanes.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const FAKE = argv.includes("--fake");
const FROM = flag("from", "2026-10-16");
const DAYS = Number(flag("days", 3));
const SEASON = flag("season", "3");
const STORE = flag("store");
const EXPORT = flag("export");
const RAWDIR = flag("raw");
const NOTE = flag(
  "note",
  "A rehearsal, recorded on 15 October 2026 on a fast clock: the Village Worker's own code ran on Builder's PC, so the village dates are pretend dates. The four Workers AI residents and the Gazette's judge answered through the same open models on OpenRouter's paid route, because Cloudflare's Workers AI needs Ben's sign-in; the other two were on OpenRouter's free models, Gemma falling back to Workers AI's Gemma 4 26B when its free route was rate-limited.",
);
const CAP = 1.9;
const SPEND = join(process.cwd(), "docs", "research", "live-room", "village", "_spend.json");
const REJUDGE = flag("rejudge");
if (!STORE && !REJUDGE) throw new Error("--store <dir> is required (a scratch folder)");

// ── a file store with the KV adapter's shape ──
const fileOf = (k) => join(STORE, `${k.replace(/:/g, "__")}.json`);
const store = {
  get: async (k) => (existsSync(fileOf(k)) ? JSON.parse(readFileSync(fileOf(k), "utf8")) : null),
  getText: async (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), "utf8") : null),
  put: async (k, v) => {
    mkdirSync(STORE, { recursive: true });
    writeFileSync(fileOf(k), typeof v === "string" ? v : JSON.stringify(v));
  },
};

// ── the spend ledger ──
const spend = existsSync(SPEND)
  ? JSON.parse(readFileSync(SPEND, "utf8"))
  : { capUsd: 2, totalUsd: 0, calls: 0, log: [] };
const onSpend = (usd, who) => {
  spend.totalUsd += usd;
  spend.calls += 1;
  spend.log.push({
    at: new Date().toISOString(),
    label: `village-local:${who?.name}`,
    model: who?.standIn,
    usd: Number(usd.toFixed(6)),
    costSource: "response",
  });
  writeFileSync(SPEND, `${JSON.stringify(spend, null, 2)}\n`);
};

// ── fake replies for --fake ──
let fakeN = 0;
const FAKE_SCRIPT = [
  '{"tool": "jobs.list", "args": {}}',
  '{"tool": "election.stand", "args": {"manifesto": "Buses and benches.", "promises": [{"kind": "build", "project": "bench"}, {"text": "be nice"}]}}',
  '{"tool": "planning.request", "args": {"title": "A bench by the harbour", "project": "bench"}}',
  '{"tool": "planning.vote", "args": {"requestId": "PL1", "vote": "yes"}}',
  '{"tool": "election.vote", "args": {"candidate": "Inkling"}}',
  '{"tool": "board.post", "args": {"text": "Heard the number 4 runs till midnight now!"}}',
  '{"tool": "library.read", "args": {"pageId": "bus-4"}}',
  '{"end": true}',
];
const fakeAI = {
  async run(_m, { messages }) {
    const sys = messages[0].content;
    const content = /Village Gazette/.test(sys)
      ? '{"headline": "A week", "sentences": [{"text": "Inkling stood for mayor.", "cites": ["D1#2"]}, {"text": "Gemma booked B9 at 19:00.", "cites": ["D1#3"]}]}'
      : /check a village newspaper/.test(sys)
        ? '{"verdicts": [{"n": 1, "verdict": "supported", "why": "ok"}, {"n": 2, "verdict": "contradicted", "why": "no"}]}'
        : FAKE_SCRIPT[fakeN++ % FAKE_SCRIPT.length];
    return { response: content };
  },
};

const key = FAKE
  ? null
  : JSON.parse(readFileSync(join(homedir(), ".claude", "openrouter-api.json"), "utf8")).key;
const ai = FAKE
  ? fakeAI
  : (() => {
      const real = standInAI(key, onSpend);
      return {
        run: async (...a) => {
          if (spend.totalUsd > CAP)
            throw new Error(`SPEND CAP: ledger $${spend.totalUsd.toFixed(4)} is past $${CAP}`);
          return real.run(...a);
        },
      };
    })();
// In --fake mode the openrouter-free residents go through the fake binding too.
if (FAKE) {
  const lanes = await import("./lanes.mjs");
  for (const c of lanes.CAST) c.lane = "workers-ai";
}

// --rejudge <dir>: check a written Gazette again with the current checks (the same words; only the
// checking changes), keeping the first pass's tally in the file as firstPass. Used once on 15 Oct,
// after the judge was found to take a resident's report as proof and the evening close was made
// citable.
if (REJUDGE) {
  const days = readdirSync(REJUDGE)
    .filter((f) => /^day-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(REJUDGE, f), "utf8")));
  for (const f of readdirSync(REJUDGE).filter((x) => /^gazette-\d+\.json$/.test(x))) {
    const g = JSON.parse(readFileSync(join(REJUDGE, f), "utf8"));
    const firstPass = g.firstPass ?? { ...g.tally, judge: g.judge?.name };
    const residents = days[0].residents;
    for (const piece of g.pieces) {
      if (!piece.sentences.length) continue;
      const mech = piece.sentences.map((x) => mechanical(x, days, residents));
      const rec = await callModel(
        JUDGE,
        judgePrompt(piece, mech),
        { ai, openrouterKey: key },
        { maxTokens: 1500 },
      );
      const verdicts = parseVerdicts(rec.content, piece.sentences.length);
      piece.sentences = piece.sentences.map(({ text, cites }, i) => ({
        text,
        cites,
        ...combine(mech[i], verdicts[i], JUDGE.name),
      }));
      console.log(
        `rejudged ${piece.resident}: ${piece.sentences.map((x) => x.verdict).join(", ")}`,
      );
    }
    g.tally = tallyGazette(g.pieces);
    g.firstPass = firstPass;
    g.rejudged =
      "Checked again on 15 Oct 2026 with the same words: the evening close became citable (D3#close) and the judge was told that a resident's post or report proves only that it was said. The first pass is kept as firstPass.";
    writeFileSync(join(REJUDGE, f), `${JSON.stringify(g, null, 2)}\n`);
    console.log(
      `${f}: ${g.tally.true} of ${g.tally.sentences} true (${g.tally.pctTrue}%), first pass ${firstPass.pctTrue}%`,
    );
  }
  process.exit(0);
}
void CAST;

// CPU proxy: a tick's wall time minus the time spent waiting on the network (Windows reports
// process CPU in 15.6 ms steps, too coarse for a 10 ms budget). File-store I/O is left in, so
// this over-counts slightly; the Worker's limit counts its JavaScript time only.
let netMs = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => {
  const t = performance.now();
  const res = await realFetch(...a).finally(() => {
    netMs += performance.now() - t;
  });
  // OpenRouter sends its headers early and the body when the model finishes: time the body too.
  for (const m of ["text", "json"]) {
    const orig = res[m].bind(res);
    res[m] = async () => {
      const t2 = performance.now();
      try {
        return await orig();
      } finally {
        netMs += performance.now() - t2;
      }
    };
  }
  return res;
};
// Retry waits (lanes.mjs sleeps 10 s and 25 s on a rate limit) are waiting, not work.
globalThis.__villageWait = (ms) => {
  netMs += ms;
};
const kindOf = (did) =>
  /^wake/.test(did)
    ? "wake"
    : /^closed/.test(did)
      ? "close"
      : /^opened/.test(did)
        ? "open"
        : /^the Stranger/.test(did)
          ? "stranger"
          : /^Gazette d+ written/.test(did)
            ? "gazette publish"
            : /^Gazette/.test(did)
              ? "gazette step"
              : "other";

// London is UTC+1 until 25 Oct 2026 (BST); the engine converts with Intl, so pass real UTC.
const env = {
  SEASON_LENGTH: SEASON,
  FIRST_DAY: flag("first-day", "2"),
  FIRST_GAZETTE: flag("first-gazette", "1"),
  TRIAL_NOTE: NOTE,
  IGNORE_LOCK: "1",
};
const cpu = [];
for (let d = 0; d < DAYS; d++) {
  const date = new Date(new Date(`${FROM}T12:00:00Z`).getTime() + d * 86400000)
    .toISOString()
    .slice(0, 10);
  for (let m = 7 * 60 + 20; m <= 24 * 60 + 10; m += 10) {
    const now = new Date(`${date}T00:00:00Z`);
    now.setUTCMinutes(m - 60); // village time minus one hour of BST
    const t0 = performance.now();
    const n0 = netMs;
    const res = await runTick(env, now, { store, ai, openrouterKey: key });
    const wall = performance.now() - t0;
    const js = wall - (netMs - n0);
    if (res.did) {
      cpu.push({ kind: kindOf(res.did), jsMs: Number(js.toFixed(2)), wallMs: Math.round(wall) });
      console.log(
        `${date} ${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}  ${res.did}  [js ${js.toFixed(1)} ms, wall ${(wall / 1000).toFixed(1)} s]`,
      );
    }
  }
}
// The Gazette runs after the last close; keep ticking the last evening until it is out.
for (let i = 0; i < 20; i++) {
  const v = await store.get("state");
  if (!v.gazette) break;
  const last = new Date(new Date(`${FROM}T12:00:00Z`).getTime() + (DAYS - 1) * 86400000);
  const at = new Date(`${last.toISOString().slice(0, 10)}T21:55:00Z`);
  const res = await runTick(env, at, { store, ai, openrouterKey: key });
  if (res.did) console.log(`gazette  ${res.did}`);
}
const byKind = {};
for (const x of cpu) {
  byKind[x.kind] = byKind[x.kind] || [];
  byKind[x.kind].push(x.jsMs);
}
console.log("\nJS time per tick (ms: wall minus network wait; the free plan allows 10 ms of CPU):");
for (const [k, xs] of Object.entries(byKind))
  console.log(
    `  ${k.padEnd(28)} n=${xs.length} median ${xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1)} max ${Math.max(...xs).toFixed(1)}`,
  );
writeFileSync(join(STORE, "_cpu.json"), JSON.stringify(cpu, null, 2));

// ── export the trial for the repo ──
if (EXPORT || RAWDIR) {
  const files = readdirSync(STORE);
  const v = await store.get("state");
  for (const p of v.published) {
    const day = await store.get(`day:${p.day}`);
    if (EXPORT) {
      mkdirSync(EXPORT, { recursive: true });
      writeFileSync(
        join(EXPORT, `day-${String(p.day).padStart(2, "0")}.json`),
        `${JSON.stringify(day, null, 2)}\n`,
      );
    }
    if (RAWDIR) {
      const raws = files
        .filter((f) => f.startsWith(`raw__${p.day}__`))
        .map((f) => ({
          n: Number(f.split("__")[2].replace(".json", "")),
          calls: JSON.parse(readFileSync(join(STORE, f), "utf8")),
        }))
        .sort((a, b) => a.n - b.n)
        .flatMap((x) => x.calls);
      mkdirSync(RAWDIR, { recursive: true });
      writeFileSync(
        join(RAWDIR, `day-${String(p.day).padStart(2, "0")}-raw.json`),
        `${JSON.stringify({ day: p.day, date: p.date, calls: raws }, null, 2)}\n`,
      );
    }
  }
  for (const g of v.gazettes) {
    const ed = await store.get(`gazette:${g.edition}`);
    if (EXPORT)
      writeFileSync(
        join(EXPORT, `gazette-${String(g.edition).padStart(2, "0")}.json`),
        `${JSON.stringify(ed, null, 2)}\n`,
      );
  }
  if (RAWDIR) writeFileSync(join(RAWDIR, "_cpu.json"), `${JSON.stringify(cpu, null, 2)}\n`);
  console.log(`exported ${v.published.length} days and ${v.gazettes.length} gazette(s)`);
}
console.log(`ledger $${spend.totalUsd.toFixed(4)} of $${spend.capUsd ?? 2}`);
void dirname;
