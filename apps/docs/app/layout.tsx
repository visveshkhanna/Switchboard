import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Provider } from '@/components/provider';
import { appName, description, siteUrl, tagline } from '@/lib/shared';
import './global.css';

const homeImage = {
  url: '/og/home.png',
  width: 1200,
  height: 630,
  alt: `${appName}: one local MCP endpoint for all your AI agents`,
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${appName}: ${tagline}`,
    template: `%s | ${appName}`,
  },
  description,
  applicationName: appName,
  alternates: { canonical: '/' },
  // Listing icons here replaces the link Next.js would generate for
  // app/icon.svg, so every icon is declared explicitly.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/brand/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    siteName: appName,
    type: 'website',
    locale: 'en_US',
    url: '/',
    title: `${appName}: ${tagline}`,
    description,
    images: [homeImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${appName}: ${tagline}`,
    description,
    images: [homeImage],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
