import { iconImage } from '@/lib/og';

// Apple touch icon: opaque and square; iOS rounds the corners itself.
export const dynamic = 'force-static';

export function GET() {
  return iconImage(180, { opaque: true });
}
