// profile-cpu.mjs - how much CPU one Worker tick spends, piece by piece (s437, 15 Oct 2026).
//
// Why: Cloudflare's free plan gives a cron run 10 ms of CPU; the local proof's wall-minus-network
// figure also counts file writes and JIT warm-up, so it over-states. This replays the pure work
// of a wake against a stored village state (run-local.mjs --store): read the state, build the
// prompts, apply six actions, assemble the "today" file, write the state back. It prints the
// first run (a cold isolate) and the median of 30 warm runs.
// Usage: node scripts/live-room/village/profile-cpu.mjs <store dir>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dayFile, systemPrompt } from "./engine.mjs";
import { applyAction, boardView, jobsView } from "./world.mjs";

const dir = process.argv[2];
const text = readFileSync(join(dir, "state.json"), "utf8");
const time = (f) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
const pieces = {
  "read the state (JSON.parse)": () => JSON.parse(text),
  "build the two prompts": () => {
    const v = JSON.parse(text);
    const me = v.cast[0];
    systemPrompt(v, me, v.today.world);
    boardView(v.today.world, 6);
    jobsView(v.today.world);
  },
  "apply six actions": () => {
    const v = JSON.parse(text);
    let w = v.today.world;
    for (const [tool, args] of [
      ["jobs.list", {}],
      ["board.read", {}],
      ["library.read", { pageId: "bins" }],
      ["places.search", { query: "step-free dinner" }],
      ["board.post", { text: "Bins are Thursday." }],
      ["diary.write", { text: "Posted the bins." }],
    ])
      w = applyAction(w, { resident: v.cast[0].name, wake: 1, t: "10:00", tool, args }).state;
  },
  "assemble today's file (checker, Stranger)": () => {
    const v = JSON.parse(text);
    dayFile(v);
  },
  "write the state and today (JSON.stringify)": () => {
    const v = JSON.parse(text);
    JSON.stringify(v);
    JSON.stringify(dayFile(v).day);
  },
};
const v0 = JSON.parse(text);
console.log(
  `state ${Math.round(text.length / 1024)} KB, ${v0.today.world.events.length} events so far today`,
);
let cold = 0;
let warm = 0;
for (const [name, f] of Object.entries(pieces)) {
  const first = time(f);
  const runs = Array.from({ length: 30 }, () => time(f)).sort((a, b) => a - b);
  const med = runs[15];
  cold += first;
  warm += med;
  console.log(
    `  ${name.padEnd(44)} first ${first.toFixed(2)} ms, warm median ${med.toFixed(2)} ms`,
  );
}
console.log(
  `  (each piece above re-reads the state; the tick reads it once)\n  total, first runs ${cold.toFixed(1)} ms; warm ${warm.toFixed(1)} ms`,
);
