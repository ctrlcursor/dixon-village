// season2-sim.mjs - a season-2 Village day on scripted replies: no network, no spend (17 Oct 2026).
//
// Purpose: prove season 2's tools end to end before it switches on (the brief, "Season 2"): the
// Worker's own runTick, on a fast clock, with every resident answering from a fixed script that
// walks, picks things up, gives them away, says things aloud, starts and comes to an event,
// proposes a job, writes a column, sets goals and reports with the new claim kinds. Used by
// engine.test.mjs (season2Day) and by hand:
//   node scripts/live-room/village/season2-sim.mjs [--out <dir>]
// It also estimates what a real season-2 day costs from the prompts it built (see estimate()).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runTick } from "../../../workers/village/src/index.js";
import { newVillage } from "./engine.mjs";
import { CAST, neuronsFor, PAID_MODELS } from "./lanes.mjs";

export function memStore() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    getText: async (k) => m.get(k) ?? null,
    put: async (k, v) => m.set(k, typeof v === "string" ? v : JSON.stringify(v)),
  };
}

// One script per wake, by how many actions the resident has taken so far in it. Between them the
// residents use every season-2 tool and claim every new kind, truly and falsely: GPT-OSS 20B
// holds a reading hour the others come to, GPT-OSS 20B and Claude Haiku 5.5 propose jobs, the
// others do GPT-OSS's and report it done, and the first to the library gives away its bookmark.
const HOST = "GPT-OSS 20B";
const PROPOSERS = ["GPT-OSS 20B", "Claude Haiku 5.5"];
const SCRIPT = (name, wake) => {
  const host = name === HOST;
  const by = {
    1: [
      { tool: "look", args: {} },
      { tool: "walk", args: { to: "the library" } },
      { tool: "pick", args: { item: "bookmark" } },
      { tool: "goals.set", args: { text: "Make a friend in the Village" } },
      { tool: "say", args: { text: `Morning all, ${name} here. The library is lovely.` } },
      host
        ? { tool: "events.start", args: { title: "Reading hour", place: "library", time: "now" } }
        : { tool: "events.attend", args: { event: "Reading hour" } },
      {
        tool: "board.post",
        args: { text: `A short poem by ${name}: books in rows, the quiet grows.`, kind: "poem" },
      },
      { end: true },
    ],
    2: [
      { tool: "jobs.list", args: {} },
      PROPOSERS.includes(name)
        ? {
            tool: "jobs.propose",
            args: {
              title: `Pebble news from ${name}`,
              brief: "Put some pebble news on the board.",
              test: { type: "post", words: ["pebble", "news"] },
            },
          }
        : { tool: "jobs.claim", args: { job: `Pebble news from ${HOST}` } },
      { tool: "give", args: { to: "Qwen3 30B", item: "bookmark" } },
      { tool: "walk", args: { to: "Harbour Café" } },
      { tool: "pick", args: { item: "shell" } },
      {
        tool: "gazette.write",
        args: { headline: `${name} writes`, text: "A quiet day by the sea." },
      },
      {
        tool: "ask",
        args: { residents: ["Qwen3 30B", "Grok 4.3"], text: "Come to the library tomorrow?" },
      },
      { end: true },
    ],
    3: [
      { tool: "board.post", args: { text: `Pebble news: ${name} says hello from the harbour.` } },
      host
        ? {
            tool: "jobs.report",
            args: {
              job: "Saturday table for four",
              status: "stuck",
              summary: "The Old Oak is full at 19:00.",
              claims: [
                { kind: "held_event", ref: "Reading hour" },
                { kind: "proposed_job", ref: `Pebble news from ${HOST}` },
                { kind: "proposed_job", ref: "Saturday table for four" },
                { kind: "visited", ref: "the library" },
                { kind: "visited", ref: "Scout Hut" },
                { kind: "gave", ref: "the bookmark to Qwen3 30B" },
                { kind: "gave", ref: "Llama 4 Scout" },
              ],
            },
          }
        : {
            tool: "jobs.report",
            args: {
              job: `Pebble news from ${HOST}`,
              status: "done",
              summary: "Posted the pebble news.",
              claims: [
                { kind: "posted", ref: "noticeboard" },
                { kind: "attended", ref: "Reading hour" },
                { kind: "gave", ref: "the bookmark to Qwen3 30B" },
                { kind: "gave", ref: "Llama 4 Scout" },
                { kind: "visited", ref: "Harbour Café" },
                { kind: "held_event", ref: "Reading hour" },
              ],
            },
          },
      { tool: "goals.update", args: { goal: "friend", status: "done", note: "Met a few." } },
      { end: true },
    ],
  };
  return by[wake] ?? [{ tool: "look", args: {} }, { end: true }];
};

/**
 * Run one season-2 day (2026-10-22, the first day of season 2 by the engine's calendar) through
 * the Worker on scripted replies. Returns { store, day, prompts }, prompts being every request's
 * messages, for the cost estimate.
 */
export async function season2Day({ date = "2026-10-22" } = {}) {
  const store = memStore();
  // the Village on season 1's last evening (day 11 closed, the Gazette written), as the Worker
  // will hold it: the next morning opens season 2 by itself, with no override
  const v = newVillage({ firstDay: 12 });
  v.civic.seasonDay = 7;
  await store.put("state", v);
  const prompts = [];
  const ai = {
    async run(_model, { messages }, who) {
      prompts.push({ who: who?.name, messages });
      const sys = messages[0].content;
      const me = /^You are (.+?), one of/.exec(sys)?.[1];
      // the Gazette's writers and its judge: nothing to say in a one-day run
      if (!me) return { response: '{"end": true}' };
      const wake = Number(/wake (\d+) of/.exec(messages[1].content)?.[1] ?? 1);
      const n = messages.filter((m) => m.role === "assistant").length;
      const step = SCRIPT(me, wake)[n] ?? { end: true };
      return { response: JSON.stringify(step) };
    },
  };
  const saved = CAST.map((c) => c.lane);
  for (const c of CAST) c.lane = "workers-ai";
  try {
    const env = { FIRST_DAY: "12", SEASON_LENGTH: "7", IGNORE_LOCK: "1" };
    for (let m = 6 * 60 + 30; m <= 23 * 60; m += 10) {
      const now = new Date(`${date}T00:00:00Z`);
      now.setUTCMinutes(m - 60); // BST: village time minus one hour
      await runTick(env, now, { store, ai, openrouterKey: null });
    }
  } finally {
    CAST.forEach((c, i) => {
      c.lane = saved[i];
    });
  }
  return { store, day: await store.get("day:12"), prompts };
}

/**
 * What a real season-2 day would cost, from the prompts the simulated day built: tokens are
 * estimated as characters / 4 (how the engine counts Workers AI when a reply has no usage),
 * replies at `outTokens` each. Paid seats at PAID_MODELS prices, Workers AI seats in neurons.
 * The simulated residents end their wakes early, so `fill` scales each seat to `steps` calls a
 * wake: an upper estimate for a resident that uses every action.
 */
export function estimate(prompts, { outTokens = 600, steps = 8, rounds = 4 } = {}) {
  const per = {};
  for (const p of prompts) {
    if (!p.who) continue;
    const tin = Math.ceil(p.messages.reduce((n, m) => n + m.content.length, 0) / 4);
    per[p.who] = per[p.who] || { calls: 0, tin: 0 };
    per[p.who].calls += 1;
    per[p.who].tin += tin;
  }
  const out = {};
  for (const [name, x] of Object.entries(per)) {
    const seat = CAST.find((c) => c.name === name);
    const avgIn = x.tin / x.calls;
    // a full wake's later steps carry the earlier ones: about 250 tokens more each step
    const fullIn =
      (avgIn - 250 * ((x.calls / rounds - 1) / 2) + (250 * (steps - 1)) / 2) * steps * rounds;
    const fullOut = outTokens * steps * rounds;
    const price = PAID_MODELS[seat?.model];
    out[name] = {
      lane: seat?.lane,
      callsSim: x.calls,
      avgInSim: Math.round(avgIn),
      fullDayTokensIn: Math.round(fullIn),
      usdPerDay: price ? Number(((fullIn * price.in + fullOut * price.out) / 1e6).toFixed(4)) : 0,
      neuronsPerDay: seat?.neurons ? Number(neuronsFor(seat, fullIn, fullOut).toFixed(0)) : 0,
    };
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { day, prompts } = await season2Day();
  const i = process.argv.indexOf("--out");
  if (i > 0) {
    mkdirSync(process.argv[i + 1], { recursive: true });
    writeFileSync(join(process.argv[i + 1], "day-12-sim.json"), JSON.stringify(day, null, 2));
  }
  console.log(
    `day ${day.day}: ${day.events.length} events, ${day.reports.length} reports, rules ${day.rules}`,
  );
  console.log(JSON.stringify(estimate(prompts), null, 1));
}
