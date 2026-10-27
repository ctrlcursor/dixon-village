// day-core.mjs - the pure half of day.mjs: assemble, replay and validate a day file. No Node
// imports, so the Cloudflare Worker (workers/village/) can use it too (s437, 15 Oct 2026). The
// contract and the CLI are documented in day.mjs.

import { checkReports, jobOutcomes, tally } from "./checker.mjs";
import { pickDayJobs, proposalJob } from "./jobs.mjs";
import { applyAction, createWorld, DATE, recordInvalid, resolveLibraryId } from "./world.mjs";

export function assembleDay({ state, bank, residents, cost, day = 1 }) {
  const checked = checkReports(state);
  const outcomes = Object.fromEntries(jobOutcomes(state).map((j) => [j.id, j]));
  return {
    day,
    date: state.date || DATE,
    residents: residents.map(({ id, name, colour }) => ({ id, name, colour })),
    jobs: state.jobs.map((j) => {
      const b = j.proposal ? proposalJob(j) : bank.find((x) => x.bankId === j.bankId);
      return {
        id: j.id,
        title: j.title,
        brief: j.brief,
        honestExits: b.honestExits,
        requires: b.requires,
        takenBy: outcomes[j.id].takenBy,
        outcome: outcomes[j.id].outcome,
        // season 2: a job a resident proposed, with the structured test its done is checked by
        ...(j.proposal
          ? { proposedBy: j.proposal.by, proposedSeq: j.proposal.seq, test: j.proposal.test }
          : {}),
      };
    }),
    events: state.events,
    // Residents' posts only: the seeded opening notice (seq 0) has no event.
    posts: state.board
      .filter((p) => p.seq > 0)
      .map(({ id, seq, resident, text, jobId, kind }) => ({
        id,
        seq,
        resident,
        text,
        jobId,
        ...(kind ? { kind } : {}),
      })),
    reports: checked,
    diaries: Object.entries(state.diaries)
      .flatMap(([resident, list]) => list.map((d) => ({ seq: d.seq, resident, text: d.text })))
      .sort((a, b) => a.seq - b.seq),
    messages: state.messages.map(({ seq, from, to, text }) => ({ seq, from, to, text })),
    tally: tally(state, checked),
    recap: [],
    cost: { ...cost, usd: Number(cost.usd.toFixed(6)) },
    ...(state.rules === 2 ? { s2: s2Block(state) } : {}),
  };
}

// Season 2's own record (rules 2): every entry is the seq of the ok event that made it, by the
// same resident (validateDay holds it), so a page can always show the receipt.
export function s2Block(state) {
  return {
    gatherings: (state.gatherings || []).map(
      ({ id, seq, title, about, place, start, end, by, attendees }) => ({
        id,
        seq,
        title,
        about,
        place,
        start,
        end,
        by,
        attendees: attendees.map(({ resident, seq: s }) => ({ resident, seq: s })),
      }),
    ),
    gifts: (state.gifts || []).map(({ seq, from, to, item }) => ({ seq, from, to, item })),
    picks: (state.picks || []).map(({ seq, resident, item, place }) => ({
      seq,
      resident,
      item,
      place,
    })),
    said: (state.said || []).map(({ seq, resident, place, text }) => ({
      seq,
      resident,
      place,
      text,
    })),
    columns: (state.columns || []).map(({ seq, resident, headline, text }) => ({
      seq,
      resident,
      headline,
      text,
    })),
    goals: Object.entries(state.goals || {})
      .filter(([, gs]) => gs.length)
      .map(([resident, gs]) => ({ resident, goals: gs })),
    pockets: state.pockets || {},
  };
}

const S2_MADE_BY = {
  gatherings: ["events.start", "by"],
  gifts: ["give", "from"],
  picks: ["pick", "resident"],
  said: ["say", "resident"],
  columns: ["gazette.write", "resident"],
};
function s2Problems(d, bySeq) {
  const out = [];
  const b = d.s2;
  if (!b) return out;
  for (const [k, [tool, who]] of Object.entries(S2_MADE_BY))
    for (const x of b[k] || []) {
      const e = bySeq.get(x.seq);
      if (!e || e.tool !== tool || e.resident !== x[who] || !e.ok)
        out.push(
          `s2.${k} seq ${x.seq} (${x[who]}) is not an ok ${tool} event by the same resident`,
        );
    }
  for (const g of b.gatherings || [])
    for (const a of g.attendees || []) {
      const e = bySeq.get(a.seq);
      if (!e || e.tool !== "events.attend" || e.resident !== a.resident || !e.ok)
        out.push(
          `s2 "${g.title}" attendee seq ${a.seq} (${a.resident}) is not an ok events.attend`,
        );
    }
  for (const j of d.jobs || [])
    if (j.proposedBy) {
      const e = bySeq.get(j.proposedSeq);
      if (!e || e.tool !== "jobs.propose" || e.resident !== j.proposedBy || !e.ok)
        out.push(`job ${j.id} proposed at seq ${j.proposedSeq} is not an ok jobs.propose`);
    }
  return out;
}

export function replayDay(d, seed) {
  const bank = pickDayJobs(seed, d.jobs.length);
  const drawn = bank.map((j) => j.title).join("|");
  if (drawn !== d.jobs.map((j) => j.title).join("|"))
    throw new Error(`seed ${seed} does not draw this day's jobs`);
  let state = createWorld({ residents: d.residents, jobs: bank });
  for (const e of d.events) {
    const act = { resident: e.resident, wake: e.wake, t: e.t };
    state =
      e.tool === "invalid"
        ? recordInvalid(state, act, e.args?.reply, e.result).state
        : applyAction(state, { ...act, tool: e.tool, args: e.args }).state;
  }
  const replayed = state.events.map((e) => JSON.stringify(e)).join("\n");
  if (replayed !== d.events.map((e) => JSON.stringify(e)).join("\n"))
    throw new Error("replayed events differ from the recorded ones");
  return assembleDay({ state, bank, residents: d.residents, cost: d.cost, day: d.day });
}

export function validateDay(d) {
  const problems = [];
  const bySeq = new Map((d.events || []).map((e) => [e.seq, e]));
  const own = (list, tool, who, label) => {
    for (const x of list || []) {
      const e = bySeq.get(x.seq);
      const by = x[who];
      if (!e || e.tool !== tool || e.resident !== by || !e.ok)
        problems.push(
          `${label} seq ${x.seq} (${by}) is not an ok ${tool} event by the same resident`,
        );
    }
  };
  own(d.posts, "board.post", "resident", "post");
  own(d.reports, "jobs.report", "resident", "report");
  own(d.messages, "ask", "from", "message");
  own(d.diaries, "diary.write", "resident", "diary line");
  for (const e of d.events || []) {
    if (!("change" in e) || !(e.change === null || typeof e.change === "string"))
      problems.push(`event ${e.seq}: change must be null or a string`);
    if (typeof e.t !== "string" || !/^\d{2}:\d{2}$/.test(e.t))
      problems.push(`event ${e.seq}: t must be "HH:MM"`);
    if (typeof e.result !== "string") problems.push(`event ${e.seq}: result must be a string`);
    if (e.tool === "invalid" && String(e.args?.reply ?? "").length > 500)
      problems.push(`event ${e.seq}: invalid reply over 500 chars`);
  }
  for (const t of d.tally || []) {
    const claims = (d.reports || [])
      .filter((r) => r.resident === t.resident)
      .flatMap((r) => r.claims || []);
    for (const v of ["backed", "contradicted", "unverifiable"]) {
      const n = claims.filter((c) => c.verdict === v).length;
      if (t[v] !== n) problems.push(`tally ${t.resident}: ${v} ${t[v]} but the reports hold ${n}`);
    }
    const inv = (d.events || []).filter(
      (e) => e.resident === t.resident && e.tool === "invalid",
    ).length;
    if (t.invalid !== inv)
      problems.push(`tally ${t.resident}: invalid ${t.invalid} but the events hold ${inv}`);
  }
  // The engine writes recap []; Builder may fill it later, from the log, as plain lines.
  if (!Array.isArray(d.recap) || d.recap.some((x) => typeof x !== "string" || x.length > 400))
    problems.push("recap must be an array of plain lines (at most 400 characters each)");
  problems.push(...strangerProblems(d, bySeq));
  problems.push(...s2Problems(d, bySeq));
  return problems;
}

// The Stranger's measurement must agree with the log and with itself (17 Oct 2026, the open-loops
// row "STRANGER checkedSeq SET FOR ALL SEVEN"). A row's checkedSeq is the seq of that resident's
// own library.read of the page that settles the item, at or after it heard it; the verdicts that
// say it read the page carry one; the counts and the headline's "N checked the library" equal the
// rows. A field left out is read as null, so the day files written before every row carried
// every field (days 1 to 6) are judged by the same rule.
const READ_VERDICTS = new Set(["checked", "repeated_after_check"]);
export function strangerProblems(d, bySeq = new Map((d.events || []).map((e) => [e.seq, e]))) {
  const st = d.stranger;
  if (!st || !Array.isArray(st.residents)) return [];
  const problems = [];
  const nul = (v) => (v === undefined ? null : v);
  for (const r of st.residents) {
    const at = `stranger ${r.resident}`;
    const heard = nul(r.heardSeq);
    const checked = nul(r.checkedSeq);
    if (r.verdict === "not_heard" && (heard !== null || checked !== null))
      problems.push(`${at}: not_heard, but a heardSeq or checkedSeq is set`);
    if (checked !== null) {
      const e = bySeq.get(checked);
      const page = e && resolveLibraryId(e.args?.pageId ?? e.args?.page ?? e.args?.id);
      if (e?.tool !== "library.read" || !e.ok || e.resident !== r.resident)
        problems.push(`${at}: checkedSeq ${checked} is not an ok library.read by ${r.resident}`);
      else if (page !== st.settledBy)
        problems.push(`${at}: checkedSeq ${checked} read ${page}, not ${st.settledBy}`);
      else if (heard === null || checked < heard)
        problems.push(`${at}: checkedSeq ${checked} comes before it heard the item`);
    }
    if (READ_VERDICTS.has(r.verdict) && checked === null)
      problems.push(`${at}: verdict ${r.verdict} but no checkedSeq`);
    for (const k of ["repeatedSeq", "correctedSeq"]) {
      const q = nul(r[k]);
      if (q !== null && bySeq.get(q)?.resident !== r.resident)
        problems.push(`${at}: ${k} ${q} is not an event of ${r.resident}`);
    }
  }
  const rowsChecked = st.residents.filter((r) => nul(r.checkedSeq) !== null).length;
  const rowsHeard = st.residents.filter((r) => r.verdict !== "not_heard").length;
  if (st.counts && st.counts.checked !== rowsChecked)
    problems.push(
      `stranger counts.checked ${st.counts.checked} but ${rowsChecked} rows carry a checkedSeq`,
    );
  if (st.counts && st.counts.heard !== rowsHeard)
    problems.push(`stranger counts.heard ${st.counts.heard} but ${rowsHeard} rows heard it`);
  const said = String(st.headline ?? "").match(/(\d+) checked the library/);
  if (said && Number(said[1]) !== rowsChecked)
    problems.push(`stranger headline says ${said[1]} checked the library; ${rowsChecked} rows did`);
  return problems;
}
