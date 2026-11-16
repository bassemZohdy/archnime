/* Keep a harness's built HTML for CI when a check fails (set ARTIFACT_DIR). */
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function retainWork(work, name, failed) {
  const directory = process.env.ARTIFACT_DIR;
  if (!directory || !failed) return;
  try {
    mkdirSync(directory, { recursive: true });
    cpSync(work, join(directory, name), { recursive: true });
    console.error(`retained ${name} build output in ${join(directory, name)}`);
  } catch (error) {
    console.error(`could not retain ${name} build output: ${error.message}`);
  }
}
