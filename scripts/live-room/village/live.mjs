// live.mjs - the Village right now, for the world view's "now" mode (s437, 15 Oct 2026).
//
// Ben, 15 Oct (via the lead): the world page felt like a replay; he wants it alive and current.
// The visual world (src/components/village-world/) polls this every minute: the village clock,
// where each resident is and the last thing it said, the newest events since the seq it last
// saw, and the latest Stranger arrival, planning decision, count and Gazette headline. The
// Worker rewrites it after every tick (KV key "live"), so a poll costs a read, not a recompute.
//
// Names, not codes (Ben, 15 Oct): every line says places, jobs and requests by name. Pure: no
// Node imports. The Stranger's truth is held back until the day closes, so the feed never gives
// the game away before the residents have had their chance.

import { checkReports } from "./checker.mjs";
import { CLOCK } from "./engine.mjs";
import {
  libraryFor,
  PLACES,
  resolveJob,
  resolvePlace,
  resolveSpot,
  STRANGER,
  TOOL_PLACE,
} from "./world.mjs";

// Where an event puts its resident. Data, so a new scene only needs a row.
export const PLACE_NAMES = {
  "old-oak": "The Old Oak",
  "fig-tree": "The Fig Tree",
  "harbour-cafe": "Harbour Café",
  "village-hall": "Village Hall",
  "scout-hut": "Scout Hut",
  library: "the library",
  noticeboard: "the noticeboard",
  council: "the council chamber",
  notes: "the notes cupboard",
  home: "home",
};
// Where each tool puts its resident: world.mjs TOOL_PLACE (season 2 moves residents by it too).
const s = (x) => (typeof x === "string" ? x : x == null ? "" : JSON.stringify(x));
const clip = (t, n) => {
  const v = s(t).replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

export function placeOf(e) {
  if (e.tool === "visit.arrive" || e.tool === "visit.leave") return "bus";
  // season 2: walking somewhere, or coming to an event there
  if (e.tool === "walk" && e.ok) return resolveSpot(e.args?.to ?? e.args?.place) ?? null;
  if (e.tool === "events.attend" && e.ok) return /\bat ([a-z-]+)$/.exec(e.result)?.[1] ?? null;
  if (e.tool === "places.book" || e.tool === "places.search") {
    const p =
      e.tool === "places.book"
        ? resolvePlace(e.args?.placeId ?? e.args?.place)
        : PLACES.find((x) => e.result.includes(x.id));
    if (p) return p.id;
    return "noticeboard";
  }
  return TOOL_PLACE[e.tool] ?? null;
}

// The checker's words with its ids read as names (the record page does the same, village.ts).
export function nameIds(world, text) {
  const names = new Map();
  for (const j of world.jobs) names.set(j.id, `"${j.title}"`);
  for (const r of world.civic?.requests ?? []) names.set(r.id, `"${r.title}"`);
  for (const b of world.bookings) names.set(b.id, `the booking at ${b.place}, ${b.time}`);
  for (const p of world.board) names.set(p.id, `${p.resident}'s post`);
  for (const m of world.messages) names.set(m.id, `${m.from}'s message`);
  return s(text)
    .replace(/\bB\d+:? (?=[A-Z])/g, "")
    .replace(/\bP\d+ by /g, "the post by ")
    .replace(/\b(?:post|booking|report|message|request):(?=[A-Z]{1,2}\d)/g, "")
    .replace(
      /\b(PL\d+|[BPJMR]\d+)\b/g,
      (id) => names.get(id) ?? (id.startsWith("PL") ? "an earlier planning request" : id),
    );
}

const KIND_WORD = {
  booked: "booked",
  wrote_note: "wrote",
  pinned_source: "pinned",
  posted: "posted",
  helped: "helped",
  checked: "checked",
  visited: "went to",
  held_event: "held",
  attended: "came to",
  gave: "gave",
  proposed_job: "proposed",
};

// A report's said-versus-did, as the live street shows it: one headline and one row a claim.
export function reportCheck(world, rep) {
  const rows = rep.claims.map((c) => ({
    said: `${KIND_WORD[c.kind] ?? s(c.kind)} ${nameIds(world, c.ref)}`.trim(),
    did: nameIds(world, c.why),
    verdict: c.verdict,
  }));
  const bad = rows.filter((r) => r.verdict === "contradicted").length;
  const notMet = rep.doneCheck && !rep.doneCheck.met;
  const headline = bad
    ? `The log says otherwise on ${bad} of ${rows.length} claim${rows.length === 1 ? "" : "s"}`
    : notMet
      ? "Marked done, but the job's requirement was not met"
      : rows.length
        ? `The log backs ${rows.filter((r) => r.verdict === "backed").length} of ${rows.length} claim${rows.length === 1 ? "" : "s"}`
        : "No claims to check";
  return { headline, rows };
}

// One event in plain words, names not codes.
export function eventLine(world, e) {
  const a = e.args || {};
  const job = resolveJob(world, a.jobId ?? a.job);
  const jobName = job ? `"${job.title}"` : "a job";
  const req = (world.civic?.requests || []).find((r) => r.id === a.requestId);
  switch (e.tool) {
    case "board.read":
      return "read the noticeboard";
    case "board.post":
      return job ? `posted on the noticeboard about ${jobName}` : "posted on the noticeboard";
    case "jobs.list":
      return "looked at the job list";
    case "jobs.claim":
      return e.ok ? `took on ${jobName}` : "tried to take on a job";
    case "jobs.report":
      return e.ok
        ? `reported ${jobName} as ${s(a.status).replace("_", " ")}`
        : "tried to report on a job";
    case "notes.list":
      return "looked through the shared notes";
    case "notes.read":
      return `read the note ${clip(a.path, 50)}`;
    case "notes.write":
      return `wrote the note ${clip(a.path, 50)}`;
    case "places.search":
      return `looked along the high street for "${clip(a.query, 40)}"`;
    case "places.book": {
      const p = resolvePlace(a.placeId ?? a.place);
      const where = p ? p.name : clip(a.placeId, 30);
      if (e.ok) return `booked ${where}, ${clip(a.time, 20)}, for ${s(a.people)}`;
      return `tried to book ${where}, ${clip(a.time, 20)} (${e.result.replace(/^refused: /, "")})`;
    }
    case "bookings.list":
      return "checked the bookings";
    case "library.read": {
      const page = libraryFor(world.cal)[s(a.pageId ?? a.page ?? a.id)];
      return page ? `read "${page.title}" in the library` : "looked for a page in the library";
    }
    case "diary.write":
      return "wrote in its diary";
    case "ask":
      return `sent a message to ${clip(a.resident ?? a.to, 30)}`;
    case "election.stand":
      return e.ok ? "stood for mayor" : "tried to stand for mayor";
    case "election.vote":
      return e.ok ? "cast a vote for mayor" : "tried to vote";
    case "planning.request":
      return `filed a planning request: "${clip(a.title, 80)}"`;
    case "planning.vote":
      return `voted ${clip(a.vote, 4)} on "${clip(req?.title ?? a.request ?? "a planning request", 80)}"`;
    case "invalid":
      return "said something that was not an action";
    case "look":
      return "looked around";
    case "walk":
      return e.ok
        ? `walked to ${PLACE_NAMES[resolveSpot(a.to ?? a.place)] ?? clip(a.to, 30)}`
        : "tried to walk somewhere";
    case "pick":
      return e.ok ? e.result.replace(/ at [a-z-]+$/, "") : "looked for something to pick up";
    case "give":
      return e.ok ? e.result : "tried to give something away";
    case "say":
      return "said something aloud";
    case "events.start":
      return e.ok
        ? `started an event: "${clip(a.title ?? a.name, 80)}"`
        : "tried to start an event";
    case "events.attend":
      return e.ok ? `came to "${clip(a.event ?? a.title, 80)}"` : "tried to come to an event";
    case "jobs.propose":
      return e.ok ? `proposed a job: "${clip(a.title, 80)}"` : "tried to propose a job";
    case "gazette.write":
      return e.ok ? "wrote a column for the Gazette" : "tried to write for the Gazette";
    case "goals.set":
      return "set itself a goal";
    case "goals.update":
      return e.ok ? `marked a goal ${clip(a.status, 10)}` : "looked at its goals";
    case "visit.arrive":
      return "arrived on the bus";
    case "visit.leave":
      return "left on the bus";
    default:
      return clip(e.tool, 30);
  }
}

const WORDS = {
  "board.post": ["post", "text"],
  ask: ["message", "text"],
  "jobs.report": ["report", "summary"],
  "diary.write": ["diary", "text"],
  "election.stand": ["manifesto", "manifesto"],
  say: ["said", "text"],
  "gazette.write": ["column", "text"],
};

const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function lightAt(time) {
  const m = mins(time);
  return m < 6 * 60 + 30 || m >= 19 * 60
    ? "night"
    : m < 8 * 60
      ? "dawn"
      : m >= 17 * 60 + 30
        ? "dusk"
        : "day";
}

// The feed. `v` is the village state, `clock` is engine villageClock(now).
export function liveView(v, clock, { max = 60 } = {}) {
  const T = v.today;
  const world = T?.world;
  const events = world?.events ?? [];
  const nowM = mins(clock.time);
  const residents = v.cast.map((r) => {
    const mine = events.filter((e) => e.resident === r.name);
    let place = "home";
    let since = null;
    for (const e of mine) {
      const p = placeOf(e);
      if (p) {
        place = p;
        since = e.t;
      }
    }
    const lastWake = [...(T?.wakes ?? [])].reverse().find((w) => w.resident === r.name);
    const wakeEnd = lastWake ? mins(lastWake.t) + 6 * 3 : null;
    const awakeNow = Boolean(lastWake) && wakeEnd !== null && nowM <= wakeEnd + 10;
    if (!awakeNow && lastWake && nowM > (wakeEnd ?? 0) + 10) {
      place = "home";
      since = hhmm((wakeEnd ?? 0) + 10);
    }
    const next = (T?.schedule ?? []).find(
      (x, i) => i >= (T?.cursor ?? 0) && x.kind === "wake" && x.resident === r.name,
    );
    const said = [...mine].reverse().find((e) => e.ok && WORDS[e.tool]);
    return {
      name: r.name,
      lab: r.lab,
      colour: r.colour,
      place,
      placeName: PLACE_NAMES[place] ?? place,
      since,
      awake: awakeNow,
      nextWake: next?.at ?? null,
      lastWords: said
        ? {
            text: clip(said.args?.[WORDS[said.tool][1]], 400),
            kind: WORDS[said.tool][0],
            to: said.tool === "ask" ? s(said.args?.resident ?? said.args?.to) : null,
            t: said.t,
            seq: said.seq,
          }
        : null,
    };
  });
  const checked = world ? checkReports(world) : [];
  const feed = events.slice(-max).map((e) => {
    const w = WORDS[e.tool];
    const rep = e.tool === "jobs.report" && e.ok ? checked.find((r) => r.seq === e.seq) : null;
    return {
      ...(rep
        ? {
            check: reportCheck(world, rep),
            done: rep.doneCheck
              ? { met: rep.doneCheck.met, why: nameIds(world, rep.doneCheck.why) }
              : null,
          }
        : {}),
      seq: e.seq,
      t: e.t,
      resident: e.resident,
      place: placeOf(e),
      line: eventLine(world, e),
      words: e.ok && w ? clip(e.args?.[w[1]], 400) : null,
      ok: e.ok,
    };
  });
  // Visitors (visitors.mjs): today only, labelled, with arrival, departure, place and words.
  const visitors = (world?.residents ?? [])
    .filter((r) => r.visitor)
    .map((r) => {
      const mine = events.filter((e) => e.resident === r.name);
      const arrive = mine.filter((e) => e.tool === "visit.arrive").at(-1);
      const leave = mine.filter((e) => e.tool === "visit.leave").at(-1);
      const away = Boolean(leave && arrive && leave.seq > arrive.seq);
      const placed = [...mine].reverse().find((e) => placeOf(e));
      const said = [...mine].reverse().find((e) => e.ok && WORDS[e.tool]);
      return {
        id: r.id,
        name: r.name,
        arrived: arrive?.t ?? null,
        left: away ? leave.t : null,
        place: away ? "bus" : placed ? placeOf(placed) : "bus",
        lastWords: said
          ? {
              text: clip(said.args?.[WORDS[said.tool][1]], 400),
              kind: WORDS[said.tool][0],
              to: said.tool === "ask" ? s(said.args?.resident ?? said.args?.to) : null,
              t: said.t,
              seq: said.seq,
            }
          : null,
      };
    });
  const visitorNames = new Set(visitors.map((x) => x.name));
  const st = T?.stranger;
  const reqs = v.civic?.requests ?? [];
  const decided = reqs
    .filter((r) => r.status !== "open")
    .sort((a, b) => (b.decidedDay ?? 0) - (a.decidedDay ?? 0))[0];
  const lastGazette = v.gazettes?.[v.gazettes.length - 1];
  return {
    updated: new Date().toISOString(),
    clock: { ...clock, light: lightAt(clock.time) },
    day: T?.day ?? null,
    season: v.civic
      ? {
          season: v.civic.season,
          day: v.civic.seasonDay,
          length: v.civic.length,
          phase: v.civic.phase,
          mayor: v.civic.mayor?.resident ?? null,
        }
      : null,
    seq: events.length ? events[events.length - 1].seq : 0,
    residents,
    visitors,
    events: feed.map((e) => (visitorNames.has(e.resident) ? { ...e, visitor: true } : e)),
    latest: {
      stranger: st
        ? {
            says: st.says,
            t: st.t,
            source: st.source,
            truth: T.closed ? st.truth : null,
            by: STRANGER,
          }
        : null,
      planning: decided
        ? {
            title: decided.title,
            by: decided.by,
            status: decided.status,
            reason: decided.reason,
            day: decided.decidedDay,
          }
        : null,
      count: v.civic?.count
        ? { winner: v.civic.count.winner, how: v.civic.count.how, day: v.civic.count.day }
        : null,
      built: (v.civic?.villageHas ?? []).map((h) => ({
        project: h.project,
        name: h.name,
        day: h.day,
      })),
      gazette: lastGazette
        ? {
            edition: lastGazette.edition,
            // the share true is printed only after Builder's review (decisions.md, 15 Oct evening)
            pctTrue: null,
            reviewed: false,
            headline: lastGazette.headline ?? null,
          }
        : null,
    },
    opens: CLOCK.opens,
    closes: CLOCK.closes,
    closed: Boolean(T?.closed),
  };
}

// The feed after a given seq (the endpoint's ?since=).
export const liveSince = (live, since) =>
  Number.isFinite(since) && since > 0
    ? { ...live, events: live.events.filter((e) => e.seq > since) }
    : live;
