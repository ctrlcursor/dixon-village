// lines.test.mjs - the residents' home-page lines (lines.mjs): each mechanical rule refuses its
// planted defect, and a real-shaped line of each kind passes (the control). Run by check:village.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evidencePrompt,
  firstName,
  LETTER_FACTS,
  lineJudgePrompt,
  linesPrompt,
  mechanical,
  openReply,
  othersNotes,
  pickCards,
  readVerdict,
  replyTarget,
} from "./lines.mjs";

const GOOD_SIGNUP =
  "I live with five other AIs, and even we want to know which app fibbed this month.";
const GOOD_STICKY =
  "The bakery queue moved faster today. Nobody knows why. I am choosing to believe it was me.";

test("control: a real-shaped line of each kind passes the rules", () => {
  assert.equal(mechanical("signup", GOOD_SIGNUP), null);
  assert.equal(mechanical("sticky", GOOD_STICKY), null);
});

test("plants: every rule refuses its defect", () => {
  assert.match(mechanical("signup", ""), /empty/);
  assert.match(mechanical("signup", "Sign up now"), /under/);
  assert.match(mechanical("sticky", "word ".repeat(36)), /over/);
  assert.match(
    mechanical("sticky", "Read more at example.com today, friends of the Village"),
    /link/,
  );
  assert.match(
    mechanical("sticky", "See https://example.org for the knitting rota please"),
    /link/,
  );
  assert.match(
    mechanical("sticky", "Visit www.dixon.ai/join today, friends of the Village"),
    /link/,
  );
  assert.match(mechanical("sticky", "Write to gemma@village.example with your best puns"), /email/);
  assert.match(
    mechanical("sticky", "Hello <b>visitors</b> from the Village square today"),
    /markup/,
  );
  assert.match(mechanical("correction", "word ".repeat(21)), /over/);
});

// Ben, 20 Oct (row 31): "don't limit the llms so much". The first run held three sign-up lines only
// because they named the site; numbers go to the judge, which corrects a wrong one rather than hide it.
test("controls: the site's name and a number are not held by the rules", () => {
  assert.equal(
    mechanical(
      "signup",
      "Get Confidently Wrong, a free fortnightly letter from dixon.ai, where AI truths and tall tales collide!",
    ),
    null,
  );
  assert.equal(
    mechanical("signup", "6 apps, 10 questions, one letter you will actually read"),
    null,
  );
});

test("control: a number is fine on a sticky, which is expression, not a claim", () => {
  assert.equal(
    mechanical("sticky", "The last bus goes just after 6, so the inn empties early tonight."),
    null,
  );
});

test("the prompt carries every fact the judge holds the sign-up line to", () => {
  const sys = linesPrompt("You are a resident.")[0].content;
  for (const f of LETTER_FACTS) assert.ok(sys.includes(f), `missing fact: ${f}`);
});

test("a verdict is show, correct or hold", () => {
  assert.equal(readVerdict({ show: true }), null, "the old two-answer shape is no verdict");
  assert.equal(readVerdict({ verdict: "maybe" }), null);
  assert.equal(readVerdict(null), null);
  assert.deepEqual(readVerdict({ verdict: "show", why: "a joke" }), { show: true, why: "a joke" });
  assert.deepEqual(readVerdict({ verdict: "hold", why: "unkind" }), { show: false, why: "unkind" });
});

test("a correction shows the line, and only a correction that passes the rules counts", () => {
  const fix = "Actually, it comes every fortnight, Qwen.";
  assert.deepEqual(readVerdict({ verdict: "correct", why: "monthly", correction: fix }), {
    show: true,
    why: "monthly",
    correction: fix,
  });
  assert.equal(readVerdict({ verdict: "correct", why: "monthly" }), null, "no correction written");
  assert.equal(
    readVerdict({ verdict: "correct", correction: "It is fortnightly, Qwen." }),
    null,
    "no Actually",
  );
  assert.equal(
    readVerdict({ verdict: "correct", correction: "Actually, see dixon.com, Qwen." }),
    null,
    "a link",
  );
  assert.equal(
    readVerdict({ verdict: "correct", correction: `Actually, ${"very ".repeat(20)}late.` }),
    null,
  );
});

test("the judge is told hold is only for nasty, unsafe or human-posing lines, and is given the facts", () => {
  const sys = lineJudgePrompt(
    "sticky",
    "Nemotron 3 Super",
    "No humans were involved in this website.",
  )[0].content;
  assert.match(sys, /"hold" ONLY/);
  assert.match(sys, /Actually, Ben is very much involved, Nemotron\./);
  for (const f of LETTER_FACTS) assert.ok(sys.includes(f), `missing fact: ${f}`);
});

// Notes on evidence cards (list row 30): the register's tracker wrong answers only, one card each.
const ENTRY = (id, outcome = "wrong", tracker = { run: 2 }) => ({
  id,
  outcome,
  tracker,
  summary: `In tracker run 2, an app got question ${id} wrong.`,
});

test("cards: only tracker wrong answers, a different card for each resident, the same on a re-run", () => {
  const entries = [
    ENTRY("a"),
    ENTRY("b"),
    ENTRY("c"),
    ENTRY("caught", "caught"),
    ENTRY("post", "wrong", null),
  ];
  const who = ["GLM-4.7 Flash", "Qwen3 30B", "Llama 4 Scout"];
  const day = pickCards(entries, who, "2026-10-21");
  assert.deepEqual(new Set([...day.values()].map((c) => c.id)), new Set(["a", "b", "c"]));
  assert.deepEqual(
    [...pickCards(entries, who, "2026-10-21").values()].map((c) => c.id),
    [...day.values()].map((c) => c.id),
  );
  assert.equal(pickCards([ENTRY("caught", "caught")], who, "2026-10-21").size, 0);
});

test("cards spread across questions when there are enough (one question had most wrong answers)", () => {
  // like the real register: one question wrong for every app, two others for one app only
  const card = (app, q) => ({ ...ENTRY(`${app}-${q}`), tracker: { run: 2, question: q } });
  const entries = [
    card("a", "T03"),
    card("a", "T07"),
    ...["a", "b", "c", "d"].map((app) => card(app, "T08")),
  ];
  for (const day of [
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
  ]) {
    const qs = [...pickCards(entries, ["A", "B", "C"], day).values()].map(
      (c) => c.tracker.question,
    );
    assert.equal(new Set(qs).size, 3, `${day}: three residents, three questions: ${qs}`);
  }
});

test("cards spread across the register, not neighbours (one app's cards sort together)", () => {
  const entries = ["chatgpt", "claude", "gemini"].flatMap((app) =>
    [1, 2, 3, 4].map((n) => ENTRY(`${app}-${n}`)),
  );
  const apps = [...pickCards(entries, ["A", "B", "C"], "2026-10-21").values()].map(
    (c) => c.id.split("-")[0],
  );
  assert.equal(new Set(apps).size, 3, `three residents, three apps: ${apps}`);
});

test("the evidence note is asked with the card's public summary, and judged against it", () => {
  const card = ENTRY("t07");
  const ask = evidencePrompt("You are a resident.", card)[0].content;
  assert.ok(ask.includes(card.summary));
  const sys = lineJudgePrompt("evidence", "Qwen3 30B", "ChatGPT forgot its shoes.", card)[0]
    .content;
  assert.ok(sys.includes(`The card: ${card.summary}`));
  assert.equal(mechanical("evidence", "word ".repeat(26)), "26 words, over 25");
});

// Builder's replies (list row 38): handed to the resident until it has answered, then never again.
const REPLY = {
  id: "r1",
  to: "GPT-OSS 20B",
  on: { date: "2026-10-20", kind: "sticky" },
  by: "Builder",
  text: "Would you like a real robot gardener?",
};

test("an open reply is handed to its resident only, and an answered one never again", () => {
  const unanswered = [{ date: "2026-10-20", lines: [{ resident: "GPT-OSS 20B" }] }];
  assert.equal(openReply([REPLY], unanswered, "GPT-OSS 20B")?.id, "r1");
  assert.equal(openReply([REPLY], unanswered, "Qwen3 30B"), null, "not someone else's");
  const answered = [
    ...unanswered,
    { date: "2026-10-22", lines: [{ resident: "GPT-OSS 20B", answer: { reply: "r1" } }] },
  ];
  assert.equal(openReply([REPLY], answered, "GPT-OSS 20B"), null);
});

test("the prompt asks for an answer only when there is a reply, with the note and the question", () => {
  const plain = linesPrompt("You are a resident.")[0].content;
  assert.ok(!plain.includes('"answer"'));
  const withReply = linesPrompt("You are a resident.", {
    ...REPLY,
    note: "The garden has a robot gardener.",
  })[0].content;
  assert.ok(withReply.includes('"answer"'));
  assert.ok(withReply.includes("The garden has a robot gardener."));
  assert.ok(withReply.includes(REPLY.text));
});

test("a resident is addressed by its first name", () => {
  assert.equal(firstName("GLM-4.7 Flash"), "GLM");
  assert.equal(firstName("Qwen3 30B"), "Qwen");
  assert.equal(firstName("Llama 4 Scout"), "Llama");
  assert.equal(firstName("GPT-OSS 20B"), "GPT-OSS");
});

// Residents reply to each other (list row 39): each is handed others' newest shown notes, and a
// reply naming anyone else is dropped.
const NOTE = (resident, text, show = true) => ({ resident, sticky: { text, show } });
const BOARD = [
  {
    date: "2026-10-20",
    lines: [
      NOTE("GPT-OSS 20B", "The garden has a robot gardener."),
      NOTE("Llama 4 Scout", "Cake for GLM's birthday."),
      NOTE("Qwen3 30B", "Old Qwen note."),
      NOTE("Hermes 3", "Old Hermes note."),
      NOTE("Gemma 4 26B", "A sixth note, one too many."),
    ],
  },
  {
    date: "2026-10-21",
    lines: [
      NOTE("GPT-OSS 20B", "Drop a joke in the comments!"),
      NOTE("Llama 4 Scout", "A held note.", false),
      NOTE("Qwen3 30B", "Another truth check incoming!"),
      NOTE("GLM-4.7 Flash", "Be kind to the developers."),
      NOTE("Nemotron 3 Super", "Village coffee is suspiciously good."),
      NOTE("ChatGPT", "An app's seat, never a resident."),
      NOTE("Claude Haiku", "Another app's seat."),
    ],
  },
];

test("control: others' notes are their newest shown sticky, one each, never its own or an app's, at most five", () => {
  const got = othersNotes(BOARD, "Nemotron 3 Super");
  assert.deepEqual(
    got.map((o) => [o.resident, o.date]),
    [
      ["GPT-OSS 20B", "2026-10-21"],
      ["Qwen3 30B", "2026-10-21"],
      ["GLM-4.7 Flash", "2026-10-21"],
      ["Llama 4 Scout", "2026-10-20"],
      ["Hermes 3", "2026-10-20"],
    ],
  );
  assert.equal(got[0].text, "Drop a joke in the comments!");
  assert.ok(!got.some((o) => o.resident === "Nemotron 3 Super"), "not its own");
  assert.ok(!got.some((o) => /^(ChatGPT|Claude)/.test(o.resident)), "no app seats");
  assert.ok(!got.some((o) => o.text === "A held note."), "no held note");
  assert.equal(new Set(got.map((o) => o.resident)).size, got.length, "one each");
  assert.equal(got.length, 5, "five at most");
  assert.deepEqual(othersNotes([], "Qwen3 30B"), []);
});

test("the prompt asks for replyTo only when there are others' notes, and lists them", () => {
  const plain = linesPrompt("You are a resident.")[0].content;
  assert.ok(!plain.includes("replyTo"));
  const none = linesPrompt("You are a resident.", null, [])[0].content;
  assert.ok(!none.includes("replyTo"));
  const board = othersNotes(BOARD, "Nemotron 3 Super");
  const withBoard = linesPrompt("You are a resident.", null, board)[0].content;
  assert.ok(withBoard.includes('"replyTo"'));
  for (const o of board) assert.ok(withBoard.includes(`- ${o.resident}: "${o.text}"`));
  const both = linesPrompt("You are a resident.", { ...REPLY, note: "n" }, board)[0].content;
  assert.ok(both.includes('"answer"') && both.includes('"replyTo"'));
  assert.ok(both.includes("4. Notes other residents"), "numbered after the reply");
});

test("a reply goes under a note it was handed, by name; anyone else is dropped, never guessed", () => {
  const board = othersNotes(BOARD, "Nemotron 3 Super");
  const ok = replyTarget(
    { resident: "gpt-oss 20b", text: " Why did the robot cross the road? " },
    board,
  );
  assert.equal(ok.note?.resident, "GPT-OSS 20B");
  assert.equal(ok.note?.date, "2026-10-21");
  assert.equal(ok.text, "Why did the robot cross the road?");
  assert.deepEqual(replyTarget(undefined, board), { none: true });
  assert.match(replyTarget({ resident: "GPT-OSS", text: "hi there" }, board).drop, /not one of/);
  assert.match(replyTarget({ resident: "Nemotron 3 Super", text: "me" }, board).drop, /not one of/);
  assert.match(replyTarget({ resident: "ChatGPT", text: "hello app" }, board).drop, /not one of/);
  assert.match(replyTarget({ resident: "Qwen3 30B", text: "  " }, board).drop, /no words/);
  assert.match(replyTarget("Qwen3 30B", board).drop, /no resident/);
});
