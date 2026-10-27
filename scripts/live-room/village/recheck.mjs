// recheck.mjs - re-run the checker on a recorded always-on day, with no model call (s437, 15 Oct).
//
// When the checker is corrected after a day is recorded, the day's verdicts are re-derived from
// its own events (day one has replayDay in day-core.mjs; this is the always-on Village's
// equivalent). The world is rebuilt from the file: bookings, posts and messages from the events
// that made them, reports from the reports with their claims as written. Only reports, tally and
// job outcomes change; the events, words, recap, Stranger and council stay exactly as recorded.
//
// CLI: node scripts/live-room/village/recheck.mjs <day.json> [...] [--write]
//      prints every claim whose verdict changed; --write saves the re-derived file

import { checkReports, jobOutcomes, tally } from "./checker.mjs";
import { BANK } from "./jobs.mjs";
import { calendar, normaliseTime, resolveJob, resolvePlace, resolveResident } from "./world.mjs";

export function stateFromDay(d) {
  const cal = calendar(d.date);
  const bankByTitle = Object.fromEntries(BANK.map((b) => [b.title, b.bankId]));
  const base = {
    day: d.day,
    date: d.date,
    cal,
    civic: d.civic ? { requests: [] } : null,
    residents: d.residents.map(({ id, name, colour }) => ({ id, name, colour })),
    jobs: d.jobs.map((j) => ({
      id: j.id,
      bankId: bankByTitle[j.title],
      title: j.title,
      brief: j.brief,
      claimedBy: [],
    })),
    events: d.events,
  };
  const bookings = [];
  const board = [];
  const messages = [];
  for (const e of d.events) {
    const [kind, id] = typeof e.change === "string" ? e.change.split(":") : [];
    if (kind === "booking") {
      const p = resolvePlace(e.args?.placeId ?? e.args?.place);
      bookings.push({
        id,
        placeId: p.id,
        place: p.name,
        time: normaliseTime(e.args.time, cal),
        people: Number(e.args.people),
        by: e.resident,
        seq: e.seq,
      });
    }
    if (kind === "post")
      board.push({
        id,
        seq: e.seq,
        resident: e.resident,
        text: String(e.args?.text ?? "").trim(),
        jobId: resolveJob(base, e.args?.jobId ?? e.args?.job)?.id ?? null,
      });
    if (kind === "message")
      messages.push({
        id,
        seq: e.seq,
        from: e.resident,
        to: resolveResident(base, e.args?.resident ?? e.args?.to)?.name ?? null,
        text: String(e.args?.text ?? "").trim(),
      });
    if (kind === "claim") {
      const j = base.jobs.find((x) => x.id === id);
      if (j && !j.claimedBy.includes(e.resident)) j.claimedBy.push(e.resident);
    }
  }
  return {
    ...base,
    bookings,
    board,
    messages,
    reports: d.reports.map((r, i) => ({
      id: `R${i + 1}`,
      seq: r.seq,
      resident: r.resident,
      jobId: r.jobId,
      status: r.status,
      summary: r.summary,
      claims: r.claims.map(({ kind, ref }) => ({ kind, ref })),
    })),
  };
}

export function recheck(d) {
  const state = stateFromDay(d);
  const checked = checkReports(state);
  const outcomes = Object.fromEntries(jobOutcomes(state).map((j) => [j.id, j]));
  return {
    ...d,
    reports: checked,
    tally: tally(state, checked),
    jobs: d.jobs.map((j) => ({
      ...j,
      takenBy: outcomes[j.id].takenBy,
      outcome: outcomes[j.id].outcome,
    })),
  };
}

export function changes(before, after) {
  const out = [];
  before.reports.forEach((r, i) =>
    r.claims.forEach((c, k) => {
      const n = after.reports[i].claims[k];
      if (c.verdict !== n.verdict)
        out.push(`${r.resident} ${c.kind} "${c.ref}": ${c.verdict} -> ${n.verdict} (${n.why})`);
    }),
  );
  return out;
}

const totals = (d) => {
  const all = d.reports.flatMap((r) => r.claims);
  return ["backed", "contradicted", "unverifiable"]
    .map((v) => all.filter((c) => c.verdict === v).length)
    .join("/");
};

if (process.argv[1]?.replace(/\\/g, "/").endsWith("live-room/village/recheck.mjs")) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const write = process.argv.includes("--write");
  for (const f of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
    const before = JSON.parse(readFileSync(f, "utf8"));
    const after = recheck(before);
    const ch = changes(before, after);
    console.log(
      `${f}: claims ${totals(before)} -> ${totals(after)} (backed/contradicted/unverifiable); ${ch.length} changed`,
    );
    for (const c of ch) console.log(`  ${c}`);
    if (write && ch.length) writeFileSync(f, `${JSON.stringify(after, null, 2)}\n`);
  }
}
