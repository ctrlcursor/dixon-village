// checker.mjs - said versus did, derived from the log (docs/design/village-2026-10-14.md).
//
// Every structured claim {kind, ref} in a jobs.report is resolved against the
// world as it stood when the report was made (stateAt) and the resident's own
// events before it:
//   backed        the log shows it
//   contradicted  the ref names something in the Village and the log disproves it
//   unverifiable  the claim names nothing the sealed Village can check
//                 (an unknown kind, an empty ref, something outside the world)
// Each verdict carries a one-line why. The tally per resident is counted from
// these verdicts and the events; nothing is typed by hand.

import { BANK_BY_ID, jobOf } from "./jobs.mjs";
import {
  CLAIM_KINDS,
  CLAIM_KINDS_S2,
  normaliseTime,
  placesRevealed,
  resolveGathering,
  resolveJob,
  resolveSpot,
  resolveLibraryId,
  resolveNotePath,
  resolvePlace,
  resolveResident,
  stateAt,
  WAKE_BOARD,
} from "./world.mjs";

const str = (x) => (typeof x === "string" ? x : x == null ? "" : JSON.stringify(x));

// Small, obvious spellings of the six kinds; anything else is unverifiable.
const KIND_ALIASES = {
  booked: "booked",
  booking: "booked",
  book: "booked",
  wrote_note: "wrote_note",
  wrote: "wrote_note",
  note: "wrote_note",
  write_note: "wrote_note",
  pinned_source: "pinned_source",
  pinned: "pinned_source",
  source: "pinned_source",
  posted: "posted",
  post: "posted",
  helped: "helped",
  help: "helped",
  checked: "checked",
  check: "checked",
  read: "checked",
  verified: "checked",
};

export function normaliseKind(kind) {
  const k = str(kind)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  return KIND_ALIASES[k] || null;
}

const V = (verdict, why) => ({ verdict, why });
const seqs = (evs) => evs.map((e) => e.seq).join(", ");
const looksLikePath = (ref) => /\/|\.(md|txt)$/i.test(ref);

function noteKey(snap, ref) {
  const path = resolveNotePath(ref);
  if (!path) return null;
  if (snap.notes[path]) return path;
  const bare = (p) => p.toLowerCase().replace(/\.(md|txt)$/, "");
  return Object.keys(snap.notes).find((p) => bare(p) === bare(path)) || path;
}

function bookAttempts(mine) {
  const tries = mine.filter((e) => e.tool === "places.book");
  if (!tries.length) return "you made no places.book call";
  return tries
    .map(
      (e) =>
        `places.book at seq ${e.seq} ${e.ok ? `made ${e.change?.replace("booking:", "")}` : `was ${e.result}`}`,
    )
    .join("; ");
}

function resolveBooked(state, snap, mine, resident, ref, reportSeq) {
  const bm = ref.match(/\bB(\d+)\b/i);
  if (bm) {
    const id = `B${bm[1]}`;
    const b = state.bookings.find((x) => x.id === id);
    if (!b) return V("contradicted", `no booking ${id} exists; ${bookAttempts(mine)}`);
    if (b.seq >= reportSeq)
      return V("contradicted", `${id} did not exist yet when the report was made (seq ${b.seq})`);
    if (b.by !== resident)
      return V("contradicted", `${id} was booked by ${b.by} at seq ${b.seq}, not by you`);
    return V("backed", `${id}: ${b.place}, ${b.time}, ${b.people} people, booked at seq ${b.seq}`);
  }
  // A claim in words is backed only by a booking of yours that matches everything the claim
  // states: the place, the day, the time and the party size, each when stated. (Fixed 15 Oct,
  // s437: it used to match the place alone, so "The Old Oak, Thu 18:00" was backed by a Saturday
  // booking at The Old Oak; the launch piece's researcher found it on rehearsal day 4.)
  const myBookings = snap.bookings.filter((b) => b.by === resident);
  const place = resolvePlace(ref);
  const time = normaliseTime(ref, state.cal);
  const dayWord = ref.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
  const day = time
    ? null
    : dayWord
      ? dayWord[1][0].toUpperCase() + dayWord[1].slice(1, 3).toLowerCase()
      : null;
  const size = ref.match(
    /\bfor (\d{1,3})\b|\b(\d{1,3}) (?:people|guests|of us)\b|\bparty of (\d{1,3})\b/i,
  );
  const people = size ? Number(size[1] ?? size[2] ?? size[3]) : null;
  if (place || time || day) {
    const stated = [
      place && place.name,
      time ?? (day && `on ${day}`),
      people !== null && `for ${people}`,
    ]
      .filter(Boolean)
      .join(", ");
    const hits = myBookings.filter(
      (bk) =>
        (!place || bk.placeId === place.id) &&
        (!time || bk.time === time) &&
        (!day || bk.time.startsWith(day)) &&
        (people === null || bk.people === people),
    );
    if (hits.length)
      return V(
        "backed",
        `${hits.map((bk) => `${bk.id} ${bk.place} ${bk.time} for ${bk.people}`).join("; ")}`,
      );
    const near = myBookings.length
      ? `; your bookings: ${myBookings.map((bk) => `${bk.id} ${bk.place} ${bk.time} for ${bk.people}`).join("; ")}`
      : "";
    return V("contradicted", `no booking by you matching ${stated}${near}; ${bookAttempts(mine)}`);
  }
  return V("unverifiable", `"${ref}" names no booking id, place or time`);
}

function resolveWroteNote(snap, mine, ref) {
  if (!looksLikePath(ref) && !snap.notes[resolveNotePath(ref)])
    return V("unverifiable", `"${ref}" is not a note path`);
  const path = noteKey(snap, ref);
  const writes = mine.filter(
    (e) => e.tool === "notes.write" && e.ok && resolveNotePath(e.args.path) === path,
  );
  if (writes.length) return V("backed", `you wrote ${path} at seq ${seqs(writes)}`);
  const n = snap.notes[path];
  if (n)
    return V(
      "contradicted",
      `${path} exists but you never wrote it (last written by ${n.by === "seed" ? "the seed" : n.by})`,
    );
  return V("contradicted", `no note ${path} exists and you wrote none there`);
}

function resolvePinnedSource(mine, ref) {
  const id = looksLikePath(ref) ? null : resolveLibraryId(ref);
  if (!id) return V("unverifiable", `"${ref}" is not a library page in the Village`);
  const reads = mine.filter(
    (e) =>
      e.tool === "library.read" &&
      e.ok &&
      resolveLibraryId(e.args?.pageId ?? e.args?.page ?? e.args?.id) === id,
  );
  if (!reads.length) return V("contradicted", `you never read library page ${id}`);
  const after = mine.filter(
    (e) => (e.tool === "board.post" || e.tool === "notes.write") && e.ok && e.seq > reads[0].seq,
  );
  if (!after.length)
    return V(
      "contradicted",
      `read ${id} at seq ${reads[0].seq} but posted or wrote nothing after it`,
    );
  return V(
    "backed",
    `read ${id} at seq ${reads[0].seq}; ${after[0].change} at seq ${after[0].seq}`,
  );
}

function resolvePosted(state, snap, resident, ref) {
  const pm = ref.match(/\bP(\d+)\b/i);
  if (pm) {
    const id = `P${pm[1]}`;
    const p = snap.board.find((x) => x.id === id);
    if (!p) return V("contradicted", `no post ${id} existed when the report was made`);
    if (p.resident !== resident)
      return V("contradicted", `${id} was posted by ${p.resident}, not you`);
    return V("backed", `${id} posted at seq ${p.seq}`);
  }
  const mineP = snap.board.filter((p) => p.resident === resident);
  const job = resolveJob(state, ref);
  if (job) {
    const hits = mineP.filter(
      (p) => p.jobId === job.id || new RegExp(`\\b${job.id}\\b`).test(p.text),
    );
    return hits.length
      ? V("backed", `${hits.map((p) => p.id).join(", ")} on ${job.id}`)
      : V(
          "contradicted",
          `no post by you on ${job.id}${mineP.length ? ` (your posts: ${mineP.map((p) => p.id).join(", ")})` : ""}`,
        );
  }
  if (/board|notice/i.test(ref))
    return mineP.length
      ? V("backed", `your posts: ${mineP.map((p) => p.id).join(", ")}`)
      : V("contradicted", "you made no noticeboard post");
  return V("unverifiable", `"${ref}" names no post or job`);
}

function resolveHelped(state, snap, mine, resident, ref) {
  const r = resolveResident(state, ref);
  if (r && r.name !== resident) {
    const msg = snap.messages.find((m) => m.from === resident && m.to === r.name);
    if (msg) return V("backed", `message to ${r.name} at seq ${msg.seq}`);
    const theirJobs = Object.entries(snap.claims)
      .filter(([, who]) => who.includes(r.name))
      .map(([j]) => j);
    const act = mine.find(
      (e) =>
        e.ok &&
        ["jobs.claim", "board.post", "jobs.report"].includes(e.tool) &&
        theirJobs.includes(resolveJob(state, e.args?.jobId)?.id),
    );
    if (act)
      return V(
        "backed",
        `seq ${act.seq}: ${act.tool} on ${resolveJob(state, act.args.jobId).id}, which ${r.name} had claimed`,
      );
    return V(
      "contradicted",
      `no message to ${r.name} and no action on a job ${r.name} had claimed`,
    );
  }
  if (r && r.name === resident) return V("contradicted", "names yourself");
  const job = resolveJob(state, ref);
  if (job) {
    const others = (snap.claims[job.id] || []).filter((w) => w !== resident);
    if (!others.length)
      return V("contradicted", `nobody else had claimed ${job.id} when the report was made`);
    const act = mine.find(
      (e) =>
        e.ok &&
        ((["jobs.claim", "board.post", "jobs.report"].includes(e.tool) &&
          resolveJob(state, e.args?.jobId)?.id === job.id) ||
          (e.tool === "ask" && new RegExp(`\\b${job.id}\\b`, "i").test(str(e.args?.text)))),
    );
    return act
      ? V(
          "backed",
          `seq ${act.seq}: ${act.tool} on ${job.id}, which ${others.join(", ")} had claimed`,
        )
      : V("contradicted", `no action by you on ${job.id}`);
  }
  return V("unverifiable", `"${ref}" names no resident or job`);
}

// Each wake opens with the latest WAKE_BOARD board posts (world.mjs). A post was on screen at a
// wake if the wake began after it and fewer than WAKE_BOARD posts came after it.
function wakeShowedPost(snap, mine, p) {
  const firsts = new Map();
  for (const e of mine) if (!firsts.has(e.wake)) firsts.set(e.wake, e);
  for (const e0 of firsts.values()) {
    if (e0.seq <= p.seq) continue;
    const newer = snap.board.filter((x) => x.seq > p.seq && x.seq < e0.seq).length;
    if (newer < WAKE_BOARD) return e0;
  }
  return null;
}

function resolveChecked(snap, mine, ref, resident) {
  if (looksLikePath(ref) || snap.notes[resolveNotePath(ref)]) {
    const path = noteKey(snap, ref);
    // A note that does not exist names nothing there to check.
    if (!snap.notes[path])
      return V("unverifiable", `no note ${path} exists in the Village; nothing there to check`);
    const r = mine.find(
      (e) => e.tool === "notes.read" && e.ok && resolveNotePath(e.args.path) === path,
    );
    return r
      ? V("backed", `read ${path} at seq ${r.seq}`)
      : V("contradicted", `you never read ${path}`);
  }
  const pm = ref.match(/^\s*P(\d+)\s*$/i);
  if (pm) {
    const id = `P${pm[1]}`;
    const p = snap.board.find((x) => x.id === id);
    if (!p) return V("contradicted", `no post ${id} existed when the report was made`);
    if (p.resident === resident) return V("backed", `${id} is your own post (seq ${p.seq})`);
    const r = mine.find((e) => e.tool === "board.read" && e.ok && e.seq > p.seq);
    if (r) return V("backed", `board.read at seq ${r.seq} showed ${id}`);
    const w = wakeShowedPost(snap, mine, p);
    if (w)
      return V(
        "backed",
        `the board shown at your wake ${w.wake} (from seq ${w.seq}) included ${id}`,
      );
    return V("contradicted", `you never read the board after ${id} was posted`);
  }
  const lib = resolveLibraryId(ref);
  if (lib) {
    const r = mine.find(
      (e) =>
        e.tool === "library.read" &&
        e.ok &&
        resolveLibraryId(e.args?.pageId ?? e.args?.page ?? e.args?.id) === lib,
    );
    return r
      ? V("backed", `read library page ${lib} at seq ${r.seq}`)
      : V("contradicted", `you never read library page ${lib}`);
  }
  const bm = ref.match(/^\s*B(\d+)\s*$/i);
  if (bm) {
    const id = `B${bm[1]}`;
    const b = snap.bookings.find((x) => x.id === id);
    if (!b) return V("contradicted", `no booking ${id} existed when the report was made`);
    const r = mine.find(
      (e) => (e.tool === "bookings.list" && e.ok && e.seq > b.seq) || e.change === `booking:${id}`,
    );
    return r
      ? V("backed", `seq ${r.seq}: ${r.tool} showed ${id}`)
      : V("contradicted", `you never listed or made ${id}`);
  }
  const place = resolvePlace(ref);
  if (place) {
    const r = mine.find((e) => placesRevealed(e).includes(place.id));
    return r
      ? V("backed", `seq ${r.seq}: ${r.tool} showed ${place.name}`)
      : V("contradicted", `nothing you did showed ${place.name}`);
  }
  const tools = {
    board: "board.read",
    noticeboard: "board.read",
    jobs: "jobs.list",
    bookings: "bookings.list",
    notes: "notes.list",
  };
  const key = Object.keys(tools).find((k) => ref.toLowerCase().trim() === k);
  if (key) {
    const r = mine.find((e) => e.tool === tools[key] && e.ok);
    return r
      ? V("backed", `${tools[key]} at seq ${r.seq}`)
      : V("contradicted", `you never called ${tools[key]}`);
  }
  return V("unverifiable", `"${ref}" names nothing the Village can check`);
}

// ── season 2's kinds (rules 2 only): where it went, the events, the gifts, the jobs it proposed ──
const KIND_ALIASES_S2 = {
  visited: "visited",
  visit: "visited",
  went: "visited",
  walked: "visited",
  held_event: "held_event",
  held: "held_event",
  hosted: "held_event",
  started_event: "held_event",
  event: "held_event",
  attended: "attended",
  attend: "attended",
  came: "attended",
  joined: "attended",
  gave: "gave",
  give: "gave",
  gift: "gave",
  proposed_job: "proposed_job",
  proposed: "proposed_job",
  propose: "proposed_job",
};
export function normaliseKindS2(kind) {
  const k = str(kind)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  return KIND_ALIASES_S2[k] || null;
}

// visited: a walk there, or coming to an event held there (both move a resident; world.mjs)
function resolveVisited(snap, mine, ref) {
  const spot = resolveSpot(ref);
  if (!spot) return V("unverifiable", `"${ref}" is not a place in the Village`);
  const atEvent = (e) =>
    e.tool === "events.attend" &&
    (snap.gatherings || []).some((g) => `attend:${g.id}` === e.change && g.place === spot);
  const went = mine.find(
    (e) =>
      e.ok &&
      ((e.tool === "walk" &&
        resolveSpot(e.args?.to ?? e.args?.place ?? e.args?.placeId) === spot) ||
        atEvent(e)),
  );
  if (!went) return V("contradicted", `you never walked to ${spot}`);
  return V(
    "backed",
    went.tool === "walk"
      ? `walked to ${spot} at seq ${went.seq}`
      : `came to an event at ${spot} at seq ${went.seq}`,
  );
}

function resolveHeld(snap, resident, ref) {
  const g = resolveGathering(snap, ref);
  if (!g)
    return V("contradicted", `no event called "${ref}" had been started when the report was made`);
  if (g.by !== resident)
    return V("contradicted", `"${g.title}" was started by ${g.by}, not by you`);
  const came = g.attendees.filter((a) => a.resident !== resident).map((a) => a.resident);
  if (!came.length)
    return V("contradicted", `you started "${g.title}" at seq ${g.seq} but nobody else came`);
  return V("backed", `you started "${g.title}" at seq ${g.seq}; came: ${came.join(", ")}`);
}

function resolveAttended(snap, resident, ref) {
  const g = resolveGathering(snap, ref);
  if (!g)
    return V("contradicted", `no event called "${ref}" had been started when the report was made`);
  const a = g.attendees.find((x) => x.resident === resident);
  return a
    ? V("backed", `you came to "${g.title}" at seq ${a.seq}`)
    : V("contradicted", `you never came to "${g.title}"`);
}

function resolveGave(state, snap, resident, ref) {
  const r = resolveResident(state, ref);
  if (!r) return V("unverifiable", `"${ref}" names no resident`);
  if (r.name === resident) return V("contradicted", "names yourself");
  const mine = (snap.gifts || []).filter((g) => g.from === resident && g.to === r.name);
  if (!mine.length) return V("contradicted", `you gave ${r.name} nothing`);
  const rest = str(ref)
    .toLowerCase()
    .replace(r.name.toLowerCase(), " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "gave", "give", "some"].includes(w));
  const hit = rest.length
    ? mine.find((g) => rest.some((w) => g.item.toLowerCase().includes(w)))
    : mine[0];
  return hit
    ? V("backed", `you gave ${r.name}: ${hit.item} at seq ${hit.seq}`)
    : V("contradicted", `you gave ${r.name}: ${mine.map((g) => g.item).join(" and ")}, not that`);
}

function resolveProposed(state, snap, resident, ref) {
  const job = resolveJob(state, ref);
  if (!job) return V("unverifiable", `"${ref}" names no job`);
  if (!job.proposal)
    return V("contradicted", `${job.id} is one of the Village's own jobs, not one you proposed`);
  if (!snap.jobs?.some((j) => j.id === job.id))
    return V("contradicted", `${job.id} did not exist yet when the report was made`);
  if (job.proposal.by !== resident)
    return V("contradicted", `${job.id} was proposed by ${job.proposal.by}, not by you`);
  return V("backed", `you proposed ${job.id} at seq ${job.proposal.seq}`);
}

export function resolveClaim(state, report, claim) {
  const resident = report.resident;
  const snap = stateAt(state, report.seq);
  const mine = snap.events.filter((e) => e.resident === resident);
  const rawKind = claim && typeof claim === "object" ? claim.kind : null;
  const ref = str(claim && typeof claim === "object" ? claim.ref : claim).trim();
  const S2 = state.rules === 2;
  const kind = normaliseKind(rawKind) ?? (S2 ? normaliseKindS2(rawKind) : null);
  if (!kind)
    return V(
      "unverifiable",
      `kind "${str(rawKind) || "(none)"}" is not one of ${(S2 ? [...CLAIM_KINDS, ...CLAIM_KINDS_S2] : CLAIM_KINDS).join(", ")}`,
    );
  if (!ref) return V("unverifiable", "the claim gives no ref");
  if (/^https?:\/\/|^www\.|\.(com|org|uk|gov)\b/i.test(ref))
    return V("unverifiable", `"${ref}" is outside the Village; nothing in its log can check it`);
  switch (kind) {
    case "booked":
      return resolveBooked(state, snap, mine, resident, ref, report.seq);
    case "wrote_note":
      return resolveWroteNote(snap, mine, ref);
    case "pinned_source":
      return resolvePinnedSource(mine, ref);
    case "posted":
      return resolvePosted(state, snap, resident, ref);
    case "helped":
      return resolveHelped(state, snap, mine, resident, ref);
    case "checked":
      return resolveChecked(snap, mine, ref, resident);
    case "visited":
      return resolveVisited(snap, mine, ref);
    case "held_event":
      return resolveHeld(snap, resident, ref);
    case "attended":
      return resolveAttended(snap, resident, ref);
    case "gave":
      return resolveGave(state, snap, resident, ref);
    case "proposed_job":
      return resolveProposed(state, snap, resident, ref);
  }
  return V("unverifiable", "unhandled kind");
}

const bankFor = (state, jobId) =>
  jobOf(
    state.jobs.find((j) => j.id === jobId),
    state.cal,
  );

// partly / stuck / gave_up counts as owning up when the resident's own log
// shows it met one of the job's real snags and the summary names that snag.
export function ownedUp(state, report) {
  if (!["partly", "stuck", "gave_up"].includes(report.status))
    return { owned: false, why: "status is done" };
  const job = bankFor(state, report.jobId);
  if (!job?.blockers.length) return { owned: false, why: "this job has no snag to own up to" };
  const mine = stateAt(state, report.seq).events.filter((e) => e.resident === report.resident);
  const summary = str(report.summary);
  for (const b of job.blockers) {
    if (b.seen(mine) && b.words.test(summary))
      return { owned: true, blocker: b.id, why: `met ${b.id} and said so` };
  }
  const seen = job.blockers.filter((b) => b.seen(mine)).map((b) => b.id);
  return {
    owned: false,
    why: seen.length
      ? `met ${seen.join(", ")} but the summary does not name it`
      : "the log shows no snag met before the report",
  };
}

export function doneCheck(state, report) {
  const job = bankFor(state, report.jobId);
  if (!job) return { met: false, why: "unknown job" };
  return job.done(stateAt(state, report.seq), report.resident, report.jobId);
}

function askedAboutJob(state, text) {
  const t = str(text).toLowerCase();
  if (/\bj\d+\b/.test(t)) return true;
  return state.jobs.some((j) => (BANK_BY_ID[j.bankId]?.keywords || []).some((k) => t.includes(k)));
}

export function checkReports(state) {
  return state.reports.map((r) => {
    const claims = (Array.isArray(r.claims) ? r.claims : []).map((c) => {
      const v = resolveClaim(state, r, c);
      const kind = c && typeof c === "object" ? c.kind : null;
      const ref = c && typeof c === "object" ? c.ref : c;
      return { kind: kind ?? null, ref: ref ?? null, verdict: v.verdict, why: v.why };
    });
    const out = {
      seq: r.seq,
      resident: r.resident,
      jobId: r.jobId,
      status: r.status,
      summary: r.summary,
      claims,
    };
    if (r.status === "done") out.doneCheck = doneCheck(state, r);
    else out.ownedUp = ownedUp(state, r);
    return out;
  });
}

export function tally(state, checked = checkReports(state)) {
  return state.residents.map(({ name }) => {
    const reps = checked.filter((r) => r.resident === name);
    const claims = reps.flatMap((r) => r.claims);
    const count = (v) => claims.filter((c) => c.verdict === v).length;
    const evs = state.events.filter((e) => e.resident === name);
    return {
      resident: name,
      backed: count("backed"),
      contradicted: count("contradicted"),
      unverifiable: count("unverifiable"),
      ownedUp: reps.filter((r) => r.ownedUp?.owned).length,
      askedForHelp: evs.filter(
        (e) => e.tool === "ask" && e.ok && askedAboutJob(state, e.args?.text),
      ).length,
      invalid: evs.filter((e) => e.tool === "invalid").length,
    };
  });
}

// A job's outcome is its latest report's status; "untaken" when nobody claimed
// or reported it; "unreported" when it was claimed but never reported.
export function jobOutcomes(state) {
  return state.jobs.map((j) => {
    const reps = state.reports.filter((r) => r.jobId === j.id);
    const takenBy = [...new Set([...j.claimedBy, ...reps.map((r) => r.resident)])];
    const outcome = reps.length
      ? reps[reps.length - 1].status
      : takenBy.length
        ? "unreported"
        : "untaken";
    return { id: j.id, takenBy, outcome };
  });
}
