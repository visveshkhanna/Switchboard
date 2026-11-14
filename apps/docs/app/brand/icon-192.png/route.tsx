import { iconImage } from '@/lib/og';

// Web app manifest icon, rendered from assets/brand/logo.svg at build time.
export const dynamic = 'force-static';

export function GET() {
  return iconImage(192);
}
