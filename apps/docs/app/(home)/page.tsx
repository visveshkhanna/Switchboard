import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Boxes, Code, Layers, Lock, MousePointerClick, Zap } from 'lucide-react';
import { CopyCommand } from '@/components/copy-command';
import { githubUrl, installCommand } from '@/lib/shared';

const features: { icon: ReactNode; title: string; body: string; href: string }[] = [
  {
    icon: <Layers className="size-5" />,
    title: 'Profiles',
    body: 'Group servers into personal, work and client profiles, and give each agent only the tools it should see.',
    href: '/docs/concepts/profiles',
  },
  {
    icon: <Boxes className="size-5" />,
    title: 'One process per server',
    body: 'Every client shares one copy of each MCP server, started on first use and stopped when idle.',
    href: '/docs/concepts/profiles#shared-servers',
  },
  {
    icon: <Zap className="size-5" />,
    title: 'Instant tool lists',
    body: 'Tool catalogs are cached, so clients see their tools at once, even when no server is running.',
    href: '/docs/concepts/profiles#shared-servers',
  },
  {
    icon: <Code className="size-5" />,
    title: 'Search/execute & code mode',
    body: 'Shrink hundreds of tool definitions into three search tools, or one execute tool that runs code in a sandbox.',
    href: '/docs/concepts/code-mode',
  },
  {
    icon: <MousePointerClick className="size-5" />,
    title: 'One-click client connect',
    body: 'Switchboard writes the MCP entry into Cursor, Claude Code, VS Code and others, and imports the servers you have.',
    href: '/docs/guides/connect-clients',
  },
  {
    icon: <Lock className="size-5" />,
    title: 'Local & private',
    body: 'Binds to loopback and keeps secrets in your OS keychain when available. No account, no cloud.',
    href: '/docs/security',
  },
];

function Diagram() {
  const clients = ['Cursor', 'Claude Code', 'VS Code'];
  const profiles = [
    { name: 'work', servers: 'github · linear · sentry' },
    { name: 'personal', servers: 'github · notion · fs' },
    { name: 'acme', servers: 'jira · postgres' },
  ];
  return (
    <div className="w-full min-w-0 max-w-3xl overflow-hidden rounded-xl border bg-fd-card text-left shadow-lg">
      <div className="flex items-center gap-1.5 border-b px-4 py-3">
        <span className="size-3 rounded-full bg-fd-border" />
        <span className="size-3 rounded-full bg-fd-border" />
        <span className="size-3 rounded-full bg-fd-border" />
        <span className="ml-3 font-mono text-xs text-fd-muted-foreground">localhost:7690</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-3 p-5 font-mono text-[13px] sm:gap-6">
        <div className="flex flex-col gap-2">
          {clients.map((c) => (
            <div key={c} className="truncate rounded-md border bg-fd-background px-3 py-2">
              {c}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-fd-muted-foreground">
          {profiles.map((p) => (
            <div key={p.name} className="py-2">
              →
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {profiles.map((p) => (
            <div key={p.name} className="min-w-0 rounded-md border bg-fd-background px-3 py-2">
              <span className="text-fd-foreground">/p/{p.name}/mcp</span>
              <span className="hidden text-fd-muted-foreground sm:inline"> {p.servers}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col overflow-x-clip">
      <section className="relative flex flex-col items-center gap-8 px-4 pb-16 pt-20 text-center md:pt-28">
        <div aria-hidden className="hero-grid pointer-events-none absolute inset-0 -z-10" />
        <Link
          href="/docs/changelog"
          className="rounded-full border bg-fd-card px-3 py-1 text-xs text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        >
          Open source · local-first MCP gateway
        </Link>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tighter md:text-6xl">
          One local MCP endpoint for all your AI agents
        </h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          Group your MCP servers into profiles and point Cursor, Claude Code, VS Code and every other agent at{' '}
          <code className="font-mono text-fd-foreground">localhost:7690</code>. Each one sees only the tools it should.
        </p>
        <CopyCommand command={installCommand} />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-lg bg-fd-foreground px-5 py-2.5 text-sm font-medium text-fd-background transition-opacity hover:opacity-90"
          >
            Get started <ArrowRight className="size-4" />
          </Link>
          <a
            href={githubUrl}
            className="inline-flex items-center gap-2 rounded-lg border bg-fd-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            GitHub
          </a>
        </div>
        <Diagram />
      </section>

      <section className="mx-4 grid max-w-5xl gap-px overflow-hidden rounded-xl border bg-fd-border sm:grid-cols-2 lg:mx-auto lg:w-full lg:grid-cols-3">
        {features.map((f) => (
          <Link key={f.title} href={f.href} className="group flex flex-col gap-3 bg-fd-background p-6 transition-colors hover:bg-fd-card">
            <span className="text-fd-muted-foreground transition-colors group-hover:text-fd-foreground">{f.icon}</span>
            <h2 className="font-semibold">{f.title}</h2>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
          </Link>
        ))}
      </section>

      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-20 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Replace a dozen server entries with one</h2>
        <p className="text-fd-muted-foreground">
          Configure servers once in Switchboard. Each client gets a single entry that points at its profile, so adding a
          server or moving a tool between profiles never means editing every client again.
        </p>
        <pre className="w-full overflow-x-auto rounded-lg border bg-fd-card p-4 text-left text-sm">
          <span className="text-red-600 dark:text-red-400">{'- "github":  { "command": "npx", "args": [...] },'}</span>
          {'\n'}
          <span className="text-red-600 dark:text-red-400">{'- "linear":  { "url": "https://mcp.linear.app/sse" },'}</span>
          {'\n'}
          <span className="text-red-600 dark:text-red-400">{'- "sentry":  { "command": "npx", "args": [...] },'}</span>
          {'\n'}
          <span className="text-green-700 dark:text-green-400">{'+ "switchboard": { "url": "http://localhost:7690/p/work/mcp" }'}</span>
        </pre>
      </section>

      <footer className="border-t px-4 py-8 text-center text-sm text-fd-muted-foreground">
        Apache-2.0 licensed.{' '}
        <a href={githubUrl} className="underline underline-offset-4 hover:text-fd-foreground">
          Source on GitHub
        </a>
        .
      </footer>
    </main>
  );
}
