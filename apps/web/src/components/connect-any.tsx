import { useState } from 'react'
import { InlineCode, Snippet, UrlField } from '@/components/common'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useStatus } from '@/lib/queries'
import { clientUrl, sharedUrl } from '@/lib/snippets'

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/

/** How to connect a client Switchboard has no preset for. */
export function ConnectAnyClientCard() {
  const status = useStatus()
  const port = status.data?.port
  const [id, setId] = useState('my-agent')
  const valid = ID_RE.test(id)
  const url = clientUrl(port, valid ? id : 'my-agent')
  return (
    <Card id="connect" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Connect any other client</CardTitle>
        <CardDescription>
          Any MCP client that speaks Streamable HTTP works. Give it its own URL (pick any id) and it shows up
          in the client list as soon as it connects; then switch its profile there.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Field data-invalid={!valid || undefined}>
            <FieldLabel htmlFor="any-client-id">Client id</FieldLabel>
            <Input
              id="any-client-id"
              className="font-mono"
              value={id}
              aria-invalid={!valid || undefined}
              onChange={(e) => setId(e.target.value.toLowerCase())}
            />
            {valid ? (
              <FieldDescription>Lowercase letters, digits, - and _. Recommended.</FieldDescription>
            ) : (
              <FieldError>Use lowercase letters, digits, - and _ only.</FieldError>
            )}
          </Field>
          <UrlField url={url} label="Client URL" />
          <Snippet
            title="mcp.json"
            code={JSON.stringify({ mcpServers: { switchboard: { url } } }, null, 2)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">Or the shared URL</h3>
          <UrlField url={sharedUrl(port)} label="Shared URL" />
          <p className="text-sm text-muted-foreground">
            One URL for every client. Each one is identified by the name it reports over MCP and listed under
            that name. Prefer the own-URL form: the shared URL cannot tell apart two clients that report the
            same name. <InlineCode>/p/&lt;profile&gt;/mcp</InlineCode> pins a profile in the URL instead.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
