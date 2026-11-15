#!/usr/bin/env node
/* Verify a directory of exported snapshots against its manifest.json.
 *
 *   node verify_snapshots.mjs --dir snapshots [--model model.json]
 *
 * Exit 0 when every listed file is present and unchanged and no unlisted SVG sits beside
 * them; exit 1 and one line per problem otherwise; exit 2 on a usage error.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifest } from "./snapshot_manifest.mjs";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) { console.error("usage: verify_snapshots.mjs --dir snapshots [--model model.json]"); process.exit(2); }
    options[argv[index].slice(2)] = argv[index + 1];
  }
  if (!options.dir) { console.error("usage: verify_snapshots.mjs --dir snapshots [--model model.json]"); process.exit(2); }
  const result = verifyManifest(resolve(options.dir), { modelPath: options.model ? resolve(options.model) : undefined });
  if (result.ok) console.log(`OK: ${result.checked} snapshot(s) match ${resolve(options.dir)}/manifest.json`);
  else { result.problems.forEach(problem => console.error(`FAIL: ${problem}`)); process.exit(1); }
}
