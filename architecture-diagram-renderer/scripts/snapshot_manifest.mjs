/* A reproducible manifest for a directory of exported snapshots.
 *
 * manifest.json says which source model, renderer and state each SVG came from and the
 * SHA-256 of every file, so a snapshot that is later edited, replaced, deleted or added by
 * hand is detected. It holds no timestamps or machine details: the same model, renderer and
 * states always produce the same manifest bytes.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const MANIFEST_NAME = "manifest.json";
export const MANIFEST_SCHEMA = "architecture-diagram-snapshots/1";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hashFile = path => sha256(readFileSync(path));

/** The renderer files that decide what an exported SVG looks like. */
function rendererIdentity(template) {
  const directory = dirname(template);
  const parts = {
    template: template,
    engine: join(directory, "diagram-engine.js"),
    library: join(directory, "architecture-library.js"),
    font: join(directory, "fonts", "inter-latin-wght-normal.woff2"),
  };
  return Object.fromEntries(Object.entries(parts).map(([name, path]) => [name, { file: basename(path), sha256: hashFile(path) }]));
}

/** Build the manifest object for files an export just wrote. */
export function buildManifest({ modelPath, template, files }) {
  return {
    schema: MANIFEST_SCHEMA,
    source: { file: basename(modelPath), sha256: hashFile(modelPath) },
    renderer: rendererIdentity(template),
    snapshots: files.map(entry => {
      const bytes = readFileSync(entry.path);
      return {
        view: entry.view,
        mode: entry.mode,
        state: { index: entry.index, id: entry.id, title: entry.title },
        file: entry.file,
        sha256: sha256(bytes),
        bytes: bytes.length,
      };
    }),
  };
}

export const manifestText = manifest => `${JSON.stringify(manifest, null, 2)}\n`;

export function writeManifest(directory, manifest) {
  const path = join(directory, MANIFEST_NAME);
  writeFileSync(path, manifestText(manifest), "utf8");
  return path;
}

/**
 * Check a snapshot directory against its manifest.
 * @returns {{ok: boolean, problems: string[], checked: number}}
 */
export function verifyManifest(directory, { modelPath } = {}) {
  const problems = [];
  const manifestPath = join(directory, MANIFEST_NAME);
  if (!existsSync(manifestPath)) return { ok: false, problems: [`${MANIFEST_NAME} is missing from ${directory}`], checked: 0 };
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (error) { return { ok: false, problems: [`${MANIFEST_NAME} is not valid JSON: ${error.message}`], checked: 0 }; }

  if (manifest.schema !== MANIFEST_SCHEMA) problems.push(`unsupported manifest schema ${JSON.stringify(manifest.schema)}`);
  if (!Array.isArray(manifest.snapshots) || !manifest.snapshots.length) problems.push("the manifest lists no snapshots");
  if (typeof manifest.source?.sha256 !== "string") problems.push("the manifest does not identify its source model");
  for (const name of ["template", "engine", "library", "font"]) if (typeof manifest.renderer?.[name]?.sha256 !== "string") problems.push(`the manifest does not identify the renderer ${name}`);

  const listed = new Set();
  let checked = 0;
  for (const [position, snapshot] of (Array.isArray(manifest.snapshots) ? manifest.snapshots : []).entries()) {
    const where = `snapshot ${position + 1}`;
    const file = snapshot?.file;
    // A manifest is untrusted input: only plain file names inside this directory are followed.
    if (typeof file !== "string" || !file || file !== basename(file) || file.includes("\\") || file === "." || file === ".." || file === MANIFEST_NAME) { problems.push(`${where}: unsafe or missing file name ${JSON.stringify(file)}`); continue; }
    if (listed.has(file)) { problems.push(`${where}: ${file} is listed twice`); continue; }
    listed.add(file);
    const path = join(directory, file);
    if (!existsSync(path) || !statSync(path).isFile()) { problems.push(`${file}: missing`); continue; }
    const bytes = readFileSync(path);
    checked += 1;
    if (sha256(bytes) !== snapshot.sha256) problems.push(`${file}: sha256 mismatch (the file was changed after export)`);
    if (bytes.length !== snapshot.bytes) problems.push(`${file}: size is ${bytes.length} bytes, the manifest says ${snapshot.bytes}`);
  }
  for (const file of readdirSync(directory).sort()) {
    if (file !== MANIFEST_NAME && file.endsWith(".svg") && !listed.has(file)) problems.push(`${file}: not listed in the manifest`);
  }
  if (modelPath) {
    if (!existsSync(modelPath)) problems.push(`source model ${modelPath} not found`);
    else if (hashFile(modelPath) !== manifest.source?.sha256) problems.push(`source model ${basename(modelPath)} differs from the one the snapshots were exported from`);
  }
  return { ok: problems.length === 0, problems, checked };
}
