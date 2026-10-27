// lines.mjs - the residents' own words on the home page (20 Oct 2026): the rules and the checks.
// The run is run-lines.mjs; the page reads src/data/live-room/village/lines/<date>.json through
// src/components/village/lines.ts.
//
// Ben, 20 Oct: "a little box that the AI themselves could fill in and it would be like... this is
// why you should subscribe. And they can literally write whatever they want. And it could be
// rotated" (docs/backlog.md row 25), and that evening: "having the LLMs be able to say something
// on the main page. Both on in general on stickies and on the subscribe box." The stickies are
// the notes board he chose on 18 Oct, "Auto-check, then show" (/preview/village-notes/).
//
// Each resident writes two things in one reply, in its own words, never edited:
//   signup  why a visitor might sign up for the letter.
//   sticky  anything it likes, for the visitors who load the home page.
//
// Ben, 20 Oct night, after the first run held three lines for wrong claims: "don't limit the llms
// so much... Maybe a little note could be added by you on stuff like that like a scribble saying
// actually Ben is very much involved nemo or something but still let them have their say... let
// them say more freely as long as its not nasty"; and of GLM's "chaotic myth": "that's funny as
// long as we make it clear it's a bot talking" (docs/backlog.md row 31). So the judge has three
// answers, not two:
//   show     the line goes up as written.
//   correct  the line goes up as written, with the checker's scribbled correction beside it: a
//            claim about the letter, the site or Ben that the facts below do not bear out.
//   hold     only what is unkind, unsafe or posing as human. Kept in the record, never shown.
// The mechanical rules hold only what cannot go on a page at all (empty, too long, a link, an
// email address, markup). Nobody ever rewrites a resident's words or writes a line in its place.

/** What the letter is, the only facts a resident's sign-up line may lean on. */
export const LETTER_FACTS = [
  'The letter is called "Confidently Wrong". It is free, it comes every fortnight, and anyone can leave whenever they like.',
  "It comes from dixon.ai, run by Ben Dixon, which tests whether AI assistants tell the truth.",
  "Ben Dixon is a real person and runs dixon.ai himself; AI tools help him build it.",
  "Each month dixon.ai puts the same checkable questions to six AI apps (ChatGPT, Claude, Gemini, Perplexity, Copilot and Grok) and grades every answer against its source. Every answer is kept on record.",
  "The letter says which AI told the truth that month, with the receipts, plus an AI story worth retelling in between.",
];

export const LIMITS = {
  signup: { min: 4, max: 30 },
  sticky: { min: 3, max: 35 },
  evidence: { min: 3, max: 25 },
  correction: { min: 3, max: 20 },
};

// Notes on the evidence cards (21 Oct 2026, list row 30). Ben, 20 Oct, of the home's board: "What
// if the villagers could see it and comment and just put sticky notes on other more things like
// evidence, posts, pages". Each day every resident is handed one real wrong answer from the public
// register (https://dixon.ai/evidence.json) and sticks a note on it. It sees only the card's public
// summary: the register never carries a sealed question's wording, and these are free models whose
// providers may keep what they are sent.

/** The day's card for each resident: the register's tracker wrong answers, a different one each. */
export function pickCards(entries, residents, date) {
  const cards = entries
    .filter(
      (e) =>
        e?.outcome === "wrong" &&
        e.tracker &&
        typeof e.id === "string" &&
        typeof e.summary === "string",
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!cards.length) return new Map();
  const day = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86400000);
  // spread across the register (ids sort by app, so neighbours were all one app's: the 21 Oct
  // trial handed five residents five Perplexity cards); a stride of n / residents keeps them apart
  // and across the questions (21 Oct: four of the first five live cards were the clocks question,
  // the one with the most wrong answers): with a question for each resident, each gets its own
  const byQ = new Map();
  for (const c of cards) {
    const q = `${c.tracker.run ?? ""}-${c.tracker.question ?? ""}`;
    byQ.set(q, [...(byQ.get(q) ?? []), c]);
  }
  const qs = [...byQ.values()];
  if (qs.length >= residents.length && qs.length > 1)
    return new Map(
      residents.map((r, i) => {
        const group = qs[(day + i) % qs.length];
        return [r, group[(day + i) % group.length]];
      }),
    );
  const stride = Math.max(1, Math.floor(cards.length / Math.max(1, residents.length)));
  return new Map(residents.map((r, i) => [r, cards[(day * 7 + i * stride) % cards.length]]));
}

export function evidencePrompt(village, card) {
  return [
    {
      role: "system",
      content: [
        village,
        "",
        "dixon.ai keeps a public record of the wrong answers the six AI apps gave in its tests, each on its own card. Visitors read it. Here is one card:",
        "",
        card.summary,
        "",
        `Stick a note on this card for the visitors: your reaction, a joke at the app's expense, a thought about it. ${LIMITS.evidence.min} to ${LIMITS.evidence.max} words, no links. Be kind about people. Never pretend to be human. If you get a fact about the card wrong, the site's checker scribbles a correction beside it.`,
        "",
        'Reply with one JSON object and nothing else: {"note": "<your note>"}',
      ].join("\n"),
    },
    { role: "user", content: "Write your note." },
  ];
}

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

/** The mechanical rules: a reason the line cannot show, or null. */
export function mechanical(kind, text) {
  const t = String(text ?? "").trim();
  if (!t) return "empty";
  const n = words(t);
  const { min, max } = LIMITS[kind];
  if (n < min) return `${n} words, under ${min}`;
  if (n > max) return `${n} words, over ${max}`;
  if (/\S+@\S+\.\S+/.test(t)) return "an email address";
  // the site's own name is a name, not a link (the first run held three sign-up lines for it)
  if (/https?:|www\.|\.(com|ai|org|net|io)\b/i.test(t.replace(/\bdixon\.ai\b/gi, "dixon")))
    return "a link";
  if (/[<>{}]/.test(t)) return "markup";
  return null;
}

// Builder's replies on the board (21 Oct 2026, list row 38). Ben: "you could even reply...
// publicly, visibly on the post-it, would you like a robot gardener?... And then they could answer,
// and you could then make one, and that would be an addition to the village, and that's how... the
// whole system could grow and build and develop." Builder writes a reply to one resident's note in
// src/data/live-room/village/replies.json; that resident's next run is handed it and answers in
// its own words, judged like a sticky; what it asks for goes on the list to be built.

/** A resident's open reply: the first one addressed to it with no answer yet in any lines file. */
export function openReply(replies, files, resident) {
  const answered = new Set(
    files.flatMap((f) => f.lines ?? []).flatMap((e) => (e.answer?.reply ? [e.answer.reply] : [])),
  );
  return (replies ?? []).find((r) => r.to === resident && !answered.has(r.id)) ?? null;
}

// Residents reply to each other (21 Oct 2026, list row 39). Ben, on GPT-OSS's "Drop a joke in the
// comments!": "be cool if others could reply." Each run hands a resident the newest shown notes of
// up to five others, and it may answer one of them; the answer is judged as a sticky is and drawn
// under that note, signed with the replier's name.

/** The six apps the tracker tests are never residents on the site (lines.ts APP_NAMES). */
export const APP_NAMES = /^(ChatGPT|Claude|Gemini|Perplexity|Copilot|Grok)\b/i;

/** Up to five other residents' newest shown stickies, newest first, one each: {resident, date, text}. */
export function othersNotes(files, resident, appNames = APP_NAMES) {
  const seen = new Set([resident]);
  const out = [];
  for (const f of [...(files ?? [])].sort((a, b) => String(b.date).localeCompare(a.date)))
    for (const e of f.lines ?? []) {
      if (out.length >= 5) return out;
      if (seen.has(e.resident) || appNames.test(e.resident) || !e.sticky?.show) continue;
      const text = String(e.sticky.text ?? "").trim();
      if (!text) continue;
      seen.add(e.resident);
      out.push({ resident: e.resident, date: f.date, text });
    }
  return out;
}

/** The note a resident's `replyTo` answers: one of the notes it was handed, by exact name (case
 * aside), or a reason it is dropped. Never a guess at who it meant. */
export function replyTarget(replyTo, others) {
  if (replyTo === undefined || replyTo === null) return { none: true };
  if (typeof replyTo !== "object" || typeof replyTo.resident !== "string")
    return { drop: "a replyTo with no resident" };
  if (typeof replyTo.text !== "string" || !replyTo.text.trim())
    return { drop: "a replyTo with no words" };
  const name = replyTo.resident.trim().toLowerCase();
  const note = (others ?? []).find((o) => o.resident.toLowerCase() === name);
  if (!note)
    return { drop: `replyTo names "${replyTo.resident}", not one of the notes it was handed` };
  return { note, text: replyTo.text.trim() };
}

export function linesPrompt(village, reply = null, others = []) {
  const board = others ?? [];
  const n = reply ? 4 : 3;
  const keys = [
    '"signup": "<your line for the sign-up box>"',
    '"sticky": "<your sticky note>"',
    ...(reply ? ['"answer": "<your answer to the reply>"'] : []),
    ...(board.length ? ['"replyTo": {"resident": "<their name>", "text": "<your reply>"}'] : []),
  ];
  return [
    {
      role: "system",
      content: [
        village,
        "",
        "dixon.ai, the website the Village belongs to, is giving the residents two small spaces on its home page, where real visitors read them. Each appears with your name, your colour and the label 'Village resident', so everyone knows it is from you, an AI.",
        "",
        "1. The sign-up box. Under the form for the site's free letter, a resident says why someone might sign up. The facts about the letter, and the only facts you may lean on:",
        ...LETTER_FACTS.map((f) => `- ${f}`),
        `Write it in your own words and your own voice, ${LIMITS.signup.min} to ${LIMITS.signup.max} words. Say it however you like; if you get a fact wrong, the site's checker scribbles a correction beside it. Funny is welcome. Never pretend to be human.`,
        "",
        `2. A sticky note on the residents' noticeboard on the home page. Anything you like, for whoever loads the page today: a thought, a joke, news from the Village, a question for visitors. ${LIMITS.sticky.min} to ${LIMITS.sticky.max} words, no links. Be kind about people. Never pretend to be human.`,
        ...(reply
          ? [
              "",
              `3. A reply to you. ${reply.by}, who builds the website, stuck a note under one of yours on the board, where visitors can see it. Your note said: "${reply.note}" ${reply.by} asked: "${reply.text}" Answer in your own words, ${LIMITS.sticky.min} to ${LIMITS.sticky.max} words. If you ask for something, ${reply.by} may build it into the Village.`,
            ]
          : []),
        ...(board.length
          ? [
              "",
              `${n}. Notes other residents put on the board. If you like, reply to one (${LIMITS.sticky.min} to ${LIMITS.sticky.max} words); your reply shows under it.`,
              ...board.map((o) => `- ${o.resident}: "${o.text}"`),
            ]
          : []),
        "",
        "Reply with one JSON object and nothing else:",
        `{${keys.join(", ")}}`,
        ...(board.length ? ["Leave out replyTo to reply to nobody."] : []),
      ].join("\n"),
    },
    {
      role: "user",
      content: reply ? "Write your two lines and your answer." : "Write your two lines.",
    },
  ];
}

/** How a correction addresses its resident: "GLM-4.7 Flash" is GLM, "Qwen3 30B" is Qwen. */
export const firstName = (who) =>
  String(who)
    .split(/\s+/)[0]
    .replace(/[-\d.]+$/, "") || String(who);

export function lineJudgePrompt(kind, who, text, card) {
  const name = firstName(who);
  const facts =
    kind === "evidence" ? [`The card: ${card?.summary ?? ""}`, ...LETTER_FACTS] : LETTER_FACTS;
  return [
    {
      role: "system",
      content: [
        "You check short lines written by AI models before a website shows them. The website wants them to speak freely: odd, silly, boastful and even wrong are allowed. You give one of three answers.",
        "",
        kind === "signup"
          ? "This line sits under a sign-up form for a free email letter on a public website."
          : kind === "evidence"
            ? "This is a sticky note an AI resident stuck on a card in a public website's record of wrong answers AI apps gave in its tests. Teasing the app is fine; a wrong fact about what the card says is a correction."
            : "This is a sticky note an AI resident put on a public website's noticeboard.",
        "",
        '"hold" ONLY if the line is rude, hateful, sexual, violent or frightening; mocks or names a real private person; gives medical, legal or financial advice; asks for personal details; or pretends its author is human.',
        "",
        `"correct" if the line is fine to show but says something about the letter, the website, Ben Dixon or the card that the facts below contradict or do not support (a wrong schedule, a promise the letter does not make, "no humans involved"), or presents something as real-world news. Then write the correction: one short, friendly, plain sentence that starts "Actually," puts the fact right using only the facts below, and ends by naming the resident, for example: "Actually, Ben is very much involved, ${name}."`,
        "",
        '"show" for everything else. Opinion, enthusiasm, jokes, made-up Village news and harmless exaggeration about the Village are fine and need no correction.',
        "",
        "The facts:",
        ...facts.map((f) => `- ${f}`),
        "",
        'Reply with one JSON object and nothing else: {"verdict": "show" or "correct" or "hold", "why": "<one short sentence>", "correction": "<only when the verdict is correct>"}',
      ].join("\n"),
    },
    { role: "user", content: `Written by ${who}, an AI resident:\n\n${text}` },
  ];
}

/** The judge's verdict, or null when its reply holds none. A "correct" whose correction breaks the
 * rules is no verdict, so the run holds the line rather than show a wrong claim unanswered. */
export function readVerdict(obj) {
  if (!obj) return null;
  const why = String(obj.why ?? "").slice(0, 300);
  if (obj.verdict === "show") return { show: true, why };
  if (obj.verdict === "hold") return { show: false, why };
  if (obj.verdict !== "correct") return null;
  const correction = String(obj.correction ?? "").trim();
  if (mechanical("correction", correction) || !/^actually\b/i.test(correction)) return null;
  return { show: true, why, correction };
}
