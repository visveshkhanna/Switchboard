import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';
import { installCommand } from './shared';

// Images rendered at build time from the SVG logo in assets/brand/: the
// Open Graph cards, and the PNG icons that need a raster format (web app
// manifest, Apple touch icon). There is no separate artwork to export.

export const ogSize = { width: 1200, height: 630 };

const root = process.cwd();
const font = (file: string) => readFileSync(join(root, 'node_modules/geist/dist/fonts', file));

export const logoSvg = `data:image/svg+xml;base64,${readFileSync(join(root, 'assets/brand/logo.svg')).toString('base64')}`;

const fonts = [
  { name: 'Geist', data: font('geist-sans/Geist-Regular.ttf'), weight: 400 as const },
  { name: 'Geist', data: font('geist-sans/Geist-SemiBold.ttf'), weight: 600 as const },
  { name: 'Geist Mono', data: font('geist-mono/GeistMono-Regular.ttf'), weight: 400 as const },
];

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A square PNG of the logo. `opaque` fills the rounded corners, for iOS. */
export function iconImage(size: number, { opaque = false }: { opaque?: boolean } = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: opaque ? '#4f46e5' : 'transparent',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSvg} width={size} height={size} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}

export function ogImage({
  title,
  description,
  eyebrow,
  footer,
  titleSize,
}: {
  title: string;
  titleSize?: number;
  description?: string;
  eyebrow?: string;
  footer?: ReactNode;
}) {
  const long = title.length > 28;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: '#0a0a0a',
          backgroundImage:
            'linear-gradient(to right, #1c1c1c 1px, transparent 1px), linear-gradient(to bottom, #1c1c1c 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          color: '#fafafa',
          fontFamily: 'Geist',
        }}
      >
        {/* the patch panel, large, on the right */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSvg}
          width={400}
          height={400}
          alt=""
          style={{ position: 'absolute', right: 96, top: 115, borderRadius: 88, boxShadow: '0 0 120px rgba(99,102,241,0.28)' }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: '64px 72px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSvg} width={44} height={44} alt="" />
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>Switchboard</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 580, gap: 20 }}>
            {eyebrow ? (
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Geist Mono',
                  fontSize: 22,
                  color: '#8a8a8a',
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                }}
              >
                {eyebrow}
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                fontSize: titleSize ?? (long ? 60 : 72),
                fontWeight: 600,
                lineHeight: 1.05,
                letterSpacing: -2,
              }}
            >
              {title}
            </div>
            {description ? (
              <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.4, color: '#a3a3a3' }}>
                {clip(description, 130)}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'Geist Mono', fontSize: 22, color: '#8a8a8a' }}>
            {footer ?? 'switchboard.visvesh.dev'}
          </div>
        </div>
      </div>
    ),
    { ...ogSize, fonts },
  );
}

export const installFooter = (
  <div
    style={{
      display: 'flex',
      padding: '12px 20px',
      border: '1px solid #333',
      borderRadius: 10,
      background: 'rgba(10,10,10,0.85)',
      color: '#e5e5e5',
      fontSize: 22,
    }}
  >
    <span style={{ color: '#737373', marginRight: 14 }}>$</span>
    {installCommand}
  </div>
);
