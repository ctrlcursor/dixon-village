// protocol.mjs - the residents' reply protocol: one JSON action per reply (moved out of
// run-day.mjs unchanged, s437, so the Worker can share it without Node imports).

// ── the protocol parser: the first JSON object that is an action or an end ──
export function parseAction(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const found = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(t.slice(i, j + 1));
            const tool = obj?.tool ?? obj?.name ?? obj?.action;
            if (typeof tool === "string" && tool.trim()) {
              const args = obj.args ?? obj.arguments ?? obj.parameters ?? obj.input ?? {};
              found.push({ tool: tool.trim(), args: args && typeof args === "object" ? args : {} });
            } else if (obj?.end === true) found.push({ end: true });
          } catch {}
          if (found.length) i = j;
          break;
        }
      }
    }
    if (found.length) break;
  }
  if (!found.length) return null;
  // Count further action objects so the reply can be told only one was taken.
  const extra = (t.match(/"(?:tool|end)"\s*:/g) || []).length - 1;
  return { ...found[0], extra: Math.max(0, extra) };
}

// The always-on Village's parser (s437, 15 Oct): the same rule, plus one tolerance. GPT-OSS
// sometimes answers in its own native tool-call form, measured in the 15 Oct rehearsal:
//   <|channel|>commentary to=library.read <|constrain|>json<|message|>{"pageId": "market"}<|call|>
// which names one tool and its arguments as plainly as the JSON form does, so it is taken as
// that action. Day one's recorder (run-day.mjs) keeps the strict parseAction above.
const NATIVE = /to=([a-z]+\.[a-z]+)\b[^{]*?<\|message\|>\s*(\{[\s\S]*?\})\s*(?:<\|call\|>|$)/;
export function parseCloudAction(text) {
  const strict = parseAction(text);
  if (strict) return strict;
  const m = String(text || "").match(NATIVE);
  if (!m) return null;
  try {
    const args = JSON.parse(m[2]);
    return {
      tool: m[1],
      args: args && typeof args === "object" ? args : {},
      extra: 0,
      native: true,
    };
  } catch {
    return null;
  }
}
