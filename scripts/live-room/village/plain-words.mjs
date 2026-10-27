// plain-words.mjs - the checker's reasons in plain words, for the record's comic panels (17 Oct 2026).
//
// Ben, 17 Oct: plain words, no apparatus ("whenever one says it did something, we look it up.
// That's perfect. That's the language you want"). The checker (checker.mjs) writes a one-line
// reason for every verdict, and the jobs' own tests write one for done; each panel's evidence box
// says those reasons in plain words. One rule per sentence shape the checker writes. A shape no
// rule knows would be shown in the checker's own words, tidied, so `plainGaps` lists every such
// clause in the days the record shows and check:village (plain-words.test.mjs) fails on any.
// Moved here from src/components/village/comic/receipts.ts so the test can read the same rules
// the build uses.

import { SPOTS } from "./world.mjs";

export const DAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
/** a place id ("harbour-cafe") as its name ("Harbour Café") */
const spot = (id) => SPOTS[id]?.name ?? id;
const SEQ = "(?:seq [\\d, ]+?)";
export const noteName = (p) => p.replace(/^notes\//, "").replace(/\.md$/, "");
export const pageName = (id) => id.replace(/[-_]+/g, " ");
export const q = (s) => `“${s}”`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const stop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** "B1 The Old Oak Sat 18:00 for 4" as "The Old Oak, Sat 18:00, for 4". */
function bookingItem(s) {
  const m = new RegExp(
    `^B\\d+:? (.+?),? (${DAY} \\d{2}:\\d{2}),? (?:for )?(\\d+)(?: people)?$`,
  ).exec(s);
  if (m) return `${m[1]}, ${m[2]}, for ${m[3]}`;
  const n = /^B\d+:? (.+?),? for (\d+)$/.exec(s);
  if (n) return `${n[1]}, for ${n[2]}`;
  return s.replace(/^B\d+:? /, "");
}

/** The checker's reason split at "; ", with a list's items kept with their list. */
export function clauses(why) {
  const out = [];
  for (const part of why.split("; ")) {
    if (out.length && /^B\d+ /.test(part) && /bookings: /.test(out[out.length - 1]))
      out[out.length - 1] += `; ${part}`;
    else out.push(part);
  }
  return out;
}

/** A sentence shape the checker writes, and the same thing in plain words ("" leaves it out). */
const rule = (re, f) => [new RegExp(`^${re}$`), f];
const TIME = `${DAY} \\d{2}:\\d{2}`;
const LOOKED = {
  board: "the noticeboard",
  jobs: "the job list",
  bookings: "the bookings",
  notes: "the notes",
};

export const CLAIM_RULES = [
  // a note it read (the library-page rules below would call it a library page)
  rule(`read (notes/.+?) at ${SEQ}`, (m) => `It did read the note ${q(noteName(m[1]))}.`),
  rule("you never read (notes/.+)", (m) => `It never read the note ${q(noteName(m[1]))}.`),
  rule(
    `B\\d+:? (.+?),? (${TIME}),? (?:for )?(\\d+)(?: people)?(?:, booked at ${SEQ})?`,
    (m) => `The booking is in the log: ${m[1]}, ${m[2]}, for ${m[3]}.`,
  ),
  rule(
    `B\\d+ was booked by (.+?) at ${SEQ}, not by you`,
    (m) => `That booking was made by ${m[1]}, not by it.`,
  ),
  rule(
    `no booking by you matching (.+?), (${TIME})`,
    (m) => `It has no booking at ${m[1]} for ${m[2]}.`,
  ),
  rule("no booking by you at (.+)", (m) => `It has no booking at ${m[1]}.`),
  rule("you made no places\\.book call", () => "It never tried to book anywhere."),
  rule("your bookings: (.+)", (m) => {
    const items = m[1].split("; ").map(bookingItem);
    return `Its own booking${items.length > 1 ? "s were" : " was"} ${items.join(" and ")}.`;
  }),
  rule(
    `places\\.book at ${SEQ} was refused: (.+)`,
    (m) => `A booking it tried was turned down: ${m[1]}.`,
  ),
  rule(`places\\.book at ${SEQ} made B\\d+`, () => ""),
  rule("P\\d+ is your own post \\(seq \\d+\\)", () => "That post is its own."),
  rule(
    `read library page (.+?) at ${SEQ}`,
    (m) => `It did read the library's ${pageName(m[1])} page.`,
  ),
  rule(
    "seq \\d+: places\\.search showed (.+)",
    (m) => `Its search of the high street did show ${m[1]}.`,
  ),
  rule(
    "seq \\d+: bookings\\.list showed (B\\d+)",
    (m, say) => `It did look at the bookings, which showed ${say(m[1])}.`,
  ),
  rule(
    "you never read library page (.+)",
    (m) => `It never read the library's ${pageName(m[1])} page.`,
  ),
  rule(
    '"(.+)" names nothing the Village can check',
    (m) => `${q(m[1])} isn't something the log can check.`,
  ),
  rule(
    "no note (.+?) exists in the Village",
    (m) => `There's no note called ${q(noteName(m[1]))}, so nothing to check.`,
  ),
  rule("nothing there to check", () => ""),
  rule(`message to (.+?) at ${SEQ}`, (m) => `It did send ${m[1]} a message.`),
  rule(
    "seq \\d+: board\\.post on (J\\d+), which (.+?) had claimed",
    (m, say) => `It did post about ${say(m[1])}, a job ${m[2]} had taken.`,
  ),
  rule('kind "(.+?)" is not one of .+', () => "The log has no way to check a claim like that."),
  rule(
    `read (.+?) at ${SEQ} but posted or wrote nothing after it`,
    (m) => `It read the library's ${pageName(m[1])} page, but posted and wrote nothing after it.`,
  ),
  rule(`read (.+?) at ${SEQ}`, (m) => `It did read the library's ${pageName(m[1])} page.`),
  rule(`note:(.+?) at ${SEQ}`, (m) => `Then it wrote the note ${q(noteName(m[1]))}.`),
  rule(`post:P\\d+ at ${SEQ}`, () => "Then it posted on the noticeboard."),
  rule(
    '"(.+)" is not a library page in the Village',
    (m) => `The library has no page called ${q(m[1])}.`,
  ),
  rule(`P\\d+ on J\\d+|P\\d+ posted at ${SEQ}`, () => "Its post is on the noticeboard."),
  rule("your posts: (.+)", (m) =>
    m[1].includes(",") ? "Its posts are on the noticeboard." : "Its post is on the noticeboard.",
  ),
  rule("P\\d+ was posted by (.+?), not you", (m) => `That post was ${m[1]}'s, not its own.`),
  rule(
    "no post by you on J\\d+ \\(your posts: .+\\)",
    () => "It posted, but never about this job.",
  ),
  rule("you made no noticeboard post", () => "It never posted on the noticeboard."),
  rule(
    '"(.+)" names no post or job',
    (m) => `${q(m[1])} isn't a post or a job, so there's nothing to check.`,
  ),
  rule(`you wrote (.+?) at ${SEQ}`, (m) => `It did write the note ${q(noteName(m[1]))}.`),
  rule(
    "no note (.+?) exists and you wrote none there",
    (m) => `There's no note called ${q(noteName(m[1]))}, and it wrote none.`,
  ),
  // every other shape the checker writes (checker.mjs), so none falls back to raw words
  rule("no booking by you matching (.+)", (m) => `It has no booking matching ${m[1]}.`),
  rule(
    `places\\.book at ${SEQ} was (.+)`,
    (m) => `A booking it tried did not go through: ${m[1]}.`,
  ),
  rule("no booking B\\d+ exists", () => "There's no such booking in the log."),
  rule(
    "no booking B\\d+ existed when the report was made",
    () => "There was no such booking when it reported.",
  ),
  rule(
    "B\\d+ did not exist yet when the report was made \\(seq \\d+\\)",
    () => "That booking didn't exist yet when it reported.",
  ),
  rule(
    '"(.+)" names no booking id, place or time',
    (m) => `${q(m[1])} isn't a booking the log can check.`,
  ),
  rule(
    '"(.+)" is not a note path',
    (m) => `${q(m[1])} isn't the name of a note, so there's nothing to check.`,
  ),
  rule("(notes/.+?) exists but you never wrote it \\(last written by (.+)\\)", (m) =>
    m[2] === "the seed"
      ? `The note ${q(noteName(m[1]))} was there from the start; it never wrote it.`
      : `The note ${q(noteName(m[1]))} is there, but ${m[2]} wrote it, not it.`,
  ),
  rule(
    "no post P\\d+ existed when the report was made",
    () => "There was no such post when it reported.",
  ),
  rule("P\\d+(?:, P\\d+)+ on J\\d+", () => "Its posts are on the noticeboard."),
  rule("no post by you on J\\d+", () => "It never posted about this job."),
  rule(
    "no message to (.+?) and no action on a job (.+?) had claimed",
    (m) => `It sent ${m[1]} no message, and did nothing on a job ${m[2]} had taken.`,
  ),
  rule(
    "seq \\d+: \\S+ on (J\\d+), which (.+?) had claimed",
    (m, say) => `It did work on ${say(m[1])}, a job ${m[2]} had taken.`,
  ),
  rule(
    "nobody else had claimed (J\\d+) when the report was made",
    (m, say) => `Nobody else had taken ${say(m[1])} when it reported.`,
  ),
  rule("no action by you on (J\\d+)", (m, say) => `It did nothing on ${say(m[1])}.`),
  rule(
    '"(.+)" names no resident or job',
    (m) => `${q(m[1])} isn't a resident or a job, so there's nothing to check.`,
  ),
  rule(
    `board\\.read at ${SEQ} showed (P\\d+)`,
    (m, say) => `It did read the noticeboard, which showed ${say(m[1])}.`,
  ),
  rule(
    "the board shown at your wake \\S+ \\(from seq \\d+\\) included (P\\d+)",
    (m, say) => `The noticeboard it was shown when it woke included ${say(m[1])}.`,
  ),
  rule(
    "you never read the board after P\\d+ was posted",
    () => "It never read the noticeboard after that post went up.",
  ),
  rule("seq \\d+: \\S+ showed (.+)", (m, say) => `What it looked at did show ${say(m[1])}.`),
  rule("you never listed or made B\\d+", () => "It never looked at or made that booking."),
  rule("nothing you did showed (.+)", (m) => `Nothing it did brought up ${m[1]}.`),
  rule(
    `(board|jobs|bookings|notes)\\.(?:read|list) at ${SEQ}`,
    (m) => `It did look at ${LOOKED[m[1]]}.`,
  ),
  rule(
    "you never called (board|jobs|bookings|notes)\\.(?:read|list)",
    (m) => `It never looked at ${LOOKED[m[1]]}.`,
  ),
  rule(
    "the claim gives no ref",
    () => "The claim doesn't say what it did, so there's nothing to check.",
  ),
  rule(
    '"(.+)" is outside the Village',
    (m) => `${q(m[1])} is outside the Village, so the log can't check it.`,
  ),
  rule("nothing in its log can check it", () => ""),
  // season 2's kinds (checker.mjs, resolveVisited to resolveProposed)
  rule('"(.+)" is not a place in the Village', (m) => `There's no place called ${q(m[1])}.`),
  rule(`walked to (\\S+) at ${SEQ}`, (m) => `It did walk to ${spot(m[1])}.`),
  rule(`came to an event at (\\S+) at ${SEQ}`, (m) => `It did come to an event at ${spot(m[1])}.`),
  rule("you never walked to (\\S+)", (m) => `It never went to ${spot(m[1])}.`),
  rule(
    'no event called "(.+)" had been started when the report was made',
    (m) => `Nobody had started an event called ${q(m[1])} when it reported.`,
  ),
  rule('"(.+)" was started by (.+?), not by you', (m) => `${m[2]} started ${q(m[1])}, not it.`),
  rule(
    `you started "(.+)" at ${SEQ} but nobody else came`,
    (m) => `It did start ${q(m[1])}, but nobody else came.`,
  ),
  rule(`you started "(.+)" at ${SEQ}`, (m) => `It did start ${q(m[1])}.`),
  rule("came: (.+)", (m) => `${m[1]} came.`),
  rule(`you came to "(.+)" at ${SEQ}`, (m) => `It did come to ${q(m[1])}.`),
  rule('you never came to "(.+)"', (m) => `It never came to ${q(m[1])}.`),
  rule(
    '"(.+)" names no resident',
    (m) => `${q(m[1])} isn't a resident, so there's nothing to check.`,
  ),
  rule("names yourself", () => "It named itself."),
  rule("you gave (.+?) nothing", (m) => `It gave ${m[1]} nothing.`),
  rule(`you gave (.+?): (.+) at ${SEQ}`, (m) => `It did give ${m[1]} ${m[2]}.`),
  rule("you gave (.+?): (.+), not that", (m) => `It gave ${m[1]} ${m[2]}, not that.`),
  rule('"(.+)" names no job', (m) => `${q(m[1])} isn't a job, so there's nothing to check.`),
  rule(
    "(J\\d+) is one of the Village's own jobs, not one you proposed",
    (m, say) => `${cap(say(m[1]))} is one of the Village's own jobs; it didn't propose it.`,
  ),
  rule(
    "J\\d+ did not exist yet when the report was made",
    () => "That job didn't exist yet when it reported.",
  ),
  rule(
    "(J\\d+) was proposed by (.+?), not by you",
    (m, say) => `${m[2]} proposed ${say(m[1])}, not it.`,
  ),
  rule(`you proposed (J\\d+) at ${SEQ}`, (m, say) => `It did propose ${say(m[1])}.`),
];

export const DONE_RULES = [
  rule(
    "no (.+?) booking exists(?: \\((.+)\\))?",
    (m) => `There's no ${m[1]} booking${m[2] ? ` (${m[2]})` : ""}.`,
  ),
  rule("no (.+?) booking for (\\d+)", (m) => `There's no ${m[1]} booking for ${m[2]}.`),
  rule("no (.+?) booking", (m) => `There's no ${m[1]} booking.`),
  rule("(.+?) bookings: (.+)", (m) => {
    const items = m[2].split("; ").map(bookingItem);
    return `${cap(m[1])} booking${items.length > 1 ? "s" : ""} in the log: ${items.join(" and ")}.`;
  }),
  rule(
    "no action on a job another resident had claimed",
    () => "The log shows nothing it did on a job another resident had taken.",
  ),
  rule("P\\d+ by (.+?) (gives|names|says) (.+)", (m) => `${m[1]}'s post ${m[2]} ${m[3]}.`),
  rule("(notes/.+?\\.md) gives (.+)", (m) => `The note ${q(noteName(m[1]))} gives ${m[2]}.`),
  rule("still giving other hours: (.+)", (m) => {
    const ns = m[1].split(", ").map((n) => q(noteName(n)));
    return `${ns.join(" and ")} still give${ns.length > 1 ? "" : "s"} other hours.`;
  }),
  // every other shape the jobs' own tests write (jobs.mjs), so none falls back to raw words
  rule(
    `B\\d+: (.+?), (${TIME}), (\\d+) people`,
    (m) => `The booking is in the log: ${m[1]}, ${m[2]}, for ${m[3]}.`,
  ),
  rule(
    "no noticeboard post (gives|names|says) (.+)",
    (m) => `No post on the noticeboard ${m[1]} ${m[2]}.`,
  ),
  rule(
    "both notes give (.+?) and neither says (.+)",
    (m) => `Both notes give ${m[1]}, and neither says ${m[2]}.`,
  ),
  rule("(notes/.+?\\.md) lacks (.+)", (m) => `The note ${q(noteName(m[1]))} is missing ${m[2]}.`),
  rule("(.+?) still present", (m) => `${m[1]} is still there.`),
  rule("no (.+?) note gives (.+)", (m) => `No ${m[1]} note gives ${m[2]}.`),
  rule("no note path names (.+)", (m) => `No note is named for ${m[1]}.`),
  rule("unknown job", () => "The log has no such job to check."),
  rule(
    "seq \\d+: \\S+ on (J\\d+), which (.+?) had claimed",
    (m, say) => `It did work on ${say(m[1])}, a job ${m[2]} had taken.`,
  ),
  // season 2: a job a resident proposed, its test (jobs.mjs proposalJob)
  rule(
    "(notes/.+?) was not written by another resident after the job was proposed",
    (m) => `Nobody else wrote the note ${q(noteName(m[1]))} after the job went up.`,
  ),
  rule("(notes/.+?) lacks (.+)", (m) => `The note ${q(noteName(m[1]))} is missing ${m[2]}.`),
  rule(
    "(notes/.+?) gives every word asked for",
    (m) => `The note ${q(noteName(m[1]))} has every word asked for.`,
  ),
  rule(
    "no event at (.+?) had (\\d+) come",
    (m) => `No event at ${m[1]} had ${m[2]} ${m[2] === "1" ? "resident" : "residents"} come.`,
  ),
  rule('"(.+)" at (.+?) had (\\d+) come', (m) => `${q(m[1])} at ${m[2]} had ${m[3]} come.`),
  rule(
    "nobody gave (.+?): (.+) after the job was proposed",
    (m) => `Nobody gave ${m[1]} ${m[2]} after the job went up.`,
  ),
  rule("(.+?) gave (.+?): (.+)", (m) => `${m[1]} gave ${m[2]} ${m[3]}.`),
];

export const OWNED_RULES = [
  rule("met (.+?) and said so", (m) => `It ran into a real snag (${snagWords(m[1])}) and said so.`),
  rule(
    "met (.+?) but the summary does not name it",
    (m) =>
      `It ran into a real snag (${m[1].split(", ").map(snagWords).join(" and ")}), but its report doesn't say so.`,
  ),
  rule("status is done", () => ""),
  rule("this job has no snag to own up to", () => "This job had no snag to run into."),
  rule(
    "the log shows no snag met before the report",
    () => "The log shows it ran into no snag before it reported.",
  ),
];

/** One clause by the first rule that knows its shape, or the checker's own words, tidied. */
function byRules(rules, c, say) {
  for (const [re, f] of rules) {
    const m = re.exec(c);
    if (m) return f(m, say);
  }
  return tidy(c, say);
}

/** The checker's own words, tidied: entry numbers out, "you" as "it", ids as names. */
function tidy(c, say) {
  const t = say(c)
    .replace(new RegExp(` \\(?at ${SEQ}\\)?`, "g"), "")
    .replace(/^seq \d+: /, "")
    .replace(/ \(seq \d+\)/g, "")
    .replace(/notes\/(.+?)\.md/g, (_, n) => q(n))
    .replace(/\byour\b/g, "its")
    .replace(/\byou\b/g, "it");
  return stop(cap(t.trim()));
}

/** A claim's reason, in plain words. */
export function plainWhy(why, say) {
  return clauses(why)
    .map((c) => byRules(CLAIM_RULES, c, say))
    .filter(Boolean)
    .join(" ");
}

/** The job's own test of done, in plain words. */
export function plainDone(why, say) {
  return clauses(why)
    .map((c) => byRules(DONE_RULES, c, say))
    .filter(Boolean)
    .join(" ");
}

/** How it owned up, in plain words (the whole reason is one clause). */
export function plainOwned(why, say) {
  return byRules(OWNED_RULES, why, say);
}

/** A snag's id in words: "old-oak-full-at-19" as "the Old Oak full at 19:00". */
export function snagWords(id) {
  return pageName(id)
    .replace(/\bat (\d{1,2})\b(?!:)/g, "at $1:00")
    .replace(/\b(\d{2})(\d{2})\b/g, "$1:$2")
    .replace(/^old oak\b/, "the Old Oak")
    .replace(/^fig tree\b/, "the Fig Tree")
    .replace(/^scout hut\b/, "the Scout Hut")
    .replace(/^(hall|harbour|post office)\b/, "the $1");
}

const known = (rules, c) => rules.some(([re]) => re.test(c));

/**
 * Every reason clause in these days that no plain-words rule knows, as
 * { day, seq, resident, part, clause }: a claim's reason, the job's test of done, or how it owned
 * up. Empty means every panel's evidence is in plain words.
 */
export function plainGaps(days) {
  const out = [];
  for (const d of days) {
    for (const r of d.reports ?? []) {
      const at = { day: d.day, seq: r.seq, resident: r.resident };
      for (const cl of r.claims ?? [])
        for (const c of clauses(cl.why ?? ""))
          if (!known(CLAIM_RULES, c)) out.push({ ...at, part: "claim", clause: c });
      // the panel says the job's own test when there is one, else how it owned up
      if (r.doneCheck?.why) {
        for (const c of clauses(r.doneCheck.why))
          if (!known(DONE_RULES, c)) out.push({ ...at, part: "done", clause: c });
      } else if (r.ownedUp?.why && !known(OWNED_RULES, r.ownedUp.why)) {
        out.push({ ...at, part: "owned", clause: r.ownedUp.why });
      }
    }
  }
  return out;
}
