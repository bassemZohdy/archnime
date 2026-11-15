/* Read which characters a WOFF2 font really contains, without a font library.
 *
 * The advance table in diagram-engine.js was measured with the host canvas, and a canvas silently
 * falls back to another font for a character the font lacks, so the table alone cannot prove the
 * pinned font paints every character it lists. The font's own `cmap` can. `cmap` is never
 * transformed in WOFF2, so it is the brotli stream, cut at the right offset, and nothing more.
 *
 *   import { fontCharacters, missingFromFont } from "./font_cmap.mjs";
 *   missingFromFont(readFileSync("inter.woff2"), "Abc Ж");   // -> "Ж"
 */
import { brotliDecompressSync } from "node:zlib";

// Table tags that a one-byte directory entry can name (WOFF2 specification, "Known table tags").
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

function readBase128(bytes, state) {
  let value = 0;
  for (let count = 0; count < 5; count += 1) {
    const byte = bytes[state.at++];
    if (byte === undefined) throw new Error("WOFF2 table directory is truncated");
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("WOFF2 table directory holds an invalid length");
}

/** The raw `cmap` table of a WOFF2 file. */
function cmapTable(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 48 || view.getUint32(0) !== 0x774f4632) throw new Error("not a WOFF2 file");
  const tableCount = view.getUint16(12), compressedSize = view.getUint32(20), state = { at: 48 };
  const tables = [];
  for (let index = 0; index < tableCount; index += 1) {
    const flags = bytes[state.at++];
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = String.fromCharCode(...bytes.subarray(state.at, state.at + 4)); state.at += 4; }
    const version = flags >> 6, originalLength = readBase128(bytes, state);
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    tables.push({ tag, length: transformed ? readBase128(bytes, state) : originalLength });
  }
  const data = brotliDecompressSync(bytes.subarray(state.at, state.at + compressedSize));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === "cmap") return data.subarray(offset, offset + table.length);
    offset += table.length;
  }
  throw new Error("the font has no cmap table");
}

/** The Unicode code points that map to a real glyph (not .notdef), from every Unicode cmap subtable. */
export function fontCharacters(woff2Bytes) {
  const table = cmapTable(woff2Bytes), view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const covered = new Set();
  for (let record = 0; record < view.getUint16(2); record += 1) {
    const platform = view.getUint16(4 + record * 8), encoding = view.getUint16(6 + record * 8), start = view.getUint32(8 + record * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = view.getUint16(start);
    if (format === 4) {
      const segments = view.getUint16(start + 6) / 2, ends = start + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const last = view.getUint16(ends + segment * 2), first = view.getUint16(starts + segment * 2), delta = view.getInt16(deltas + segment * 2), rangeOffset = view.getUint16(ranges + segment * 2);
        for (let code = first; code <= last && code !== 0xffff; code += 1) {
          const glyph = rangeOffset === 0 ? (code + delta) & 0xffff : (() => {
            const at = ranges + segment * 2 + rangeOffset + (code - first) * 2, raw = view.getUint16(at);
            return raw === 0 ? 0 : (raw + delta) & 0xffff;
          })();
          if (glyph !== 0) covered.add(code);
        }
      }
    } else if (format === 12) {
      for (let group = 0, count = view.getUint32(start + 12); group < count; group += 1) {
        const at = start + 16 + group * 12, first = view.getUint32(at), last = view.getUint32(at + 4), glyph = view.getUint32(at + 8);
        for (let code = first; code <= last; code += 1) if (glyph + (code - first) !== 0) covered.add(code);
      }
    }
  }
  return covered;
}

/** The characters of `text` the font does not contain, as one string without repeats. */
export function missingFromFont(woff2Bytes, text) {
  const covered = fontCharacters(woff2Bytes);
  return [...new Set([...text].filter(char => !covered.has(char.codePointAt(0))))].join("");
}
