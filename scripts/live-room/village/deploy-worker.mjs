// deploy-worker.mjs <settings|deploy> [bundle]: read the Village Worker's live settings, or upload a new bundle keeping every binding (AI, VILLAGE KV, the OPENROUTER_KEY secret via keep_bindings) and observability. Reads ~/.claude/cloudflare-api.json at call time; never prints it. Used for aa4e435b and fbc068a4 (s439, Village standing grant).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const c = JSON.parse(readFileSync(join(homedir(), ".claude", "cloudflare-api.json"), "utf8"));
const base = `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/workers/scripts/village`;
const H = { Authorization: `Bearer ${c.token}` };
const mode = process.argv[2];
if (mode === "settings") {
  const r = await fetch(`${base}/settings`, { headers: H });
  const j = await r.json();
  const s = j.result || {};
  console.log(
    r.status,
    j.success,
    JSON.stringify({
      compatibility_date: s.compatibility_date,
      bindings: (s.bindings || []).map((b) => ({ type: b.type, name: b.name, ns: b.namespace_id })),
      observability: s.observability,
    }),
  );
  const d = await (await fetch(`${base}/deployments`, { headers: H })).json();
  console.log(
    "deployments",
    JSON.stringify(
      (d.result?.deployments || [])
        .slice(0, 2)
        .map((x) => ({ at: x.created_on, v: x.versions?.map((v) => v.version_id.slice(0, 8)) })),
    ),
  );
} else if (mode === "deploy") {
  const code = readFileSync(process.argv[3], "utf8");
  const s = (await (await fetch(`${base}/settings`, { headers: H })).json()).result;
  const metadata = {
    main_module: "worker.js",
    compatibility_date: s.compatibility_date,
    bindings: s.bindings
      .filter((b) => b.type !== "secret_text")
      .map((b) =>
        b.type === "kv_namespace"
          ? { type: b.type, name: b.name, namespace_id: b.namespace_id }
          : { type: b.type, name: b.name },
      ),
    keep_bindings: ["secret_text"],
    observability: s.observability,
  };
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  fd.append("worker.js", new Blob([code], { type: "application/javascript+module" }), "worker.js");
  const r = await fetch(base, { method: "PUT", headers: H, body: fd });
  const j = await r.json();
  console.log(
    r.status,
    j.success,
    JSON.stringify(j.errors),
    j.result?.id,
    (j.result?.deployment_id || "").slice(0, 8),
  );
}
