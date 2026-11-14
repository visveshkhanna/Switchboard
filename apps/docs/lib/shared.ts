import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'Switchboard';
export const siteUrl = 'https://switchboard.visvesh.dev';
export const tagline = 'One local MCP endpoint for all your AI agents.';
export const description =
  'Switchboard groups your MCP servers into profiles and gives Cursor, Claude Code, VS Code and every other agent one local endpoint with only the tools it should see.';
export const packageName = 'mcp-switchboard';
export const installCommand = `npx ${packageName} up`;
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'visveshkhanna',
  repo: 'Switchboard',
  branch: 'main',
  // where the pages live in the repository
  contentDir: 'apps/docs/content/docs',
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
