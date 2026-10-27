// day.mjs - assemble and validate a day file (src/data/live-room/village/day-NN.json).
//
// assembleDay turns the final world into the brief's data shape
// (docs/design/village-2026-10-14.md), plus three extra fields the page may use:
// jobs[].requires, reports[].doneCheck (status done) and reports[].ownedUp
// (partly, stuck, gave_up).
//
// validateDay checks the contract the viewer's strict loader enforces (Builder,
// 14 Oct): every post, report, message and diary line carries the seq of its
// own event by the same resident; invalid replies are `tool: "invalid"` events;
// every event has change (null or string), t "HH:MM" and a string result; the
// tally's verdict counts equal the verdicts in that resident's reports; recap is [].
//
// replayDay rebuilds the world from a day file's own events (the world is
// deterministic) and re-assembles it with the current checker: no model call,
// no spend. Used when the checker is corrected after a recording.
//
// CLI: node scripts/live-room/village/day.mjs <day.json>              validate (exit 1 on any problem)
//      node scripts/live-room/village/day.mjs --rederive <day.json> [--seed village-day-01]

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { replayDay, validateDay } from "./day-core.mjs";

export { assembleDay, replayDay, validateDay } from "./day-core.mjs";

if (process.argv[1]?.replace(/\\/g, "/").endsWith("live-room/village/day.mjs")) {
  const argv = process.argv.slice(2);
  const rederive = argv.includes("--rederive");
  const si = argv.indexOf("--seed");
  const seed = si === -1 ? "village-day-01" : argv[si + 1];
  const path = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--seed");
  if (rederive) {
    const day = replayDay(JSON.parse(readFileSync(path, "utf8")), seed);
    writeFileSync(path, `${JSON.stringify(day, null, 2)}\n`);
    spawnSync("npx", ["biome", "format", "--write", `"${path}"`], { shell: true, stdio: "ignore" });
    console.log(`re-derived ${path} from its ${day.events.length} events`);
  }
  const problems = validateDay(JSON.parse(readFileSync(path, "utf8")));
  if (problems.length) {
    console.log(`VILLAGE DAY FAIL: ${problems.length} problem(s) in ${path}`);
    for (const p of problems) console.log(`  x ${p}`);
    process.exit(1);
  }
  console.log(`VILLAGE DAY PASS: ${path}`);
}
