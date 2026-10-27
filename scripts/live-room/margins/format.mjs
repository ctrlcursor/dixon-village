// format.mjs - every file the margins generator writes goes through the repository's own Biome
// formatter before anything can commit it (15 Oct 2026). Run 38785429177 wrote seven posts'
// comments with JSON.stringify, and the push gate's check:biome-format refused them (Biome lays
// JSON out differently), so the run's words were lost with the runner. Formatting at the write
// makes a written file one the gate accepts; a file already in Biome's shape is left as it is.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function formatWritten(paths) {
  if (!paths.length) return;
  const biome = require.resolve("@biomejs/biome/bin/biome");
  const r = spawnSync(process.execPath, [biome, "format", "--write", ...paths], {
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error(
      `Biome could not format ${paths.join(", ")}: ${(r.stderr || r.stdout).slice(0, 400)}`,
    );
}
