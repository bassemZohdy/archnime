/* A small, dependency-free reader for the PDFs Chromium writes (PDF 1.4 from Skia).
 *
 * It exists to answer two questions about a converted diagram: how big is each page, and is the
 * diagram's text still text (with its Unicode mapping) rather than pixels or outlines? It is not
 * a general PDF parser: it reads classic cross-reference files with Flate streams, Type 0 fonts
 * that carry a ToUnicode map, and text-showing operators (Tj and TJ), including text inside form
 * XObjects. Anything else is reported as "not understood" instead of guessed at.
 */
import { inflateSync } from "node:zlib";

/** Split the file into indirect objects: number -> { dict, data }. */
function readObjects(buffer) {
  const source = buffer.toString("latin1");
  const objects = new Map();
  const start = /(\d+) (\d+) obj\b/g;
  let match;
  while ((match = start.exec(source))) {
    const bodyStart = start.lastIndex;
    const streamAt = source.indexOf("stream", bodyStart);
    const endAt = source.indexOf("endobj", bodyStart);
    if (endAt < 0) break;
    let dict = source.slice(bodyStart, endAt), data = null;
    if (streamAt >= 0 && streamAt < endAt) {
      dict = source.slice(bodyStart, streamAt);
      const from = streamAt + "stream".length + (source[streamAt + 6] === "\r" ? 2 : 1);
      const to = source.indexOf("endstream", from);
      const length = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1]);
      const raw = Buffer.from(source.slice(from, Number.isFinite(length) && source.startsWith("endstream", from + length + (source[from + length] === "\r" ? 2 : source[from + length] === "\n" ? 1 : 0)) ? from + length : to), "latin1");
      data = /\/FlateDecode/.test(dict) ? inflateSync(raw) : raw;
      start.lastIndex = Math.max(start.lastIndex, to);
    } else start.lastIndex = endAt;
    objects.set(Number(match[1]), { dict, data });
  }
  return objects;
}

const reference = text => { const found = /(\d+) 0 R/.exec(text || ""); return found ? Number(found[1]) : null; };

/** ToUnicode CMap stream -> { codeBytes, map: code -> string }. */
function parseToUnicode(text) {
  const map = new Map();
  let codeBytes = 2;
  const unicode = hex => Buffer.from(hex, "hex").toString("utf16le").length ? Buffer.from(hex.replace(/(..)(..)/g, "$2$1"), "hex").toString("utf16le") : "";
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, source, target] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) { codeBytes = source.length / 2; map.set(parseInt(source, 16), unicode(target)); }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, low, high, rest] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      codeBytes = low.length / 2;
      const from = parseInt(low, 16), to = parseInt(high, 16);
      if (rest.startsWith("[")) [...rest.matchAll(/<([0-9a-fA-F]+)>/g)].forEach((entry, offset) => map.set(from + offset, unicode(entry[1])));
      else { const base = parseInt(rest.slice(1, -1), 16), width = rest.length - 2; for (let code = from; code <= to; code += 1) map.set(code, unicode((base + code - from).toString(16).padStart(width, "0"))); }
    }
  }
  return { codeBytes, map };
}

function decodeHex(hex, cmap) {
  let output = "";
  const width = cmap.codeBytes * 2;
  for (let index = 0; index + width <= hex.length; index += width) output += cmap.map.get(parseInt(hex.slice(index, index + width), 16)) ?? "";
  return output;
}

/** Text shown by one content stream: a string per Tj/TJ operator, in order. */
function showText(content, fonts, forms, objects, depth = 0) {
  const strings = [];
  let current = null;
  const tokens = /\/(F\d+|[A-Za-z][\w.+-]*)\s+[\d.+-]+\s+Tf|\[((?:[^\]\\]|\\.)*)\]\s*TJ|<([0-9a-fA-F\s]*)>\s*Tj|\/([\w.+-]+)\s+Do/g;
  let match;
  while ((match = tokens.exec(content))) {
    if (match[1]) current = fonts.get(match[1]) ?? null;
    else if (match[2] !== undefined) {
      if (current) strings.push([...match[2].matchAll(/<([0-9a-fA-F\s]*)>/g)].map(part => decodeHex(part[1].replace(/\s+/g, ""), current)).join(""));
    } else if (match[3] !== undefined) {
      if (current) strings.push(decodeHex(match[3].replace(/\s+/g, ""), current));
    } else if (match[4] && depth < 6 && forms.has(match[4])) {
      const form = objects.get(forms.get(match[4]));
      if (form?.data && /\/Subtype\s*\/Form/.test(form.dict)) strings.push(...showText(form.data.toString("latin1"), fonts, forms, objects, depth + 1));
    }
  }
  return strings;
}

/**
 * @returns {{pages: {width: number, height: number, text: string[]}[], fonts: number, images: number, understood: boolean, notes: string[]}}
 */
export function inspectPdf(buffer) {
  const notes = [];
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return { pages: [], fonts: 0, images: 0, understood: false, notes: ["not a PDF file"] };
  const objects = readObjects(buffer);
  const fontObjects = new Map();
  let images = 0;
  for (const [number, object] of objects) {
    if (/\/Subtype\s*\/Image\b/.test(object.dict)) images += 1;
    if (/\/Type\s*\/Font\b/.test(object.dict)) {
      const toUnicode = reference(/\/ToUnicode\s+(\d+ 0 R)/.exec(object.dict)?.[1]);
      const stream = toUnicode ? objects.get(toUnicode)?.data : null;
      fontObjects.set(number, stream ? parseToUnicode(stream.toString("latin1")) : null);
    }
  }
  const pages = [];
  for (const [, object] of objects) {
    if (!/\/Type\s*\/Page\b(?!s)/.test(object.dict)) continue;
    let box = /\/MediaBox\s*\[([^\]]*)\]/.exec(object.dict)?.[1];
    if (!box) { const parent = objects.get(reference(/\/Parent\s+(\d+ 0 R)/.exec(object.dict)?.[1])); box = /\/MediaBox\s*\[([^\]]*)\]/.exec(parent?.dict || "")?.[1]; }
    const numbers = (box || "").trim().split(/\s+/).map(Number);
    const resourcesText = (() => { const inline = /\/Resources\s*<<([\s\S]*)>>/.exec(object.dict)?.[1]; if (inline) return inline; const ref = reference(/\/Resources\s+(\d+ 0 R)/.exec(object.dict)?.[1]); return objects.get(ref)?.dict || ""; })();
    const fontDictionary = (() => { const inline = /\/Font\s*<<([^>]*)>>/.exec(resourcesText)?.[1]; if (inline) return inline; const ref = reference(/\/Font\s+(\d+ 0 R)/.exec(resourcesText)?.[1]); return objects.get(ref)?.dict || ""; })();
    const fonts = new Map([...fontDictionary.matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)].map(entry => [entry[1], fontObjects.get(Number(entry[2])) ?? null]));
    const xobjectDictionary = (() => { const inline = /\/XObject\s*<<([^>]*)>>/.exec(resourcesText)?.[1]; if (inline) return inline; const ref = reference(/\/XObject\s+(\d+ 0 R)/.exec(resourcesText)?.[1]); return objects.get(ref)?.dict || ""; })();
    const forms = new Map([...xobjectDictionary.matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)].map(entry => [entry[1], Number(entry[2])]));
    const contents = (() => { const list = /\/Contents\s*\[([^\]]*)\]/.exec(object.dict)?.[1]; return list ? [...list.matchAll(/(\d+) 0 R/g)].map(entry => Number(entry[1])) : [reference(/\/Contents\s+(\d+ 0 R)/.exec(object.dict)?.[1])].filter(Boolean); })();
    const content = contents.map(number => objects.get(number)?.data?.toString("latin1") || "").join("\n");
    pages.push({ width: numbers[2] - numbers[0], height: numbers[3] - numbers[1], text: showText(content, fonts, forms, objects) });
  }
  const understood = pages.length > 0 && pages.every(page => Number.isFinite(page.width) && Number.isFinite(page.height));
  if (!understood) notes.push("no readable page was found");
  return { pages, fonts: fontObjects.size, images, understood, notes };
}

/** Lower-cased text with whitespace removed, so labels compare regardless of how a line was broken. */
export const normalizeText = value => String(value).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
