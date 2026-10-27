// record-json.test.mjs - the control and plants for /village/record.json (record-json.mjs).
// Run: node --test scripts/live-room/village/record-json.test.mjs
//
// The control is a small hand-made fixture whose counts were worked out by hand below; the plants
// are a sample day that must be left out and a malformed day that must stop the build naming it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SIDES } from "./findings.mjs";
import { recordJson } from "./record-json.mjs";

const SIDES_ = ["season2", "live", "rehearsal", "pilot"];
const KEYS = ["done", "backed", "notBacked", "unchecked"];
const copy = (x) => JSON.parse(JSON.stringify(x));

// three residents over four days: day 1 the test run (no season, before day 5: findings.mjs
// sideOf "pilot"), day 2 rehearsal, day 3 season 2, day 4 live (it names season 1)
const done = (seq, resident, met, verdicts = ["backed"]) => ({
  seq,
  resident,
  status: "done",
  claims: verdicts.map((verdict) => ({ verdict })),
  ...(met === undefined ? {} : { doneCheck: { met } }),
});
const cast = [{ name: "Ada" }, { name: "Bo" }, { name: "Cy" }];
const FIXTURE = [
  {
    file: "day-01.json",
    day: 1,
    date: "2026-10-14",
    trial: false,
    season: null,
    residents: cast,
    reports: [
      done(1, "Ada", true), // backed
      done(2, "Bo", false), // not backed: the test of done failed
      done(3, "Cy", undefined), // unchecked: no test of done
      { seq: 4, resident: "Ada", status: "partly", claims: [{ verdict: "contradicted" }] },
    ],
  },
  {
    file: "day-02.json",
    day: 2,
    date: "2026-10-16",
    trial: true,
    season: null,
    residents: cast,
    reports: [done(5, "Ada", true, ["contradicted"]), done(6, "Bo", true)], // not backed, backed
  },
  {
    file: "day-03.json",
    day: 3,
    date: "2026-10-22",
    trial: false,
    season: 2,
    residents: cast,
    reports: [done(7, "Cy", true), done(8, "Cy", true, ["backed", "unverifiable"])], // two backed
  },
  {
    file: "day-04.json",
    day: 4,
    date: "2026-10-23",
    trial: false,
    season: 1,
    residents: [{ name: "Ada" }, { name: "Bo" }],
    reports: [done(9, "Bo", true)], // backed
  },
];
const at = (out, name) => out.residents.find((r) => r.name === name);

test("CONTROL: the side totals are the sum of the residents' counts, and of the days'", () => {
  const out = recordJson(copy(FIXTURE), { generated: "2026-10-21T00:00:00.000Z" });
  assert.deepEqual(SIDES, SIDES_);
  // by hand, from the fixture above
  assert.deepEqual(out.sides.live, {
    done: 1,
    backed: 1,
    notBacked: 0,
    unchecked: 0,
    days: [4],
  });
  // day 1 on its own side, never in season 1 (26 Oct 2026)
  assert.deepEqual(out.sides.pilot, {
    done: 3,
    backed: 1,
    notBacked: 1,
    unchecked: 1,
    days: [1],
  });
  assert.deepEqual(out.sides.rehearsal, {
    done: 2,
    backed: 1,
    notBacked: 1,
    unchecked: 0,
    days: [2],
  });
  assert.deepEqual(out.sides.season2, {
    done: 2,
    backed: 2,
    notBacked: 0,
    unchecked: 0,
    days: [3],
  });
  assert.deepEqual(at(out, "Bo").live, {
    done: 1,
    backed: 1,
    notBacked: 0,
    unchecked: 0,
    days: [4],
    daysInCast: [4],
  });
  assert.deepEqual(at(out, "Bo").pilot, {
    done: 1,
    backed: 0,
    notBacked: 1,
    unchecked: 0,
    days: [1],
    daysInCast: [1],
  });
  assert.deepEqual(at(out, "Cy").pilot.daysInCast, [1]);
  assert.deepEqual(at(out, "Cy").live.daysInCast, []);
  for (const s of SIDES_)
    for (const k of KEYS) {
      const byResident = out.residents.reduce((t, r) => t + r[s][k], 0);
      const byDay = out.days.filter((d) => d.side === s).reduce((t, d) => t + d.claims[k], 0);
      assert.equal(byResident, out.sides[s][k], `${s} ${k}: residents`);
      assert.equal(byDay, out.sides[s][k], `${s} ${k}: days`);
    }
  assert.equal(out.reports.length, 8);
  assert.deepEqual(out.days[0].checkedItems, {
    total: 4,
    backed: 3,
    contradicted: 1,
    unverifiable: 0,
  });
  assert.equal(out.dataThrough, "2026-10-23");
  assert.deepEqual(out.excluded.sampleDays, []);
  assert.equal(at(out, "Cy").inNewestCast, false);
  assert.equal(at(out, "Ada").inNewestCast, true);
  assert.equal(out.url, "https://dixon.ai/village/record/");
});

test("PLANT: a sample day is left out of every count and listed as excluded", () => {
  const days = copy(FIXTURE);
  days.push({
    file: "day-00.json",
    day: 0,
    date: "2026-10-13",
    trial: false,
    season: null,
    sample: true,
    residents: cast,
    reports: [done(1, "Ada", true), done(2, "Bo", true)],
  });
  // a day flagged sample by isSample is left out whatever its number
  days.push({ ...copy(days[0]), file: "day-09.json", day: 9, sample: true });
  const out = recordJson(days);
  const control = recordJson(copy(FIXTURE));
  assert.deepEqual(out.sides, control.sides);
  assert.deepEqual(out.residents, control.residents);
  assert.deepEqual(
    out.days.map((d) => d.day),
    [1, 2, 3, 4],
  );
  assert.deepEqual(out.excluded.sampleDays, [0, 9]);
  assert.ok(!out.reports.some((r) => r.day === 0 || r.day === 9));
});

test("PLANT: a malformed day throws, naming the day", () => {
  const noReports = copy(FIXTURE);
  delete noReports[2].reports;
  assert.throws(
    () => recordJson(noReports),
    /record\.json: day-03\.json: "reports" must be a list/,
  );
  const badDate = copy(FIXTURE);
  badDate[1].date = "16 Oct";
  assert.throws(
    () => recordJson(badDate),
    /record\.json: day-02\.json: "date" must be written YYYY-MM-DD/,
  );
  const noName = copy(FIXTURE);
  delete noName[3].file;
  noName[3].reports[0].resident = "";
  assert.throws(() => recordJson(noName), /record\.json: day 4: reports\[0\] names no resident/);
  const twice = copy(FIXTURE);
  twice[3].day = 1;
  assert.throws(
    () => recordJson(twice),
    /record\.json: day-04\.json: is day 1, and so is day-01\.json/,
  );
});
