import { brand } from '@switchboard/shared'
import {
  ActivityIcon,
  CableIcon,
  DownloadIcon,
  HouseIcon,
  KeyRoundIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  ServerIcon,
  SunIcon,
} from 'lucide-react'
import { Fragment, useRef } from 'react'
import { useWaitingClients } from '@/components/client-profiles'
import { StatusDot } from '@/components/common'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { type LiveState, useStatus } from '@/lib/queries'
import { Link, useLocation } from '@/lib/router'
import { type ThemePref, useTheme } from '@/lib/theme'

const NAV = [
  { to: '/', label: 'Overview', icon: HouseIcon },
  { to: '/servers', label: 'Servers', icon: ServerIcon },
  { to: '/profiles', label: 'Profiles', icon: LayersIcon },
  { to: '/clients', label: 'Clients', icon: CableIcon },
  { to: '/import', label: 'Import', icon: DownloadIcon },
  { to: '/secrets', label: 'Secrets', icon: KeyRoundIcon },
  { to: '/activity', label: 'Activity', icon: ActivityIcon },
]

const LINKS = [
  { href: `${brand.docsUrl}/docs`, label: 'Docs' },
  { href: `${brand.docsUrl}/docs/changelog`, label: 'Changelog' },
  { href: brand.repoUrl, label: 'GitHub' },
]

const THEMES: { value: ThemePref; label: string; icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
]

function ThemeMenu() {
  const { theme, resolved, setTheme } = useTheme()
  const Icon = theme === 'system' ? MonitorIcon : resolved === 'dark' ? MoonIcon : SunIcon
  const label = THEMES.find((t) => t.value === theme)?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton tooltip={`Theme: ${label}`} />}>
        <Icon />
        <span>Theme: {label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePref)}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value}>
                <t.icon />
                {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function liveText(live: LiveState, everLive: boolean): string {
  if (live === 'live') return 'Connected'
  if (live === 'offline') return 'Offline'
  return everLive ? 'Reconnecting…' : 'Connecting…'
}

export function AppSidebar({ live }: { live: LiveState }) {
  const { path } = useLocation()
  const status = useStatus()
  const { setOpenMobile } = useSidebar()
  const waiting = useWaitingClients().length
  const everLive = useRef(false)
  if (live === 'live') everLive.current = true
  const text = liveText(live, everLive.current)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link to="/" onClick={() => setOpenMobile(false)} />}
              tooltip={brand.displayName}
            >
              <img src="/favicon.svg" alt="" className="size-8 shrink-0" />
              <span className="flex flex-col leading-tight">
                <span className="font-heading font-semibold">{brand.displayName}</span>
                <span className="text-xs text-muted-foreground">MCP gateway</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active =
                  item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`)
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={
                        item.to === '/clients' && waiting
                          ? `${item.label} · ${waiting} waiting for a profile`
                          : item.label
                      }
                      render={
                        <Link
                          to={item.to}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => setOpenMobile(false)}
                        />
                      }
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.to === '/clients' && waiting > 0 && (
                      <SidebarMenuBadge
                        aria-label={`${waiting} client${waiting === 1 ? '' : 's'} waiting for a profile`}
                      >
                        {waiting}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
        </SidebarMenu>
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border bg-background px-2.5 py-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-2"
          title={status.data?.port ? `Daemon on 127.0.0.1:${status.data.port}` : undefined}
        >
          <span className="flex items-center gap-2 text-xs font-medium">
            <StatusDot
              tone={live === 'live' ? 'success' : live === 'connecting' ? 'warning' : 'destructive'}
              pulse={live === 'connecting'}
            />
            <span className="truncate group-data-[collapsible=icon]:sr-only">{text}</span>
            {status.data?.port && live === 'live' ? (
              <span className="ml-auto font-mono text-muted-foreground group-data-[collapsible=icon]:hidden">
                :{status.data.port}
              </span>
            ) : null}
          </span>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {status.data?.version && (
              <>
                <span className="tabular-nums">v{status.data.version}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {LINKS.map((l, i) => (
              <Fragment key={l.label}>
                {i > 0 && <span aria-hidden="true">·</span>}
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:text-foreground hover:underline"
                >
                  {l.label}
                </a>
              </Fragment>
            ))}
          </p>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
