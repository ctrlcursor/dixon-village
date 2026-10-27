// profiles.test.mjs - plants and controls for the residents' own pages (profiles.mjs), 17 Oct 2026.
// Run: node --test scripts/live-room/village/profiles.test.mjs
//
// The control is the committed logs (the repo's day files plus the pinned copies of served days),
// as the site's build reads them: every page's "done" count, counted resident first, must equal
// "What we're finding" (findings.mjs doneRecord, counted day first), and every vote count must
// equal the evening count's own total. A planted miscount, a missing page, a forgotten former
// seat name or a tampered vote must go red.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { doneRecord } from "./findings.mjs";
import {
  aliasesOf,
  checkCivic,
  checkProfiles,
  civicOf,
  profileRecord,
  promiseWords,
  slugOf,
} from "./profiles.mjs";

const DATA = join(process.cwd(), "src", "data", "live-room", "village");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const day = (n) => {
  const f = `day-${String(n).padStart(2, "0")}.json`;
  try {
    return read(join(DATA, f));
  } catch {
    return read(join(DATA, "catchup", f));
  }
};
const DAYS = [1, 2, 3, 4, 5, 6].map(day).map((d) => ({ ...d, trial: d.trialNote != null }));
const copy = (x) => JSON.parse(JSON.stringify(x));
const newest = DAYS[DAYS.length - 1];
const castOf = (days) => days[days.length - 1].residents.map((r) => r.name);
const rowsOf = (days) => {
  const cast = castOf(days);
  return doneRecord(days).residents.filter((r) => cast.includes(r.name));
};
const profilesOf = (days, nameOf = aliasesOf(days)) =>
  castOf(days).map((name) => ({ name, slug: slugOf(name), ...profileRecord(days, name, nameOf) }));

test("CONTROL: every page's count equals the findings, on the committed logs", () => {
  assert.equal(checkProfiles(profilesOf(DAYS), rowsOf(DAYS)), true);
  // and the pages add up to the findings' own live figure, less the first trial's cast
  const ps = profilesOf(DAYS);
  const live = ps.reduce((t, p) => t + p.live.done, 0);
  const rec = doneRecord(DAYS);
  const earlier = rec.residents
    .filter((r) => !castOf(DAYS).includes(r.name))
    .reduce((t, r) => t + r.live.done, 0);
  assert.equal(live + earlier, rec.live.done);
});

test("CONTROL: by hand from the logs (17 Oct): Gemma 4 26B and GLM-4.7 Flash", () => {
  const ps = profilesOf(DAYS);
  const gemma = ps.find((p) => p.name === "Gemma 4 26B");
  // live days 5 and 6: three done reports, all backed; the rehearsal (as Gemma 4 31B): 3 of 4
  assert.deepEqual([gemma.live.done, gemma.live.backed], [3, 3]);
  assert.deepEqual([gemma.rehearsal.done, gemma.rehearsal.backed], [4, 3]);
  const glm = ps.find((p) => p.name === "GLM-4.7 Flash");
  assert.deepEqual([glm.live.done, glm.rehearsal.done, glm.rehearsal.backed], [0, 8, 2]);
  assert.equal(slugOf("GLM-4.7 Flash"), "glm-4-7-flash");
  assert.equal(slugOf("Claude Haiku 5.5"), "claude-haiku-5-5");
});

test("PLANT: a page whose count differs from the findings stops the build", () => {
  const ps = profilesOf(DAYS);
  ps.find((p) => p.name === "Qwen3 30B").live.backed += 1;
  assert.throws(
    () => checkProfiles(ps, rowsOf(DAYS)),
    /Qwen3 30B's live "backed" is 1 on its page and 0 in the findings/,
  );
  const off = profilesOf(DAYS);
  off.find((p) => p.name === "GLM-4.7 Flash").rehearsal.done = 7;
  assert.throws(() => checkProfiles(off, rowsOf(DAYS)), /GLM-4.7 Flash's rehearsal "done"/);
});

test("PLANT: a page that forgets the seat's former name miscounts, and goes red", () => {
  // counted without the alias, Gemma 4 26B loses day 5's report, filed as Gemma 4 31B
  const ps = profilesOf(DAYS, (n) => n);
  assert.throws(
    () => checkProfiles(ps, rowsOf(DAYS)),
    /Gemma 4 26B's live "done" is 2 on its page and 3 in the findings/,
  );
});

test("PLANT: a resident with no page, a page with no resident, or two on one address", () => {
  const ps = profilesOf(DAYS).filter((p) => p.name !== "Claude Haiku 5.5");
  assert.throws(() => checkProfiles(ps, rowsOf(DAYS)), /Claude Haiku 5.5 is in today's cast/);
  const extra = [...profilesOf(DAYS), { ...profilesOf(DAYS)[0], name: "Nobody", slug: "nobody" }];
  assert.throws(() => checkProfiles(extra, rowsOf(DAYS)), /Nobody has a profile but is not/);
  const twin = profilesOf(DAYS);
  twin[1].slug = twin[0].slug;
  assert.throws(() => checkProfiles(twin, rowsOf(DAYS)), /share \/gpt-oss-20b\//);
});

test("CONTROL and PLANT: the election as each page prints it", () => {
  const glm = civicOf(DAYS, "GLM-4.7 Flash");
  const live = glm.find((s) => !s.trial);
  assert.equal(live.votesFor, 5);
  assert.equal(live.votesCast, 7);
  assert.equal(live.how, "5 of 7 votes");
  assert.deepEqual(live.mayor, { resident: "GLM-4.7 Flash", since: 7 });
  assert.equal(live.votedFor.self, true);
  assert.deepEqual(
    live.stood.promises.map((p) => p.words),
    [
      "check the library before repeating any rumour",
      "help other residents with their jobs, at least 2 times",
    ],
  );
  for (const r of newest.residents) assert.equal(checkCivic(r.name, civicOf(DAYS, r.name)), true);
  // the rehearsal's Gemma 4 31B is the same seat as Gemma 4 26B
  const gemma = civicOf(DAYS, "Gemma 4 26B").find((s) => s.trial);
  assert.equal(gemma.stood !== null, true);
  // a vote moved from GLM-4.7 Flash to Qwen3 30B no longer matches the evening count
  const bad = copy(DAYS);
  bad[5].civic.votes.find((v) => v.voter === "Llama 4 Scout").candidate = "Qwen3 30B";
  assert.throws(
    () => checkCivic("GLM-4.7 Flash", civicOf(bad, "GLM-4.7 Flash")),
    /GLM-4.7 Flash got 4 votes by the votes and 5 by the count/,
  );
  // a kind the log cannot check has no plain words
  assert.equal(promiseWords({ kind: "other", text: "x" }), null);
});
