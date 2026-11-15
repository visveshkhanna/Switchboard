'use client';

import { useEffect, useRef, useState } from 'react';

type ProfileId = 'personal' | 'work' | 'client-acme';

const CLIENTS = [
  { id: 'cursor', name: 'Cursor' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'vscode', name: 'VS Code' },
  { id: 'zed', name: 'Zed' },
  { id: 'codex', name: 'Codex' },
] as const;
type ClientId = (typeof CLIENTS)[number]['id'];

const SERVERS = ['github', 'notion', 'linear', 'slack', 'sentry', 'figma'] as const;
type ServerId = (typeof SERVERS)[number];

// The logo's three cords: white (foreground), amber and grey.
const PROFILES: { id: ProfileId; servers: ServerId[]; stroke: string; fill: string }[] = [
  { id: 'personal', servers: ['github', 'notion'], stroke: 'stroke-fd-foreground', fill: 'fill-fd-foreground' },
  { id: 'work', servers: ['github', 'linear', 'slack', 'sentry'], stroke: 'stroke-amber-500', fill: 'fill-amber-500' },
  { id: 'client-acme', servers: ['linear', 'slack', 'figma'], stroke: 'stroke-neutral-400', fill: 'fill-neutral-400' },
];
const ORDER: ProfileId[] = ['personal', 'work', 'client-acme'];

const W = 1000;
const CLIENT_X = 178;
const PROFILE_L = 430;
const PROFILE_R = 570;
const SERVER_X = 822;
const clientY = (i: number) => 70 + i * 75;
const profileY = (id: ProfileId) => 120 + ORDER.indexOf(id) * 110;
const serverY = (i: number) => 60 + i * 64;

type Point = { x: number; y: number };
type Curve = [Point, Point, Point, Point];

function cord(from: Point, to: Point): Curve {
  const bend = (to.x - from.x) * 0.55;
  return [from, { x: from.x + bend, y: from.y }, { x: to.x - bend, y: to.y }, to];
}
const toPath = ([a, b, c, d]: Curve) => `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${c.x} ${c.y}, ${d.x} ${d.y}`;
function pointAt([a, b, c, d]: Curve, t: number): Point {
  const u = 1 - t;
  const x = u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x;
  const y = u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y;
  return { x, y };
}

const INITIAL: Record<ClientId, ProfileId> = {
  cursor: 'work',
  'claude-code': 'personal',
  vscode: 'work',
  zed: 'personal',
  codex: 'client-acme',
};

/**
 * The idea of Switchboard as a patch panel: clients on the left, profiles in
 * the middle, servers on the right. Click a client to move its cord to the
 * next profile; its tools change with it.
 */
export function PatchPanel() {
  const [assign, setAssign] = useState(INITIAL);
  const [hover, setHover] = useState<ClientId | null>(null);
  const [focus, setFocus] = useState<ClientId>('cursor');
  // Animated y of each client cord's profile end, so cords swing when re-patched.
  const [ends, setEnds] = useState<Record<ClientId, number>>(() =>
    Object.fromEntries(CLIENTS.map((c) => [c.id, profileY(INITIAL[c.id])])) as Record<ClientId, number>,
  );
  const endsRef = useRef(ends);
  const dots = useRef(new Map<string, SVGCircleElement>());
  const reduced = useRef(false);

  const active = hover ?? focus;
  const activeProfile = assign[active];

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Swing cords towards their new profile.
  useEffect(() => {
    const from = { ...endsRef.current };
    const to = Object.fromEntries(CLIENTS.map((c) => [c.id, profileY(assign[c.id])])) as Record<ClientId, number>;
    if (reduced.current) {
      endsRef.current = to;
      setEnds(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      const e = 1 - (1 - t) ** 3;
      const next = Object.fromEntries(
        CLIENTS.map((c) => [c.id, from[c.id] + (to[c.id] - from[c.id]) * e]),
      ) as Record<ClientId, number>;
      endsRef.current = next;
      setEnds(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [assign]);

  // Signals travelling along the active route.
  useEffect(() => {
    if (reduced.current) return;
    let raf = 0;
    const loop = (now: number) => {
      const t = (now / 1500) % 1;
      const ci = CLIENTS.findIndex((c) => c.id === active);
      const pY = endsRef.current[active];
      const first = cord({ x: CLIENT_X, y: clientY(ci) }, { x: PROFILE_L, y: pY });
      const lead = dots.current.get('lead');
      if (lead) {
        const p = pointAt(first, t);
        lead.setAttribute('cx', String(p.x));
        lead.setAttribute('cy', String(p.y));
      }
      const profile = PROFILES.find((p) => p.id === activeProfile)!;
      for (const s of profile.servers) {
        const el = dots.current.get(s);
        if (!el) continue;
        const curve = cord({ x: PROFILE_R, y: profileY(profile.id) }, { x: SERVER_X, y: serverY(SERVERS.indexOf(s)) });
        const p = pointAt(curve, (t + 0.35) % 1);
        el.setAttribute('cx', String(p.x));
        el.setAttribute('cy', String(p.y));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, activeProfile]);

  const cycle = (id: ClientId) => {
    setFocus(id);
    setAssign((a) => ({ ...a, [id]: ORDER[(ORDER.indexOf(a[id]) + 1) % ORDER.length]! }));
  };

  const activeServers = PROFILES.find((p) => p.id === activeProfile)!.servers;
  const activeName = CLIENTS.find((c) => c.id === active)!.name;

  return (
    <div className="w-full max-w-5xl">
      <svg viewBox={`0 0 ${W} 440`} className="w-full select-none" role="group" aria-label="Clients patched to profiles">
        {/* Profile → server cords */}
        {PROFILES.map((p) =>
          p.servers.map((s) => {
            const on = p.id === activeProfile;
            return (
              <path
                key={`${p.id}-${s}`}
                d={toPath(cord({ x: PROFILE_R, y: profileY(p.id) }, { x: SERVER_X, y: serverY(SERVERS.indexOf(s)) }))}
                className={`${p.stroke} fill-none transition-opacity duration-300`}
                strokeWidth={on ? 3 : 2}
                strokeLinecap="round"
                opacity={on ? 0.95 : 0.14}
              />
            );
          }),
        )}

        {/* Client → profile cords */}
        {CLIENTS.map((c, i) => {
          const p = PROFILES.find((x) => x.id === assign[c.id])!;
          const on = c.id === active;
          return (
            <path
              key={c.id}
              d={toPath(cord({ x: CLIENT_X, y: clientY(i) }, { x: PROFILE_L, y: ends[c.id] }))}
              className={`${p.stroke} fill-none transition-opacity duration-300`}
              strokeWidth={on ? 3.5 : 2.5}
              strokeLinecap="round"
              opacity={on ? 1 : 0.35}
            />
          );
        })}

        {/* Signals */}
        <circle
          ref={(el) => {
            if (el) dots.current.set('lead', el);
          }}
          r={4.5}
          className="fill-amber-400"
          cx={-20}
          cy={-20}
        />
        {SERVERS.map((s) => (
          <circle
            key={s}
            ref={(el) => {
              if (el) dots.current.set(s, el);
            }}
            r={3.5}
            className="fill-amber-400 transition-opacity"
            opacity={activeServers.includes(s) ? 1 : 0}
            cx={-20}
            cy={-20}
          />
        ))}

        {/* Clients */}
        {CLIENTS.map((c, i) => {
          const on = c.id === active;
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
            <g
              key={c.id}
              role="button"
              tabIndex={0}
              aria-label={`${c.name} uses ${assign[c.id]}. Switch its profile.`}
              className="cursor-pointer outline-none [&:focus-visible_circle]:stroke-amber-500"
              onPointerEnter={() => setHover(c.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => cycle(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  cycle(c.id);
                }
              }}
            >
              <rect x={20} y={clientY(i) - 24} width={176} height={48} fill="transparent" />
              <text
                x={152}
                y={clientY(i) + 6}
                textAnchor="end"
                className={`text-[17px] font-medium transition-colors ${on ? 'fill-fd-foreground' : 'fill-fd-muted-foreground'}`}
              >
                {c.name}
              </text>
              <circle cx={CLIENT_X} cy={clientY(i)} r={9} className="fill-fd-background stroke-fd-foreground" strokeWidth={2.5} />
            </g>
          );
        })}

        {/* Profiles */}
        {PROFILES.map((p) => {
          const on = p.id === activeProfile;
          return (
            <g key={p.id} className="transition-opacity duration-300" opacity={on ? 1 : 0.55}>
              <rect
                x={PROFILE_L}
                y={profileY(p.id) - 24}
                width={PROFILE_R - PROFILE_L}
                height={48}
                rx={24}
                className={`fill-fd-card ${on ? p.stroke : 'stroke-fd-border'}`}
                strokeWidth={on ? 2.5 : 1.5}
              />
              <text x={W / 2} y={profileY(p.id) + 6} textAnchor="middle" className="fill-fd-foreground font-mono text-[16px]">
                {p.id}
              </text>
            </g>
          );
        })}

        {/* Servers */}
        {SERVERS.map((s, i) => {
          const on = activeServers.includes(s);
          return (
            <g key={s} className="transition-opacity duration-300" opacity={on ? 1 : 0.4}>
              <circle
                cx={SERVER_X}
                cy={serverY(i)}
                r={9}
                className={on ? 'fill-amber-500 stroke-amber-500' : 'fill-fd-background stroke-fd-foreground'}
                strokeWidth={2.5}
              />
              <text x={SERVER_X + 22} y={serverY(i) + 6} className="fill-fd-foreground font-mono text-[16px]">
                {s}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-sm text-fd-muted-foreground" aria-live="polite">
        <span className="font-medium text-fd-foreground">{activeName}</span> uses{' '}
        <span className="font-mono text-fd-foreground">{activeProfile}</span>: {activeServers.join(', ')}.{' '}
        <span className="hidden sm:inline">Click a client to switch its profile.</span>
        <span className="sm:hidden">Tap a client to switch it.</span>
      </p>
    </div>
  );
}
