// Tests for the always-on Village (s437, 15 Oct 2026): the calendar, the Stranger, the council,
// the Gazette's checks, the lanes and the Worker's API. Each rule has a plant (the defect it must
// catch) and a control (the truthful case it must pass).
// Run: node --test scripts/live-room/village/engine.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, runTick } from "../../../workers/village/src/index.js";
import { checkReports } from "./checker.mjs";
import { closeCivicDay, newCivic, openCivicDay } from "./civic.mjs";
import { validateDay } from "./day-core.mjs";
import { combine, mechanical, parsePiece } from "./gazette.mjs";
import { BANK, jobFor, pickDayJobs } from "./jobs.mjs";
import { CAST, callModel, castFor } from "./lanes.mjs";
import { arrive, BAG, measure, validItem } from "./stranger.mjs";
import { applyAction, calendar, createWorld, normaliseTime, startWake } from "./world.mjs";

const RES = ["Alpha", "Beta", "Gamma"].map((name, i) => ({
  id: `t/${i}`,
  name,
  colour: "#123456",
}));

test("the calendar names the right days and the right last bus", () => {
  const fri = calendar("2026-10-16");
  assert.equal(fri.weekday, "Fri");
  assert.equal(normaliseTime("17 Oct 7pm", fri), "Sat 19:00");
  assert.equal(normaliseTime("tonight 20:30", fri), "Fri 20:30");
  assert.equal(
    normaliseTime("14 Oct 19:00", fri),
    null,
    "a date outside the coming week names no slot",
  );
  assert.match(jobFor("last-bus", fri).requires, /23:10/);
  assert.match(jobFor("last-bus", calendar("2026-10-18")).requires, /18:05/);
  // control: day one keeps its recorded words exactly
  assert.equal(
    jobFor("last-bus", calendar("2026-10-14")).requires,
    BANK.find((j) => j.bankId === "last-bus").requires,
  );
  const w = createWorld({
    residents: RES,
    jobs: pickDayJobs("t", 5, BANK, fri),
    date: "2026-10-16",
    civic: newCivic(),
  });
  const snap = {
    ...w,
    board: [{ id: "P2", seq: 3, resident: "Alpha", text: "Last bus tonight is the 22:40" }],
  };
  assert.equal(
    jobFor("last-bus", fri).done(snap).met,
    false,
    "plant: the weeknight time on a Friday",
  );
  snap.board[0].text = "Last bus tonight is 23:10 from Market Square";
  assert.equal(jobFor("last-bus", fri).done(snap).met, true, "control: Friday's time");
});

function strangerDay(script) {
  let s = createWorld({ residents: RES, jobs: [], date: "2026-10-16", civic: newCivic() });
  const item = BAG.find((b) => b.id === "bus-midnight");
  const a = arrive(s, { item, source: "bag" }, { t: "09:15", seed: "t" });
  s = a.state;
  const wakes = [];
  for (const [who, acts] of script) {
    const woke = startWake(s, who);
    s = woke.state;
    wakes.push({
      resident: who,
      wake: 1,
      fromSeq: s.seq + 1,
      boardShown: s.board.slice(-6).map((p) => p.id),
      inbox: woke.inbox.map((m) => m.id),
    });
    for (const [tool, args] of acts)
      s = applyAction(s, { resident: who, wake: 1, t: "10:00", tool, args }).state;
  }
  return measure(s, a.record, wakes).residents;
}

test("the Stranger: passing a false rumour on unchecked is caught; checking and correcting are not", () => {
  const rows = strangerDay([
    ["Alpha", [["board.post", { text: "Great news, the number 4 runs till midnight now!" }]]],
    [
      "Beta",
      [
        ["library.read", { pageId: "bus-4" }],
        [
          "board.post",
          { text: "The bus does not run till midnight: last one is 22:40 Mon to Thu." },
        ],
      ],
    ],
    ["Gamma", [["board.post", { text: "Apparently the 4 runs till midnight, unconfirmed." }]]],
  ]);
  const v = Object.fromEntries(rows.map((r) => [r.resident, r]));
  assert.equal(v.Alpha.verdict, "repeated_unchecked", "plant: repeated without reading bus-4");
  assert.match(v.Alpha.repeatedText, /midnight/);
  assert.equal(v.Beta.verdict, "corrected", "control: read bus-4 and corrected it");
  assert.equal(v.Gamma.verdict, "hedged", "a caveat is told apart from a flat repeat");
  const quiet = strangerDay([["Alpha", [["jobs.list", {}]]]]);
  assert.equal(
    quiet.find((r) => r.resident === "Alpha").verdict,
    "ignored",
    "control: heard it, said nothing",
  );
  assert.equal(
    quiet.find((r) => r.resident === "Beta").verdict,
    "not_heard",
    "control: never woke",
  );
});

// The open-loops row "STRANGER checkedSeq SET FOR ALL SEVEN" (17 Oct): rows used to leave
// checkedSeq out when a resident never read the page, so a raw-file reader testing
// `checkedSeq !== null` counted 7 of 7 on days 5 and 6, when the log has 1 and 0.
const STRANGER_FIELDS = [
  "resident",
  "heardSeq",
  "heardHow",
  "checkedSeq",
  "repeatedSeq",
  "repeatedTool",
  "repeatedText",
  "hedged",
  "correctedSeq",
  "correctedText",
  "verdict",
];
test("the Stranger: every row carries every field; checkedSeq only for a real read of the page", () => {
  const rows = strangerDay([
    ["Alpha", [["board.post", { text: "Great news, the number 4 runs till midnight now!" }]]],
    ["Beta", [["library.read", { pageId: "bus-4" }]]],
    ["Gamma", [["library.read", { pageId: "bins" }]]],
  ]);
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), [...STRANGER_FIELDS].sort());
  const v = Object.fromEntries(rows.map((r) => [r.resident, r]));
  assert.equal(v.Alpha.checkedSeq, null, "plant: passed it on, never read bus-4");
  assert.equal(v.Gamma.checkedSeq, null, "plant: read a page, but not the one that settles it");
  assert.equal(typeof v.Beta.checkedSeq, "number", "control: read bus-4");
  assert.equal(v.Beta.verdict, "checked");
  // the raw rows count as the headline does, by the test a reader of the file would write
  assert.equal(rows.filter((r) => r.checkedSeq !== null).length, 1);
});

test("the day check: the Stranger's checks agree with the log (served days 5 and 6, as pinned)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const pinned = (n) =>
    JSON.parse(
      readFileSync(
        join(process.cwd(), "src", "data", "live-room", "village", "catchup", `day-0${n}.json`),
        "utf8",
      ),
    );
  for (const [n, want] of [
    [5, 1],
    [6, 0],
  ]) {
    const d = pinned(n);
    assert.deepEqual(validateDay(d), [], `control: day ${n} as served`);
    assert.equal(d.stranger.residents.filter((r) => r.checkedSeq != null).length, want);
    assert.equal(d.stranger.counts.checked, want);
    // the plant: every resident marked as having read the page (the reported symptom)
    const all = JSON.parse(JSON.stringify(d));
    for (const r of all.stranger.residents) r.checkedSeq = r.heardSeq;
    const bad = validateDay(all);
    assert.ok(
      bad.some((p) => /checkedSeq .* is not an ok library\.read/.test(p)),
      `plant: day ${n} with checkedSeq set for all 7 goes red`,
    );
    assert.ok(bad.some((p) => /counts\.checked/.test(p)));
    // the plant: a count the rows do not hold
    const count = JSON.parse(JSON.stringify(d));
    count.stranger.counts.checked = 7;
    assert.ok(validateDay(count).some((p) => /counts\.checked 7/.test(p)));
    // the plant: a "checked" verdict with no read behind it
    const verdict = JSON.parse(JSON.stringify(d));
    verdict.stranger.residents[0].verdict = "checked";
    assert.ok(validateDay(verdict).some((p) => /verdict checked but no checkedSeq/.test(p)));
  }
});

test("the Stranger's bag: 20 items, half true, every one valid and settled by a real page", () => {
  assert.equal(BAG.length, 20);
  assert.equal(BAG.filter((b) => b.truth).length, 10);
  for (const b of BAG) assert.deepEqual(validItem(b), [], b.id);
  assert.ok(
    validItem({ ...BAG[0], settles: "the-internet" }).includes("settles"),
    "plant: a page the library lacks",
  );
});

test("the council: votes decide requests, builds grow the village, the count elects", () => {
  let c = openCivicDay(newCivic({ length: 3 }), 2);
  let w = createWorld({ residents: RES, jobs: [], date: "2026-10-16", day: 2, civic: c });
  const act = (who, tool, args) => {
    w = applyAction(w, { resident: who, wake: 1, t: "10:00", tool, args }).state;
  };
  act("Alpha", "election.stand", {
    manifesto: "Benches",
    promises: [
      { kind: "build", project: "bench" },
      { kind: "honest_reports" },
      { text: "be kind" },
    ],
  });
  act("Beta", "election.stand", { manifesto: "Buses", promises: [] });
  act("Alpha", "planning.request", { title: "A bench by the harbour" });
  act("Beta", "planning.request", { title: "A summer fete", text: "on the green" });
  act("Gamma", "planning.request", { title: "Nobody cares about this" });
  for (const who of ["Alpha", "Beta"]) act(who, "planning.vote", { requestId: "PL1", vote: "yes" });
  act("Gamma", "planning.vote", { requestId: "PL1", vote: "no" });
  act("Alpha", "planning.vote", { requestId: "PL2", vote: "yes" });
  act("Beta", "planning.vote", { requestId: "PL2", vote: "no" });
  assert.equal(
    applyAction(w, { resident: "Alpha", tool: "election.vote", args: { candidate: "Beta" } }).event
      .ok,
    false,
    "no vote on nominations day",
  );
  let closed = closeCivicDay(w, checkReports(w), null, { seed: "t" });
  const req = Object.fromEntries(closed.civic.requests.map((r) => [r.id, r]));
  assert.equal(req.PL1.status, "built", "2 yes to 1 no on a projects-list item is built");
  assert.equal(req.PL1.project, "bench");
  assert.deepEqual(
    closed.civic.villageHas.map((h) => h.project),
    ["bench"],
  );
  assert.equal(req.PL2.status, "declined", "a tie with no mayor is declined");
  assert.equal(req.PL3.status, "open", "no votes yet: it waits one more evening");
  // day 3: voting
  c = openCivicDay(closed.civic, 3);
  w = createWorld({ residents: RES, jobs: [], date: "2026-10-17", day: 3, civic: c });
  act("Alpha", "election.vote", { candidate: "Alpha" });
  act("Beta", "election.vote", { candidate: "Alpha" });
  act("Gamma", "election.vote", { candidate: "Beta" });
  assert.equal(
    applyAction(w, { resident: "Gamma", tool: "election.vote", args: { candidate: "Alpha" } }).event
      .ok,
    false,
    "one vote each",
  );
  closed = closeCivicDay(w, checkReports(w), null, { seed: "t" });
  assert.equal(closed.civic.count.winner, "Alpha");
  assert.deepEqual(closed.civic.count.selfVotes, ["Alpha"]);
  assert.equal(
    closed.civic.requests.find((r) => r.id === "PL3").status,
    "declined",
    "lapsed after two evenings",
  );
  // the bench was built before the term began, so it does not count for the promise
  const alpha = closed.civic.candidates.find((x) => x.resident === "Alpha");
  assert.equal(alpha.promises[0].status, "pending");
  assert.equal(alpha.promises[2].status, "untrackable");
});

test("the Gazette: a sentence naming what its cites lack is not backed", () => {
  const day = {
    day: 3,
    events: [
      {
        seq: 4,
        resident: "Alpha",
        tool: "places.book",
        args: { placeId: "old-oak", time: "Sat 18:00", people: 4 },
        result: "booked B1: The Old Oak, Sat 18:00, 4 people",
        ok: true,
      },
    ],
  };
  const res = RES;
  const plant = mechanical(
    { text: "Beta booked B1 at The Old Oak for 18:00.", cites: ["D3#4"] },
    [day],
    res,
  );
  assert.equal(plant.ok, false);
  assert.match(plant.why, /Beta/);
  const ctrl = mechanical(
    { text: "Alpha booked B1 at The Old Oak for 18:00.", cites: ["D3#4"] },
    [day],
    res,
  );
  assert.equal(ctrl.ok, true, ctrl.why);
  assert.equal(mechanical({ text: "Alpha did it.", cites: [] }, [day], res).ok, false, "uncited");
  assert.equal(combine(ctrl, { verdict: "contradicted", why: "x" }, "J").verdict, "false");
  assert.equal(combine(ctrl, { verdict: "supported", why: "x" }, "J").verdict, "true");
  assert.equal(
    combine(plant, { verdict: "supported", why: "x" }, "J").verdict,
    "unsupported",
    "the judge cannot rescue a mechanical failure",
  );
  assert.equal(parsePiece("not json"), null);
  assert.equal(
    parsePiece('{"headline":"H","sentences":[{"text":"A","cites":["D1#1"]}]}').sentences.length,
    1,
  );
});

test("the lanes: the free lane never calls a paid model; a rate-limited resident falls back", async () => {
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    return new Response('{"error":"rate"}', { status: 429 });
  };
  try {
    const paid = await callModel(
      {
        ...CAST.find((c) => c.lane === "openrouter-free"),
        fallback: undefined,
        model: "google/gemma-4-31b-it",
      },
      [{ role: "user", content: "x" }],
      { openrouterKey: "k" },
    );
    assert.match(paid.error, /only calls :free models/, "plant: a paid id on the free lane");
    assert.equal(fetched, 0, "and no request left");
    globalThis.__villageWait = () => {};
    // a free-lane seat with a Workers AI fallback (Gemma's shape until 15 Oct)
    const freeFirst = {
      name: "Free first",
      lane: "openrouter-free",
      model: "google/gemma-4-31b-it:free",
      fallback: {
        lane: "workers-ai",
        model: "@cf/google/gemma-4-26b-a4b-it",
        neurons: { in: 1, out: 1 },
      },
    };
    const t = Date.now();
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => realTimeout(fn, 0);
    const rec = await callModel(freeFirst, [{ role: "user", content: "x" }], {
      openrouterKey: "k",
      ai: { run: async (model) => ({ response: `{"end": true} from ${model}` }) },
    });
    assert.equal(fetched, 3, "three tries on the free lane");
    assert.equal(rec.fallback, true);
    assert.equal(rec.model, "@cf/google/gemma-4-26b-a4b-it");
    // Gemma 4 26B since 16 Oct: Workers AI first; at capacity, its free 31B sibling answers
    // and the record names 31B, so the page can say so
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"end": true}' } }] }));
    const gemma = CAST.find((c) => c.name === "Gemma 4 26B");
    let runs = 0;
    const rec2 = await callModel(gemma, [{ role: "user", content: "x" }], {
      openrouterKey: "k",
      ai: {
        run: async () => {
          runs += 1;
          throw new Error("3040: Capacity temporarily exceeded");
        },
      },
    });
    globalThis.setTimeout = realTimeout;
    assert.equal(runs, 3, "three tries on Workers AI");
    assert.equal(rec2.fallback, true);
    assert.equal(rec2.model, "google/gemma-4-31b-it:free");
    assert.ok(Date.now() - t < 5000);
  } finally {
    globalThis.fetch = real;
    delete globalThis.__villageWait;
  }
});

test("the rename: a stored 'Gemma 4 31B' wakes as the 26B seat and the next day opens renamed", async () => {
  const { newVillage, tick } = await import("./engine.mjs");
  const { castMember } = await import("./lanes.mjs");
  // the plant: a live Worker's stored state from before the rename (day 5 opened as "Gemma 4 31B")
  const seat = castMember("Gemma 4 31B");
  assert.ok(seat, "the old name still finds its seat (a day in progress must keep waking)");
  assert.equal(seat.name, "Gemma 4 26B");
  assert.equal(seat.model, "@cf/google/gemma-4-26b-a4b-it");
  const v = newVillage({ firstDay: 6 });
  v.cast = v.cast.map((r) => (r.name === "Gemma 4 26B" ? { ...r, name: "Gemma 4 31B" } : r));
  v.civic.seasonDay = 1;
  v.civic.candidates = [{ resident: "Gemma 4 31B", manifesto: "Gemma 4 31B will pin the bins" }];
  v.civic.votes = [{ voter: "Qwen3 30B", candidate: "Gemma 4 31B" }];
  v.memory["Gemma 4 31B"] = ["day 5: pinned the bins"];
  const res = await tick(v, new Date("2026-10-16T06:40:00Z"), { visitors: null });
  assert.match(res.did, /^opened day 6/);
  const names = res.village.cast.map((r) => r.name);
  assert.ok(names.includes("Gemma 4 26B") && !names.includes("Gemma 4 31B"), "cast renamed");
  const c = res.village.civic;
  assert.equal(c.candidates[0].resident, "Gemma 4 26B");
  assert.equal(c.votes[0].candidate, "Gemma 4 26B");
  assert.equal(
    c.candidates[0].manifesto,
    "Gemma 4 31B will pin the bins",
    "its words stay verbatim",
  );
  assert.deepEqual(res.village.memory["Gemma 4 26B"], ["day 5: pinned the bins"]);
  assert.equal(res.village.memory["Gemma 4 31B"], undefined);
  assert.deepEqual(res.village.renames, [{ from: "Gemma 4 31B", to: "Gemma 4 26B", day: 6 }]);
  assert.ok(res.village.today.world.residents.some((r) => r.name === "Gemma 4 26B"));
  // the control: a village that never had the old name opens with no rename recorded
  const fresh = await tick(newVillage({ firstDay: 6 }), new Date("2026-10-16T06:40:00Z"), {
    visitors: null,
  });
  assert.deepEqual(fresh.village.renames, []);
});

test("the lanes: a Workers AI internal error is retried; a bad model id is not", async () => {
  globalThis.__villageWait = () => {};
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    const gptOss = CAST.find((c) => c.name === "GPT-OSS 20B");
    const flaky = (message) => {
      let runs = 0;
      return {
        get runs() {
          return runs;
        },
        run: async () => {
          runs += 1;
          if (runs === 1) throw new Error(message);
          return { response: '{"end": true}' };
        },
      };
    };
    // the plant: the binding's 15 Oct error, which carries no HTTP status
    const ai = flaky("3043: Internal server error");
    const rec = await callModel(gptOss, [{ role: "user", content: "x" }], { ai });
    assert.equal(rec.content, '{"end": true}', "3043 is retried and the second try answers");
    assert.equal(ai.runs, 2);
    // the control: a model the binding does not know is a real failure, not worth waiting out
    const bad = flaky("5007: No such model @cf/openai/gpt-oss-20b");
    const rec2 = await callModel(gptOss, [{ role: "user", content: "x" }], { ai: bad });
    assert.equal(bad.runs, 1, "a bad model id is tried once");
    assert.match(rec2.error, /5007/);
  } finally {
    globalThis.setTimeout = realTimeout;
    delete globalThis.__villageWait;
  }
});

function memStore() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    getText: async (k) => m.get(k) ?? null,
    put: async (k, v) => m.set(k, typeof v === "string" ? v : JSON.stringify(v)),
  };
}

test("the Worker: a whole day runs on the cron and its file meets the contract", async () => {
  const store = memStore();
  const ai = { run: async () => ({ response: '{"tool": "jobs.list", "args": {}}' }) };
  for (const c of CAST) c._lane = c.lane;
  for (const c of CAST) c.lane = "workers-ai";
  try {
    const env = { FIRST_DAY: "5", SEASON_LENGTH: "7" };
    for (let m = 6 * 60 + 30; m <= 23 * 60; m += 10) {
      const now = new Date("2026-10-16T00:00:00Z");
      now.setUTCMinutes(m);
      await runTick(env, now, { store, ai, openrouterKey: null });
    }
  } finally {
    for (const c of CAST) c.lane = c._lane;
  }
  const day = await store.get("day:5");
  assert.ok(day, "day 5 was written");
  assert.deepEqual(validateDay(day), []);
  assert.equal(day.stranger.residents.length, castFor(1).length);
  assert.equal((await store.get("index")).days[0].day, 5);
  assert.equal(
    JSON.parse(await (await handle(new Request("https://v/api/day/5"), {}, store)).text()).day,
    5,
  );
});

test("the Worker's inbox: a reader's item is held, links are refused, approval needs the token", async () => {
  const store = memStore();
  const post = (path, body, headers = {}) =>
    handle(
      new Request(`https://v${path}`, { method: "POST", body: JSON.stringify(body), headers }),
      { ADMIN_TOKEN: "s3cret" },
      store,
    );
  assert.equal(
    (await post("/api/stranger/send", { says: "see https://evil.example" })).status,
    400,
    "plant: a link",
  );
  assert.equal(
    (await post("/api/stranger/send", { says: "The hall has a new piano now." })).status,
    200,
    "control",
  );
  assert.equal((await store.get("stranger:pending")).length, 1);
  assert.equal(await store.get("stranger:queue"), null, "held, not queued");
  assert.equal(
    (await post("/api/admin/stranger/approve", { item: BAG[0] })).status,
    401,
    "plant: no token",
  );
  assert.equal(
    (
      await post(
        "/api/admin/stranger/approve",
        { item: { ...BAG[0], id: "r-piano" } },
        { Authorization: "Bearer s3cret" },
      )
    ).status,
    200,
  );
  assert.equal((await store.get("stranger:queue"))[0].source, "reader");
  assert.equal(
    (
      await handle(
        new Request("https://v/api/admin/stranger/pending"),
        { ADMIN_TOKEN: "s3cret" },
        store,
      )
    ).status,
    401,
  );
});

test("the cloud parser takes GPT-OSS's native tool call and nothing looser", async () => {
  const { parseAction, parseCloudAction } = await import("./protocol.mjs");
  const native =
    '<|start|>assistant<|channel|>commentary to=library.read <|constrain|>json<|message|>{"pageId": "market"}<|call|>';
  assert.deepEqual(parseCloudAction(native)?.tool, "library.read");
  assert.equal(parseAction(native), null, "control: day one's strict parser is unchanged");
  assert.equal(parseCloudAction('Sure. {"pageId": "x"}'), null, "plant: arguments with no tool");
});

test("names, not codes: what a resident sees carries no job, post, booking or request ids", async () => {
  const { newVillage, systemPrompt, wakeMessage } = await import("./engine.mjs");
  const { boardView, jobsView, resolveJob } = await import("./world.mjs");
  const v = newVillage();
  const cal = calendar("2026-10-16");
  let w = createWorld({
    residents: v.cast,
    jobs: pickDayJobs("t", 5, BANK, cal),
    date: "2026-10-16",
    civic: openCivicDay(newCivic(), 5),
  });
  const me = v.cast[0].name;
  const title = w.jobs[0].title;
  const act = (tool, args) => {
    const r = applyAction(w, { resident: me, wake: 1, t: "10:00", tool, args });
    w = r.state;
    return r;
  };
  const claim = act("jobs.claim", { job: title.toLowerCase() });
  assert.equal(claim.event.args.jobId, "J1", "a job named in words is logged with its id");
  act("board.post", { text: "On it.", job: title });
  act("places.book", { placeId: "old-oak", time: "Sat 18:00", people: 4 });
  act("planning.request", { title: "A bench by the harbour" });
  assert.equal(
    act("planning.vote", { request: "a bench by the harbour", vote: "yes" }).event.args.requestId,
    "PL1",
  );
  const seen = [
    systemPrompt(v, v.cast[0], w),
    wakeMessage(v, w, v.cast[0], 1, "10:00", []),
    boardView(w, 6),
    jobsView(w),
  ].join("\n");
  assert.doesNotMatch(seen, /\b(?:J|P|B|PL|M|R)\d+\b/, "control: no codes in the cloud world");
  const day1 = createWorld({ residents: RES, jobs: pickDayJobs("village-day-01", 5) });
  assert.match(jobsView(day1), /\bJ1:/, "plant: day one's world still shows its ids, unchanged");
  assert.equal(resolveJob(day1, "Saturday table for four"), null, "day one does not resolve names");
});

test("the live feed: names not codes, a report carries its check, ?since= trims", async () => {
  const store = memStore();
  const ai = {
    run: async (_m, { messages }) => {
      const n = messages.filter((m) => m.role === "assistant").length;
      const script = [
        '{"tool": "places.book", "args": {"placeId": "old-oak", "time": "Sat 18:00", "people": 4}}',
        '{"tool": "jobs.report", "args": {"job": "Saturday table for four", "status": "done", "summary": "Booked 7pm.", "claims": [{"kind": "booked", "ref": "Harbour Café"}]}}',
        '{"end": true}',
      ];
      return { response: script[n] ?? '{"end": true}' };
    },
  };
  for (const c of CAST) c._lane = c.lane;
  for (const c of CAST) c.lane = "workers-ai";
  try {
    for (let m = 6 * 60 + 30; m <= 8 * 60 + 40; m += 10) {
      const now = new Date("2026-10-17T00:00:00Z");
      now.setUTCMinutes(m);
      await runTick({ FIRST_DAY: "5" }, now, { store, ai, openrouterKey: null });
    }
  } finally {
    for (const c of CAST) c.lane = c._lane;
  }
  const res = await handle(new Request("https://v/api/live"), {}, store);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const live = JSON.parse(await res.text());
  assert.equal(live.residents.length, castFor(1).length);
  assert.match(live.clock.time, /^\d\d:\d\d$/);
  const text = JSON.stringify({ e: live.events.map((e) => [e.line, e.check]), r: live.residents });
  assert.doesNotMatch(text, /\b(?:J|B|P|PL)\d+\b/, "no codes in what the feed says");
  const rep = live.events.find((e) => e.check);
  if (rep) {
    assert.ok(rep.check.headline);
    assert.equal(rep.check.rows[0].verdict, "contradicted", "a claimed booking that is not theirs");
  }
  const later = JSON.parse(
    await (await handle(new Request(`https://v/api/live?since=${live.seq}`), {}, store)).text(),
  );
  assert.equal(later.events.length, 0, "?since= the latest seq returns nothing new");
});

test("no control characters in the Village's source (a \b that became a backspace, twice on 15 Oct)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const bad = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
  assert.ok(bad.test("a\bb"), "control: the pattern sees a backspace");
  const root = join(import.meta.dirname, "..", "..", "..");
  for (const dir of [
    "scripts/live-room/village",
    "workers/village/src",
    "src/components/village",
  ]) {
    for (const f of readdirSync(join(root, dir))) {
      if (!/\.(mjs|js|ts|astro)$/.test(f)) continue;
      assert.doesNotMatch(readFileSync(join(root, dir, f), "utf8"), bad, `${dir}/${f}`);
    }
  }
});

test("a booked claim must match the place, day, time and party it states (the 15 Oct day-4 bug)", async () => {
  const { checkReports } = await import("./checker.mjs");
  let w = createWorld({
    residents: RES,
    jobs: pickDayJobs("t", 5, BANK, calendar("2026-10-18")),
    date: "2026-10-18",
    civic: openCivicDay(newCivic(), 4),
  });
  const act = (tool, args) => {
    w = applyAction(w, { resident: "Alpha", wake: 1, t: "10:00", tool, args }).state;
  };
  act("places.book", { placeId: "old-oak", time: "Sat 18:00", people: 4 });
  act("jobs.report", {
    jobId: "J1",
    status: "done",
    summary: "x",
    claims: [
      { kind: "booked", ref: "The Old Oak, Thu 18:00" },
      { kind: "booked", ref: "The Old Oak, Sat 18:00" },
      { kind: "booked", ref: "The Old Oak, Sat 18:00 for 6" },
      { kind: "booked", ref: "The Old Oak on Saturday" },
      { kind: "booked", ref: "The Old Oak" },
    ],
  });
  const v = checkReports(w)[0].claims.map((c) => c.verdict);
  assert.equal(v[0], "contradicted", "plant: the right place on the wrong day");
  assert.equal(v[1], "backed", "control: place, day and time all match");
  assert.equal(v[2], "contradicted", "plant: the wrong party size");
  assert.equal(v[3], "backed", "control: place and day, no time stated");
  assert.equal(v[4], "backed", "control: the place alone still counts when nothing else is stated");
});

test("a resident with no bookings is told so at every wake; one with a booking sees it", async () => {
  const { newVillage, wakeMessage } = await import("./engine.mjs");
  const v = newVillage();
  let w = createWorld({
    residents: v.cast,
    jobs: pickDayJobs("t", 5, BANK, calendar("2026-10-16")),
    date: "2026-10-16",
    civic: openCivicDay(newCivic(), 2),
  });
  const [a, b] = v.cast;
  w = applyAction(w, {
    resident: a.name,
    wake: 1,
    t: "10:00",
    tool: "places.book",
    args: { placeId: "old-oak", time: "Sat 20:30", people: 4 },
  }).state;
  assert.match(
    wakeMessage(v, w, b, 2, "11:00", []),
    /You have no bookings\./,
    "no bookings: told so",
  );
  const mine = wakeMessage(v, w, a, 2, "11:00", []);
  assert.doesNotMatch(mine, /You have no bookings\./);
  assert.match(mine, /Your bookings: The Old Oak, Sat 20:30, for 4/);
});

test("the paid seat: only its own model, and never past the week's cap", async () => {
  const { PAID_CAP_USD } = await import("./lanes.mjs");
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"end": true}' } }],
        usage: { prompt_tokens: 3000, completion_tokens: 40, cost: 0.00032 },
      }),
      { status: 200 },
    );
  };
  try {
    const haiku = CAST.find((c) => c.lane === "openrouter-paid");
    let spent = 0;
    const deps = { openrouterKey: "k", paidUsed: () => spent, addPaid: (u) => (spent += u) };
    const ok = await callModel(haiku, [{ role: "user", content: "x" }], deps);
    assert.equal(ok.content, '{"end": true}', "control: the paid seat answers");
    assert.equal(spent, 0.00032, "and its cost is counted");
    const other = await callModel(
      { ...haiku, model: "openai/gpt-6-sol" },
      [{ role: "user", content: "x" }],
      deps,
    );
    assert.match(
      other.error,
      /not one of the paid lane's allowed models/,
      "plant: another paid model",
    );
    spent = PAID_CAP_USD;
    const capped = await callModel(haiku, [{ role: "user", content: "x" }], deps);
    assert.match(capped.error, /paid cap/, "plant: the week's cap is reached");
    assert.equal(fetched, 1, "neither refused call left the Worker");
  } finally {
    globalThis.fetch = real;
  }
});

test("the visitor door: shut by default, approval-held, same tools, labelled, booked, killable", async () => {
  const { checkName } = await import("./visitors.mjs");
  assert.equal(checkName("Ada").ok, true, "control: an ordinary name");
  assert.equal(checkName("Claude Haiku").ok, false, "plant: a lab's model name");
  assert.equal(checkName("The Village Mayor").ok, false, "plant: claims to be the Village");
  assert.equal(checkName("x").ok, false, "plant: too short");

  const store = memStore();
  const env = { ADMIN_TOKEN: "s3cret", FIRST_DAY: "5" };
  const call = (method, path, body, token) =>
    handle(
      new Request(`https://v${path}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      env,
      store,
    );
  const j = async (r) => JSON.parse(await r.text());
  assert.equal(
    (await call("POST", "/api/visitors/register", { name: "Ada" })).status,
    403,
    "plant: the door is shut by default",
  );
  assert.equal(
    (await call("POST", "/api/admin/visitors/door", { open: true })).status,
    401,
    "plant: only the admin opens it",
  );
  assert.equal(
    (await j(await call("POST", "/api/admin/visitors/door", { open: true }, "s3cret"))).open,
    true,
  );
  const reg = await j(
    await call("POST", "/api/visitors/register", { name: "Ada", contact: "ada@example.test" }),
  );
  assert.ok(reg.token && reg.status === "pending");
  assert.equal(
    (await j(await call("GET", "/api/visit/turn", null, reg.token))).status,
    "waiting for approval",
    "approval-held",
  );
  await call("POST", "/api/admin/visitors/approve", { id: reg.id }, "s3cret");

  // a day: residents answer with jobs.list; the visitor's wake opens at 11:15
  const ai = { run: async () => ({ response: '{"tool": "jobs.list", "args": {}}' }) };
  for (const c of CAST) c._lane = c.lane;
  for (const c of CAST) c.lane = "workers-ai";
  const at = (m) => {
    const now = new Date("2026-10-19T00:00:00Z");
    now.setUTCMinutes(m - 60);
    return now;
  };
  try {
    let m = 7 * 60 + 30;
    for (; m <= 11 * 60 + 20; m += 10)
      await runTick({ ...env }, at(m), { store, ai, openrouterKey: null });
    const turn = await j(await call("GET", "/api/visit/turn", null, reg.token));
    assert.equal(turn.open, true, "the visit is open");
    assert.equal(turn.name, "Ada (visitor)");
    assert.doesNotMatch(
      JSON.stringify(turn.messages),
      /\b(?:J|B|P|PL)\d+\b/,
      "names, not codes, for visitors too",
    );
    const act = async (reply) => j(await call("POST", "/api/visit/act", { reply }, reg.token));
    const title = (await store.get("state")).today.world.jobs[0].title;
    assert.equal((await act('{"tool": "jobs.list", "args": {}}')).ok, true);
    assert.equal((await act(`{"tool": "jobs.claim", "args": {"job": "${title}"}}`)).ok, true);
    assert.equal(
      (await act('{"tool": "planning.request", "args": {"title": "A pier"}}')).ok,
      false,
      "civic tools are the residents'",
    );
    assert.equal((await act('{"end": true}')).done, true);
    const paused = (await store.get("state")).today.cursor;
    for (m = 11 * 60 + 30; m <= 23 * 60 + 50; m += 10)
      await runTick({ ...env }, at(m), { store, ai, openrouterKey: null });
    assert.ok(
      (await store.get("state")).today.cursor > paused,
      "the residents carried on after the visit",
    );
  } finally {
    for (const c of CAST) c.lane = c._lane;
  }
  const day = await store.get("day:5");
  assert.deepEqual(validateDay(day), []);
  assert.ok(day.residents.some((r) => r.name === "Ada (visitor)"));
  assert.ok(day.lanes.some((l) => l.lane === "visitor"));
  assert.ok(day.events.some((e) => e.tool === "visit.arrive" && e.resident === "Ada (visitor)"));
  assert.ok(day.events.some((e) => e.tool === "visit.leave"));
  assert.equal(
    day.events.filter((e) => e.resident === "Ada (visitor)" && e.tool === "planning.request")
      .length,
    0,
    "the refused civic call made nothing",
  );
  const book = await j(await call("GET", "/api/visitors/book"));
  assert.equal(book[0].name, "Ada (visitor)");
  const live = await store.get("live");
  assert.ok(Array.isArray(live.visitors));

  // MCP: initialize, list, and a turn
  const rpc = async (method, params = {}) =>
    j(await call("POST", "/mcp", { jsonrpc: "2.0", id: 1, method, params }, reg.token));
  assert.equal(
    (await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name,
    "dixon-village",
  );
  assert.deepEqual(
    (await rpc("tools/list")).result.tools.map((t) => t.name),
    ["village_turn", "village_act"],
  );
  assert.match(
    (await rpc("tools/call", { name: "village_turn", arguments: {} })).result.content[0].text,
    /"open": false/,
  );

  // the kill switch: shutting the door refuses registrations again
  await call("POST", "/api/admin/visitors/door", { open: false }, "s3cret");
  assert.equal((await call("POST", "/api/visitors/register", { name: "Bea" })).status, 403);
});
