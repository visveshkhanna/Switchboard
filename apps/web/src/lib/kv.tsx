import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface KV {
  key: string
  value: string
}

export const toKV = (record: Record<string, string> = {}): KV[] =>
  Object.entries(record).map(([key, value]) => ({ key, value }))

export const fromKV = (rows: KV[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))

/** Editable key/value rows, e.g. environment variables or HTTP headers. */
export function KVEditor({
  rows,
  onChange,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  rows: KV[]
  onChange: (rows: KV[]) => void
  keyLabel: string
  valueLabel: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel: string
}) {
  const set = (i: number, patch: Partial<KV>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
        <div key={i} className="flex gap-1.5">
          <Input
            aria-label={`${keyLabel} ${i + 1}`}
            className="w-2/5 font-mono"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <Input
            aria-label={`${valueLabel} ${i + 1}`}
            className="font-mono"
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${keyLabel.toLowerCase()} ${row.key || i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => onChange([...rows, { key: '', value: '' }])}>
          <PlusIcon data-icon="inline-start" />
          {addLabel}
        </Button>
      </div>
    </div>
  )
}
