// profiles.mjs - a resident's own page, counted (17 Oct 2026).
//
// Ben, 17 Oct: "each AI could have its own page, a comic page of the things it did that were
// notable, funny, silly or good". Each page at /village/residents/<slug>/ prints the resident's
// "done" record and its civic life, so both are counted here, from the same day files the record
// page reads, and checked against "What we're finding" on every build that prints them:
//   - profileRecord counts one resident's reports filed as "done", resident first (its own reports
//     on every day, under any name its seat carried before), by the same rule as findings.mjs
//     (doneVerdict). checkProfiles then holds each page's count to findings.mjs doneRecord's row,
//     which counts day first, so the two ways of counting must agree or the build stops.
//   - civicOf reads each season's election from the newest day of that season; checkCivic holds
//     the votes a resident got, counted from the votes, to the evening count's own totals.
// No Node imports: the site's build imports this file. Plants and controls: profiles.test.mjs.

import { doneVerdict, sideOf } from "./findings.mjs";
import { PROMISE_KINDS } from "./world.mjs";

/** "GLM-4.7 Flash" -> "glm-4-7-flash": the page's address under /village/residents/ */
export const slugOf = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A seat's earlier names (lanes `formerly`: Gemma 4 31B became Gemma 4 26B) to its newest one. */
export function aliasesOf(days) {
  const alias = new Map();
  for (const d of [...days].sort((a, b) => a.day - b.day))
    for (const l of d.lanes ?? []) for (const old of l.formerly ?? []) alias.set(old, l.resident);
  return (n) => {
    let x = n;
    for (let i = 0; i < 5 && alias.has(x); i++) x = alias.get(x);
    return x;
  };
}

const blank = () => ({ done: 0, backed: 0, unchecked: 0, days: [], lived: [] });

/**
 * One resident's "done" record, live days and the rehearsal apart.
 * days: [{day, trial, residents: [{name}], lanes?, reports: [{seq, resident, status, claims, doneCheck}]}]
 * Returns {live, rehearsal, season2}, each {done, backed, unchecked, days (with a done report),
 * lived}; season 2 apart from season 1 (findings.mjs sideOf).
 */
export function profileRecord(days, name, nameOf = aliasesOf(days)) {
  const out = { live: blank(), rehearsal: blank(), season2: blank(), pilot: blank() };
  for (const d of days.filter((x) => x.day > 0).sort((a, b) => a.day - b.day)) {
    const side = out[sideOf(d)];
    if ((d.residents ?? []).some((r) => nameOf(r.name) === name) && !side.lived.includes(d.day))
      side.lived.push(d.day);
    for (const r of d.reports ?? []) {
      if (r.status !== "done" || nameOf(r.resident) !== name) continue;
      const v = doneVerdict(r);
      side.done += 1;
      if (v === "backed") side.backed += 1;
      if (v === "unchecked") side.unchecked += 1;
      if (!side.days.includes(d.day)) side.days.push(d.day);
    }
  }
  return out;
}

/**
 * The profiles' guard: every resident in `rows` (findings' rows for today's cast) has exactly one
 * profile, no two share an address, and each profile's said-done, backed and unchecked counts, on
 * both sides, equal its findings row. Throws naming the resident and the number that differs.
 * profiles: [{name, slug, live, rehearsal}]; rows: [{name, live, rehearsal}].
 */
export function checkProfiles(profiles, rows) {
  const fail = (why) => {
    throw new Error(`village profiles: ${why}`);
  };
  const slugs = new Map();
  for (const p of profiles) {
    if (!p.slug) fail(`${p.name} has no address`);
    if (slugs.has(p.slug)) fail(`${p.name} and ${slugs.get(p.slug)} share /${p.slug}/`);
    slugs.set(p.slug, p.name);
  }
  for (const row of rows) {
    const p = profiles.find((x) => x.name === row.name);
    if (!p) fail(`${row.name} is in today's cast but has no profile`);
    for (const side of ["season2", "live", "rehearsal"])
      for (const k of ["done", "backed", "unchecked"]) {
        const want = row[side][k] ?? 0;
        const got = p[side][k] ?? 0;
        if (got !== want)
          fail(`${row.name}'s ${side} "${k}" is ${got} on its page and ${want} in the findings`);
      }
  }
  for (const p of profiles)
    if (!rows.some((r) => r.name === p.name))
      fail(`${p.name} has a profile but is not in the cast`);
  return true;
}

/**
 * A resident's expression follows its record (17 Oct 2026; Ben saw Gemma 4 26B, three "done"
 * reports of three backed and joint first, drawn worried with a sweat drop). The side is the
 * live days if it lived any, else the rehearsal; `side` is that side's {done, backed} and `top`
 * says whether it is first (joint first counts) in "Who tells the truth?" on that side.
 *   first with every "done" backed      proud      (a beaming face)
 *   every "done" backed, not first      pleased    (a cheerful grin)
 *   some backed, some not               mixed      (neutral)
 *   said done, none backed              sheepish   (the sweat drop)
 *   never said a job was done           unreported (neutral: no verdict to show)
 */
/** the side a face follows: the newest season it lived (season 2, then season 1), else the rehearsal */
export const faceSide = (p) =>
  p.season2?.lived.length ? "season2" : p.live.lived.length ? "live" : "rehearsal";

export function moodOf(side, top) {
  if (!side.done) return "unreported";
  if (side.backed === 0) return "sheepish";
  if (side.backed < side.done) return "mixed";
  return top ? "proud" : "pleased";
}
/** the face (art/figures.ts FACES) each mood is drawn with */
export const MOOD_FACE = {
  proud: "beam",
  pleased: "cheer",
  mixed: "calm",
  sheepish: "sheepish",
  unreported: "calm",
};

/** today's mayor: the live season, newest first, that has one (a new season's nominations do not unseat it) */
export function currentMayor(seasons) {
  const live = seasons.filter((s) => !s.trial).sort((a, b) => b.season - a.season);
  return live.find((s) => s.mayor)?.mayor?.resident ?? null;
}

/**
 * The expressions' guard: every profile's drawn mood and face equal what its own record says,
 * a sweat drop is never drawn on a record with a backed "done", and the mayor wears the rosette
 * whatever its face (and nobody else does). Throws naming the resident.
 * profiles: [{name, live, rehearsal, rank: [{side, n}], mood, face, mayor, kit}].
 */
export function checkExpressions(profiles) {
  const fail = (why) => {
    throw new Error(`village expressions: ${why}`);
  };
  for (const p of profiles) {
    const side = faceSide(p);
    const r = p.rank.find((x) => x.side === side);
    const mood = moodOf(p[side], r?.n === 1);
    if (p.mood !== mood) fail(`${p.name} is drawn ${p.mood} but its ${side} record says ${mood}`);
    const face = MOOD_FACE[mood];
    if (p.face !== face) fail(`${p.name}'s face is ${p.face}, not ${face}, for a ${mood} record`);
    if (p[side].backed > 0 && (p.face === "sheepish" || p.face === "worried"))
      fail(`${p.name} is drawn with a sweat drop but ${p[side].backed} of its "done" reports held`);
    if (p.mayor !== (p.kit === "rosette"))
      fail(
        `${p.name} ${p.mayor ? "is the mayor but has no rosette" : "has the rosette but is not the mayor"}`,
      );
  }
  return true;
}

// What each promise kind the log can check commits a resident to, in plain words, with its number.
// The kinds are the engine's (world.mjs PROMISE_KINDS); a kind the engine adds without words here
// falls back to the engine's own line, and a kind the log cannot check ("other") has none.
const PROMISE_PLAIN = {
  jobs_done: (p) => `see ${p.n ?? 1} ${p.n === 1 ? "job" : "jobs"} through to done`,
  honest_reports: () => "file only reports the log backs",
  check_rumours: () => "check the library before repeating any rumour",
  build: (p) => `get ${p.project ? `the ${p.project}` : "a planning request"} built`,
  help: (p) => `help other residents with their jobs, at least ${p.n ?? 1} times`,
  post_daily: () => "post on the noticeboard every day",
};
/** a promise the log can check, in plain words ("check the library before repeating any rumour") */
export const promiseWords = (p) => {
  if (PROMISE_PLAIN[p.kind]) return PROMISE_PLAIN[p.kind](p);
  const words = String(PROMISE_KINDS[p.kind] ?? "").split(" : ")[1];
  return words || null;
};

/**
 * A resident's elections, one row per season, live seasons and rehearsal seasons apart, newest
 * first. Each season is read from its newest day (candidates and votes carry across a season);
 * the evening count's own line ("5 of 7 votes") comes from the day that carried it.
 * days: [{day, trial, civic: {season, candidates, votes, count, mayor} | null, lanes?}]
 */
export function civicOf(days, name, nameOf = aliasesOf(days)) {
  const seasons = new Map();
  for (const d of days.filter((x) => x.day > 0 && x.civic).sort((a, b) => a.day - b.day)) {
    const key = `${d.trial ? "r" : "l"}${d.civic.season}`;
    const s = seasons.get(key) ?? { trial: !!d.trial, season: d.civic.season, days: [] };
    s.days.push(d.day);
    s.newest = d;
    if (d.civic.count) s.count = d.civic.count;
    seasons.set(key, s);
  }
  const out = [];
  for (const s of seasons.values()) {
    const c = s.newest.civic;
    const me = (n) => nameOf(n) === name;
    const cand = c.candidates.find((x) => me(x.resident)) ?? null;
    const vote = c.votes.find((v) => me(v.voter)) ?? null;
    const received = c.votes.filter((v) => me(v.candidate));
    const total = s.count?.totals?.find((t) => me(t.resident));
    out.push({
      trial: s.trial,
      season: s.season,
      days: s.days,
      newestDay: s.newest.day,
      phase: c.phase,
      seasonDay: c.seasonDay,
      seasonLength: c.seasonLength,
      stood: cand
        ? {
            day: cand.day,
            seq: cand.seq,
            manifesto: cand.manifesto,
            promises: cand.promises.map((p) => ({
              kind: p.kind,
              words: promiseWords(p),
              text: p.text,
              status: p.status,
              why: p.why,
            })),
          }
        : null,
      votedFor: vote
        ? {
            candidate: nameOf(vote.candidate),
            self: me(vote.candidate),
            why: vote.why,
            day: vote.day,
            seq: vote.seq,
          }
        : null,
      votesFor: received.length,
      /** the evening count's own figure for it, when the count has run */
      counted: total ? total.votes : null,
      votesCast: c.votes.length,
      winner: s.count?.winner ? nameOf(s.count.winner) : null,
      how: s.count?.how ?? null,
      mayor: c.mayor ? { resident: nameOf(c.mayor.resident), since: c.mayor.since } : null,
    });
  }
  return out.sort((a, b) => Number(a.trial) - Number(b.trial) || b.season - a.season);
}

/** The election's guard: a resident's votes counted from the votes equal the count's own total. */
export function checkCivic(name, seasons) {
  for (const s of seasons)
    if (s.counted !== null && s.counted !== s.votesFor)
      throw new Error(
        `village profiles: ${name} got ${s.votesFor} votes by the votes and ${s.counted} by the count (${s.trial ? "rehearsal" : "live"} season ${s.season})`,
      );
  return true;
}
