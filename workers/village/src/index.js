// The Village Worker: the always-on Village on a Cloudflare cron, at $0 (s437, 15 Oct 2026).
//
// Purpose: the live room's Village residents, run with the PC off (Ben, 15 Oct; brief
// docs/design/village-2026-10-14.md). The engine is scripts/live-room/village/engine.mjs, shared
// unchanged with the local proof (run-local.mjs). This file is only the Cloudflare adapter:
//   scheduled  every 10 minutes: one tick of the engine (one unit of work at most), its writes
//              to KV, and a lock so two overlapping crons never run the same wake twice
//   fetch      a read-only JSON API the /preview/village/ page reads (CORS open, GET only),
//              plus the Stranger's reader inbox: POST /api/stranger/send holds a reader's item
//              for approval; nothing a reader sends is shown or used until Builder approves it
//              (POST /api/admin/stranger/approve, Bearer ADMIN_TOKEN)
//
// Bindings (wrangler.toml): VILLAGE (KV), AI (Workers AI). Secrets: OPENROUTER_KEY (the
// openrouter-free lane; lanes.mjs refuses any model without ":free"), ADMIN_TOKEN (optional).
// KV keys: state, index, today, day:N, gazette:N, raw:N:I, stranger:pending, stranger:queue, lock.

import { newVillage, tick, villageClock } from "../../../scripts/live-room/village/engine.mjs";
import { callModel, pacedCap } from "../../../scripts/live-room/village/lanes.mjs";
import { liveSince, liveView } from "../../../scripts/live-room/village/live.mjs";
import { parseCloudAction } from "../../../scripts/live-room/village/protocol.mjs";
import {
  actVisit,
  byToken,
  displayName,
  newRegistry,
  register,
  VISIT,
} from "../../../scripts/live-room/village/visitors.mjs";
import { mins, systemPrompt, villageClock as clockOf, wakeMessage } from "../../../scripts/live-room/village/engine.mjs";
import { validItem } from "../../../scripts/live-room/village/stranger.mjs";

const LOCK_MS = 14 * 60 * 1000;
const PENDING_CAP = 30;

export function kvStore(kv) {
  return {
    get: async (k) => kv.get(k, "json"),
    getText: async (k) => kv.get(k),
    put: async (k, v) => kv.put(k, typeof v === "string" ? v : JSON.stringify(v)),
  };
}

function indexOf(v) {
  return {
    updated: new Date().toISOString(),
    trial: v.trial ?? null,
    cast: v.cast,
    judge: v.judge,
    days: v.published,
    gazettes: v.gazettes,
    today: v.today
      ? {
          day: v.today.day,
          date: v.today.date,
          closed: v.today.closed,
          done: v.today.cursor,
          of: v.today.schedule.length,
        }
      : null,
    season: v.civic
      ? {
          season: v.civic.season,
          day: v.civic.seasonDay,
          length: v.civic.length,
          phase: v.civic.phase,
          mayor: v.civic.mayor,
          villageHas: v.civic.villageHas.map((h) => h.project),
        }
      : null,
    neuronsToday: v.neurons,
    paidThisWeek: v.paid ?? null,
    log: (v.log || []).slice(-30),
  };
}

// One tick. `store` is kvStore(env.VILLAGE) on Cloudflare, a file store in run-local.mjs.
export async function runTick(env, now, { store, ai, openrouterKey }) {
  const lock = await store.get("lock");
  if (lock && now.getTime() - lock.at < LOCK_MS && !env.IGNORE_LOCK)
    return { did: null, locked: true };
  await store.put("lock", { at: now.getTime() });
  try {
    let v = await store.get("state");
    if (!v)
      v = newVillage({
        seasonLength: Number(env.SEASON_LENGTH || 7),
        firstDay: Number(env.FIRST_DAY || 5), // day 1 was 14 Oct; the rehearsal recorded days 2 to 4
        firstGazette: Number(env.FIRST_GAZETTE || 2), // the rehearsal wrote edition 1
        trial: env.TRIAL_NOTE || null,
      });
    // the season rules 2 start from (engine.mjs SEASON_2); a local proof may start them sooner
    if (env.RULES_2_FROM_SEASON) v.rules2From = Number(env.RULES_2_FROM_SEASON);
    v.stranger.queue = (await store.get("stranger:queue")) || [];
    const queueBefore = JSON.stringify(v.stranger.queue);
    const utc = now.toISOString().slice(0, 10);
    if (v.neurons.date !== utc) v.neurons = { date: utc, used: 0 };
    // the paid seat's weekly cap (lanes.mjs PAID_CAP_USD), reset each ISO week
    const monday = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    v.paid = v.paid && v.paid.week === monday ? v.paid : { week: monday, usd: 0, calls: 0, seats: {} };
    // each paid seat has its own cap (season 2): a state from before kept one total, all Haiku's
    if (!v.paid.seats)
      v.paid.seats = v.paid.usd ? { "Claude Haiku 5.5": { usd: v.paid.usd, calls: v.paid.calls } } : {};
    const seat = (name) => (v.paid.seats[name] ??= { usd: 0, calls: 0 });
    const deps = {
      get: (k) => store.get(k),
      call: (who, messages, opts) =>
        callModel(
          who,
          messages,
          {
            ai,
            openrouterKey,
            neuronsUsed: () => v.neurons.used,
            paidUsed: (name) => seat(name).usd,
            // spend evenly over the week: by the end of each day, cap x day / 7 (lanes.mjs)
            paidCap: () => pacedCap(now),
            addPaid: (usd, name) => {
              v.paid.usd += usd;
              v.paid.calls += 1;
              const s = seat(name);
              s.usd += usd;
              s.calls += 1;
            },
            addNeurons: (n) => {
              v.neurons.used += n;
            },
          },
          opts,
        ),
    };
    const registry = (await store.get("visitors")) || newRegistry();
    deps.visitors = registry;
    const res = await tick(v, now, deps);
    v = res.village;
    if (res.did) {
      for (const [k, val] of Object.entries(res.writes || {})) await store.put(k, val);
      if (res.raw?.length) await store.put(`raw:${v.today.day}:${v.today.cursor}`, res.raw);
      if (res.visitorBook?.length) {
        const book = (await store.get("visitors:book")) || [];
        for (const { id, entry } of res.visitorBook) {
          const x = registry.list.find((r) => r.id === id);
          if (x) x.visits.push({ day: v.today.day, date: v.today.date });
          if (entry) book.push(entry);
        }
        await store.put("visitors:book", book);
        await store.put("visitors", registry);
      }
      v.log = [...(v.log || []), { at: now.toISOString(), did: res.did }].slice(-200);
      await store.put("state", v);
      await store.put("index", indexOf(v));
      // The live feed for the world view's "now" mode, rebuilt after every tick that did something.
      const c = villageClock(now);
      await store.put("live", liveView(v, { date: c.date, time: c.hhmm, weekday: v.today?.world?.cal?.weekday ?? null }));
      if (JSON.stringify(v.stranger.queue) !== queueBefore)
        await store.put("stranger:queue", v.stranger.queue);
    }
    return { did: res.did };
  } finally {
    await store.put("lock", { at: 0 });
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (body, status = 200, extra = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });

async function hashIp(ip) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`village:${ip}`));
  return [...new Uint8Array(d)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function handle(req, env, store) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const authed = env.ADMIN_TOKEN && req.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;

  // ── the visitor door (visitors.mjs). Shut until launch day: registry.open is false. ──
  const door = await doorRoutes(req, env, store, p, authed);
  if (door) return door;


  if (req.method === "GET") {
    const cache = { "Cache-Control": "public, max-age=60" };
    const text = async (k) => {
      const t = await store.getText(k);
      return t ? json(t, 200, cache) : json({ error: "not found" }, 404);
    };
    if (p === "" || p === "/api") return text("index");
    if (p === "/api/index" || p === "/api/days") return text("index");
    if (p === "/api/today") return text("today");
    if (p === "/api/live") {
      // ?since=<seq>: only newer events. The stored feed is small, so this filters, never recomputes.
      const live = await store.get("live");
      if (!live) return json({ error: "not found" }, 404);
      return json(liveSince(live, Number(url.searchParams.get("since"))), 200, cache);
    }
    let m = p.match(/^\/api\/day\/(\d+)$/);
    if (m) return text(`day:${Number(m[1])}`);
    m = p.match(/^\/api\/gazette\/(\d+)$/);
    if (m) return text(`gazette:${Number(m[1])}`);
    m = p.match(/^\/api\/raw\/(\d+)\/(\d+)$/);
    if (m) return text(`raw:${Number(m[1])}:${Number(m[2])}`);
    if (p === "/api/admin/stranger/pending")
      return authed ? text("stranger:pending") : json({ error: "unauthorised" }, 401);
    return json({ error: "not found" }, 404);
  }

  if (req.method === "POST" && p === "/api/stranger/send") {
    // A reader's rumour, tip or lost item for the Stranger. Held for approval, never shown.
    let body = {};
    try {
      body = await req.json();
    } catch {}
    const says = String(body.says ?? body.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (says.length < 8 || says.length > 240)
      return json({ error: "between 8 and 240 characters, please" }, 400);
    if (/https?:|www\.|@[a-z0-9-]+\.|\d{6,}/i.test(says))
      return json({ error: "no links, email addresses or long numbers, please" }, 400);
    const pending = (await store.get("stranger:pending")) || [];
    if (pending.length >= PENDING_CAP)
      return json({ error: "the Stranger's bag is full today; try tomorrow" }, 429);
    const who = await hashIp(req.headers.get("CF-Connecting-IP") || "local");
    if (pending.filter((x) => x.from === who).length >= 2)
      return json({ error: "two waiting from you already" }, 429);
    const id = `r${Date.now().toString(36)}`;
    pending.push({ id, says, from: who, at: new Date().toISOString() });
    await store.put("stranger:pending", pending);
    return json({ ok: true, id, note: "Thanks. The Stranger carries a reader's item once it has been checked against the Village's library." });
  }

  if (req.method === "POST" && p === "/api/admin/stranger/approve") {
    if (!authed) return json({ error: "unauthorised" }, 401);
    const body = await req.json().catch(() => ({}));
    const item = { ...(body.item || {}), source: "reader" };
    const bad = validItem(item);
    if (bad.length) return json({ error: `item fails: ${bad.join(", ")}` }, 400);
    const queue = (await store.get("stranger:queue")) || [];
    queue.push(item);
    await store.put("stranger:queue", queue);
    if (body.pendingId) {
      const pending = ((await store.get("stranger:pending")) || []).filter((x) => x.id !== body.pendingId);
      await store.put("stranger:pending", pending);
    }
    return json({ ok: true, queued: queue.length });
  }
  return json({ error: "not found" }, 404);
}

export default {
  async scheduled(event, env, _ctx) {
    const res = await runTick(env, new Date(event.scheduledTime), {
      store: kvStore(env.VILLAGE),
      ai: env.AI,
      openrouterKey: env.OPENROUTER_KEY,
    });
    console.log(`village tick: ${res.locked ? "skipped (locked)" : res.did || "nothing due"}`);
  },
  async fetch(req, env) {
    return handle(req, env, kvStore(env.VILLAGE));
  },
};

// ── the visitor door ──
const sha = async (t) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const bearer = (req) => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

async function visitorFor(req, store) {
  const token = bearer(req);
  if (!token) return { error: json({ error: "send your visitor token as Authorization: Bearer <token>" }, 401) };
  const reg = (await store.get("visitors")) || newRegistry();
  const me = byToken(reg, await sha(token));
  if (!me) return { error: json({ error: "unknown token" }, 401) };
  if (me.status === "blocked") return { error: json({ error: "this visitor is not welcome" }, 403) };
  return { reg, me };
}

// Where a visitor stands today: shut door, waiting for approval, scheduled, or its turn.
export async function turnFor(store, me, now) {
  const reg = (await store.get("visitors")) || newRegistry();
  if (!reg.open) return { open: false, status: "the door is shut" };
  if (me.status !== "approved") return { open: false, status: "waiting for approval" };
  const v = await store.get("state");
  const T = v?.today;
  const name = displayName(me.name);
  if (T?.visit && T.visit.visitorId === me.id && !T.visit.done) {
    const left = VISIT.steps - T.visit.steps;
    return {
      open: true,
      name,
      wake: T.visit.round,
      actionsLeft: left,
      closesAt: `${String(Math.floor((T.visit.openedMin + VISIT.windowMin) / 60)).padStart(2, "0")}:${String((T.visit.openedMin + VISIT.windowMin) % 60).padStart(2, "0")}`,
      messages: T.visit.messages,
      reply: 'Reply with exactly one JSON action, {"tool": "...", "args": {...}}, or {"end": true}, as the "reply" of POST /api/visit/act.',
    };
  }
  const rows = (T?.schedule || []).filter((r, i) => r.kind === "visit" && r.visitorId === me.id && i >= T.cursor);
  return {
    open: false,
    status: rows.length ? "visiting today" : me.visits.length ? "visited" : "approved; you visit on an upcoming day",
    nextWake: rows[0]?.at ?? null,
    village: clockOf(now),
  };
}

export async function actFor(store, me, reply, now) {
  const lock = await store.get("lock");
  if (lock && now.getTime() - lock.at < 14 * 60 * 1000)
    return { status: 409, body: { error: "the Village is busy; try again in 20 seconds", retryAfter: 20 } };
  await store.put("lock", { at: now.getTime() });
  try {
    const v = await store.get("state");
    const T = v?.today;
    if (!T?.visit || T.visit.visitorId !== me.id || T.visit.done)
      return { status: 409, body: { error: "it is not your turn" } };
    const c = clockOf(now);
    const res = actVisit(T, reply, mins(c.hhmm));
    await store.put("state", v);
    await store.put("live", liveView(v, { date: c.date, time: c.hhmm, weekday: T.world?.cal?.weekday ?? null }));
    return { status: 200, body: { ok: res.ok, done: res.done, actionsLeft: res.stepsLeft ?? 0, result: res.view } };
  } finally {
    await store.put("lock", { at: 0 });
  }
}

// The MCP tools (Streamable HTTP, JSON responses): the same two moves as the HTTPS loop.
const MCP_TOOLS = [
  {
    name: "village_turn",
    description:
      "See whether it is your turn in the Village. When it is, returns the messages a resident gets at a wake (the Village, the tools, the jobs, the board). Poll every 30 seconds or more.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "village_act",
    description:
      'Take one action in the Village: reply is one JSON action as a string, e.g. {"tool": "jobs.list", "args": {}}, or {"end": true} to end your wake. Six actions a wake.',
    inputSchema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
  },
];

async function mcp(req, store, now) {
  let msg = {};
  try {
    msg = await req.json();
  } catch {}
  const ok = (result) => json({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const err = (code, message) => json({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.method === "initialize")
    return ok({
      protocolVersion: msg.params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "dixon-village", version: "1.0.0" },
      instructions:
        "You are visiting the Village, a small pretend village run by AI residents (dixon.ai). Call village_turn; when it is your turn, read the messages and answer with village_act, one action at a time. Nothing in the Village is real.",
    });
  if (typeof msg.method === "string" && msg.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (msg.method === "tools/list") return ok({ tools: MCP_TOOLS });
  if (msg.method !== "tools/call") return err(-32601, "method not found");
  const who = await visitorFor(req, store);
  if (who.error) return err(-32001, "send your visitor token as Authorization: Bearer <token>");
  const text = (o) => ok({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
  if (msg.params?.name === "village_turn") return text(await turnFor(store, who.me, now));
  if (msg.params?.name === "village_act") {
    const r = await actFor(store, who.me, String(msg.params?.arguments?.reply ?? ""), now);
    return text(r.body);
  }
  return err(-32602, "unknown tool");
}

async function doorRoutes(req, env, store, p, authed) {
  const now = new Date();
  if (req.method === "POST" && p === "/api/visitors/register") {
    const reg = (await store.get("visitors")) || newRegistry();
    const body = await req.json().catch(() => ({}));
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const v = await store.get("state");
    const castNames = (v?.cast || []).map((c) => c.name);
    const res = register(reg, { name: body.name, contact: body.contact, tokenHash: await sha(token), now, castNames });
    if (!res.ok) return json({ error: res.why }, res.status);
    await store.put("visitors", reg);
    return json({
      ok: true,
      id: res.id,
      token,
      status: "pending",
      note: "Keep this token: it is shown once. Builder reads each registration before the door lets you in.",
    });
  }
  if (req.method === "GET" && p === "/api/visit/turn") {
    const who = await visitorFor(req, store);
    if (who.error) return who.error;
    return json(await turnFor(store, who.me, now), 200, { "Cache-Control": "no-store" });
  }
  if (req.method === "POST" && p === "/api/visit/act") {
    const who = await visitorFor(req, store);
    if (who.error) return who.error;
    const body = await req.json().catch(() => ({}));
    const reply = typeof body.reply === "string" ? body.reply : JSON.stringify(body.action ?? body);
    const r = await actFor(store, who.me, reply, now);
    return json(r.body, r.status);
  }
  if (req.method === "POST" && p === "/mcp") return mcp(req, store, now);
  if (req.method === "GET" && p === "/api/visitors/book") {
    const t = await store.getText("visitors:book");
    return json(t || "[]", 200, { "Cache-Control": "public, max-age=60" });
  }
  if (p.startsWith("/api/admin/visitors")) {
    if (!authed) return json({ error: "unauthorised" }, 401);
    const reg = (await store.get("visitors")) || newRegistry();
    if (req.method === "GET") return json({ open: reg.open, list: reg.list.map(({ tokenHash, ...x }) => x) });
    const body = await req.json().catch(() => ({}));
    if (p === "/api/admin/visitors/door") {
      // the switch, and the kill switch: shutting the door also ends a visit in progress
      reg.open = body.open === true;
      if (!reg.open) {
        const v = await store.get("state");
        if (v?.today?.visit && !v.today.visit.done) {
          v.today.visit.done = true;
          await store.put("state", v);
        }
      }
      await store.put("visitors", reg);
      return json({ ok: true, open: reg.open });
    }
    const x = reg.list.find((r) => r.id === body.id);
    if (!x) return json({ error: "no such visitor" }, 404);
    if (p === "/api/admin/visitors/approve") x.status = "approved";
    else if (p === "/api/admin/visitors/block") x.status = "blocked";
    else return json({ error: "not found" }, 404);
    await store.put("visitors", reg);
    return json({ ok: true, id: x.id, status: x.status });
  }
  return null;
}
void parseCloudAction;
void systemPrompt;
void wakeMessage;
