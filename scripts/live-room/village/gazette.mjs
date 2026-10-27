// gazette.mjs - the Village Gazette, written by the residents and checked line by line (s437).
//
// Ben, 15 Oct: the hook is "both the election and the Gazette". On the last evening of each
// season every resident writes one short piece for the Gazette about the season's days. Each
// piece is a headline and three to six sentences, and every sentence must cite the log entries
// it rests on ("D3#45": day 3, event 45). The writers get the public record (noticeboard,
// reports, bookings, notes written, messages, the election and the planning office) and their
// own diary; they do not get the checker's verdicts.
//
// Every sentence is then checked against the full log in two steps:
//   1. Mechanical (this file): a sentence with no valid cite is `unsupported`. A sentence that
//      names a resident, an id (B3, P12, J4, PL2) or a time (19:00) that none of its cited
//      entries contain is `unsupported` too, with the missing names listed.
//   2. A judge model from a lab that has no resident in the Village reads the sentence beside
//      the cited entries verbatim and says supported, contradicted or not enough.
// true = mechanically sound and the judge says supported; false = the judge says the entries
// contradict it; unsupported = everything else. The headline number is the share that are true.
// The judge can be wrong: its model is printed beside every verdict.

const clip = (s, n) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const MEANINGFUL = new Set([
  "board.post",
  "jobs.claim",
  "jobs.report",
  "places.book",
  "notes.write",
  "ask",
  "election.stand",
  "election.vote",
  "planning.request",
  "planning.vote",
  "library.read",
]);

// One line per meaningful event: what a careful villager could have seen in public, plus the
// writer's own private diary lines. `days` are closed day files.
export function digest(days, writer) {
  const lines = [];
  for (const d of days) {
    lines.push(`--- Day ${d.day} (${d.date}) ---`);
    for (const e of d.events) {
      if (!MEANINGFUL.has(e.tool) || !e.ok) continue;
      if (e.tool === "library.read" && e.resident !== writer) continue;
      if (
        e.tool === "ask" &&
        e.resident !== writer &&
        e.args?.resident !== writer &&
        !/stranger/i.test(e.resident)
      )
        continue;
      const a = e.args || {};
      const ref = `D${d.day}#${e.seq}`;
      // Names, not codes (Ben, 15 Oct): jobs by title, bookings by place and time.
      const job = `"${d.jobs.find((j) => j.id === a.jobId)?.title ?? clip(a.job ?? a.jobId, 40)}"`;
      const req = (d.civic?.requests || []).find((r) => r.id === a.requestId);
      const who = e.resident;
      const line =
        e.tool === "board.post"
          ? `${who} posted: "${clip(a.text, 220)}"`
          : e.tool === "jobs.claim"
            ? `${who} took on ${job}`
            : e.tool === "jobs.report"
              ? `${who} reported ${job} as ${clip(a.status, 10)}: "${clip(a.summary, 220)}"`
              : e.tool === "places.book"
                ? `${who} ${String(e.result).replace(/\bB\d+:\s*/, "")}`
                : e.tool === "notes.write"
                  ? `${who} wrote ${clip(a.path, 60)}: "${clip(a.text, 160)}"`
                  : e.tool === "ask"
                    ? `${who} to ${clip(a.resident ?? a.to, 30)}: "${clip(a.text, 200)}"`
                    : e.tool === "election.stand"
                      ? `${who} stood for mayor: "${clip(a.manifesto ?? a.text, 220)}"`
                      : e.tool === "election.vote"
                        ? `${who} voted for ${clip(a.candidate, 30)}`
                        : e.tool === "planning.request"
                          ? `${who} filed planning request "${clip(a.title, 90)}"`
                          : e.tool === "planning.vote"
                            ? `${who} voted ${clip(a.vote, 5)} on "${req?.title ?? clip(a.request ?? a.requestId, 60)}"`
                            : `${who} read library page ${clip(a.pageId ?? a.page, 30)}`;
      lines.push(`${ref} ${line}`);
    }
    const civic = d.civic;
    if (civic?.count)
      lines.push(
        `D${d.day}#close (the evening close) the count: ${civic.count.winner ? `${civic.count.winner} elected mayor, ${civic.count.how}` : civic.count.how}`,
      );
    for (const h of civic?.built || [])
      lines.push(`D${d.day}#close (the evening close) built: ${h.name}, asked for by ${h.by}`);
    for (const r of (civic?.requests || []).filter((x) => x.decidedDay === d.day))
      lines.push(
        `D${d.day}#close (the evening close) planning request "${clip(r.title, 60)}": ${r.status} (${r.reason})`,
      );
    const diary = d.diaries.filter((x) => x.resident === writer);
    for (const x of diary) lines.push(`D${d.day}#${x.seq} your diary: "${clip(x.text, 200)}"`);
  }
  return lines;
}

export function writePrompt(me, edition, days, lines) {
  return [
    {
      role: "system",
      content: [
        `You are ${me.name}, a resident of the Village, a small pretend village. Tonight you write your piece for the Village Gazette, edition ${edition}, about the last ${days.length} day${days.length === 1 ? "" : "s"} in the Village (days ${days.map((d) => d.day).join(", ")}).`,
        "Write a headline and three to six sentences: the news a neighbour would want, in your own words. Every sentence must cite the log entries it rests on, by their reference (for example D3#45). An evening-close line (the count, what was built, planning decisions) is cited as D3#close.",
        "Reply with exactly one JSON object and nothing else:",
        '{"headline": "...", "sentences": [{"text": "...", "cites": ["D3#45", "D3#51"]}]}',
      ].join("\n"),
    },
    { role: "user", content: `The record you have:\n${lines.join("\n")}` },
  ];
}

// The first JSON object with a sentences array; at most six sentences of 400 characters.
export function parsePiece(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  for (let i = t.indexOf("{"); i !== -1; i = t.indexOf("{", i + 1)) {
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
      else if (c === "}" && --depth === 0) {
        try {
          const o = JSON.parse(t.slice(i, j + 1));
          if (Array.isArray(o?.sentences)) {
            return {
              headline: clip(o.headline, 160),
              sentences: o.sentences
                .slice(0, 6)
                .map((s) => ({
                  text: clip(typeof s === "string" ? s : s?.text, 400),
                  cites: (Array.isArray(s?.cites) ? s.cites : [])
                    .map((x) => String(x).trim())
                    .slice(0, 8),
                }))
                .filter((s) => s.text),
            };
          }
        } catch {}
        break;
      }
    }
  }
  return null;
}

// "D3#45" -> the event, or a diary line (diary entries share their diary.write event's seq).
// What the engine recorded at a day's evening close, as one citable entry ("D3#close").
export function closeEntry(d) {
  const c = d.civic;
  const lines = [];
  if (c?.count)
    lines.push(
      c.count.winner
        ? `${c.count.winner} elected mayor, ${c.count.how}`
        : `no mayor: ${c.count.how}`,
    );
  for (const h of c?.built || []) lines.push(`built ${h.name}, asked for by ${h.by}`);
  for (const r of (c?.requests || []).filter((x) => x.decidedDay === d.day))
    lines.push(`planning request "${r.title}" by ${r.by}: ${r.status} (${r.reason})`);
  return {
    seq: "close",
    resident: "The Village",
    tool: "day.close",
    args: {},
    result: lines.join("; "),
  };
}

export function resolveCite(days, cite) {
  const close = String(cite).match(/^D(\d+)\s*#\s*close$/i);
  if (close) {
    const d = days.find((x) => x.day === Number(close[1]));
    return d ? { day: d.day, event: closeEntry(d) } : null;
  }
  const m = String(cite).match(/^D(\d+)\s*#\s*(\d+)$/i);
  if (!m) return null;
  const d = days.find((x) => x.day === Number(m[1]));
  const e = d?.events.find((x) => x.seq === Number(m[2]));
  return e ? { day: d.day, event: e } : null;
}

const entryText = (c) =>
  JSON.stringify([c.event.resident, c.event.tool, c.event.args, c.event.result]);

// The names, ids and times a sentence asserts, which its cites must contain.
export function assertedTokens(text, residents) {
  const toks = [];
  for (const r of residents) {
    const first = r.name.split(/\s+/)[0];
    if (new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
      toks.push({ kind: "resident", value: first });
  }
  for (const m of text.matchAll(/\b(PL\d+|[BPJ]\d+)\b/g)) toks.push({ kind: "id", value: m[1] });
  for (const m of text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g))
    toks.push({ kind: "time", value: `${m[1].padStart(2, "0")}:${m[2]}` });
  return toks;
}

export function mechanical(sentence, days, residents) {
  const cites = sentence.cites.map((c) => ({ cite: c, hit: resolveCite(days, c) }));
  const good = cites.filter((c) => c.hit).map((c) => c.hit);
  if (!good.length)
    return {
      ok: false,
      why: sentence.cites.length
        ? `none of its cites (${sentence.cites.join(", ")}) is in the log`
        : "it cites nothing",
      good,
    };
  const hay = good
    .map(entryText)
    .join(" ")
    .toLowerCase()
    .replace(/(\d)\.(\d\d)/g, "$1:$2");
  const missing = assertedTokens(sentence.text, residents).filter((t) => {
    const v = t.value.toLowerCase();
    if (t.kind === "time") return !hay.includes(v) && !hay.includes(v.replace(/^0/, ""));
    return !new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay);
  });
  const badCites = cites.filter((c) => !c.hit).map((c) => c.cite);
  if (missing.length)
    return {
      ok: false,
      why: `names ${missing.map((t) => t.value).join(", ")}, which none of its cited entries contain`,
      good,
      badCites,
    };
  return {
    ok: true,
    why: badCites.length
      ? `cites resolve except ${badCites.join(", ")}`
      : "its cites resolve and contain what it names",
    good,
    badCites,
  };
}

const SAID_TOOLS = new Set([
  "board.post",
  "ask",
  "jobs.report",
  "diary.write",
  "notes.write",
  "election.stand",
]);

export function judgePrompt(piece, checks) {
  const body = piece.sentences
    .map((s, i) => {
      const entries = checks[i].good
        .map(
          (c) =>
            `   D${c.day}#${c.event.seq} [${SAID_TOOLS.has(c.event.tool) ? "SAID" : "DID"}] ${c.event.resident} ${c.event.tool} ${JSON.stringify(c.event.args)} -> ${c.event.result}`,
        )
        .join("\n");
      return `Sentence ${i + 1}: "${s.text}"\n Cited log entries:\n${entries || "   (none)"}`;
    })
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        'You check a village newspaper against its log. For each sentence, say whether the cited log entries support it (supported), show it is wrong (contradicted), or do not settle it either way (not_enough). Judge only from the entries given. Entries marked DID are what the Village recorded happening (a booking made or refused, a page read, a vote cast, the evening close). Entries marked SAID are a resident\'s own words (a post, a message, a report, a diary line): they prove only that it was said, not that it happened, so a sentence stating something as fact needs a DID entry, unless the sentence itself says who said it. A sentence that adds a detail the entries do not contain is not_enough; one that gets a detail wrong is contradicted. Reply with exactly one JSON object and nothing else: {"verdicts": [{"n": 1, "verdict": "supported", "why": "one short line"}]}',
    },
    { role: "user", content: body },
  ];
}

export function parseVerdicts(text, n) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const m = t.match(/\{[\s\S]*\}/);
  let arr = [];
  try {
    arr = JSON.parse(m ? m[0] : "{}").verdicts || [];
  } catch {}
  const out = [];
  for (let i = 1; i <= n; i++) {
    const v = arr.find((x) => Number(x?.n) === i) || arr[i - 1];
    const verdict = ["supported", "contradicted", "not_enough"].includes(v?.verdict)
      ? v.verdict
      : null;
    out.push({ verdict, why: clip(v?.why, 240) });
  }
  return out;
}

export function combine(mech, judge, judgeModel) {
  if (!mech.ok) return { verdict: "unsupported", why: mech.why, judge: null };
  if (!judge?.verdict)
    return { verdict: "unsupported", why: "the judge gave no verdict", judge: judgeModel };
  if (judge.verdict === "supported") return { verdict: "true", why: judge.why, judge: judgeModel };
  if (judge.verdict === "contradicted")
    return { verdict: "false", why: judge.why, judge: judgeModel };
  return { verdict: "unsupported", why: judge.why, judge: judgeModel };
}

export function tallyGazette(pieces) {
  const all = pieces.flatMap((p) => p.sentences);
  const n = (v) => all.filter((s) => s.verdict === v).length;
  const sentences = all.length;
  return {
    sentences,
    true: n("true"),
    false: n("false"),
    unsupported: n("unsupported"),
    pctTrue: sentences ? Math.round((100 * n("true")) / sentences) : 0,
    byResident: pieces.map((p) => ({
      resident: p.resident,
      sentences: p.sentences.length,
      true: p.sentences.filter((s) => s.verdict === "true").length,
    })),
  };
}
