# Vendored libraries

Exact copies of the third-party scripts the renderer otherwise loads from public CDNs, so a
presentation can be built and run with no network access. They are never edited.

d3 and gif.js (with its worker) are what a delivered page loads; `build_bundle.py --offline`
places them beside the page or inlines them. dagre and elkjs are vendored for the build step
(`scripts/store_geometry.mjs` loads them to compute the layout that is stored in the page) and
are what `translate.html` loads from the CDN; they are not delivered with a page.

| Library | Version | Licence | Files |
| --- | --- | --- | --- |
| d3 | 7.9.0 | ISC | `d3.min.js` |
| dagre | 1.1.4 | MIT | `dagre.min.js` |
| elkjs | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later | `elk.bundled.js` |
| gif.js | 0.2.0 | MIT | `gif.js`, `gif.worker.js` |
| js-yaml | 4.1.1 | MIT | `js-yaml.min.js` |

`manifest.json` records each file's source URL, size and SHA-384, and each library's licence
file. Every hash equals the Subresource Integrity value pinned for the same URL in
`../cdn-integrity.json`, so a vendored file is byte-for-byte what the CDN serves.
`npm run test:documentation` (`offline_assets.test.mjs`) fails if a file is changed, a licence
text is missing or unrecognisable, a library has a licence that is not on the allowed list, or
a file appears here that the manifest does not list.

elkjs is dual licensed (EPL-2.0 or GPL-3.0-or-later); this repository uses it under the
Eclipse Public License 2.0, whose text is `elkjs.LICENSE.md`. It is distributed unmodified.

## Updating

1. Change the pinned URL and hash in `../cdn-integrity.json` (and the `<script>` tags).
2. Update the version in `../../scripts/vendor_assets.mjs`.
3. Run `node skills/archnime-renderer/scripts/vendor_assets.mjs`: it refuses any download
   whose SHA-384 differs from the pinned value, then rewrites the files, licences and manifest.

`.gitattributes` marks this directory `-text` so git never converts line endings: that would
change the bytes and break the pinned hashes on Windows checkouts.
