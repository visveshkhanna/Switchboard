// Copies files kept at the repository root into the site: CHANGELOG.md as
// the changelog page. The repository copy stays the one source of truth.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const site = new URL('../', import.meta.url);
const repo = new URL('../../', site);
const releases = 'https://github.com/visveshkhanna/Switchboard/releases';
const source = readFileSync(new URL('CHANGELOG.md', repo), 'utf8');

const body = source
  // the page has its own title and intro
  .replace(/^# Changelog\n+[^\n]*\n+/, '')
  // version headings link to their GitHub release
  .replace(/^## \[(\d+\.\d+\.\d+[^\]]*)\] - (\d{4}-\d{2}-\d{2})$/gm,
    (_, v, date) => `## [v${v}](${releases}/tag/v${v}) · ${date}`)
  // drop the empty Unreleased section and the link definitions
  .replace(/^## \[Unreleased\]\n+(?=## )/m, '')
  .replace(/^## \[Unreleased\]$/m, '## Unreleased')
  .replace(/^\[[^\]]+\]: .*$/gm, '')
  .trimEnd();

const page = `---
title: Changelog
description: What changed in each release of Switchboard.
---

{/* Generated from CHANGELOG.md at the repository root by scripts/sync.mjs. Edit that file instead. */}

Releases are published to npm as [\`mcp-switchboard\`](https://www.npmjs.com/package/mcp-switchboard), with notes on [GitHub](${releases}).

${body}
`;

const out = fileURLToPath(new URL('content/docs/changelog.mdx', site));
writeFileSync(out, page);
console.log(`wrote ${out}`);
