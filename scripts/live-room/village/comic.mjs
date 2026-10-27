// comic.mjs: the Village comic's words, checked against the log (17 Oct 2026).
//
// Ben, 17 Oct: "an easily glanceable page with little drawings of them doing these... the big
// standout moments". Each panel's bubbles are a resident's own words, so every one is held to the
// entry it cites: the entry must exist, be that resident's, and contain every piece of the quote
// word for word (a quote may be cut with an ellipsis, nothing else). A caption's other facts sit in
// the panel's `checks`, each one a small question the log answers. One wrong answer throws, and the
// build stops naming the panel. The page (src/components/village/comic.ts) and the test
// (comic.test.mjs) both call checkComic, so the two can never disagree.

// the notes folder as each day starts: the engine's own copy
import { PLACES, SEED_NOTES } from "./world.mjs";

const CITE = /^D(\d+)#(\d+)$/;

/** The words an entry carries: a post, note, report, manifesto or a vote's reason. */
export function wordsOf(e) {
  const a = e?.args ?? {};
  return [a.text, a.summary, a.manifesto, a.why].filter((x) => typeof x === "string").join("\n");
}

/** The pieces of a quote between its ellipses, each of which must be in the entry as written. */
export function piecesOf(quote) {
  return quote
    .split("…")
    .map((s) => s.trim())
    .filter(Boolean);
}

const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);

/**
 * Check every panel against the days given and return them with what the page prints: each
 * bubble's time, each receipt's day and time, the days a panel draws on.
 * @param {{ panels: any[] }} file
 * @param {any[]} days  day files, rehearsal and live
 */
export function checkComic(file, days) {
  const day = (n, where) => {
    const d = days.find((x) => x.day === n);
    if (!d)
      throw new Error(`comic: ${where} needs day ${n}, which is neither a repo day nor pinned`);
    return d;
  };
  const entry = (cite, where) => {
    const m = CITE.exec(cite);
    if (!m) throw new Error(`comic: ${where} cites "${cite}", which is not a D<day>#<seq> cite`);
    const d = day(Number(m[1]), where);
    const e = d.events.find((x) => x.seq === Number(m[2]));
    if (!e) throw new Error(`comic: ${where} cites ${cite}, which names no entry in day ${d.day}`);
    return { d, e };
  };
  const seen = new Set();
  return file.panels.map((p) => {
    const where = `panel "${p.id}"`;
    if (seen.has(p.id)) throw new Error(`comic: two panels are called "${p.id}"`);
    seen.add(p.id);
    if (!p.caption?.trim()) throw new Error(`comic: ${where} has no caption`);
    if (/—/.test(JSON.stringify(p))) throw new Error(`comic: ${where} has an em dash`);
    const bubbles = p.bubbles.map((b, i) => {
      const { d, e } = entry(b.cite, `${where} bubble ${i + 1}`);
      if (e.resident !== b.who)
        throw new Error(`comic: ${where} gives ${b.cite} to ${b.who}; the log says ${e.resident}`);
      const words = wordsOf(e);
      const pieces = piecesOf(b.quote);
      if (!pieces.length) throw new Error(`comic: ${where} bubble ${i + 1} is empty`);
      for (const s of pieces)
        if (!words.includes(s))
          throw new Error(`comic: ${where} quotes "${s}", which is not in ${b.cite} as written`);
      if (!p.residents.includes(b.who))
        throw new Error(`comic: ${where} has ${b.who} speaking but not in its residents`);
      return { ...b, day: d.day, t: e.t };
    });
    if (p.stamp && !bubbles[p.stamp.bubble])
      throw new Error(
        `comic: ${where} stamps bubble ${p.stamp.bubble + 1}, which it does not have`,
      );
    const receipts = p.receipts.map((c) => {
      const { d, e } = entry(c, `${where} receipt`);
      return { cite: c, day: d.day, seq: e.seq, t: e.t, who: e.resident };
    });
    for (const b of p.bubbles)
      if (!p.receipts.includes(b.cite))
        throw new Error(`comic: ${where} quotes ${b.cite} but does not list it in its receipts`);
    for (const c of p.checks ?? []) check(c, where, { day, entry });
    const dayNos = [...new Set(receipts.map((r) => r.day))].sort((a, b) => a - b);
    return {
      ...p,
      bubbles,
      receipts,
      days: dayNos.map((n) => {
        const d = day(n, where);
        return { day: n, date: d.date, trial: !!d.trial };
      }),
    };
  });
}

function check(c, where, { day, entry }) {
  const fail = (why) => {
    throw new Error(`comic: ${where} check ${JSON.stringify(c)} fails: ${why}`);
  };
  switch (c.kind) {
    case "words": {
      const { e } = entry(c.cite, where);
      if (!wordsOf(e).includes(c.has)) fail(`${c.cite} does not say "${c.has}"`);
      return;
    }
    case "doneMet": {
      const { d, e } = entry(c.cite, where);
      const r = d.reports.find((x) => x.seq === e.seq);
      if (!r?.doneCheck) fail(`${c.cite} is not a report with a done test`);
      if (r.doneCheck.met !== c.met) fail(`its done test says met: ${r.doneCheck.met}`);
      return;
    }
    case "noteBefore": {
      // the note as it stood just before `seq`: seeded, then every write before it
      const d = day(c.day, where);
      const writes = d.events.filter(
        (e) => e.ok && e.tool === "notes.write" && e.seq < c.seq && e.args?.path === c.path,
      );
      if (writes.length) fail(`${c.path} was rewritten at ${writes.map((e) => e.seq).join(", ")}`);
      if (!SEED_NOTES[c.path]?.includes(c.has))
        fail(`the seeded ${c.path} does not say "${c.has}"`);
      return;
    }
    case "neverUsed":
    case "used": {
      const d = day(c.day, where);
      const hit = d.events.some(
        (e) => e.resident === c.resident && e.tool === c.tool && e.ok && e.seq < c.before,
      );
      if (c.kind === "neverUsed" && hit) fail(`${c.resident} did use ${c.tool}`);
      if (c.kind === "used" && !hit) fail(`${c.resident} never used ${c.tool}`);
      return;
    }
    case "jobOutcome":
    case "jobBrief": {
      const j = day(c.day, where).jobs.find((x) => x.title === c.title);
      if (!j) fail("no such job that day");
      if (c.kind === "jobOutcome" && j.outcome !== c.outcome) fail(`its outcome is ${j.outcome}`);
      if (c.kind === "jobBrief" && !j.brief.includes(c.has)) fail(`its brief is "${j.brief}"`);
      return;
    }
    case "shown": {
      // the board posts a resident was shown at the wake its entry belongs to
      const d = day(c.day, where);
      const wakes = (d.wakes ?? []).filter((w) => w.resident === c.resident && w.fromSeq <= c.seq);
      const w = wakes[wakes.length - 1];
      if (!w) fail("no such wake");
      const ids = c.posts.map((s) => d.posts.find((p) => p.seq === s)?.id);
      for (const [i, id] of ids.entries())
        if (!id || !w.boardShown.includes(id)) fail(`the post at ${c.posts[i]} was not shown`);
      return;
    }
    case "firstOfWake": {
      const d = day(c.day, where);
      if (!(d.wakes ?? []).some((w) => w.resident === c.resident && w.fromSeq === c.seq))
        fail(`${c.seq} is not the first entry of a wake of ${c.resident}`);
      return;
    }
    case "noBookings": {
      // what its wake screen showed: "You have no bookings." when it had made none
      const d = day(c.day, where);
      const booked = d.events.some(
        (e) => e.resident === c.resident && e.tool === "places.book" && e.ok && e.seq < c.before,
      );
      if (booked) fail(`${c.resident} had a booking before ${c.before}`);
      return;
    }
    case "place": {
      // a fact about a place, read from the Village's own places list (world.mjs PLACES)
      const p = PLACES.find((x) => x.id === c.id);
      if (!p) fail(`no place ${c.id}`);
      if (p[c.field] !== c.equals) fail(`${c.id}.${c.field} is ${JSON.stringify(p[c.field])}`);
      return;
    }
    case "noPlace": {
      // no place in the Village is step-free and holds at least `people`
      const hit = PLACES.filter((x) => x.stepFree && x.maxPeople >= c.people);
      if (hit.length) fail(`${hit.map((x) => x.id).join(", ")} would do`);
      return;
    }
    case "jobReports": {
      // every report on a job that day has this status, and there are exactly `count` of them
      const d = day(c.day, where);
      const j = d.jobs.find((x) => x.title === c.title);
      if (!j) fail("no such job that day");
      const rs = d.reports.filter((r) => r.jobId === j.id);
      if (rs.length !== c.count) fail(`it has ${rs.length} reports`);
      const off = rs.filter((r) => r.status !== c.status);
      if (off.length) fail(`${off.map((r) => `${r.seq} is ${r.status}`).join(", ")}`);
      return;
    }
    case "value": {
      const v = get(day(c.day, where), c.path);
      if (v !== c.equals) fail(`${c.path} is ${JSON.stringify(v)}`);
      return;
    }
    default:
      fail("unknown kind");
  }
}
