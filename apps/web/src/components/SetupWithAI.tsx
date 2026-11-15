import { brand } from '@switchboard/shared'
import { SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { CopyButton, type Option, SimpleSelect, Snippet } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfig, useStatus } from '@/lib/queries'
import { agentPrompt, CLIENT_INFO, clientInfo, manualInstructions } from '@/lib/snippets'

const clientOptions: Option[] = CLIENT_INFO.map((c) => ({ value: c.id, label: c.name }))

/** "Set up with AI": a prompt to paste into an AI agent, or the plain config entry for one client. */
export function SetupWithAI({
  variant = 'outline',
  size = 'default',
}: {
  variant?: 'default' | 'outline'
  size?: 'sm' | 'default'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={variant} size={size} />}>
        <SparklesIcon data-icon="inline-start" />
        Set up with AI
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(90svh,52rem)] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Set up with AI</DialogTitle>
          <DialogDescription>
            Paste a prompt into your AI agent and it configures {brand.displayName} for you, asking before it
            changes anything. Or copy just the entry for one client.
          </DialogDescription>
        </DialogHeader>
        {open && <SetupBody />}
      </DialogContent>
    </Dialog>
  )
}

function SetupBody() {
  const status = useStatus()
  const config = useConfig()
  const [clientId, setClientId] = useState('claude-code')
  const port = status.data?.port
  const info = clientInfo(clientId)
  const [tab, setTab] = useState<string>('agent')

  const prompt = agentPrompt({
    clientId,
    port,
    servers: Object.keys(config.data?.servers ?? {}),
    profiles: Object.entries(config.data?.profiles ?? {}).map(([name, p]) => ({ name, servers: p.servers })),
    defaultProfile: config.data?.defaultProfile,
  })
  const manual = manualInstructions(clientId, port)

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1">
      <TabsList>
        <TabsTrigger value="agent">Prompt for an AI agent</TabsTrigger>
        <TabsTrigger value="entry">Config entry only</TabsTrigger>
      </TabsList>
      <FieldGroup className="mt-2 grid gap-4 sm:max-w-sm">
        <Field>
          <FieldLabel htmlFor="setup-client">Client</FieldLabel>
          <SimpleSelect
            id="setup-client"
            value={clientId}
            onValueChange={setClientId}
            options={clientOptions}
          />
        </Field>
      </FieldGroup>
      <TabsContent value="agent" className="flex min-h-0 flex-col gap-2">
        <FieldDescription>
          For Claude Code, Cursor, Codex and other agents that can run shell commands. It describes{' '}
          {brand.displayName}, lists your profiles and the exact commands to use, and asks you before changing
          anything.
        </FieldDescription>
        <Snippet title={`Prompt · ${info?.name}`} code={prompt} wrap />
      </TabsContent>
      <TabsContent value="entry" className="flex min-h-0 flex-col gap-2">
        <FieldDescription>
          Add this to {info?.file} yourself, then restart {info?.name}.
        </FieldDescription>
        <Snippet title={`${info?.name} · ${info?.file}`} code={manual} wrap />
      </TabsContent>
      <DialogFooter className="mt-4">
        {tab === 'agent' ? (
          <CopyButton text={prompt} label="Copy prompt" variant="default" size="default" />
        ) : (
          <CopyButton text={manual} label="Copy instructions" variant="default" size="default" />
        )}
      </DialogFooter>
    </Tabs>
  )
}
