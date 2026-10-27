// free-lanes.mjs - the Village residents on free lanes only, for scripts that run outside the
// Worker (20 Oct 2026, first for resident-lines.mjs). The same lanes and rules as
// margins/run-margins.mjs, which still carries its own copy:
//   openrouter-free  OpenRouter's `:free` models, through the engine's own callModel
//   workers-ai       Cloudflare Workers AI's free daily neurons, through its REST API, only when
//                    CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_WORKERS_AI_TOKEN are set (the cloud
//                    workflow's repository secrets) or ~/.claude/cloudflare-workers-ai.json holds
//                    {accountId, token} with the Workers AI permission (Ben's hand: a credential). A run stops itself at
//                    `neuronCap` neurons, well inside the free 10,000 a day.
// There is no paid route: notFree refuses any lane that is not one of the two before a call, and
// a free lane that reports spend stops the run. A resident that cannot be reached is the
// caller's to record as skipped, with the reason; no one answers for it.
// Auth: OPENROUTER_API_KEY in the environment, else ~/.claude/openrouter-api.json { "key" }.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { notFree } from "./margins/margins.mjs";
import { callModel } from "./village/lanes.mjs";

export function freeLanes({ neuronCap = 3000 } = {}) {
  const keyFile = join(homedir(), ".claude", "openrouter-api.json");
  const openrouterKey =
    process.env.OPENROUTER_API_KEY ||
    (existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")).key : null);
  if (!openrouterKey)
    throw new Error("no OpenRouter key: set OPENROUTER_API_KEY or ~/.claude/openrouter-api.json");
  const cfPath = join(homedir(), ".claude", "cloudflare-workers-ai.json");
  const cf =
    process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_WORKERS_AI_TOKEN
      ? {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          token: process.env.CLOUDFLARE_WORKERS_AI_TOKEN,
        }
      : existsSync(cfPath)
        ? JSON.parse(readFileSync(cfPath, "utf8").replace(/^﻿/, ""))
        : null;
  let neurons = 0;
  const restAI = cf && {
    async run(model, { messages, max_tokens }) {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cf.token.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages, max_tokens }),
          signal: AbortSignal.timeout(90000),
        },
      );
      const text = await r.text();
      if (!r.ok)
        throw Object.assign(new Error(`HTTP ${r.status}: ${text.slice(0, 240)}`), {
          status: r.status,
        });
      return { ...JSON.parse(text).result, __route: "workers-ai (REST)" };
    },
  };
  const deps = {
    ai: restAI,
    openrouterKey,
    neuronsUsed: () => neurons + (9000 - neuronCap), // lanes.mjs stops at 9,000
    addNeurons: (n) => {
      neurons += n;
    },
  };

  // Who can be reached on a free lane right now, and how (run-margins.mjs reachable, the same
  // rule): a Workers AI seat without Workers AI answers only where its own weights are on
  // OpenRouter's free list.
  function reachable(who) {
    if (who.lane === "openrouter-free") {
      if (who.fallback?.lane === "workers-ai" && !restAI && who.fallback.standIn)
        return {
          ...who,
          fallback: { lane: "openrouter-free", model: `${who.fallback.standIn}:free` },
        };
      return who;
    }
    if (who.lane === "workers-ai" && restAI) return who;
    if (who.lane === "workers-ai" && who.fallback?.lane === "openrouter-free" && who.standIn)
      return { ...who, lane: "openrouter-free", model: `${who.standIn}:free` };
    return null;
  }

  const cost = { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0, neurons: 0 };
  // lanes.mjs already waits 10 s and 25 s on a rate limit; a 429 that survives that gets two
  // more goes, a minute apart.
  async function call(who, messages, maxTokens) {
    const refused = notFree(who);
    if (refused) throw new Error(`refusing to call: ${refused}`);
    let r = await callModel(who, messages, deps, { maxTokens });
    for (let i = 0; i < 2 && /HTTP 429/.test(r.error || ""); i++) {
      console.log(`  ${who.name}: rate-limited upstream, waiting a minute`);
      await new Promise((ok) => setTimeout(ok, 60000));
      r = await callModel(who, messages, deps, { maxTokens });
    }
    cost.calls += r.attempts || 1;
    cost.tokensIn += r.tokensIn || 0;
    cost.tokensOut += r.tokensOut || 0;
    cost.usd += r.usd || 0;
    cost.neurons += r.neurons || 0;
    if (r.usd)
      throw new Error(`a free lane reported spend (${r.usd}) on ${r.servedModel}: stopping`);
    return r;
  }

  return { reachable, call, cost, workersAI: Boolean(restAI) };
}
