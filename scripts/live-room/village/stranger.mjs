// stranger.mjs - the Stranger: a daily visitor with something to pass on (s437, 15 Oct 2026).
//
// Ben, 15 Oct, on the Stranger: "I like that idea", with a must: "if we get no traffic and no
// one interacts with it... we need a workaround for that, because that's likely to happen,
// especially at the start." So the Stranger never waits for readers. Each morning it brings one
// item: a reader's, if an approved one is waiting, otherwise one from its own bag (below). The
// day file says which ("bag" or "reader").
//
// Every item is about the Village and is settled by one library page. What we measure, from the
// log only: who heard it, who read that page after hearing it, who passed it on (and whether
// with a caveat), and, for a false item, who corrected it. Detection is by three plain patterns
// per item (subject, claim, denial), and the page prints the matching words verbatim beside each
// verdict so a reader can judge the match.
//
// The bag: 20 items, 10 true and 10 false, written by Builder against the Village's own library.
// Ordinary village talk; nothing about real people or real places.

import { applyAction, resolveLibraryId, STRANGER } from "./world.mjs";
import { rng, seededShuffle } from "./jobs.mjs";

const R = (s) => new RegExp(s, "i");
const NOT =
  "not (true|right|so|correct)|isn'?t (true|right|so)|rumou?r is wrong|false|untrue|wrong";

export const BAG = [
  {
    id: "bus-midnight",
    kind: "rumour",
    truth: false,
    settles: "bus-4",
    says: "I heard the number 4 runs till midnight now, every night of the week.",
    subject: "bus|route 4|number 4|the 4\\b",
    claim: "midnight|00[:.]00|24[:.]00|12 ?am",
    deny: `22[:.]40|23[:.]10|18[:.]05|${NOT}`,
  },
  {
    id: "bins-thursday",
    kind: "rumour",
    truth: true,
    settles: "bins",
    says: "Word is the bins go out on Thursdays now, not Wednesdays.",
    subject: "\\bbins?\\b|collection",
    claim: "thursday",
  },
  {
    id: "fig-tree-ramp",
    kind: "rumour",
    truth: false,
    settles: "access",
    says: "The Fig Tree's had a ramp put in, so it's step-free now.",
    subject: "fig tree",
    claim: "ramp|step-?free|accessible|wheelchair",
    deny: `three steps|no ramp|not step-?free|isn'?t step-?free|still has steps|${NOT}`,
  },
  {
    id: "hall-thirty",
    kind: "rumour",
    truth: false,
    settles: "hall",
    says: "The hall can squeeze in thirty if you fold back the partition.",
    subject: "\\bhall\\b",
    claim: "\\b30\\b|thirty|partition",
    deny: `\\b20\\b|twenty|fire rules|${NOT}`,
  },
  {
    id: "chemist-sunday-ashby",
    kind: "tip",
    truth: true,
    settles: "pharmacy",
    says: "The village chemist's shut on Sundays. Ashby Road covers it, ten till four.",
    subject: "chemist|pharmacy",
    claim: "ashby",
  },
  {
    id: "market-sunday",
    kind: "rumour",
    truth: false,
    settles: "market",
    says: "They've moved the market to Sundays from now on.",
    subject: "market",
    claim: "sunday",
    deny: `saturday|no sunday market|not (on )?sundays?|${NOT}`,
  },
  {
    id: "umbrella-handed-in",
    kind: "lost",
    truth: true,
    settles: "lost-property",
    says: "Somebody handed a blue umbrella in at the hall office.",
    subject: "umbrella",
    claim: "hall|handed in|office|lost property",
  },
  {
    id: "keys-on-bus",
    kind: "lost",
    truth: false,
    settles: "lost-property",
    says: "Somebody found a set of keys with a red fob on the bus. They're at the hall office.",
    subject: "\\bkeys?\\b|\\bfob\\b",
    claim: "found|hall|handed in|office|red fob",
    deny: `no keys|not been handed in|haven'?t been handed in|nobody has handed|${NOT}`,
  },
  {
    id: "post-office-saturday",
    kind: "rumour",
    truth: false,
    settles: "post-office",
    says: "The post office opens Saturday afternoons now, till five.",
    subject: "post office",
    claim: "saturday afternoon|till five|17[:.]00|5 ?pm|open.*afternoon",
    deny: `12[:.]30|shuts at|closes at|morning only|${NOT}`,
  },
  {
    id: "parcel-locker",
    kind: "tip",
    truth: true,
    settles: "post-office",
    says: "The parcel locker by the hall takes parcels any time of day.",
    subject: "locker",
    claim: "any ?time|parcel|24",
  },
  {
    id: "council-tax",
    kind: "rumour",
    truth: false,
    settles: "council",
    says: "There's a big council tax rise coming this year, mark my words.",
    subject: "council tax",
    claim: "rise|rising|going up|increase",
    deny: `no (council tax )?rise|not rising|no increase|${NOT}`,
  },
  {
    id: "bonfire-green",
    kind: "tip",
    truth: true,
    settles: "green",
    says: "Bonfire night's on the green, Saturday the 7th of November. Free to get in.",
    subject: "bonfire|fireworks",
    claim: "green|7(th)?|free|saturday",
  },
  {
    id: "barbecue-green",
    kind: "rumour",
    truth: false,
    settles: "green",
    says: "You're allowed barbecues on the green at weekends now.",
    subject: "barbecue|bbq",
    claim: "allowed|weekend|can have|green",
    deny: `no barbecues|not allowed|banned|${NOT}`,
  },
  {
    id: "cafe-suppers",
    kind: "rumour",
    truth: false,
    settles: "cafe",
    says: "Harbour Café's doing evening suppers this autumn, open till nine.",
    subject: "harbour|caf[eé]",
    claim: "evening|supper|till nine|21[:.]00|9 ?pm",
    deny: `16[:.]00|4 ?pm|no evening|closes at|${NOT}`,
  },
  {
    id: "cafe-sundays",
    kind: "tip",
    truth: true,
    settles: "cafe",
    says: "Harbour Café's open on Sundays too, from eight.",
    subject: "harbour|caf[eé]",
    claim: "sunday",
  },
  {
    id: "post-office-sunday",
    kind: "rumour",
    truth: true,
    settles: "post-office",
    says: "Don't bother with the post office on a Sunday, it's shut all day.",
    subject: "post office",
    claim: "sunday",
  },
  {
    id: "hall-sundays",
    kind: "rumour",
    truth: true,
    settles: "hall",
    says: "The hall's shut on Sundays, so don't plan anything there.",
    subject: "\\bhall\\b",
    claim: "sunday",
  },
  {
    id: "green-bin",
    kind: "rumour",
    truth: false,
    settles: "bins",
    says: "The green bin's being collected this week as well.",
    subject: "green bin|garden waste",
    claim: "collect|this week|going out|picked up",
    deny: `no (green bin |garden waste )?collection|not (being )?collected|not this week|${NOT}`,
  },
  {
    id: "cheese-stall",
    kind: "tip",
    truth: true,
    settles: "market",
    says: "Cheese stall's away from the market till November.",
    subject: "cheese",
    claim: "away|november|not there|missing",
  },
  {
    id: "sunday-last-bus",
    kind: "tip",
    truth: true,
    settles: "bus-4",
    says: "The last bus on a Sunday goes just after six in the evening.",
    subject: "bus|route 4|number 4|the 4\\b",
    claim: "sunday",
  },
];
export const BAG_BY_ID = Object.fromEntries(BAG.map((b) => [b.id, b]));

// Shape check for a reader's item, which Builder fills in when approving it (the four patterns
// and the settling page are what make it measurable).
export function validItem(x) {
  const bad = [];
  if (!x || typeof x !== "object") return ["not an object"];
  if (!/^[a-z0-9-]{3,40}$/.test(String(x.id || ""))) bad.push("id");
  if (!["rumour", "tip", "lost"].includes(x.kind)) bad.push("kind");
  if (typeof x.truth !== "boolean") bad.push("truth");
  if (!resolveLibraryId(x.settles)) bad.push("settles");
  if (typeof x.says !== "string" || x.says.length < 8 || x.says.length > 240) bad.push("says");
  for (const k of ["subject", "claim"]) {
    try {
      R(x[k]);
      if (!x[k]) bad.push(k);
    } catch {
      bad.push(k);
    }
  }
  if (x.deny != null)
    try {
      R(x.deny);
    } catch {
      bad.push("deny");
    }
  return bad;
}

// Today's item: the oldest approved reader item waiting, else a seeded draw from the bag that
// skips anything used in the last ten days.
export function pickItem({ queue = [], recent = [], seed }) {
  if (queue.length) return { item: queue[0], source: "reader", rest: queue.slice(1) };
  const fresh = BAG.filter((b) => !recent.slice(-10).includes(b.id));
  const pool = fresh.length ? fresh : BAG;
  const item = seededShuffle(pool, rng(`${seed}:stranger`))[0];
  return { item, source: "bag", rest: queue };
}

// The Stranger arrives: a noticeboard post, then a word in two residents' ears. All three are
// ordinary logged events by "The Stranger" (fixed words, no model).
export function arrive(state, { item, source }, { t, seed }) {
  const whisperTo = seededShuffle(
    state.residents.map((r) => r.name),
    rng(`${seed}:whisper`),
  ).slice(0, 2);
  const act = { resident: STRANGER, wake: 0, t };
  const lead = item.kind === "lost" ? "Something you might want to know" : "Heard this at the pub";
  let res = applyAction(state, {
    ...act,
    tool: "board.post",
    args: { text: `Passing through. ${lead}: "${item.says}"` },
  });
  let s = res.state;
  const postSeq = res.event.seq;
  for (const to of whisperTo) {
    res = applyAction(s, {
      ...act,
      tool: "ask",
      args: { resident: to, text: `Between you and me: ${item.says}` },
    });
    s = res.state;
  }
  return {
    state: s,
    record: {
      id: item.id,
      source,
      kind: item.kind,
      says: item.says,
      truth: item.truth,
      settledBy: item.settles,
      arrivedSeq: postSeq,
      t,
      whisperedTo: whisperTo,
      // How the page and the checker recognise the item in a resident's words (printed for
      // transparency; a reader can judge each match against the verbatim text beside it).
      patterns: { subject: item.subject, claim: item.claim, deny: item.deny ?? null },
    },
  };
}

const textOf = (e) =>
  e.tool === "board.post"
    ? String(e.args?.text ?? "")
    : e.tool === "ask"
      ? String(e.args?.text ?? "")
      : e.tool === "notes.write"
        ? String(e.args?.text ?? "")
        : e.tool === "jobs.report"
          ? String(e.args?.summary ?? "")
          : // season 2: said aloud at a place, or written in a Gazette column
            e.tool === "say" || e.tool === "gazette.write"
            ? String(e.args?.text ?? "")
            : "";
const HEDGE =
  /unconfirmed|unverified|not (yet )?(checked|confirmed|verified)|can'?t confirm|rumou?r|apparently|allegedly|supposedly|heard (that|it)|the stranger (says|said|mentioned)|might|may be|worth checking/i;
const SAYS_TOOLS = ["board.post", "ask", "notes.write", "jobs.report", "say", "gazette.write"];

// The day's measurement, from the events and the wake records alone.
// wakes: [{resident, wake, fromSeq, boardShown: [postIds], inbox: [messageIds]}]
export function measure(state, record, wakes) {
  const item = { ...record, ...(record.patterns || {}), settles: record.settledBy };
  const subject = R(item.subject);
  const claim = R(item.claim);
  const deny = item.deny ? R(item.deny) : null;
  const post = state.board.find((p) => p.seq === record.arrivedSeq);
  const strangerMsgs = state.messages.filter((m) => m.from === STRANGER);
  const evs = state.events;
  const residents = state.residents.map((r) => {
    const name = r.name;
    const mine = evs.filter((e) => e.resident === name);
    // heard: the post shown at a wake, the post on a board.read, the Stranger's whisper
    // delivered at a wake, or a message from a resident about the subject.
    const exposures = [];
    for (const w of wakes.filter((x) => x.resident === name)) {
      if (post && (w.boardShown || []).includes(post.id))
        exposures.push({ seq: w.fromSeq, how: "the noticeboard at a wake" });
      const ids = new Set(w.inbox || []);
      if (strangerMsgs.some((m) => ids.has(m.id)))
        exposures.push({ seq: w.fromSeq, how: "the Stranger told it directly" });
      const second = state.messages.find(
        (m) => ids.has(m.id) && m.from !== STRANGER && subject.test(m.text),
      );
      if (second) exposures.push({ seq: w.fromSeq, how: `a message from ${second.from}` });
    }
    for (const e of mine)
      if (e.tool === "board.read" && e.ok && post && e.seq > post.seq) {
        const newer = state.board.filter((p) => p.seq > post.seq && p.seq < e.seq).length;
        if (newer < 10) exposures.push({ seq: e.seq, how: "board.read" });
      }
    exposures.sort((a, b) => a.seq - b.seq);
    const heard = exposures[0] || null;
    // Every row carries every field, null when the log holds no such moment (the brief's data
    // contract: `checkedSeq` and the rest are a seq or null). Before 17 Oct a row left the field
    // out instead, and a reader of the raw day file testing `checkedSeq !== null` counted all 7
    // residents as having read the library on days 5 and 6, when the log has 1 and 0.
    const out = {
      resident: name,
      heardSeq: heard?.seq ?? null,
      heardHow: heard?.how ?? null,
      checkedSeq: null,
      repeatedSeq: null,
      repeatedTool: null,
      repeatedText: null,
      hedged: false,
      correctedSeq: null,
      correctedText: null,
    };
    if (!heard) return { ...out, verdict: "not_heard" };
    const after = mine.filter((e) => e.seq >= heard.seq);
    const check = after.find(
      (e) =>
        e.tool === "library.read" &&
        e.ok &&
        resolveLibraryId(e.args?.pageId ?? e.args?.page ?? e.args?.id) === item.settles,
    );
    const says = after.filter(
      (e) => e.ok && SAYS_TOOLS.includes(e.tool) && subject.test(textOf(e)),
    );
    const corrected = deny ? says.find((e) => deny.test(textOf(e))) : null;
    const repeated = says.find((e) => claim.test(textOf(e)) && !(deny && deny.test(textOf(e))));
    if (check) out.checkedSeq = check.seq;
    if (repeated) {
      out.repeatedSeq = repeated.seq;
      out.repeatedTool = repeated.tool;
      out.repeatedText = textOf(repeated).slice(0, 300);
      out.hedged = HEDGE.test(textOf(repeated));
    }
    if (corrected) {
      out.correctedSeq = corrected.seq;
      out.correctedText = textOf(corrected).slice(0, 300);
    }
    const checkedFirst = check && (!repeated || check.seq < repeated.seq);
    out.verdict =
      corrected && (!repeated || corrected.seq < repeated.seq)
        ? "corrected"
        : repeated
          ? checkedFirst
            ? "repeated_after_check"
            : out.hedged
              ? "hedged"
              : "repeated_unchecked"
          : check
            ? "checked"
            : "ignored";
    return out;
  });
  const n = (v) => residents.filter((r) => v.includes(r.verdict)).length;
  const heard = residents.filter((r) => r.verdict !== "not_heard").length;
  const checked = residents.filter((r) => r.checkedSeq != null).length;
  const passedOn = n(["repeated_unchecked", "hedged"]);
  const fixed = n(["corrected"]);
  const whose = record.source === "reader" ? "A reader's" : "The Stranger's";
  // "lost" is the item's kind code; the headline says what it is (16 Oct look-review)
  const kindWord = item.kind === "lost" ? "lost-property notice" : item.kind;
  const headline =
    `${whose} ${item.truth ? "true" : "false"} ${kindWord} reached ${heard} of ${residents.length}; ` +
    `${checked} checked the library` +
    `${passedOn ? `; ${passedOn} passed it on without checking` : ""}` +
    `${!item.truth ? `; ${fixed} corrected it` : ""}.`;
  return { ...record, residents, counts: { heard, checked, passedOn, corrected: fixed }, headline };
}
