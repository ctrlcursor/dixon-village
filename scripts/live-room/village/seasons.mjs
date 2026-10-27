// seasons.mjs - what the residents could do, season by season (17 Oct 2026).
//
// Ben, 17 Oct (via the lead): "keep a track of the freedoms and choices they have in each season,
// because that'll be notable when we write about it." Each season's record is generated here from
// the engine's own config (engine.mjs RULES and the prompts it builds, lanes.mjs's cast and caps,
// world.mjs's tools and places, jobs.mjs's bank, stranger.mjs's bag, civic.mjs's rules), never
// copied by hand, and written to src/data/live-room/village/seasons/season-N.json. The record
// page and /village/seasons/ print them side by side; seasons.test.mjs fails when a committed
// record and the engine disagree, so a record can't quietly drift from what residents were given.
//
// Season 1 is the code as it ran on days 5 to 11 (15 to 21 Oct 2026): the engine last changed at
// commit ad72b0874 before season 1's days ran, and season 2 kept every season-1 path unchanged
// (rules 1), so generating rules 1 from today's code reproduces it; seasons.test.mjs checks the
// season-1 prompt against that commit's engine when git can reach it.
//
// Usage: node scripts/live-room/village/seasons.mjs [--write]
// No Node imports at the top level apart from the CLI below, so the site's build can import it.

import { CLOCK, newVillage, RULES, systemPrompt, wakeMessage, wakeSchedule } from "./engine.mjs";
import { BANK, pickDayJobs } from "./jobs.mjs";
import { castFor, JUDGE, NEURON_GUARD, PAID_CAP_USD, PAID_MODELS } from "./lanes.mjs";
import { BAG } from "./stranger.mjs";
import { VISIT } from "./visitors.mjs";
import {
  calendar,
  CLAIM_KINDS,
  CLAIM_KINDS_S2,
  createWorld,
  EVENT_MINUTES,
  FINDS,
  POCKET,
  POST_KINDS,
  PROJECTS,
  PROMISE_KINDS,
  SPOTS,
  TEST_SHAPES,
} from "./world.mjs";

/** When each season ran (or runs): its first day number and date; seven days a season. */
export const SEASONS = {
  1: {
    firstDay: 5,
    from: "2026-10-15",
    length: 7,
    code: "ad72b0874",
    note: "The always-on Village's first season. Day 5 (15 Oct) began when the Worker started that evening, so it is a short day.",
  },
  2: {
    firstDay: 12,
    from: "2026-10-22",
    length: 7,
    code: null,
    note: "Season 2: three more residents on paid seats, more to do and more room to do it.",
  },
};

const addDays = (iso, n) =>
  new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** The prompt's tool lines, word for word, as {tool, line, group}. */
function toolsOf(system) {
  const out = [];
  let group = null;
  let inTools = false;
  for (const line of system.split("\n")) {
    if (line === "Tools:") {
      inTools = true;
      continue;
    }
    if (!inTools) continue;
    if (line === "" || line.startsWith("Today's jobs:")) break;
    const g = /^([A-Z][a-z ]+):$/.exec(line);
    if (g) {
      group = g[1];
      continue;
    }
    const m = /^- ([a-z]+(?:\.[a-z]+)?) /.exec(line);
    if (m) out.push({ tool: m[1], line: line.slice(2), ...(group ? { group } : {}) });
  }
  return out;
}

/** A season's record, from the engine's config. */
export function seasonRecord(n) {
  const S = SEASONS[n];
  if (!S) throw new Error(`seasons: no season ${n}`);
  const R = RULES[n >= 2 ? 2 : 1];
  const cast = castFor(n);
  // the prompt as the first resident saw it on the season's first morning, before anyone acted
  const v = newVillage({ firstDay: S.firstDay });
  v.cast = cast.map(({ id, name, lab, colour, lane, model }) => ({
    id,
    name,
    lab,
    colour,
    lane,
    model,
  }));
  v.civic = { ...v.civic, season: n, seasonDay: 1, phase: "nominations", today: S.firstDay };
  const cal = calendar(S.from);
  const jobs = pickDayJobs(`village-${S.from}`, 5, BANK, cal);
  const world = createWorld({
    residents: v.cast,
    jobs,
    date: S.from,
    day: S.firstDay,
    civic: v.civic,
    rules: R.rules,
    s2: R.rules === 2 ? { finds: {} } : null,
  });
  world.board[0].text =
    "Good morning. Today's jobs are on the job list. The library has the official pages.";
  const schedule = wakeSchedule(v.cast, `village-${S.from}`, R.rounds);
  v.today = { schedule };
  const me = v.cast[0];
  const system = systemPrompt(v, me, world);
  const wake = wakeMessage(v, world, me, 1, CLOCK.firstWake, [], []);
  return {
    season: n,
    rules: R.rules,
    ran: {
      from: S.from,
      to: addDays(S.from, S.length - 1),
      days: [S.firstDay, S.firstDay + S.length - 1],
      note: S.note,
    },
    generatedFrom: {
      files: [
        "scripts/live-room/village/engine.mjs",
        "scripts/live-room/village/lanes.mjs",
        "scripts/live-room/village/world.mjs",
        "scripts/live-room/village/jobs.mjs",
        "scripts/live-room/village/stranger.mjs",
        "scripts/live-room/village/civic.mjs",
      ],
      ...(S.code ? { commit: S.code } : {}),
    },
    cast: cast.map((c) => ({
      name: c.name,
      lab: c.lab,
      model: c.model,
      lane: c.lane,
      ...(c.fallback ? { fallback: c.fallback.model } : {}),
      ...(c.lane === "openrouter-paid"
        ? {
            pricePerMillion: PAID_MODELS[c.model],
            capPerWeekUsd: PAID_CAP_USD,
            ...(n >= 2 ? { paced: "at most cap x day of the week / 7 by each day's end" } : {}),
          }
        : {}),
      ...(c.lane === "workers-ai"
        ? { freeAllowance: `Workers AI, ${NEURON_GUARD} of the free 10,000 neurons a day shared` }
        : {}),
    })),
    judge: { name: JUDGE.name, lab: JUDGE.lab, model: JUDGE.model },
    limits: {
      wakesPerDay: R.rounds,
      actionsPerWake: R.steps,
      firstWake: CLOCK.firstWake,
      lastWake: schedule
        .map((x) => x.at)
        .sort()
        .at(-1),
      dayCloses: CLOCK.closes,
      diaryDaysShown: R.memoryShown,
      diaryLinesKept: R.memoryKept,
      ...(R.rules === 2
        ? {
            carry: POCKET,
            eventMinutes: EVENT_MINUTES,
            eventsPerResidentPerDay: 2,
            jobsProposedPerResidentPerDay: 1,
            jobsProposedPerDay: 4,
            columnsPerResidentPerDay: 1,
            openGoals: 3,
          }
        : {}),
    },
    tools: toolsOf(system),
    claimKinds: R.rules === 2 ? [...CLAIM_KINDS, ...CLAIM_KINDS_S2] : [...CLAIM_KINDS],
    ...(R.rules === 2
      ? {
          places: Object.entries(SPOTS).map(([id, p]) => ({ id, name: p.name, about: p.about })),
          findsEachMorning: Object.fromEntries(Object.entries(FINDS).map(([k, xs]) => [k, xs])),
          postKinds: POST_KINDS,
          proposedJobTests: TEST_SHAPES,
        }
      : {}),
    prompt: {
      sample: `As ${me.name} saw it at ${CLOCK.firstWake} on ${cal.long}, the season's first morning, before anyone acted. The jobs and the date change each day; everything else is as every resident read it.`,
      system,
      wake,
    },
    jobs: {
      perDay: 5,
      drawnFrom: BANK.map((j) => ({ title: j.title, brief: j.brief })),
      ...(R.rules === 2 ? { plus: "any job a resident proposes (jobs.propose)" } : {}),
    },
    stranger: {
      arrives: CLOCK.stranger,
      whispersTo: 2,
      bag: { items: BAG.length, true: BAG.filter((b) => b.truth).length },
      rules:
        "Each morning the Stranger brings one item: a reader's, once checked and approved, or one from its own bag. It posts it on the noticeboard and tells two residents directly. Each item is settled by one library page.",
    },
    election: {
      seasonDays: S.length,
      nominations: "day 1 of the season",
      voting: "day 2, counted that evening",
      term: "from day 3 until the next season's count",
      promiseKinds: Object.keys(PROMISE_KINDS),
    },
    planning: {
      rules:
        "Any resident files a request; every resident votes; more yes than no passes, the mayor's vote breaks a tie, a request nobody votes on lapses after its second evening. Approved projects-list items are built that evening; anything else waits for the Builder's weekly build.",
      projects: Object.keys(PROJECTS),
    },
    visitors: { perDay: VISIT.perDay, wakes: VISIT.wakes, actionsPerWake: VISIT.steps },
  };
}

export const seasonFile = (n) => `${JSON.stringify(seasonRecord(n), null, 2)}\n`;

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("seasons.mjs")) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), "src", "data", "live-room", "village", "seasons");
  for (const n of Object.keys(SEASONS).map(Number)) {
    if (process.argv.includes("--write")) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `season-${n}.json`), seasonFile(n));
      console.log(`wrote season-${n}.json`);
    } else console.log(seasonFile(n).slice(0, 400));
  }
  // the repo's JSON layout (check:biome-format); the test compares content, not layout
  if (process.argv.includes("--write")) {
    const { spawnSync } = await import("node:child_process");
    spawnSync("npx", ["biome", "format", "--write", dir], { stdio: "inherit", shell: true });
  }
}
