import { installFooter, ogImage } from '@/lib/og';

// The card for the home page, and the default for pages without their own.
// A route with a .png path, so it is served as image/png.
export const dynamic = 'force-static';

export function GET() {
  return ogImage({
    title: 'One local MCP endpoint for all your AI agents',
    titleSize: 56,
    description: 'Profiles, shared servers, search/execute and code mode.',
    footer: installFooter,
  });
}
