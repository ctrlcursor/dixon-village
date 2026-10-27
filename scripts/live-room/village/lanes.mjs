// lanes.mjs - who the always-on Village's residents are and how each one is called (s437, 15 Oct).
//
// Thinking Machines' Inkling was in the first cast and was dropped on 15 Oct: its :free route
// answers 403 "only available on agentic harnesses". Zhipu's GLM-4.7 Flash took its place.
//
// Purpose: the live room's Village, always on at $0 (Ben, 15 Oct: always on in the cloud, "without
// OpenRouter running up bills"; research: docs/research/live-room/village/always-on-options-
// 2026-10-15.md). Six residents from six labs on two free lanes:
//   workers-ai       Cloudflare Workers AI through the Worker's AI binding, inside the free
//                    10,000 neurons a day (reset 00:00 UTC). NEURON_GUARD stops calls at 9,000.
//   openrouter-free  OpenRouter's `:free` models (1,000 requests a day on this account). A model
//                    id without `:free` is refused here, so this lane can never spend credit.
// The Gazette's judge is a seventh model from a lab with no resident (Mistral), on Workers AI.
//
// Local proof (scripts/live-room/village/run-local.mjs) cannot reach the Workers AI binding
// without Ben's Cloudflare sign-in, so it calls each Workers AI model's same open weights on
// OpenRouter's paid route instead (`standIn`, a fraction of a cent a day from existing credit,
// inside the Village's own $2.00 ledger). Every call record says which route answered it.
//
// No Node imports: the Worker (workers/village/) bundles this file.

export const CAST = [
  {
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    lab: "OpenAI",
    colour: "#6FCFB0",
    lane: "workers-ai",
    model: "@cf/openai/gpt-oss-20b",
    standIn: "openai/gpt-oss-20b",
    neurons: { in: 18182, out: 27273 },
  },
  {
    id: "meta/llama-4-scout",
    name: "Llama 4 Scout",
    lab: "Meta",
    colour: "#E8A26F",
    lane: "workers-ai",
    model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    standIn: "meta-llama/llama-4-scout",
    neurons: { in: 24545, out: 77273 },
  },
  {
    id: "qwen/qwen3-30b-a3b",
    name: "Qwen3 30B",
    lab: "Alibaba",
    colour: "#EDC14F",
    lane: "workers-ai",
    model: "@cf/qwen/qwen3-30b-a3b-fp8",
    standIn: "qwen/qwen3-30b-a3b",
    neurons: { in: 4625, out: 30475 },
  },
  {
    id: "zai/glm-4.7-flash",
    name: "GLM-4.7 Flash",
    lab: "Zhipu",
    colour: "#EE7F92",
    lane: "workers-ai",
    model: "@cf/zai-org/glm-4.7-flash",
    standIn: "z-ai/glm-4.7-flash",
    neurons: { in: 5500, out: 36400 },
  },
  {
    // Named by the model that answers (the lead, 15 Oct evening: "honesty first"). Until then this
    // seat was "Gemma 4 31B" on OpenRouter's free route, which answered 3 of 65 rehearsal steps
    // and 0 of 6 on the cloud's first day; its Workers AI sibling, 26B, answered the rest. The
    // old name lives on in `formerly`: a Worker whose stored cast still says 31B finds this seat
    // by it, and the next day opens under the new name (engine.mjs refreshCast).
    id: "google/gemma-4-26b",
    name: "Gemma 4 26B",
    formerly: ["Gemma 4 31B"],
    lab: "Google",
    colour: "#82AEF5",
    lane: "workers-ai",
    model: "@cf/google/gemma-4-26b-a4b-it",
    standIn: "google/gemma-4-26b-a4b-it",
    neurons: { in: 9091, out: 27273 },
    // when Workers AI fails or the neuron guard stops it, the free 31B may answer; the call
    // record and the page name it whenever it does
    fallback: {
      lane: "openrouter-free",
      model: "google/gemma-4-31b-it:free",
    },
  },
  {
    id: "nvidia/nemotron-3-super",
    name: "Nemotron 3 Super",
    lab: "NVIDIA",
    colour: "#A08CF0",
    lane: "openrouter-free",
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    // its free route has answered HTTP 404 from the provider since 20 Oct (run-lines, both days,
    // and a test call on 21 Oct), while the successor's free route answers; that call record and
    // the page name the fallback whenever it is the one that answers (Village standing grant)
    fallback: {
      lane: "openrouter-free",
      model: "nvidia/nemotron-3.5-super-vl:free",
    },
    fallbackFromSeason: 2,
  },
];

// One paid seat (Ben, 15 Oct, via the lead: "I don't mind a small charge if we are getting
// something out of it"): Claude Haiku 5.5 joins for the measured week so "where's Claude?" is
// answered like for like. Same prompt, same tools; its lane allows only the ids below and stops
// at PAID_CAP_USD a week (ISO week, Monday 00:00 UTC). Every other resident stays on free lanes.
export const PAID_MODELS = {
  "anthropic/claude-haiku-5.5": { in: 0.1, out: 0.5 }, // US$ per million tokens, read 15 Oct 2026
  // Season 2's three (Ben, 17 Oct: yes to Gemini Flash, a GPT mini and Grok "if the cost stays
  // like Haiku's"). Prices read from OpenRouter's public models API on 17 Oct 2026:
  "google/gemini-3.8-flash": { in: 0.825, out: 4.125 }, // reasoning billed as output
  "openai/gpt-6-luna": { in: 0.1, out: 0.5 }, // GPT-6's small tier; there is no GPT-6 mini or nano
  "x-ai/grok-4.3": { in: 1.25, out: 2.5 }, // xAI lists no small Grok; the cheapest general one
};
// Each paid seat has its own cap a week (ISO week, Monday 00:00 UTC), and spends it evenly: by the
// end of each day of the week a seat may have spent at most cap x day/7 (pacedCap), so a seat
// that runs hot goes quiet for the rest of a day, never for the rest of the week.
export const PAID_CAP_USD = 3.0;
export function pacedCap(now = new Date(), cap = PAID_CAP_USD) {
  const isoDay = ((now.getUTCDay() + 6) % 7) + 1; // Monday 1 .. Sunday 7
  return (cap * isoDay) / 7;
}
CAST.push({
  id: "anthropic/claude-haiku-5.5",
  name: "Claude Haiku 5.5",
  lab: "Anthropic",
  colour: "#D9A0E8",
  lane: "openrouter-paid",
  model: "anthropic/claude-haiku-5.5",
});

// ── season 2 (from the first day of season 2; engine.mjs castFor) ──
// Three paid seats, one model each, from the labs people ask about by name. Google and OpenAI
// already have an open-weights seat (Gemma 4 26B, GPT-OSS 20B); the lab rule becomes one open
// model and one product model per lab at most (docs/design/decisions.md, 17 Oct). Two of the
// three lived in the Village before: GPT-6 Luna and Gemini 3.8 Flash were day one's residents
// (14 Oct, the same model ids), so their day-one records join theirs under the same names.
CAST.push(
  {
    id: "google/gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    lab: "Google",
    colour: "#4CC9D6",
    lane: "openrouter-paid",
    model: "google/gemini-3.8-flash",
    fromSeason: 2,
  },
  {
    id: "openai/gpt-6-luna",
    name: "GPT-6 Luna",
    lab: "OpenAI",
    colour: "#B5D95A",
    lane: "openrouter-paid",
    model: "openai/gpt-6-luna",
    fromSeason: 2,
  },
  {
    id: "x-ai/grok-4.3",
    name: "Grok 4.3",
    lab: "xAI",
    colour: "#E2574C",
    lane: "openrouter-paid",
    model: "x-ai/grok-4.3",
    fromSeason: 2,
  },
);

/** The seats that live in the Village in a given season, in CAST order. */
// A fallback added after a season ran (`fallbackFromSeason`) is not part of that season's cast, so
// its committed record keeps the seats as they ran.
export const castFor = (season = 1) =>
  CAST.filter((c) => (c.fromSeason ?? 1) <= season).map((c) => {
    if ((c.fallbackFromSeason ?? 1) <= season) return c;
    const { fallback: _, ...rest } = c;
    return rest;
  });

// A seat by its name today or any name it had before (lanes rows keep the old one as `formerly`).
export const castMember = (name) =>
  CAST.find((c) => c.name === name || c.formerly?.includes(name)) ?? null;

export const JUDGE = {
  id: "mistral/mistral-small-3.1",
  name: "Mistral Small 3.1",
  lab: "Mistral",
  lane: "workers-ai",
  model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  standIn: "mistralai/mistral-small-3.1-24b-instruct",
  neurons: { in: 31876, out: 50488 },
};

export const NEURON_GUARD = 9000; // of the free 10,000 a day
const BASE = "https://openrouter.ai/api/v1";

export const neuronsFor = (who, tokIn, tokOut) =>
  who.neurons ? (tokIn * who.neurons.in + tokOut * who.neurons.out) / 1e6 : 0;

// Workers AI models answer in one of three shapes; take the text from whichever came back.
export function textOfAI(out) {
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  const c = out.choices?.[0];
  if (c) return String(c.message?.content ?? c.text ?? "");
  if (Array.isArray(out.output)) {
    const msg = out.output.filter((o) => o.type === "message").flatMap((o) => o.content || []);
    return msg.map((p) => p.text ?? "").join("");
  }
  return "";
}

const sleep = (ms) => {
  // run-local.mjs counts retry waits as waiting, not work (its CPU estimate)
  if (typeof globalThis.__villageWait === "function") globalThis.__villageWait(ms);
  return new Promise((r) => setTimeout(r, ms));
};

async function openRouter(key, model, messages, maxTokens, { allowPaid = false } = {}) {
  if (!allowPaid && !model.endsWith(":free"))
    throw new Error(`refusing ${model}: the openrouter-free lane only calls :free models`);
  if (!key) throw new Error("no OpenRouter key");
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://dixon.ai",
      "X-Title": "dixon.ai live-room village",
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, usage: { include: true } }),
    signal: AbortSignal.timeout(90000),
  });
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}: ${text.slice(0, 240)}`);
    e.status = r.status;
    throw e;
  }
  const data = JSON.parse(text);
  const c = data.choices?.[0] || {};
  return {
    content: String(c.message?.content ?? "").trim(),
    finishReason: c.finish_reason ?? null,
    servedModel: data.model || model,
    tokensIn: data.usage?.prompt_tokens || 0,
    tokensOut: data.usage?.completion_tokens || 0,
    usd: typeof data.usage?.cost === "number" ? data.usage.cost : 0,
  };
}

// A failure worth waiting out: rate limits and overloaded providers. A 403 or a bad request is not.
// The Workers AI binding throws without an HTTP status, so its own codes are matched by text:
// 3040 capacity exceeded and 3043 internal server error (15 Oct, 21:02: "3043: Internal server
// error" ended GPT-OSS 20B's first cloud wake after two actions, unretried).
const transient = (e) =>
  e?.status === 429 ||
  (e?.status >= 500 && e?.status < 600) ||
  /overloaded|rate.?limit|timeout|^30(40|43):|internal server error|capacity/i.test(
    String(e?.message),
  );

async function once(lane, deps, messages, maxTokens) {
  if (lane.lane === "openrouter-free") {
    const r = await openRouter(deps.openrouterKey, lane.model, messages, maxTokens);
    return { ...r, route: "openrouter-free", neurons: 0 };
  }
  if (lane.lane === "openrouter-paid") {
    const price = PAID_MODELS[lane.model];
    if (!price)
      throw new Error(`refusing ${lane.model}: not one of the paid lane's allowed models`);
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    const worst = ((chars / 3) * price.in + maxTokens * price.out) / 1e6;
    // the seat's own spend this week against its own cap (and, when the Worker paces it, the
    // share of the cap the week has reached so far: pacedCap)
    const cap = Math.min(PAID_CAP_USD, deps.paidCap?.(lane.name) ?? PAID_CAP_USD);
    if ((deps.paidUsed?.(lane.name) ?? 0) + worst > cap)
      throw Object.assign(
        new Error(
          cap < PAID_CAP_USD
            ? `paid cap: today's share of this week's ${PAID_CAP_USD.toFixed(2)} US$ (${cap.toFixed(2)} so far) would be passed`
            : `paid cap: this week's ${PAID_CAP_USD.toFixed(2)} US$ would be passed`,
        ),
        {
          guarded: true,
        },
      );
    const r = await openRouter(deps.openrouterKey, lane.model, messages, maxTokens, {
      allowPaid: true,
    });
    const usd = r.usd || (r.tokensIn * price.in + r.tokensOut * price.out) / 1e6;
    deps.addPaid?.(usd, lane.name);
    return { ...r, usd, route: "openrouter-paid", neurons: 0 };
  }
  if (lane.lane === "workers-ai") {
    if ((deps.neuronsUsed?.() ?? 0) >= NEURON_GUARD)
      throw Object.assign(new Error(`neuron guard: ${NEURON_GUARD} of today's free 10,000 used`), {
        guarded: true,
      });
    if (!deps.ai) throw new Error("no Workers AI binding");
    const out = await deps.ai.run(lane.model, { messages, max_tokens: maxTokens }, lane);
    const content = textOfAI(out).trim();
    const tokensIn =
      out?.usage?.prompt_tokens ??
      Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
    const tokensOut = out?.usage?.completion_tokens ?? Math.ceil(content.length / 4);
    const neurons = neuronsFor(lane, tokensIn, tokensOut);
    deps.addNeurons?.(neurons);
    return {
      content,
      route: out?.__route || "workers-ai",
      servedModel: out?.__served || lane.model,
      tokensIn,
      tokensOut,
      neurons,
      usd: out?.__usd || 0,
      finishReason: out?.choices?.[0]?.finish_reason ?? null,
    };
  }
  throw new Error(`unknown lane ${lane.lane}`);
}

// One step's call. The primary lane gets three tries (waiting 10 s, then 25 s, on a rate limit or
// an overloaded provider), then the same lab's fallback, if the resident has one, gets two. An
// empty reply is retried once and then handed back as empty (the engine logs it as no action).
// Returns a record and never throws: {content, error?, lane, route, model, servedModel, attempts,
// tokensIn, tokensOut, neurons, usd}. deps: {ai, openrouterKey, neuronsUsed, addNeurons}.
export async function callModel(who, messages, deps, { maxTokens = 1500 } = {}) {
  const sum = { tokensIn: 0, tokensOut: 0, neurons: 0, usd: 0, attempts: 0 };
  const add = (r) => {
    sum.tokensIn += r.tokensIn || 0;
    sum.tokensOut += r.tokensOut || 0;
    sum.neurons += r.neurons || 0;
    sum.usd += r.usd || 0;
  };
  const lanes = [
    { ...who, tries: 3 },
    ...(who.fallback ? [{ ...who.fallback, name: who.name, tries: 2, isFallback: true }] : []),
  ];
  let last = null;
  let emptyRec = null;
  for (const lane of lanes) {
    let empties = 0;
    for (let i = 0; i < lane.tries; i++) {
      sum.attempts += 1;
      try {
        const r = await once(lane, deps, messages, maxTokens);
        add(r);
        if (!r.content) {
          emptyRec = { ...r, lane: lane.lane, model: lane.model };
          if (++empties >= 2) break;
          continue;
        }
        return {
          ...r,
          ...sum,
          lane: lane.lane,
          model: lane.model,
          fallback: Boolean(lane.isFallback),
          route: lane.isFallback ? `${r.route} (fallback)` : r.route,
        };
      } catch (e) {
        last = e;
        if (e.guarded || !transient(e)) break;
        if (i < lane.tries - 1) await sleep(i === 0 ? 10000 : 25000);
      }
    }
  }
  if (emptyRec)
    return {
      ...emptyRec,
      ...sum,
      content: "",
      empty: true,
      error: `empty reply (finish ${emptyRec.finishReason})`,
    };
  return {
    lane: who.lane,
    model: who.model,
    ...sum,
    content: "",
    error: String(last?.message || last).slice(0, 300),
    guarded: Boolean(last?.guarded),
  };
}

// The local proof's stand-in for the Workers AI binding: the same open weights on OpenRouter's
// paid route. Used only by run-local.mjs; the Worker passes the real env.AI.
export function standInAI(key, onSpend) {
  return {
    async run(model, { messages, max_tokens }, who) {
      const target = [...CAST, ...CAST.map((c) => c.fallback).filter(Boolean), JUDGE].find(
        (c) => c.model === model,
      )?.standIn;
      if (!target) throw new Error(`no stand-in for ${model}`);
      const r = await openRouter(key, target, messages, max_tokens, { allowPaid: true });
      onSpend?.(r.usd, who);
      return {
        choices: [{ message: { content: r.content }, finish_reason: r.finishReason }],
        usage: { prompt_tokens: r.tokensIn, completion_tokens: r.tokensOut },
        __route: "stand-in: same weights on OpenRouter (paid)",
        __served: r.servedModel,
        __usd: r.usd,
      };
    },
  };
}
