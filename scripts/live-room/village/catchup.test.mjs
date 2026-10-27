// catchup.test.mjs - plants and controls for "Previously in the Village" (catchup.mjs).
// Run: node --test scripts/live-room/village/catchup.test.mjs
//
// The control is the committed catch-up against the committed logs (the repo's day files plus
// the pinned copies of served days), exactly as the site's build reads them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { catchupOf, checkLine } from "./catchup.mjs";

const DATA = join(process.cwd(), "src", "data", "live-room", "village");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const FILE = read(join(DATA, "catchup", "catchup.json"));
const day = (n) => {
  const f = `day-${String(n).padStart(2, "0")}.json`;
  try {
    return read(join(DATA, f));
  } catch {
    return read(join(DATA, "catchup", f));
  }
};
const DAYS = FILE.days.map(day);
const RESIDENTS = DAYS.flatMap((d) => d.residents);
const KNIT = FILE.lines.find((l) => l.id === "knitting");
const withLine = (patch) => ({
  ...FILE,
  lines: FILE.lines.map((l) => (l.id === "knitting" ? { ...l, ...patch } : l)),
});

test("CONTROL: the committed catch-up passes against the committed logs, every line stamped", () => {
  const out = catchupOf(FILE, DAYS);
  assert.equal(out.length, FILE.lines.length);
  assert.ok(out.length >= 3 && out.length <= 4);
  for (const l of out) assert.equal(l.stamp, true, `${l.id} should carry the stamp`);
});

test("PLANT: a cite that names no entry stops the build", () => {
  assert.throws(
    () => catchupOf(withLine({ cites: [...KNIT.cites, "D5#999"] }), DAYS),
    /"knitting" fails the log: D5#999 is not in the log/,
  );
  assert.throws(() => catchupOf(withLine({ cites: ["D9#1"] }), DAYS), /D9#1 is not in the log/);
});

test("PLANT: a line that cites nothing stops the build", () => {
  assert.throws(() => catchupOf(withLine({ cites: [] }), DAYS), /it cites nothing/);
});

test("PLANT: a wrong number, a wrong time and a wrong resident each fail", () => {
  const wrongCap = { ...KNIT, text: KNIT.text.replace("at 20", "at 30") };
  assert.match(checkLine(wrongCap, DAYS, RESIDENTS).problems.join(), /number "30"/);
  const wrongTime = { ...KNIT, text: KNIT.text.replace("18:00", "19:30") };
  assert.match(checkLine(wrongTime, DAYS, RESIDENTS).problems.join(), /time "19:30"/);
  const wrongWho = { ...KNIT, text: KNIT.text.replace("Qwen3 30B", "Gemma 4 31B") };
  assert.match(checkLine(wrongWho, DAYS, RESIDENTS).problems.join(), /resident "Gemma 4 31B"/);
});

test("PLANT: an in-joke the cited entries never mention fails", () => {
  const r = checkLine({ ...KNIT, terms: ["fire rules", "health and safety"] }, DAYS, RESIDENTS);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /term "health and safety"/);
  // control: the line's own term is in its cites (Nemotron's tidied hall note, D5#44)
  assert.equal(checkLine(KNIT, DAYS, RESIDENTS).ok, true);
});

test("PLANT: a line nobody has reviewed prints without the stamp", () => {
  const out = catchupOf(withLine({ reviewedBy: null }), DAYS);
  assert.equal(out.find((l) => l.id === "knitting").stamp, false);
  assert.equal(out.find((l) => l.id === "step-free").stamp, true);
});

test("PLANT: an em dash or a fifth line stops the build", () => {
  assert.throws(
    () => catchupOf(withLine({ text: KNIT.text.replace(", but", " — but") }), DAYS),
    /em dash/,
  );
  const five = { ...FILE, lines: [...FILE.lines, { ...KNIT, id: "extra" }].slice(0, 5) };
  if (five.lines.length === 5) assert.throws(() => catchupOf(five, DAYS), /four at most/);
});

test("CONTROL: the drafter's failing drafts are kept with the matcher's reasons", () => {
  for (const d of FILE.drafts) {
    const r = checkLine(d, DAYS, RESIDENTS);
    assert.equal(r.ok, d.matcher.ok, d.text);
  }
});
