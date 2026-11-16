/* snapshots.md: Markdown that shows every exported state and links to where it can be explored.
 *
 * For each snapshot: the static SVG as an image, a plain link to the SVG (the fallback for a
 * page that cannot show images inline or run the presenter), and, when a viewer URL is given,
 * a link that opens the interactive presenter on the same view and state through the
 * presenter's own ?view= and ?stage= / ?variant= / ?step= parameters.
 */

const SAFE_SCHEMES = new Set(["http", "https"]);

/** A viewer URL comes from the caller and ends up in a link, so only web or relative targets pass. */
export function checkViewerUrl(value) {
  // Browsers delete tab, CR and LF and strip leading control characters before reading a scheme.
  const cleaned = String(value).replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (!cleaned || cleaned.startsWith("//") || (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase()))) {
    throw new Error(`viewer URL must be http(s) or a relative path, got ${JSON.stringify(value)}`);
  }
  if (/[\s()<>"`]/.test(cleaned)) throw new Error(`viewer URL must not contain spaces or Markdown/HTML delimiters, got ${JSON.stringify(value)}`);
  return cleaned;
}

/** Text from a model is data, so Markdown and HTML syntax in it is neutralised. */
export const escapeMarkdown = text => String(text ?? "")
  .replace(/[\r\n]+/g, " ")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/([\\`*_{}\[\]()#+!|~])/g, "\\$1");

const presenterLink = (viewerUrl, snapshot) => {
  const query = [];
  if (snapshot.view) query.push(`view=${encodeURIComponent(snapshot.view)}`);
  query.push(`${snapshot.parameter}=${snapshot.state.index}`);
  return `${viewerUrl}${viewerUrl.includes("?") ? "&" : "?"}${query.join("&")}`;
};

/**
 * @param {{manifest: {snapshots: object[]}, title: string, viewerUrl?: string}} options
 */
export function buildMarkdown({ manifest, title, viewerUrl }) {
  const viewer = viewerUrl === undefined ? null : checkViewerUrl(viewerUrl);
  const lines = [`# ${escapeMarkdown(title)}`, ""];
  const groups = [];
  for (const snapshot of manifest.snapshots) {
    let group = groups.find(item => item.view === snapshot.view);
    if (!group) { group = { view: snapshot.view, mode: snapshot.mode, snapshots: [] }; groups.push(group); }
    group.snapshots.push(snapshot);
  }
  for (const group of groups) {
    lines.push(`## ${escapeMarkdown(group.view ?? "Snapshots")}${group.mode ? ` (${escapeMarkdown(group.mode)})` : ""}`, "");
    for (const snapshot of group.snapshots) {
      const heading = escapeMarkdown(snapshot.state.title), target = encodeURIComponent(snapshot.file);
      lines.push(`### ${snapshot.state.index}. ${heading}`, "", `![${escapeMarkdown([group.view, snapshot.state.title].filter(Boolean).join(": "))}](${target})`, "");
      const parts = [`[SVG](${target})`];
      if (viewer) parts.push(`[Open in the interactive presenter](${presenterLink(viewer, snapshot)})`);
      lines.push(parts.join(" · "), "");
    }
  }
  if (!viewer) lines.push("_No interactive presenter link was given; the images above are static SVGs._", "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
