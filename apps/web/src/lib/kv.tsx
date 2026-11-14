import { Button, inputClass, monoInputClass } from './ui.tsx'

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
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
        <div key={i} className="flex gap-1.5">
          <input
            aria-label={`${keyLabel} ${i + 1}`}
            className={`${monoInputClass} w-2/5`}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <input
            aria-label={`${valueLabel} ${i + 1}`}
            className={`${inputClass} font-mono text-[13px]`}
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <Button
            variant="ghost"
            aria-label={`Remove ${keyLabel.toLowerCase()} ${row.key || i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...rows, { key: '', value: '' }])}>
        + {addLabel}
      </Button>
    </div>
  )
}
