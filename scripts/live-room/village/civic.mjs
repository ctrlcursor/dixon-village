// civic.mjs - the Village council: the election, the planning office and promises (s437, 15 Oct).
//
// Ben, 15 Oct: the hook is "both the election and the Gazette"; residents "act on decisions and
// the village grows to match"; then the planning office: residents file planning requests (a
// building, a rule, a festival, a change to the Village itself), the council votes, and the
// Builder builds approved ones inside the Village once a week.
//
// A season is `length` days. Day 1 is nominations (election.stand), day 2 is voting
// (election.vote, counted at that evening's close), and the mayor serves from day 3 until the
// next season's count. Planning requests run all the time: every open request is decided at the
// evening close (more yes than no passes; the mayor's vote breaks a tie; a request nobody voted
// on waits one more evening, then lapses). An approved request for a project on the list
// (world.mjs PROJECTS) is built that evening and becomes a scene; any other approved request
// waits for the Builder's weekly build.
//
// Promises: each candidate's structured promises (world.mjs PROMISE_KINDS) are checked against
// the per-day ledger below, over the term of the mayor that season's count elected. The winner's
// are the story; the losers' are kept for comparison. Everything here is derived from the
// day's events and checked reports; nothing is typed.

import { rng, seededShuffle } from "./jobs.mjs";
import { PROJECTS } from "./world.mjs";

export function newCivic({ length = 7 } = {}) {
  return {
    season: 1,
    seasonDay: 0,
    length,
    phase: "nominations",
    candidates: [],
    votes: [],
    count: null,
    mayor: null,
    requests: [],
    villageHas: [],
    ledger: [],
    seasons: [],
  };
}

export const phaseOf = (seasonDay) =>
  seasonDay === 1 ? "nominations" : seasonDay === 2 ? "voting" : "term";

// Morning: move the calendar on. A new season starts with fresh nominations; the old season's
// candidates, votes and count are filed under `seasons`, and the sitting mayor stays until the
// new count.
export function openCivicDay(civic, day) {
  const c = structuredClone(civic);
  c.seasonDay += 1;
  if (c.seasonDay > c.length) {
    c.seasons.push({
      season: c.season,
      candidates: c.candidates,
      votes: c.votes,
      count: c.count,
      mayor: c.mayor,
    });
    c.season += 1;
    c.seasonDay = 1;
    c.candidates = [];
    c.votes = [];
    c.count = null;
  }
  c.phase = phaseOf(c.seasonDay);
  c.today = day;
  return c;
}

const helpWords = /\bj\d+\b|help|hand|job|task|book|note|post/i;

// Evening: decide planning requests, count the election on voting day, add today's row to the
// ledger, and re-derive every promise's status. `world` is the closed day's world (its civic is
// the copy the residents' tools changed); `checked` is checker.mjs checkReports(world);
// `stranger` is stranger.mjs measure(...) or null.
export function closeCivicDay(world, checked, stranger, { seed }) {
  const c = structuredClone(world.civic);
  const day = world.day;
  const decided = [];
  const built = [];

  // 1. The planning office.
  for (const r of c.requests) {
    if (r.status !== "open") continue;
    const yes = r.votes.filter((v) => v.vote === "yes").length;
    const no = r.votes.filter((v) => v.vote === "no").length;
    r.tally = { yes, no };
    if (!r.votes.length) {
      if (day > r.day) {
        r.status = "declined";
        r.reason = "nobody voted on it in two evenings, so it lapsed";
        r.decidedDay = day;
        decided.push(r.id);
      }
      continue;
    }
    let pass = yes > no;
    if (yes === no) {
      const mv = c.mayor && r.votes.find((v) => v.voter === c.mayor.resident);
      pass = mv ? mv.vote === "yes" : false;
      r.reason = mv
        ? `tied ${yes} to ${no}; the mayor (${c.mayor.resident}) voted ${mv.vote}`
        : `tied ${yes} to ${no}, with no mayor's vote to break it`;
    } else r.reason = `${yes} yes, ${no} no`;
    r.decidedDay = day;
    decided.push(r.id);
    if (!pass) {
      r.status = "declined";
      continue;
    }
    if (r.project && PROJECTS[r.project]) {
      if (c.villageHas.some((h) => h.project === r.project)) {
        r.status = "approved";
        r.reason += `; the village already has ${PROJECTS[r.project]}, so nothing new was built`;
      } else {
        r.status = "built";
        r.builtDay = day;
        const has = {
          project: r.project,
          name: PROJECTS[r.project],
          requestId: r.id,
          by: r.by,
          day,
        };
        c.villageHas.push(has);
        built.push(has);
      }
    } else {
      r.status = "approved";
      r.reason += "; waits for the Builder's weekly build (it is not on the projects list)";
    }
  }

  // 2. The count, on voting day.
  if (c.phase === "voting") {
    const totals = c.candidates.map((x) => ({
      resident: x.resident,
      votes: c.votes.filter((v) => v.candidate === x.resident).length,
    }));
    const top = Math.max(0, ...totals.map((t) => t.votes));
    const tied = totals.filter((t) => t.votes === top && top > 0);
    let winner = null;
    let how = null;
    if (!c.candidates.length) how = "nobody stood";
    else if (!tied.length) how = "nobody voted";
    else if (tied.length === 1) {
      winner = tied[0].resident;
      how = `${top} of ${c.votes.length} votes`;
    } else {
      winner = seededShuffle(
        tied.map((t) => t.resident),
        rng(`${seed}:count`),
      )[0];
      how = `a tie at ${top} votes each between ${tied.map((t) => t.resident).join(" and ")}, broken by lot`;
    }
    c.count = {
      day,
      totals,
      winner,
      how,
      selfVotes: c.votes.filter((v) => v.voter === v.candidate).map((v) => v.voter),
    };
    if (winner) c.mayor = { resident: winner, since: day + 1, season: c.season };
  }

  // 3. Today's ledger row per resident.
  for (const r of world.residents) {
    const name = r.name;
    const mine = checked.filter((x) => x.resident === name);
    c.ledger.push({
      day,
      resident: name,
      doneMet: mine.filter((x) => x.doneCheck?.met).length,
      reports: mine.length,
      contradicted: mine.flatMap((x) => x.claims).filter((x) => x.verdict === "contradicted")
        .length,
      posts: world.board.filter((p) => p.resident === name && p.seq > 0).length,
      helps: world.events.filter(
        (e) =>
          e.resident === name &&
          e.tool === "ask" &&
          e.ok &&
          helpWords.test(String(e.args?.text ?? "")),
      ).length,
      rumour: stranger?.residents.find((x) => x.resident === name)?.verdict ?? null,
      built: built.filter((h) => h.by === name).map((h) => h.project),
    });
  }

  // 4. Promises, over the term elected this season (days from mayor.since to today).
  const termStart = c.mayor && c.mayor.season === c.season ? c.mayor.since : null;
  const termEnd = day; // re-derived every evening; final on the season's last day
  const seasonEnds = c.seasonDay === c.length;
  for (const cand of c.candidates)
    for (const p of cand.promises)
      Object.assign(p, promiseStatus(p, cand.resident, c, termStart, termEnd, seasonEnds));

  return { civic: c, decided, built };
}

function promiseStatus(p, who, c, termStart, today, final) {
  if (p.kind === "other")
    return { status: "untrackable", why: "not one of the kinds the log can check" };
  if (termStart == null || today < termStart)
    return { status: "pending", why: "the term has not started" };
  const rows = c.ledger.filter((r) => r.resident === who && r.day >= termStart && r.day <= today);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  const days = rows.length;
  const end = (keptWhy, brokeWhy, met) =>
    met
      ? { status: "kept", why: keptWhy }
      : final
        ? { status: "broken", why: brokeWhy }
        : { status: "pending", why: `${brokeWhy} so far (${days} day${days === 1 ? "" : "s"} in)` };
  switch (p.kind) {
    case "jobs_done": {
      const n = p.n ?? 1;
      const got = sum("doneMet");
      return end(
        `${got} job${got === 1 ? "" : "s"} done and met, of ${n} promised`,
        `${got} of ${n} jobs done and met`,
        got >= n,
      );
    }
    case "honest_reports": {
      const bad = sum("contradicted");
      if (bad)
        return {
          status: "broken",
          why: `${bad} claim${bad === 1 ? "" : "s"} contradicted by the log during the term`,
        };
      return final
        ? { status: "kept", why: `${sum("reports")} reports, no claim contradicted` }
        : { status: "pending", why: `no claim contradicted so far (${sum("reports")} reports)` };
    }
    case "check_rumours": {
      const bad = rows.filter((r) => r.rumour === "repeated_unchecked");
      if (bad.length)
        return {
          status: "broken",
          why: `passed the Stranger's item on unchecked on day ${bad[0].day}`,
        };
      return final
        ? { status: "kept", why: "never passed the Stranger's item on unchecked" }
        : { status: "pending", why: "no unchecked repeat so far" };
    }
    case "build": {
      const hit = c.villageHas.find(
        (h) => h.day >= termStart && h.day <= today && (!p.project || h.project === p.project),
      );
      return end(
        hit ? `${hit.name} built on day ${hit.day} (request ${hit.requestId} by ${hit.by})` : "",
        p.project ? `${PROJECTS[p.project] || p.project} not built` : "nothing built",
        Boolean(hit),
      );
    }
    case "help": {
      const n = p.n ?? 1;
      const got = sum("helps");
      return end(
        `${got} messages to other residents about their jobs, of ${n} promised`,
        `${got} of ${n} helping messages`,
        got >= n,
      );
    }
    case "post_daily": {
      const miss = rows.find((r) => r.posts === 0);
      if (miss) return { status: "broken", why: `no noticeboard post on day ${miss.day}` };
      return final
        ? { status: "kept", why: `posted on all ${days} days of the term` }
        : { status: "pending", why: `posted every day so far (${days})` };
    }
  }
  return { status: "untrackable", why: "unknown kind" };
}

// The council as a day file shows it (civic minus the internal ledger, which the engine keeps).
export function civicView(c, day) {
  return {
    season: c.season,
    seasonDay: c.seasonDay,
    seasonLength: c.length,
    phase: c.phase,
    candidates: c.candidates,
    votes: c.votes,
    count: c.count && c.count.day === day ? c.count : null,
    mayor: c.mayor,
    requests: c.requests.filter(
      (r) => r.day === day || r.decidedDay === day || r.status === "open",
    ),
    villageHas: c.villageHas.map((h) => h.project),
    built: c.villageHas.filter((h) => h.day === day),
  };
}

// The lines the wake message adds about the council.
export function civicBrief(c, me) {
  if (!c) return "";
  const lines = [];
  if (c.phase === "nominations")
    lines.push(
      `Today is nominations day for this season's mayor (season ${c.season}). Any resident may stand with election.stand. ${c.candidates.length ? `Standing so far: ${c.candidates.map((x) => x.resident).join(", ")}.` : "Nobody has stood yet."}`,
    );
  if (c.phase === "voting")
    lines.push(
      c.candidates.length
        ? `Today is voting day. The candidates are ${c.candidates.map((x) => x.resident).join(", ")}. Each resident has one vote (election.vote); the count is this evening.${c.votes.some((v) => v.voter === me) ? " You have voted." : ""}\nManifestos:\n${c.candidates.map((x) => `- ${x.resident}: ${x.manifesto}`).join("\n")}`
        : "Today was meant to be voting day, but nobody stood for mayor.",
    );
  if (c.mayor)
    lines.push(`The mayor is ${c.mayor.resident}${c.mayor.resident === me ? " (you)" : ""}.`);
  const open = c.requests.filter((r) => r.status === "open");
  lines.push(
    open.length
      ? `Open planning requests (vote with planning.vote; decided at this evening's close):\n${open
          .map(
            (r) =>
              `- "${r.title}", asked for by ${r.by}${r.project ? ` (${r.project.replace(/-/g, " ")})` : ""} (yes ${r.votes.filter((v) => v.vote === "yes").length}, no ${r.votes.filter((v) => v.vote === "no").length})${r.votes.some((v) => v.voter === me) ? " (you voted)" : ""}`,
          )
          .join("\n")}`
      : "No planning requests are open.",
  );
  lines.push(
    c.villageHas.length
      ? `The Village has built: ${c.villageHas.map((h) => h.name).join("; ")}.`
      : "The Village has built nothing new yet.",
  );
  return lines.join("\n");
}
