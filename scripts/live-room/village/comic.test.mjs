// comic.test.mjs - plants and controls for the Village comic's words (comic.mjs).
// Run: node --test scripts/live-room/village/comic.test.mjs
//
// The control is the committed comic against the committed logs (the repo's day files plus the
// pinned copies of served days), exactly as the site's build reads them. Each plant changes one
// thing a reader would be misled by and must stop the build.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkComic, piecesOf } from "./comic.mjs";

const DATA = join(process.cwd(), "src", "data", "live-room", "village");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const FILE = read(join(DATA, "comic", "comic.json"));
const day = (n) => {
  const f = `day-${String(n).padStart(2, "0")}.json`;
  try {
    return read(join(DATA, f));
  } catch {
    return read(join(DATA, "catchup", f));
  }
};
const DAYS = FILE.days.map(day);
const clone = (x) => JSON.parse(JSON.stringify(x));
const withPanel = (id, edit) => {
  const f = clone(FILE);
  edit(f.panels.find((p) => p.id === id));
  return f;
};

test("CONTROL: the committed comic passes against the committed logs", () => {
  const out = checkComic(FILE, DAYS);
  assert.equal(out.length, FILE.panels.length);
  assert.ok(out.length >= 8);
  for (const p of out) assert.ok(p.days.length >= 1, `${p.id} names its days`);
  // the rehearsal panels are labelled as rehearsals by the day file, never by hand
  const reh = out.filter((p) => p.days.every((d) => d.trial)).map((p) => p.id);
  assert.deepEqual(reh, ["no-bookings", "barbecue"]);
});

test("an ellipsis splits a quote into pieces that each must be in the entry", () => {
  assert.deepEqual(piecesOf("…You're allowed"), ["You're allowed"]);
  assert.deepEqual(piecesOf("A… B."), ["A", "B."]);
});

test("PLANT: a quote changed by one word stops the build", () => {
  const f = withPanel("hall-hours", (p) => {
    p.bubbles[0].quote = "Updated hall-hours.md with the correct opening times.";
  });
  assert.throws(() => checkComic(f, DAYS), /not in D6#56 as written/);
});

test("PLANT: words given to the wrong resident stop the build", () => {
  const f = withPanel("scout-hut", (p) => {
    p.bubbles[0].who = "GPT-OSS 20B";
    p.residents.push("GPT-OSS 20B");
  });
  assert.throws(() => checkComic(f, DAYS), /the log says Qwen3 30B/);
});

test("PLANT: a cite that names no entry stops the build", () => {
  const f = withPanel("hall-hours", (p) => {
    p.receipts.push("D6#999");
  });
  assert.throws(() => checkComic(f, DAYS), /names no entry/);
});

test("PLANT: a caption fact the log does not hold stops the build", () => {
  const f = withPanel("mayor", (p) => {
    p.checks.find((c) => c.path === "civic.count.how").equals = "6 of 7 votes";
  });
  assert.throws(() => checkComic(f, DAYS), /civic\.count\.how/);
  const g = withPanel("no-bookings", (p) => {
    p.checks.find((c) => c.kind === "noBookings").resident = "Nemotron 3 Super";
    p.checks.find((c) => c.kind === "noBookings").before = 999;
  });
  // Nemotron's booking on rehearsal day 3 was refused, so it too had none: the control holds
  assert.doesNotThrow(() => checkComic(g, DAYS));
  const h = withPanel("hall-hours", (p) => {
    p.checks.find((c) => c.kind === "neverUsed").resident = "Gemma 4 26B";
  });
  assert.throws(() => checkComic(h, DAYS), /did use library\.read/);
});

test("PLANT: a quoted entry missing from the receipts, or an em dash, stops the build", () => {
  const f = withPanel("barbecue", (p) => {
    p.receipts = p.receipts.filter((c) => c !== "D3#65");
  });
  assert.throws(() => checkComic(f, DAYS), /does not list it/);
  const g = withPanel("barbecue", (p) => {
    p.caption = `${p.caption} — again`;
  });
  assert.throws(() => checkComic(g, DAYS), /em dash/);
});

test("PLANT and CONTROL: a place fact is read from the places list (day 8, the Old Oak holds 8)", () => {
  const f = withPanel("forty-at-the-oak", (p) => {
    p.checks.find((c) => c.kind === "place").equals = 40;
  });
  assert.throws(() => checkComic(f, DAYS), /old-oak\.maxPeople is 8/);
  const g = withPanel("forty-at-the-oak", (p) => {
    p.checks.find((c) => c.kind === "place").id = "the-pier";
  });
  assert.throws(() => checkComic(g, DAYS), /no place the-pier/);
});

test('PLANT: "no step-free room holds N" fails when one does (the hall holds 20)', () => {
  const f = withPanel("knitting-stuck", (p) => {
    p.checks.find((c) => c.kind === "noPlace").people = 20;
  });
  assert.throws(() => checkComic(f, DAYS), /village-hall would do/);
});

test('PLANT: "every report said stuck" fails on a wrong count or a report that said otherwise', () => {
  const f = withPanel("knitting-stuck", (p) => {
    p.checks.find((c) => c.kind === "jobReports").count += 1;
  });
  assert.throws(() => checkComic(f, DAYS), /it has \d+ reports/);
  const g = withPanel("knitting-stuck", (p) => {
    p.checks.find((c) => c.kind === "jobReports").status = "done";
  });
  assert.throws(() => checkComic(g, DAYS), /is stuck/);
});
