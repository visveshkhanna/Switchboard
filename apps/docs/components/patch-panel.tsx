'use client';

import { RotateCcw } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

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
const PROFILES: { id: ProfileId; stroke: string }[] = [
  { id: 'personal', stroke: 'stroke-fd-foreground' },
  { id: 'work', stroke: 'stroke-amber-500' },
  { id: 'client-acme', stroke: 'stroke-neutral-400' },
];
const ORDER: ProfileId[] = ['personal', 'work', 'client-acme'];
const strokeOf = (id: ProfileId) => PROFILES.find((p) => p.id === id)!.stroke;

const W = 1000;
const CLIENT_X = 178;
const PROFILE_L = 430;
const PROFILE_R = 570;
const SERVER_X = 822;
const clientY = (i: number) => 70 + i * 75;
const profileY = (id: ProfileId) => 120 + ORDER.indexOf(id) * 110;
const serverY = (s: ServerId) => 60 + SERVERS.indexOf(s) * 64;

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

const INITIAL_ASSIGN: Record<ClientId, ProfileId> = {
  cursor: 'work',
  'claude-code': 'personal',
  vscode: 'work',
  zed: 'personal',
  codex: 'client-acme',
};
const INITIAL_SERVERS: Record<ProfileId, ServerId[]> = {
  personal: ['github', 'notion'],
  work: ['github', 'linear', 'slack', 'sentry'],
  'client-acme': ['linear', 'slack', 'figma'],
};

/** Enter and Space activate an SVG element with role="button". */
function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

/**
 * Switchboard as a patch panel: clients on the left, profiles in the middle,
 * servers on the right. Pick a client, then a profile to patch it into, or a
 * server to add to or remove from its profile.
 */
export function PatchPanel() {
  const [assign, setAssign] = useState(INITIAL_ASSIGN);
  const [servers, setServers] = useState(INITIAL_SERVERS);
  const [selected, setSelected] = useState<ClientId>('cursor');
  const [hoverClient, setHoverClient] = useState<ClientId | null>(null);
  const [hoverProfile, setHoverProfile] = useState<ProfileId | null>(null);
  const [hoverServer, setHoverServer] = useState<ServerId | null>(null);
  const [said, setSaid] = useState('');
  // Animated y of each client cord's profile end, so cords swing when re-patched.
  const [ends, setEnds] = useState<Record<ClientId, number>>(
    () => Object.fromEntries(CLIENTS.map((c) => [c.id, profileY(INITIAL_ASSIGN[c.id])])) as Record<ClientId, number>,
  );
  const endsRef = useRef(ends);
  const dots = useRef(new Map<string, SVGCircleElement>());
  const reduced = useRef(false);

  // The route on show: the hovered client's, or the selected one's; a hovered profile previews its servers.
  const shownClient = hoverClient ?? selected;
  const shownProfile = hoverProfile ?? assign[shownClient];
  const shownServers = servers[shownProfile];
  const selectedProfile = assign[selected];
  const nameOf = (id: ClientId) => CLIENTS.find((c) => c.id === id)!.name;
  const changed =
    JSON.stringify(assign) !== JSON.stringify(INITIAL_ASSIGN) ||
    JSON.stringify(servers) !== JSON.stringify(INITIAL_SERVERS);

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

  // Signals travelling along the route on show.
  useEffect(() => {
    if (reduced.current) return;
    let raf = 0;
    const loop = (now: number) => {
      const t = (now / 1500) % 1;
      const lead = dots.current.get('lead');
      if (lead) {
        const ci = CLIENTS.findIndex((c) => c.id === shownClient);
        const live = !hoverProfile || hoverProfile === assign[shownClient];
        const p = pointAt(cord({ x: CLIENT_X, y: clientY(ci) }, { x: PROFILE_L, y: endsRef.current[shownClient] }), t);
        lead.setAttribute('cx', String(p.x));
        lead.setAttribute('cy', String(p.y));
        lead.setAttribute('opacity', live ? '1' : '0');
      }
      for (const s of SERVERS) {
        const el = dots.current.get(s);
        if (!el || !shownServers.includes(s)) continue;
        const p = pointAt(cord({ x: PROFILE_R, y: profileY(shownProfile) }, { x: SERVER_X, y: serverY(s) }), (t + 0.35) % 1);
        el.setAttribute('cx', String(p.x));
        el.setAttribute('cy', String(p.y));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [shownClient, shownProfile, shownServers, hoverProfile, assign]);

  const clickClient = (id: ClientId) => {
    if (id !== selected) {
      setSelected(id);
      setSaid(`${nameOf(id)} selected. It uses ${assign[id]}.`);
      return;
    }
    // A second click on the selected client moves it to the next profile.
    const next = ORDER[(ORDER.indexOf(assign[id]) + 1) % ORDER.length]!;
    setAssign((a) => ({ ...a, [id]: next }));
    setSaid(`${nameOf(id)} now uses ${next}.`);
  };

  const clickProfile = (id: ProfileId) => {
    setAssign((a) => ({ ...a, [selected]: id }));
    setHoverProfile(null);
    setSaid(`${nameOf(selected)} now uses ${id}.`);
  };

  const clickServer = (s: ServerId) => {
    const has = servers[selectedProfile].includes(s);
    setServers((all) => ({
      ...all,
      [selectedProfile]: has ? all[selectedProfile].filter((x) => x !== s) : SERVERS.filter((x) => x === s || all[selectedProfile].includes(x)),
    }));
    setSaid(`${s} ${has ? 'removed from' : 'added to'} ${selectedProfile}.`);
  };

  const reset = () => {
    setAssign(INITIAL_ASSIGN);
    setServers(INITIAL_SERVERS);
    setSelected('cursor');
    setSaid('Back to the start.');
  };

  let hint: string;
  if (hoverProfile && hoverProfile !== selectedProfile) hint = `Click to patch ${nameOf(selected)} into ${hoverProfile}.`;
  else if (hoverServer) {
    const has = servers[selectedProfile].includes(hoverServer);
    hint = `Click to ${has ? 'remove' : 'add'} ${hoverServer} ${has ? 'from' : 'to'} ${selectedProfile}.`;
  } else if (hoverClient && hoverClient !== selected) hint = `Click to select ${nameOf(hoverClient)}.`;
  else if (hoverClient) hint = `Click again to move ${nameOf(hoverClient)} to the next profile.`;
  else hint = 'Pick a client, then click a profile to patch it in, or a server to add or remove it.';

  return (
    <div className="w-full max-w-5xl">
      <svg viewBox={`0 0 ${W} 440`} className="w-full select-none" role="group" aria-label="Interactive patch panel">
        {/* Profile → server cords */}
        {PROFILES.map((p) =>
          servers[p.id].map((s) => {
            const on = p.id === shownProfile;
            return (
              <path
                key={`${p.id}-${s}`}
                d={toPath(cord({ x: PROFILE_R, y: profileY(p.id) }, { x: SERVER_X, y: serverY(s) }))}
                className={`${p.stroke} fill-none transition-opacity duration-300`}
                strokeWidth={on ? 3 : 2}
                strokeLinecap="round"
                opacity={on ? 0.95 : 0.14}
              />
            );
          }),
        )}

        {/* Preview cord: where the selected client would go */}
        {hoverProfile && hoverProfile !== selectedProfile && (
          <path
            d={toPath(
              cord(
                { x: CLIENT_X, y: clientY(CLIENTS.findIndex((c) => c.id === selected)) },
                { x: PROFILE_L, y: profileY(hoverProfile) },
              ),
            )}
            className={`${strokeOf(hoverProfile)} fill-none`}
            strokeWidth={2.5}
            strokeDasharray="6 7"
            strokeLinecap="round"
            opacity={0.8}
          />
        )}

        {/* Client → profile cords */}
        {CLIENTS.map((c, i) => {
          const on = c.id === shownClient;
          return (
            <path
              key={c.id}
              d={toPath(cord({ x: CLIENT_X, y: clientY(i) }, { x: PROFILE_L, y: ends[c.id] }))}
              className={`${strokeOf(assign[c.id])} fill-none transition-opacity duration-300`}
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
            className="fill-amber-400"
            opacity={shownServers.includes(s) ? 1 : 0}
            cx={-20}
            cy={-20}
          />
        ))}

        {/* Clients */}
        {CLIENTS.map((c, i) => {
          const isSelected = c.id === selected;
          const on = c.id === shownClient;
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
            <g
              key={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${c.name}, uses ${assign[c.id]}.${isSelected ? ' Selected; press again to move it to the next profile.' : ' Select it.'}`}
              className="group/client cursor-pointer outline-none"
              onPointerEnter={() => setHoverClient(c.id)}
              onPointerLeave={() => setHoverClient(null)}
              onFocus={() => setHoverClient(c.id)}
              onBlur={() => setHoverClient(null)}
              onClick={() => clickClient(c.id)}
              onKeyDown={onActivate(() => clickClient(c.id))}
            >
              <rect x={10} y={clientY(i) - 26} width={190} height={52} rx={10} className="fill-transparent" />
              <text
                x={152}
                y={clientY(i) + 6}
                textAnchor="end"
                className={`text-[17px] font-medium transition-colors ${on ? 'fill-fd-foreground' : 'fill-fd-muted-foreground group-hover/client:fill-fd-foreground'}`}
              >
                {c.name}
              </text>
              {isSelected && (
                <circle cx={CLIENT_X} cy={clientY(i)} r={16} className={`${strokeOf(assign[c.id])} fill-none`} strokeWidth={2} opacity={0.6} />
              )}
              <circle
                cx={CLIENT_X}
                cy={clientY(i)}
                r={9}
                className="fill-fd-background stroke-fd-foreground transition-[r] group-hover/client:[r:11] group-focus-visible/client:stroke-amber-500"
                strokeWidth={2.5}
              />
            </g>
          );
        })}

        {/* Profiles */}
        {PROFILES.map((p) => {
          const on = p.id === shownProfile;
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`Profile ${p.id}: ${servers[p.id].join(', ') || 'no servers'}. Patch ${nameOf(selected)} into it.`}
              className="group/profile cursor-pointer outline-none transition-opacity duration-300"
              opacity={on ? 1 : 0.6}
              onPointerEnter={() => setHoverProfile(p.id)}
              onPointerLeave={() => setHoverProfile(null)}
              onFocus={() => setHoverProfile(p.id)}
              onBlur={() => setHoverProfile(null)}
              onClick={() => clickProfile(p.id)}
              onKeyDown={onActivate(() => clickProfile(p.id))}
            >
              <rect
                x={PROFILE_L}
                y={profileY(p.id) - 24}
                width={PROFILE_R - PROFILE_L}
                height={48}
                rx={24}
                className={`fill-fd-card transition-colors ${on ? p.stroke : 'stroke-fd-border group-hover/profile:stroke-fd-muted-foreground'} group-focus-visible/profile:stroke-amber-500`}
                strokeWidth={on ? 2.5 : 1.5}
              />
              <text x={W / 2} y={profileY(p.id) + 6} textAnchor="middle" className="fill-fd-foreground font-mono text-[16px]">
                {p.id}
              </text>
            </g>
          );
        })}

        {/* Servers */}
        {SERVERS.map((s) => {
          const on = shownServers.includes(s);
          return (
            // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
            <g
              key={s}
              role="button"
              tabIndex={0}
              aria-label={`${s}: ${servers[selectedProfile].includes(s) ? 'in' : 'not in'} ${selectedProfile}. Toggle it.`}
              className="group/server cursor-pointer outline-none transition-opacity duration-300"
              opacity={on ? 1 : 0.45}
              onPointerEnter={() => setHoverServer(s)}
              onPointerLeave={() => setHoverServer(null)}
              onFocus={() => setHoverServer(s)}
              onBlur={() => setHoverServer(null)}
              onClick={() => clickServer(s)}
              onKeyDown={onActivate(() => clickServer(s))}
            >
              <rect x={SERVER_X - 20} y={serverY(s) - 24} width={170} height={48} rx={10} className="fill-transparent" />
              <circle
                cx={SERVER_X}
                cy={serverY(s)}
                r={9}
                className={`transition-[r] group-hover/server:[r:11] group-focus-visible/server:stroke-amber-300 ${on ? 'fill-amber-500 stroke-amber-500' : 'fill-fd-background stroke-fd-foreground'}`}
                strokeWidth={2.5}
              />
              <text
                x={SERVER_X + 22}
                y={serverY(s) + 6}
                className="fill-fd-foreground font-mono text-[16px] group-hover/server:underline"
              >
                {s}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-col items-center gap-2 text-sm">
        <p className="text-center text-fd-muted-foreground">
          <span className="font-medium text-fd-foreground">{nameOf(shownClient)}</span> uses{' '}
          <span className="font-mono text-fd-foreground">{assign[shownClient]}</span>
          {': '}
          {servers[assign[shownClient]].join(', ') || 'no servers'}.
        </p>
        <p className="flex min-h-8 items-center gap-3 text-center text-fd-muted-foreground">
          <span>{hint}</span>
          {changed && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-fd-card px-2.5 py-1 text-xs text-fd-foreground transition-colors hover:bg-fd-accent"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
        </p>
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
      </div>
    </div>
  );
}
