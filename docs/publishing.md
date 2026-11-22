# Publishing archnime to plugin providers

This repository is one plugin, `archnime`, with five skills. Every provider below
reads files that are already in the repository, so most of "registering" is
making the repository public with the right metadata, then telling the
provider where it is. Nothing here needs a second copy of the skills.

## What each provider reads

| Provider | Reads | Registered by |
| --- | --- | --- |
| Claude Code | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Users add the repository as a marketplace; the repository is a marketplace already |
| Anthropic's directory | the same `.claude-plugin/plugin.json` | A submission in the developer portal at claude.ai/directory/manage, from the GitHub repository |
| Codex | `.agents/plugins/marketplace.json`, root `plugin.json` | Users add the repository as a marketplace; the repository is a marketplace already |
| GitHub Copilot (CLI, VS Code) | `.github/plugin/marketplace.json`, root `plugin.json` | Users add the repository as a marketplace; the repository is a marketplace already |
| Gemini CLI | root `gemini-extension.json`, `skills/` | The gallery crawls public repositories that carry the `gemini-cli-extension` topic, daily |
| Cursor | root `plugin.json` (Agent Plugins) | A submission of the repository link at cursor.com/marketplace/publish |
| Any Agent Skills tool | `skills/<name>/SKILL.md` | `npx skills add bassemZohdy/archnime`; no registration |

Self-hosted routes (Claude Code, Codex, Copilot, Gemini by URL) work as soon as
the repository is public. Listing in a provider's own directory (Anthropic's,
Cursor's, Gemini's gallery) needs one action by the owner of the repository, in
the order below.

## Before any submission

1. `npm test` passes, and `claude plugin validate . --strict` reports no error.
2. Every manifest carries the same name and version (`npm run check-skills`
   enforces it, and also parses each skill's frontmatter as YAML).
3. The version is the one you want users to receive: Claude keeps users on the
   version they installed until it changes, so bump it in `plugin.json`,
   `.claude-plugin/plugin.json`, `gemini-extension.json` and the three
   marketplaces together.
4. Tag the release (`v<version>`) and publish a GitHub Release. Gemini's gallery
   and its update check both read tags.

## Steps only the repository owner can do

- **Gemini gallery.** On github.com/bassemZohdy/archnime, add the topic
  `gemini-cli-extension` in the About section. No form: the crawler picks the
  repository up on its next daily run, if it validates.
- **Anthropic's directory.** Open claude.ai/directory/manage, choose **Submit
  new**, connect GitHub, and give the repository, the plugin path (the
  repository root) and the branch or tag to follow. The portal asks for a
  square PNG icon, 512 to 2048 px, under 2 MB; set `icon` in
  `.claude-plugin/plugin.json` or add `.claude-plugin/icon.png`. The icon is
  taken from the first submission, so choose it before submitting. The
  directory then runs its own safety scan and policy review.
- **Cursor.** Open cursor.com/marketplace/publish and submit
  `https://github.com/bassemZohdy/archnime`.
- **Codex and Copilot directories.** Neither has a central listing to submit
  to; the marketplace files in this repository are the registration.

## What was checked, and what was not

| Check | Result |
| --- | --- |
| `claude plugin validate . --strict` | passes the manifests and every skill; one directory warning remains, the missing icon |
| `gemini extensions validate .` | passes |
| `codex plugin marketplace add` on `.agents/plugins/marketplace.json` | accepted when the route was first set up; not rerun for this change |
| GitHub Copilot catalog | structure checked by `npm run check-skills` (name, version, source `./`) against GitHub's documented format; not installed through Copilot |
| Cursor | the root `plugin.json` meets Cursor's stated submission checklist; not submitted or installed |
| Anthropic's directory | not submitted; its safety scan and policy review are not run by the validator |

The manifests and marketplaces list the same plugin, so a change to the name,
version or description belongs in all of them; `npm run check-skills` catches a
mismatch in name and version.
