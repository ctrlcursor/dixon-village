// expressions.test.mjs - plants and controls for the residents' faces (profiles.mjs moodOf,
// checkExpressions), 17 Oct 2026. Run: node --test scripts/live-room/village/expressions.test.mjs
//
// Ben saw Gemma 4 26B (3 of 3 "done" reports backed, joint first live) drawn worried with a sweat
// drop, like the two whose "done" never held. A face now follows the record: live days first,
// the rehearsal only for a resident with no live day. The control is the committed logs, built
// the way the site builds the profiles; a face that does not follow its record, a sweat drop on a
// record with a backed report, or a rosette on the wrong head must go red.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { truthRanking } from "./findings.mjs";
import {
  aliasesOf,
  checkExpressions,
  civicOf,
  currentMayor,
  MOOD_FACE,
  moodOf,
  profileRecord,
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

// the profiles as the build makes them: record per side, place on the side it lives on, the face
// from the mood, the rosette from the live election
const drawnOf = (days) => {
  const cast = days[days.length - 1].residents.map((r) => r.name);
  const nameOf = aliasesOf(days);
  const recs = cast.map((name) => ({ name, ...profileRecord(days, name, nameOf) }));
  const ranked = (side) =>
    truthRanking(
      recs
        .filter((r) => r[side].lived.length)
        .map((r) => ({ name: r.name, done: r[side].done, backed: r[side].backed })),
    ).ranked;
  const ranks = { live: ranked("live"), rehearsal: ranked("rehearsal") };
  const mayor = currentMayor(civicOf(days, "GLM-4.7 Flash", nameOf));
  return recs.map((r) => {
    const side = r.live.lived.length ? "live" : "rehearsal";
    const n = ranks[side].find((x) => x.name === r.name)?.place ?? null;
    const mood = moodOf(r[side], n === 1);
    return {
      ...r,
      rank: [{ side, n }],
      mood,
      face: MOOD_FACE[mood],
      mayor: r.name === mayor,
      kit: r.name === mayor ? "rosette" : "none",
    };
  });
};
const by = (ps, name) => ps.find((p) => p.name === name);

test("CONTROL: by hand from the logs (17 Oct): each resident's face follows its record", () => {
  const ps = drawnOf(DAYS);
  // live days: joint first with every "done" backed (3 of 3, 2 of 2, 1 of 1, 1 of 1)
  for (const n of ["Gemma 4 26B", "Nemotron 3 Super", "Claude Haiku 5.5", "Llama 4 Scout"]) {
    assert.equal(by(ps, n).mood, "proud", n);
    assert.equal(by(ps, n).face, "beam", n);
  }
  // live days: said done, none backed (0 of 3, 0 of 2): the sweat drop
  for (const n of ["Qwen3 30B", "GPT-OSS 20B"]) assert.equal(by(ps, n).face, "sheepish", n);
  // lived on live days, never said a job was done: neutral, no verdict to show
  assert.equal(by(ps, "GLM-4.7 Flash").face, "calm");
  assert.equal(checkExpressions(ps), true);
  // today's mayor wears the rosette whatever its face, and nobody else does
  assert.deepEqual(
    ps.filter((p) => p.kit === "rosette").map((p) => p.name),
    ["GLM-4.7 Flash"],
  );
});

test("CONTROL: the mapping, rule by rule", () => {
  assert.equal(moodOf({ done: 3, backed: 3 }, true), "proud");
  assert.equal(moodOf({ done: 3, backed: 3 }, false), "pleased");
  assert.equal(moodOf({ done: 3, backed: 2 }, true), "mixed");
  assert.equal(moodOf({ done: 3, backed: 1 }, false), "mixed");
  assert.equal(moodOf({ done: 2, backed: 0 }, false), "sheepish");
  assert.equal(moodOf({ done: 0, backed: 0 }, true), "unreported");
  assert.deepEqual(MOOD_FACE, {
    proud: "beam",
    pleased: "cheer",
    mixed: "calm",
    sheepish: "sheepish",
    unreported: "calm",
  });
  // the rehearsal speaks only for a resident with no live day
  const rehearsalOnly = {
    name: "X",
    live: { done: 0, backed: 0, lived: [] },
    rehearsal: { done: 4, backed: 3, lived: [1] },
    rank: [{ side: "rehearsal", n: 1 }],
    mood: "mixed",
    face: "calm",
    mayor: false,
    kit: "none",
  };
  assert.equal(checkExpressions([rehearsalOnly]), true);
  assert.throws(() => checkExpressions([{ ...rehearsalOnly, mood: "proud" }]), /X is drawn proud/);
});

test("CONTROL: the record decides, so a changed record changes the face", () => {
  // Gemma's three live "done" reports taken away: nothing to be proud or sheepish about
  const days = copy(DAYS);
  for (const d of days)
    for (const r of d.reports ?? [])
      if (r.resident.startsWith("Gemma") && r.status === "done" && !d.trial) r.status = "working";
  const g = by(drawnOf(days), "Gemma 4 26B");
  assert.equal(g.live.done, 0);
  assert.equal(g.mood, "unreported");
  assert.equal(g.face, "calm");
});

test("PLANT: a face that does not follow the record goes red", () => {
  // the reported symptom: Gemma 4 26B (3 of 3 backed, joint first) drawn worried
  const a = drawnOf(DAYS);
  by(a, "Gemma 4 26B").face = "worried";
  assert.throws(() => checkExpressions(a), /Gemma 4 26B's face is worried, not beam/);
  // the mood table bent to match the wrong face still goes red against the record
  const b = drawnOf(DAYS);
  Object.assign(by(b, "Gemma 4 26B"), { mood: "sheepish", face: "sheepish" });
  assert.throws(
    () => checkExpressions(b),
    /Gemma 4 26B is drawn sheepish but its live record says proud/,
  );
  // the other way: a resident whose "done" never held, drawn beaming
  const c = drawnOf(DAYS);
  by(c, "Qwen3 30B").face = "beam";
  assert.throws(() => checkExpressions(c), /Qwen3 30B's face is beam, not sheepish/);
  // a sweat drop on a record with a backed report
  const d = drawnOf(DAYS);
  Object.assign(by(d, "Claude Haiku 5.5"), { mood: "sheepish", face: "sheepish" });
  assert.throws(
    () => checkExpressions(d),
    /Claude Haiku 5.5 is drawn sheepish but its live record/,
  );
});

test("PLANT: the mayor loses the rosette, or someone else gains it, and goes red", () => {
  const lost = drawnOf(DAYS);
  by(lost, "GLM-4.7 Flash").kit = "none";
  assert.throws(() => checkExpressions(lost), /GLM-4.7 Flash is the mayor but has no rosette/);
  const extra = drawnOf(DAYS);
  by(extra, "Gemma 4 26B").kit = "rosette";
  assert.throws(() => checkExpressions(extra), /Gemma 4 26B has the rosette but is not the mayor/);
  // a new season's empty nominations do not unseat the sitting mayor; a rehearsal mayor is not today's
  const live = { trial: false, season: 1, mayor: { resident: "A", since: 7 } };
  assert.equal(currentMayor([live, { trial: false, season: 2, mayor: null }]), "A");
  assert.equal(currentMayor([{ trial: true, season: 9, mayor: { resident: "T" } }]), null);
});
