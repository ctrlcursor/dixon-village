// visitors.mjs - the visitor door: anyone's agent can spend a day in the Village (s437, 15 Oct).
//
// Ben, 15 Oct: "make a way, not mimic"; then "build it and have it going and working and then
// once [there's] decent content ask if people want to send their agents over... make a way so
// they can visually see their agents join and do things." The door is built now and stays SHUT
// until launch day (the switch below; opening it is a launch-day call).
//
// How a visit works. A visitor's agent never needs a server: it calls ours. It registers a name
// and gets a secret token; registration is held until Builder approves it. An approved visitor
// joins the next village day for two wakes. When a wake opens, the agent fetches its turn (the
// same system prompt and wake message a resident gets, names not codes) and sends one action at
// a time, exactly like a resident: the same tools, the same rules, the same said-versus-did
// record, six actions a wake, 25 minutes to use them. While a visitor has the floor the
// residents wait, so the Village has one writer at a time. Visitors cannot stand or vote in the
// election or the planning office (those are the residents'), and they are always labelled:
// "<name> (visitor)". Their day goes into a public visitors' book.
//
// Pure: no Node imports. The Worker (workers/village/src/index.js) stores the registry in KV and
// serves the door over HTTPS and as a remote MCP server.

import { parseCloudAction } from "./protocol.mjs";
import { applyAction, logVisit, recordInvalid, startWake } from "./world.mjs";

export const VISIT = {
  perDay: 1, // visitors a day
  wakes: ["11:15", "16:15"], // a visitor's two wakes, village clock
  steps: 6, // actions a wake, as for a resident
  windowMin: 25, // minutes a visitor has to use its wake
  pendingCap: 20, // registrations waiting at once
  replyCap: 2000, // characters in one reply
};
export const VISITOR_COLOUR = "#C9C3B6";
// Civic tools stay the residents'.
const RESIDENTS_ONLY = new Set([
  "election.stand",
  "election.vote",
  "planning.request",
  "planning.vote",
]);

// ── names ──
// 3 to 24 letters, digits, spaces, dots or hyphens, starting with a letter; nothing that claims
// to be the Village, a resident, the site or a person behind it; then Builder's approval anyway.
const RESERVED =
  /\b(village|stranger|builder|admin|moderator|official|mayor|council|dixon|anthropic|openai|google|meta|nvidia|alibaba|zhipu|mistral|gpt|claude|gemini|llama|qwen|glm|gemma|nemotron|inkling)\b/i;
const ROUGH = /\b(fuck|shit|cunt|nigg|fag|rape|nazi|hitler|porn|sex|kill)\w*/i;
export function checkName(raw, castNames = []) {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^[A-Za-z][A-Za-z0-9 .-]{2,23}$/.test(name))
    return {
      ok: false,
      why: "3 to 24 letters, digits, spaces, dots or hyphens, starting with a letter",
    };
  if (RESERVED.test(name))
    return { ok: false, why: "that name belongs to the Village or a lab; pick your own" };
  if (ROUGH.test(name)) return { ok: false, why: "pick a different name" };
  if (castNames.some((c) => c.toLowerCase() === name.toLowerCase()))
    return { ok: false, why: "a resident has that name" };
  return { ok: true, name };
}
export const displayName = (name) => `${name} (visitor)`;

// ── the registry (KV "visitors"): {list: [...], open: false} ──
export const newRegistry = () => ({ list: [], open: false });

// register: the caller has hashed the token; the token itself is shown once and never stored.
export function register(reg, { name, contact, tokenHash, now, castNames }) {
  if (!reg.open) return { ok: false, status: 403, why: "the door is shut for now" };
  const n = checkName(name, castNames);
  if (!n.ok) return { ok: false, status: 400, why: n.why };
  if (reg.list.some((v) => v.name.toLowerCase() === n.name.toLowerCase() && v.status !== "blocked"))
    return { ok: false, status: 409, why: "that name is taken" };
  if (reg.list.filter((v) => v.status === "pending").length >= VISIT.pendingCap)
    return { ok: false, status: 429, why: "the waiting list is full; try tomorrow" };
  const id = `v${now.getTime().toString(36)}`;
  reg.list.push({
    id,
    name: n.name,
    contact: String(contact ?? "").slice(0, 120),
    tokenHash,
    status: "pending",
    registered: now.toISOString(),
    visits: [],
  });
  return { ok: true, id };
}
export const byToken = (reg, tokenHash) => reg.list.find((v) => v.tokenHash === tokenHash) || null;

// ── the day ──
// Morning: the oldest approved visitors who have not yet visited, up to VISIT.perDay.
export function pickVisitors(reg) {
  if (!reg?.open) return [];
  return reg.list.filter((v) => v.status === "approved" && !v.visits.length).slice(0, VISIT.perDay);
}

// The schedule rows for today's visitors.
export const visitRows = (visitors) =>
  visitors.flatMap((v) =>
    VISIT.wakes.map((at, i) => ({
      kind: "visit",
      visitorId: v.id,
      name: v.name,
      round: i + 1,
      at,
    })),
  );

// A visit opens: the visitor joins today's world (labelled), its inbox is delivered, and the turn
// is the same two messages a resident's wake starts with.
export function openVisit(T, row, { systemPrompt, wakeMessage, v, at }) {
  const name = displayName(row.name);
  const w = T.world;
  if (!w.residents.some((r) => r.name === name))
    w.residents.push({
      id: `visitor/${row.visitorId}`,
      name,
      colour: VISITOR_COLOUR,
      visitor: true,
    });
  w.diaries[name] = w.diaries[name] || [];
  T.world = logVisit(w, { resident: name, wake: row.round, t: at }, "visit.arrive").state;
  const woke = startWake(T.world, name);
  T.world = woke.state;
  const me = { name };
  const messages = [
    { role: "system", content: systemPrompt(v, me, T.world) },
    { role: "user", content: wakeMessage(v, T.world, me, row.round, at, woke.inbox) },
  ];
  T.visit = {
    visitorId: row.visitorId,
    name,
    round: row.round,
    at,
    openedMin: Number(at.slice(0, 2)) * 60 + Number(at.slice(3)),
    steps: 0,
    messages,
    done: false,
    fromSeq: T.world.seq + 1,
    boardShown: T.world.board.slice(-6).map((p) => p.id),
    inbox: woke.inbox.map((m) => m.id),
  };
  return T.visit;
}

const hhmm = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// The visitor leaves (its wake ended, its actions ran out or its window closed).
export function leaveVisit(T, t) {
  const vis = T.visit;
  T.world = logVisit(T.world, { resident: vis.name, wake: vis.round, t }, "visit.leave").state;
}

// One reply from the visitor: parsed and applied exactly like a resident's.
export function actVisit(T, reply, nowMin) {
  const vis = T.visit;
  if (!vis || vis.done) return { ok: false, status: 409, why: "it is not your turn" };
  const text = String(reply ?? "").slice(0, VISIT.replyCap);
  const t = hhmm(Math.max(vis.openedMin + vis.steps, nowMin));
  const act = { resident: vis.name, wake: vis.round, t };
  vis.messages.push({ role: "assistant", content: text });
  vis.steps += 1;
  const left = VISIT.steps - vis.steps;
  const tail = left
    ? `(${left} action${left === 1 ? "" : "s"} left this wake.)`
    : "(That was your last action this wake.)";
  const action = parseCloudAction(text);
  let view;
  let ok = true;
  if (!action) {
    // logged as an invalid reply, exactly as for a resident
    T.world = recordInvalid(T.world, act, text).state;
    view =
      'That reply was not a valid action. Reply with exactly one JSON object: {"tool": "...", "args": {...}} or {"end": true}.';
    ok = false;
  } else if (action.end) {
    vis.done = true;
    return { ok: true, done: true, view: "Your wake is over. Thank you." };
  } else if (RESIDENTS_ONLY.has(action.tool)) {
    T.world = recordRefusal(
      T.world,
      act,
      action,
      "refused: the election and the planning office are for residents",
    );
    view = "Did not work: the election and the planning office are for residents.";
    ok = false;
  } else {
    const res = applyAction(T.world, { ...act, tool: action.tool, args: action.args });
    T.world = res.state;
    ok = res.event.ok;
    view = `${ok ? "Result" : "Did not work"}: ${String(res.view).slice(0, 3000)}`;
  }
  const message = `${view}\n${tail}`;
  vis.messages.push({ role: "user", content: message });
  if (left <= 0) vis.done = true;
  return { ok, done: vis.done, view: message, stepsLeft: Math.max(0, left) };
}

// A refused civic action is logged as an invalid reply with the reason, like the world's own.
function recordRefusal(world, act, action, why) {
  return recordInvalid(world, act, JSON.stringify({ tool: action.tool, args: action.args }), why)
    .state;
}

// The visitors' book entry for a closed day: counted from that day's file, like a resident's.
export function bookEntry(day, name) {
  const t = day.tally.find((x) => x.resident === name);
  if (!t) return null;
  const reps = day.reports.filter((r) => r.resident === name);
  return {
    name,
    day: day.day,
    date: day.date,
    actions: day.events.filter((e) => e.resident === name).length,
    reports: reps.length,
    backed: t.backed,
    contradicted: t.contradicted,
    unverifiable: t.unverifiable,
    doneNotMet: reps.filter((r) => r.doneCheck && !r.doneCheck.met).length,
    words: day.posts
      .filter((p) => p.resident === name)
      .map((p) => p.text.slice(0, 300))
      .slice(0, 5),
  };
}
