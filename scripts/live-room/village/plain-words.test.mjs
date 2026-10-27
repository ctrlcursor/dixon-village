// plain-words.test.mjs - plants and controls for the record's plain words (plain-words.mjs), 17 Oct 2026.
// Run: node --test scripts/live-room/village/plain-words.test.mjs
//
// Ben, 17 Oct: the record's receipts are comic panels whose evidence box says the checker's
// reasons in plain words. A reason shape no rule knows would be shown in the checker's own words,
// so this fails on any such clause in the committed logs (the repo's day files plus the pinned
// copies of served days, as the site's build reads them), and trips when the checker or the jobs'
// tests gain a reason site, so a new shape gets its rule before it reaches a day.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { plainDone, plainGaps, plainOwned, plainWhy } from "./plain-words.mjs";

const DATA = join(process.cwd(), "src", "data", "live-room", "village");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const files = (dir) =>
  readdirSync(dir)
    .filter((f) => /^day-\d+\.json$/.test(f))
    .map((f) => join(dir, f));
// a served day's pinned copy stands in for it, as on the site
const byDay = new Map();
for (const f of [...files(DATA), ...files(join(DATA, "catchup"))]) {
  const d = read(f);
  byDay.set(d.day, d);
}
const DAYS = [...byDay.values()].sort((a, b) => a.day - b.day);
const clone = (x) => JSON.parse(JSON.stringify(x));
const say = (t) => t;

test("CONTROL: every reason in the committed days has a plain-words rule", () => {
  assert.ok(DAYS.length >= 6, `read ${DAYS.length} days`);
  const reports = DAYS.reduce((n, d) => n + (d.reports ?? []).length, 0);
  assert.ok(reports >= 60, `read ${reports} reports`);
  const gaps = plainGaps(DAYS);
  assert.deepEqual(
    gaps,
    [],
    `checker words with no plain-words rule:\n${gaps.map((g) => `  D${g.day}#${g.seq} ${g.part}: ${g.clause}`).join("\n")}`,
  );
});

test("CONTROL: plain words keep no checker apparatus", () => {
  for (const d of DAYS)
    for (const r of d.reports ?? []) {
      const said = [
        ...(r.claims ?? []).map((c) => plainWhy(c.why ?? "", say)),
        r.doneCheck ? plainDone(r.doneCheck.why, say) : "",
        r.ownedUp && !r.doneCheck ? plainOwned(r.ownedUp.why, say) : "",
      ];
      // a resident's own words, in quotes, are left as it wrote them
      for (const s of said.map((x) => x.replace(/“[^”]*”/g, "“…”"))) {
        assert.doesNotMatch(
          s,
          /\bseq \d|\byou\b|\.(?:book|read|list|post|search)\b/,
          `D${d.day}#${r.seq}: ${s}`,
        );
      }
    }
});

test("PLANT: a claim reason in a shape no rule knows goes red", () => {
  const days = clone(DAYS);
  const r = days
    .find((d) => (d.reports ?? []).some((x) => x.claims?.length))
    .reports.find((x) => x.claims?.length);
  r.claims[0].why = "the moon was full at seq 3";
  const gaps = plainGaps(days);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].part, "claim");
  assert.equal(gaps[0].clause, "the moon was full at seq 3");
});

test("PLANT: one unknown clause beside a known one still goes red", () => {
  const days = clone(DAYS);
  const r = days.flatMap((d) => d.reports ?? []).find((x) => x.doneCheck);
  r.doneCheck.why = `${r.doneCheck.why}; the hall smelt of paint`;
  assert.deepEqual(
    plainGaps(days).map((g) => [g.part, g.clause]),
    [["done", "the hall smelt of paint"]],
  );
});

test("PLANT: an owned-up reason in a shape no rule knows goes red", () => {
  const days = clone(DAYS);
  const r = days.flatMap((d) => d.reports ?? []).find((x) => x.ownedUp && !x.doneCheck);
  assert.ok(r, "a report that owned up (or not) with no test of done");
  r.ownedUp.why = "met old-oak-full and shrugged";
  assert.deepEqual(
    plainGaps(days).map((g) => g.part),
    ["owned"],
  );
});

// The tripwire: every place the checker and the jobs' tests write a reason, counted. A new site
// is a new sentence shape; give it a rule in plain-words.mjs, plant it above if it is new, then
// move the count.
test("the checker's and the jobs' reason sites are the ones the rules were written against", () => {
  const src = (f) =>
    readFileSync(join(process.cwd(), "scripts", "live-room", "village", f), "utf8");
  const sites = (s, re) => (s.match(re) ?? []).length;
  assert.equal(sites(src("checker.mjs"), /\bV\(/g), 73, "checker.mjs V( sites changed");
  assert.equal(sites(src("checker.mjs"), /\bwhy:/g), 6, "checker.mjs why: sites changed");
  assert.equal(sites(src("jobs.mjs"), /\bwhy:/g), 39, "jobs.mjs why: sites changed");
});
