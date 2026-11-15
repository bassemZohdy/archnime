/* Run the configured Python interpreter from npm scripts on every platform. */
import { spawnSync } from "node:child_process";

const interpreter = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(interpreter, process.argv.slice(2), { stdio: "inherit", shell: false });
if (result.error) {
  console.error(`could not start Python interpreter ${interpreter}: ${result.error.message}`);
  process.exit(127);
}
process.exit(result.status ?? 1);
