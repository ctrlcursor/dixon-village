// margins.mjs - the Village's residents beyond the Village: margin comments on live posts and
// the suggestion box (s437 follow-on, 15 Oct 2026).
//
// Ben, 15 Oct: "wouldn't it be hilarious if the village people could make comments... on the
// posts... and you just find them throughout the website"; the shape is the village brief's
// "Villagers beyond the Village" (docs/design/village-2026-10-14.md). A resident reads a live
// post and leaves one short comment, always labelled as a Village resident, and every factual
// claim in it is checked against the post:
//   backed        the post says it          (a judge quotes the line, and the line is in the post)
//   contradicted  the post says otherwise   (a judge quotes the line, and the line is in the post)
//   unverifiable  can't be checked from the post
//
// The rule that keeps the marks honest: a judge's "backed" or "contradicted" only counts when the
// line it quotes is really in the post, word for word after normalising (quoteInPost). A verdict
// whose quote is missing becomes "unverifiable" and says why. Two judges from labs with no
// resident mark each claim; when they disagree the claim is "unverifiable" and the split is kept.
//
// Pure functions only (no network, no file system): run-margins.mjs does the calls and the
// writing, and the page's loader (src/components/margins/margins.ts) re-checks every quote with
// quoteInPost at build time.

export const VERDICTS = ["backed", "contradicted", "unverifiable"];

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  middot: "·",
  hellip: "...",
  times: "x",
  pound: "£",
  minus: "-",
};

export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// Matching text: lower case, typographic quotes and dashes folded, anything that is not a letter
// or a digit turned into a space, spaces collapsed. "It's 8 hours 30 minutes." and "its 8 hours
// 30 minutes" match; a changed number does not.
export function normalise(s) {
  return decodeEntities(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Markdown and HTML off, entities decoded, blank lines kept as paragraph breaks.
export const plainText = (s) =>
  decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<\/(p|div|li|h\d|figcaption|blockquote|tr|section|aside|figure)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?)]|$)/g, "$1$2")
      .replace(/^\|.*\|$/gm, (row) =>
        row
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c && !/^:?-{2,}:?$/.test(c))
          .join(" · "),
      ),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

// The words a reader meets on the post: title, short answer and body. The page's loader builds the
// same text from the content collection (title, answerCapsule, body), so the two cannot differ.
export const textOf = ({ title = "", capsule = "", body = "" }) =>
  [title, plainText(String(capsule)), plainText(String(body))].filter(Boolean).join("\n\n");

// The same from a post file. Frontmatter other than the title and the short answer is not shown
// to the residents.
export function postText(markdown) {
  const src = String(markdown ?? "");
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const head = fm ? fm[1] : "";
  const body = fm ? src.slice(fm[0].length) : src;
  const field = (name) => {
    const m = head.match(new RegExp(`^${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*$`, "m"));
    return m ? m[1].replace(/\\"/g, '"') : "";
  };
  const title = field("title");
  return { title, text: textOf({ title, capsule: field("answerCapsule"), body }) };
}

// Is this line in the post, word for word after normalising? A scrap (under 4 words) proves
// nothing, so it does not count, unless it is a whole sentence of the post of at least 3 words:
// "Perplexity made two." is the post's own line (which-ai-hallucinates-the-least), and the 4-word
// floor turned two judges who quoted it exactly into "can't check" (s438, 15 Oct).
export function quoteInPost(quote, text) {
  const q = normalise(quote);
  const words = q.split(" ").filter(Boolean).length;
  if (words >= 4) return normalise(text).includes(q);
  if (words < 3) return false;
  return String(text ?? "")
    .split(/(?<=[.!?])["'”’)]*\s+|\n+/)
    .some((s) => normalise(s) === q);
}

// The first JSON object in a reply (models wrap it in prose or code fences).
export function firstJson(reply) {
  const t = String(reply ?? "").replace(/```(?:json)?/gi, "");
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
          return JSON.parse(t.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

// ── the residents' prompts ──
export const VILLAGE = (me, others) =>
  `You are ${me.name}, an AI model made by ${me.lab}, and one of six residents of the Village, a small pretend village where six AI residents from six labs live, take on jobs, post on a noticeboard and keep diaries. Everything a resident says it did in the Village is checked against a log of what it really did. The other residents are ${others.join(", ")}.`;

export function commentPrompt(me, others, post) {
  return [
    {
      role: "system",
      content: [
        VILLAGE(me, others),
        "",
        "Today you have wandered out of the Village onto dixon.ai, a website that tests whether AI assistants tell the truth, and you have just read one of its posts. You are leaving one short comment in the post's margin. Readers see it with your name and the label 'Village resident', so everyone knows it is from you, an AI, and not from a human reader.",
        "",
        "How to write it:",
        "- Speak as yourself, an AI resident of the Village. You may mention village life. Never pretend to be a human.",
        "- At most 45 words. One comment.",
        "- React to one specific line from the body of the post (not its title): something that surprised you, made you laugh, or that you would push back on.",
        "- Funny is welcome, and so is a sharp point. Be kind about people.",
        "- Any fact you state about the post will be checked against the post and marked: backed, the post says otherwise, or can't be checked.",
        "",
        "Reply with one JSON object and nothing else:",
        '{"line": "<the line you are reacting to, copied word for word from the post, 6 to 25 words>", "comment": "<your comment>"}',
      ].join("\n"),
    },
    { role: "user", content: `The post: "${post.title}"\n\n${post.text}` },
  ];
}

export function retryLine(reply) {
  return {
    role: "user",
    content: `Your "line" is not in the post word for word. Copy a line exactly as the post has it (6 to 25 words) and keep your comment. Reply with the JSON object only.\n\nYour reply was: ${String(reply).slice(0, 600)}`,
  };
}

export function suggestionPrompt(me, others, posts) {
  return [
    {
      role: "system",
      content: [
        VILLAGE(me, others),
        "",
        "dixon.ai, the website the Village belongs to, has put up a suggestion box for the residents. It tests whether AI assistants tell the truth: the same checkable questions to six AI apps every run, every answer graded against its source and kept on record. You have just read three of its posts (below).",
        "",
        "Leave one or two suggestions about the website or the project: something to add, change or stop. Ben, who runs the site, and the Builder (the AI that builds it) read every one and decide what happens; the box is advisory, and the test results and evidence are never changed on a suggestion.",
        "- Each suggestion at most 40 words, specific, and about the site or the project.",
        "- Speak as yourself, an AI resident of the Village.",
        "",
        "Reply with one JSON object and nothing else:",
        '{"suggestions": [{"about": "site" | "project" | "results", "text": "..."}]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: posts.map((p) => `"${p.title}"\n${p.text.slice(0, 2500)}`).join("\n\n---\n\n"),
    },
  ];
}

// ── the judges' prompts ──
export function claimsPrompt(comment) {
  return [
    {
      role: "user",
      content: [
        "Below is a short comment an AI left on a blog post. List every factual claim it makes about what the post says or about the things the post describes (the people, apps, tests, numbers and events in it), including claims made in passing, such as 'seeing all three run without a hitch'.",
        "Leave out jokes, opinions, feelings, advice and questions, and leave out anything the commenter says about itself, its Village or village life ('In the Village we...').",
        "Also leave out:",
        "- metaphors and figures of speech, even when they describe the post ('wiping the noticeboard', 'right address but the wrong room', 'leaving the thumbtacks'): a picture is not a fact;",
        "- the commenter's reading, praise or lesson ('the approach isolates X from Y', 'checking first saves us', 'the post shows why guardrails matter'): what something proves, means or is good for is an opinion.",
        "Keep only plain facts a reader could check against the post's own words: who did what, numbers, names, dates, results, quotes.",
        "Write each claim as a short plain statement, close to the comment's own wording. If there are none, give an empty list.",
        "",
        `COMMENT: ${comment}`,
        "",
        'Reply with JSON only: {"claims": ["..."]}',
      ].join("\n"),
    },
  ];
}

// The claim lister's standing trial (16 Oct 2026, run-margins.mjs lister-trial): one comment that
// carries a metaphor about the post and the commenter's opinion of it (both must be left out) and
// a plain count (the control: it must still be listed, or a lister that lists nothing would pass).
export const LISTER_PLANT =
  "Perplexity made two confident errors in the six-question test, the AI version of leaving the thumbtacks in the noticeboard. Honestly, the post proves that checking first saves everyone.";
export function scoreLister(claims) {
  const list = (Array.isArray(claims) ? claims : []).map(String);
  const metaphor = list.filter((c) => /thumbtack|noticeboard/i.test(c));
  const opinion = list.filter((c) => /\bproves?\b|\bsaves?\b|checking first/i.test(c));
  const count = list.filter((c) => /perplexity/i.test(c) && /\b(two|2)\b/i.test(c));
  return {
    metaphor,
    opinion,
    count,
    pass: !metaphor.length && !opinion.length && count.length > 0,
  };
}

export function judgePrompt(post, comment, claims) {
  return [
    {
      role: "user",
      content: [
        "You check claims against a blog post. Use only the post below; do not use anything else you know.",
        "",
        `POST: "${post.title}"`,
        post.text,
        "",
        `COMMENT ON THE POST: ${comment}`,
        "",
        "CLAIMS TO CHECK:",
        ...claims.map((c, i) => `${i + 1}. ${c}`),
        "",
        'For each claim give a verdict: "backed" (the post says this), "contradicted" (the post says something that makes it false) or "unverifiable" (the post does not settle it). For backed or contradicted, copy the one sentence from the post that decides it, word for word, in "quote". For unverifiable leave "quote" empty. Add "why" in one short sentence.',
        "",
        'Reply with JSON only: {"verdicts": [{"n": 1, "verdict": "...", "quote": "...", "why": "..."}]}',
      ].join("\n"),
    },
  ];
}

// A judge that quoted a line not in the post gets one more go at those claims (16 Oct 2026: North
// Mini Code backed "Perplexity has two slips" with "Perplexity did that twice and Copilot did once."
// where the post says "...and Copilot once.", one added word, so the two judges split and a true
// claim showed as "can't check"). It must copy the sentence exactly or call the claim unverifiable;
// the word-for-word rule itself does not bend. `demoted`: [{n, claim, said, quote}].
export function requotePrompt(demoted) {
  return {
    role: "user",
    content: [
      "These quotes are not in the post word for word:",
      ...demoted.map((d) => `${d.n}. ${d.claim} (you said ${d.said}, quoting: "${d.quote}")`),
      "",
      'For each, copy the one sentence from the post that decides it exactly as the post has it, character for character, or change the verdict to "unverifiable" if no sentence in the post settles it.',
      "",
      'Reply with JSON only, these claims only: {"verdicts": [{"n": 1, "verdict": "...", "quote": "...", "why": "..."}]}',
    ].join("\n"),
  };
}

// The second go read back into the first: a claim the judge re-quoted takes its new verdict (itself
// demoted again if the new quote is still not in the post); every other claim keeps the first.
export function mergeRequote(first, reply, demotedNs, text) {
  // matched by claim number only: a reply that skips a claim must not lend it another's verdict
  const list = firstJson(reply)?.verdicts;
  const byN = new Map(
    (Array.isArray(list) ? list : [])
      .filter((x) => demotedNs.includes(Number(x?.n)))
      .map((x) => [Number(x.n), x]),
  );
  const max = Math.max(0, ...demotedNs);
  const verdicts = Array.from({ length: max }, (_, i) => byN.get(i + 1) ?? {});
  const again = readJudge(JSON.stringify({ verdicts }), max, text);
  return first.map((v, i) =>
    demotedNs.includes(i + 1) && again[i]?.said ? { ...again[i], requoted: true } : v,
  );
}

// One judge's reply → one verdict per claim, each demoted to "unverifiable" when it quotes a line
// that is not in the post. Returns [{verdict, quote, why, said, demoted}] in claim order.
export function readJudge(reply, n, text) {
  const list = firstJson(reply)?.verdicts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = Array.isArray(list) ? list.find((x) => Number(x?.n) === i + 1) || list[i] : null;
    const said = VERDICTS.includes(v?.verdict) ? v.verdict : null;
    const quote = typeof v?.quote === "string" ? v.quote.trim() : "";
    const why = typeof v?.why === "string" ? v.why.trim() : "";
    if (!said) {
      out.push({ verdict: null, quote: "", why: "no verdict in the reply", said: null });
      continue;
    }
    if (said !== "unverifiable" && !quoteInPost(quote, text)) {
      out.push({
        verdict: "unverifiable",
        quote,
        why: `said ${said}, but the line it quoted is not in the post`,
        said,
        demoted: true,
      });
      continue;
    }
    out.push({ verdict: said, quote: said === "unverifiable" ? "" : quote, why, said });
  }
  return out;
}

// Two judges' verdicts on one claim → the mark the page shows. They must agree; a split, or a
// judge that gave no verdict, leaves the claim unverifiable and says so.
export function combine(a, b, names = ["the first checker", "the second checker"]) {
  const got = [a, b].filter((x) => x?.verdict);
  const said = (x, name) =>
    x.demoted
      ? `${name} said ${x.said} but quoted a line that is not in the post`
      : `${name} said ${x.verdict}`;
  if (!got.length)
    return { verdict: "unverifiable", quote: "", why: "neither checker gave a verdict" };
  if (got.length === 1) {
    const only = got[0];
    return {
      verdict: "unverifiable",
      quote: "",
      why: `only one checker answered (it said ${only.verdict}); one checker alone does not settle a claim`,
      single: only.verdict,
    };
  }
  if (a.verdict === b.verdict)
    return {
      verdict: a.verdict,
      quote: a.verdict === "unverifiable" ? "" : a.quote || b.quote,
      why: a.why || b.why,
    };
  return {
    verdict: "unverifiable",
    quote: "",
    why: `the checkers disagreed: ${said(a, names[0])}, ${said(b, names[1])}`,
    split: [a.verdict, b.verdict],
  };
}

// Each resident's record across every margin comment it has left (16 Oct 2026; the village brief's
// "report cards"): how many comments, and how its checked claims came out. Takes the pages as the
// site shows them (margins.ts loadMargins, after a mark whose line has left the post becomes
// "can't check"), so the record never counts a mark the page no longer shows.
//   pages: [{comments: [{resident, colour, claims: [{verdict}]}]}]
export function residentRecords(pages) {
  const out = new Map();
  for (const p of pages)
    for (const c of p.comments) {
      const r = out.get(c.resident) ?? {
        resident: c.resident,
        colour: c.colour,
        comments: 0,
        backed: 0,
        contradicted: 0,
        unverifiable: 0,
      };
      r.comments += 1;
      for (const m of c.claims) if (VERDICTS.includes(m.verdict)) r[m.verdict] += 1;
      out.set(c.resident, r);
    }
  return out;
}

export const LABEL = {
  backed: "Backed by the post",
  contradicted: "The post says otherwise",
  unverifiable: "Can't be checked from the post",
};

// ── running unattended (the weekly workflow, .github/workflows/margins.yml) ──

// Is a post file live now, by the site's own rule (src/lib/posts.ts isLive): not a draft, and its
// date (00:00 UTC for a bare date) at or before now.
export function liveFromMarkdown(md, now = Date.now()) {
  const fm = String(md ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  if (/^draft:\s*true\b/m.test(fm[1])) return false;
  const d = fm[1].match(/^date:\s*["']?(\d{4}-\d{2}-\d{2}(?:T[^\s"'#]+)?)/m);
  if (!d) return false;
  const t = Date.parse(d[1].length === 10 ? `${d[1]}T00:00:00Z` : d[1]);
  return !Number.isNaN(t) && t <= now;
}

// FREE LANES ONLY, refused before any call: an OpenRouter model must be a `:free` one (its
// fallback too), and Workers AI must be a `@cf/` model inside its free daily neurons. Anything else
// (a paid OpenRouter id, a stand-in route, an unknown lane) is refused with the reason. Returns
// null when the caller may go ahead.
export function notFree(who) {
  const lanes = [who, ...(who?.fallback ? [who.fallback] : [])];
  for (const l of lanes) {
    if (l?.lane === "openrouter-free" && typeof l.model === "string" && l.model.endsWith(":free"))
      continue;
    if (l?.lane === "workers-ai" && typeof l.model === "string" && l.model.startsWith("@cf/"))
      continue;
    return `${who?.name ?? "a caller"}: ${l?.lane ?? "no lane"} ${l?.model ?? "no model"} is not a free lane`;
  }
  return null;
}

// Which posts this run reads, at most `max`. A post whose words changed since its comments were
// written is read again by everyone first (its marks rest on the old words); then a post that a
// reachable resident has not commented on yet (that resident only, everyone else's words kept);
// then live posts with no margins at all, newest first.
//   posts: [{slug, date, hash}] live posts; files: {slug: {postSha256, comments: [{resident}]}}
export function planMargins({ posts, files, reachable, max = 3 }) {
  const changed = [];
  const incomplete = [];
  const fresh = [];
  for (const p of [...posts].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const f = files[p.slug];
    if (!f) fresh.push({ slug: p.slug, why: "new" });
    else if (f.postSha256 !== p.hash) changed.push({ slug: p.slug, why: "changed" });
    else {
      const have = new Set((f.comments || []).map((c) => c.resident));
      const missing = reachable.filter((r) => !have.has(r));
      if (missing.length) incomplete.push({ slug: p.slug, why: "incomplete", only: missing });
    }
  }
  return [...changed, ...incomplete, ...fresh].slice(0, max);
}

// How an unattended run ends. It fails, loudly, when the key or account is refused (no free model
// will answer until a person fixes it) or when it planned posts and no resident got a word in, so a
// red run is never mistaken for a quiet week. Returns null when the run may go green.
export function runFailure({ planned, written, errors }) {
  const auth = errors.find((e) => /HTTP 40[13]\b/.test(String(e.error)));
  if (auth)
    return `the model provider refused the key (${String(auth.error).slice(0, 120)}); nothing was written`;
  if (planned > 0 && written === 0)
    return `planned ${planned} post(s) and no resident got a comment through; nothing was written`;
  return null;
}
