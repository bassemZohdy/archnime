/* A delivered page loads the runtime part of the engine and no layout library:
 * it shows stored layouts and places nothing. Harnesses that test the engine
 * itself (placement, routing after placement, the Tune search) need the whole
 * engine, so they load it into the page they already have open. This replaces
 * `window.DiagramEngine` for code the harness runs; the page's own engine
 * instance, created at load from the runtime file, is not touched.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = resolve(fileURLToPath(new URL(".", import.meta.url)), "../assets");

export async function injectFullEngine(page) {
  for (const file of ["vendor/dagre.min.js", "vendor/elk.bundled.js", "diagram-engine.js"]) await page.addScriptTag({ path: join(ASSETS, file) });
  const loaded = await page.evaluate(() => ({ dagre: typeof window.dagre, elk: typeof window.ELK, collect: typeof window.DiagramEngine?.create }));
  if (loaded.dagre === "undefined" || loaded.elk === "undefined" || loaded.collect !== "function") throw new Error(`the full engine did not load into the page: ${JSON.stringify(loaded)}`);
}
