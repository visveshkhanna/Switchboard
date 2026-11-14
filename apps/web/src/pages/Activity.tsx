import { brand } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ActivityIcon, ChartNoAxesColumnIcon, InfoIcon } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { ErrorAlert, InlineCode, LoadingState, Page, SimpleSelect } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage, put } from '@/lib/api'
import { compact, duration, plural, relativeTime, useTick } from '@/lib/format'
import { keys, useAudit, useConfig, useSettings, useStats } from '@/lib/queries'
import { navigate, useLocation } from '@/lib/router'
import type { Settings, Stats, StatsRange } from '@/lib/types'
import { cn } from '@/lib/utils'

const VIA_LABEL: Record<string, string> = { direct: 'direct', call_tool: 'call_tool', code: 'code mode' }
const RANGES: { value: StatsRange; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

export function ActivityPage() {
  const [range, setRange] = useState<StatsRange>('24h')
  return (
    <Page
      title="Activity"
      description={
        <>
          Tool calls through {brand.displayName}. Only the tool name, client, profile, timing and success are
          recorded, never arguments or results.
        </>
      }
    >
      <LogSettings />
      <div className="flex flex-wrap items-center gap-3">
        <span id="range-label" className="text-sm font-medium">
          Time range
        </span>
        <ToggleGroup
          aria-labelledby="range-label"
          variant="outline"
          size="sm"
          spacing={0}
          value={[range]}
          onValueChange={(v) => {
            const next = v[0] as StatsRange | undefined
            if (next) setRange(next)
          }}
        >
          {RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <StatsSection range={range} />
      <LiveTable />
    </Page>
  )
}

function LogSettings() {
  const settings = useSettings()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => put<Settings>('/settings', patch),
    onSuccess: (data, patch) => {
      qc.setQueryData(keys.settings, data)
      void qc.invalidateQueries({ queryKey: keys.config })
      void qc.invalidateQueries({ queryKey: ['stats'] })
      if ('activityLog' in patch) toast.success(`Activity log turned ${data.activityLog ? 'on' : 'off'}`)
      else toast.success(`Keeping ${data.retentionDays} days of activity`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (settings.isPending) return <LoadingState rows={1} />
  if (settings.error) return <ErrorAlert error={settings.error} title="Could not load activity settings" />
  if (!settings.data)
    return (
      <Alert>
        <InfoIcon />
        <AlertTitle>Activity settings are not available</AlertTitle>
        <AlertDescription>
          This daemon version does not support them yet. Update {brand.displayName}.
        </AlertDescription>
      </Alert>
    )
  const s = settings.data
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Field orientation="horizontal" className="md:max-w-xl">
          <Switch
            id="activity-log"
            checked={s.activityLog === true}
            disabled={save.isPending}
            onCheckedChange={(on) => save.mutate({ activityLog: on })}
          />
          <FieldContent>
            <FieldLabel htmlFor="activity-log">
              Activity log: {s.activityLog === null ? 'not chosen' : s.activityLog ? 'On' : 'Off'}
            </FieldLabel>
            <FieldDescription>
              Stores tool names, timing and success in{' '}
              <InlineCode>~/{brand.stateDirName}/audit.jsonl</InlineCode>. Never arguments or results.
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal" className="md:w-auto">
          <FieldLabel htmlFor="retention" className="whitespace-nowrap">
            Keep for
          </FieldLabel>
          <SimpleSelect
            id="retention"
            className="w-32"
            disabled={save.isPending || s.activityLog !== true}
            value={String(s.retentionDays)}
            onValueChange={(v) => save.mutate({ retentionDays: Number(v) })}
            options={[7, 30, 90, ...([7, 30, 90].includes(s.retentionDays) ? [] : [s.retentionDays])].map(
              (d) => ({
                value: String(d),
                label: `${d} days`,
              }),
            )}
          />
        </Field>
      </CardContent>
    </Card>
  )
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold group-data-[size=sm]/card:text-2xl">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  )
}

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function NoData({ children = 'No calls in this range.' }: { children?: ReactNode }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {children}
    </div>
  )
}

const callsConfig = {
  ok: { label: 'Succeeded', color: 'var(--series-1)' },
  errors: { label: 'Failed', color: 'var(--destructive)' },
} satisfies ChartConfig

const latencyConfig = {
  p50: { label: 'p50 (median)', color: 'var(--series-2)' },
  p95: { label: 'p95', color: 'var(--series-1)' },
} satisfies ChartConfig

const countConfig = {
  calls: { label: 'Calls', color: 'var(--series-1)' },
} satisfies ChartConfig

function tickFormatter(range: StatsRange) {
  return (t: number) => {
    const d = new Date(t)
    return range === '1h' || range === '24h'
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
}

function labelFormatter(range: StatsRange) {
  return (_: unknown, payload: readonly { payload?: { t?: number } }[]) => {
    const t = payload[0]?.payload?.t
    if (!t) return null
    const d = new Date(t)
    return range === '30d' || range === '7d'
      ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
}

function StatsSection({ range }: { range: StatsRange }) {
  const stats = useStats(range)
  if (stats.isPending) return <LoadingState rows={2} />
  if (stats.error) return <ErrorAlert error={stats.error} title="Could not load statistics" />
  if (!stats.data)
    return (
      <Alert>
        <ChartNoAxesColumnIcon />
        <AlertTitle>Charts are not available</AlertTitle>
        <AlertDescription>This daemon version does not provide usage statistics yet.</AlertDescription>
      </Alert>
    )
  return <Charts stats={stats.data} range={range} refreshing={stats.isPlaceholderData} />
}

function Charts({ stats, range, refreshing }: { stats: Stats; range: StatsRange; refreshing: boolean }) {
  const { totals } = stats
  const buckets = useMemo(
    () => stats.buckets.map((b) => ({ ...b, ok: Math.max(0, b.calls - b.errors) })),
    [stats.buckets],
  )
  const latency = useMemo(() => buckets.filter((b) => b.calls > 0), [buckets])
  const tools = useMemo(
    () =>
      [...stats.tools]
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 8)
        .map((t) => ({ ...t, name: t.tool, ok: Math.max(0, t.calls - t.errors) })),
    [stats.tools],
  )
  const errorRate = totals.calls ? (totals.errors / totals.calls) * 100 : 0
  const fmtTick = tickFormatter(range)
  const fmtLabel = labelFormatter(range)

  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', refreshing && 'opacity-60')}>
      {stats.source === 'memory' && (
        <Alert>
          <InfoIcon />
          <AlertTitle>Showing calls since the daemon started</AlertTitle>
          <AlertDescription>
            The activity log is off, so history is kept in memory only and resets when the daemon restarts.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Total calls"
          value={compact(totals.calls)}
          sub={`Last ${RANGES.find((r) => r.value === range)?.label}`}
        />
        <Kpi
          label="Error rate"
          value={totals.calls ? `${errorRate.toFixed(errorRate < 10 ? 1 : 0)}%` : '—'}
          sub={plural(totals.errors, 'failed call')}
        />
        <Kpi label="Median latency (p50)" value={totals.calls ? duration(totals.p50) : '—'} />
        <Kpi
          label="p95 latency"
          value={totals.calls ? duration(totals.p95) : '—'}
          sub="95% of calls were faster"
        />
      </div>

      {totals.calls === 0 ? (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>No tool calls in this range</EmptyTitle>
                <EmptyDescription>
                  Connect a client to a profile and use a tool; charts fill in as calls arrive.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="Calls over time" description="Succeeded and failed calls per interval.">
              <ChartContainer config={callsConfig} className="aspect-auto h-64 w-full">
                <AreaChart data={buckets} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={fmtTick}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip
                    content={<ChartTooltipContent indicator="line" labelFormatter={fmtLabel} />}
                  />
                  <Area
                    isAnimationActive={false}
                    dataKey="ok"
                    stackId="calls"
                    type="monotone"
                    stroke="var(--color-ok)"
                    strokeWidth={2}
                    fill="var(--color-ok)"
                    fillOpacity={0.12}
                  />
                  <Area
                    isAnimationActive={false}
                    dataKey="errors"
                    stackId="calls"
                    type="monotone"
                    stroke="var(--color-errors)"
                    strokeWidth={2}
                    fill="var(--color-errors)"
                    fillOpacity={0.2}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </AreaChart>
              </ChartContainer>
            </ChartCard>

            <ChartCard
              title="Latency"
              description="Median and 95th percentile per interval, in milliseconds."
            >
              {latency.length ? (
                <ChartContainer config={latencyConfig} className="aspect-auto h-64 w-full">
                  <LineChart data={latency} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={fmtTick}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickFormatter={(v: number) => compact(v)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          indicator="line"
                          labelFormatter={fmtLabel}
                          formatter={(value, name) => (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">
                                {latencyConfig[name as keyof typeof latencyConfig]?.label ?? name}
                              </span>
                              <span className="font-mono font-medium tabular-nums">
                                {duration(Number(value))}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <Line
                      isAnimationActive={false}
                      dataKey="p50"
                      type="monotone"
                      stroke="var(--color-p50)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      isAnimationActive={false}
                      dataKey="p95"
                      type="monotone"
                      stroke="var(--color-p95)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                  </LineChart>
                </ChartContainer>
              ) : (
                <NoData />
              )}
            </ChartCard>
          </div>

          <ChartCard title="Top tools" description="Most-called tools, with the failed share of each.">
            <ChartContainer
              config={callsConfig}
              className="aspect-auto w-full"
              style={{ height: Math.max(120, tools.length * 36 + 48) }}
            >
              <BarChart data={tools} layout="vertical" margin={{ left: 0, right: 16 }} barSize={20}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={180}
                  tickFormatter={(v: string) => (v.length > 28 ? `${v.slice(0, 27)}…` : v)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <Bar isAnimationActive={false} dataKey="ok" stackId="t" fill="var(--color-ok)" />
                <Bar
                  isAnimationActive={false}
                  dataKey="errors"
                  stackId="t"
                  fill="var(--color-errors)"
                  radius={[0, 4, 4, 0]}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ShareChart
              title="By client"
              description="Calls per MCP client name."
              rows={stats.clients.map((c) => ({ name: c.client || 'unknown', calls: c.calls }))}
            />
            <ShareChart
              title="By profile"
              description="Calls per profile."
              rows={stats.profiles.map((p) => ({ name: p.profile, calls: p.calls }))}
            />
          </div>
        </>
      )}
    </div>
  )
}

function ShareChart({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: { name: string; calls: number }[]
}) {
  const data = [...rows].sort((a, b) => b.calls - a.calls).slice(0, 8)
  return (
    <ChartCard title={title} description={description}>
      {data.length ? (
        <ChartContainer
          config={countConfig}
          className="aspect-auto w-full"
          style={{ height: Math.max(96, data.length * 36 + 24) }}
        >
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40 }} barSize={20}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
            <Bar
              isAnimationActive={false}
              dataKey="calls"
              fill="var(--color-calls)"
              radius={[0, 4, 4, 0]}
              label={{ position: 'right', className: 'fill-foreground text-xs tabular-nums' }}
            />
          </BarChart>
        </ChartContainer>
      ) : (
        <NoData />
      )}
    </ChartCard>
  )
}

function LiveTable() {
  useTick(10_000)
  const audit = useAudit()
  const config = useConfig()
  const { query } = useLocation()
  const profile = query.get('profile') ?? ''
  const errorsOnly = query.get('errors') === '1'

  const setFilter = (key: string, value: string) => {
    const q = new URLSearchParams(query)
    if (value) q.set(key, value)
    else q.delete(key)
    const s = q.toString()
    navigate(`/activity${s ? `?${s}` : ''}`, { replace: true })
  }

  const rows = useMemo(
    () => (audit.data ?? []).filter((e) => (!profile || e.profile === profile) && (!errorsOnly || !e.ok)),
    [audit.data, profile, errorsOnly],
  )
  const profiles = Object.keys(config.data?.profiles ?? {})
  const errors = rows.filter((r) => !r.ok).length

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Live calls</CardTitle>
          <CardDescription>
            Newest first, updated as they happen.
            {audit.data && rows.length > 0 && (
              <>
                {' '}
                {plural(rows.length, 'call')}
                {errors > 0 && <span className="text-destructive"> · {errors} failed</span>}
              </>
            )}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="errors-only"
              checked={errorsOnly}
              onCheckedChange={(on) => setFilter('errors', on ? '1' : '')}
            />
            <FieldLabel htmlFor="errors-only" className="font-normal whitespace-nowrap">
              Errors only
            </FieldLabel>
          </Field>
          <SimpleSelect
            size="sm"
            aria-label="Filter by profile"
            className="w-40"
            value={profile || '__all__'}
            onValueChange={(v) => setFilter('profile', v === '__all__' ? '' : v)}
            options={[
              { value: '__all__', label: 'All profiles' },
              ...profiles.map((p) => ({ value: p, label: p })),
            ]}
          />
        </div>
      </CardHeader>
      <CardContent>
        {audit.isPending ? (
          <LoadingState rows={2} />
        ) : audit.error ? (
          <ErrorAlert error={audit.error} />
        ) : !rows.length ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>
                {audit.data.length ? 'No calls match these filters' : 'No tool calls yet'}
              </EmptyTitle>
              <EmptyDescription>
                {audit.data.length
                  ? 'Clear the filters to see everything.'
                  : 'Connect a client to a profile and use a tool; each call shows up here as it happens.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Via</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: audit events have no id
                <TableRow key={`${e.ts}-${i}`}>
                  <TableCell
                    className="whitespace-nowrap text-muted-foreground"
                    title={new Date(e.ts).toLocaleString()}
                  >
                    {new Date(e.ts).toLocaleTimeString()}
                    <span className="ml-1.5 text-xs">{relativeTime(e.ts)}</span>
                  </TableCell>
                  <TableCell>{e.client ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="rounded-sm hover:text-primary hover:underline"
                      onClick={() => setFilter('profile', e.profile)}
                      title={`Show only ${e.profile}`}
                    >
                      {e.profile}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.tool}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{VIA_LABEL[e.via] ?? e.via}</Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {duration(e.durationMs)}
                  </TableCell>
                  <TableCell>
                    {e.ok ? (
                      <Badge variant="outline">ok</Badge>
                    ) : (
                      <span className="flex flex-col items-start gap-0.5">
                        <Badge variant="destructive">error</Badge>
                        {e.error && (
                          <span
                            className="line-clamp-2 max-w-xs text-xs whitespace-normal text-destructive"
                            title={e.error}
                          >
                            {e.error}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
