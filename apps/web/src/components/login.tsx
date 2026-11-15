import { brand } from '@switchboard/shared'
import { TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { InlineCode } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ApiError, auth, errorMessage } from '@/lib/api'

/** The hosted-mode sign-in screen. */
export function LoginScreen({ passwordSet, onSignedIn }: { passwordSet: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    if (!password) return setError('Enter the password.')
    setBusy(true)
    setError(undefined)
    try {
      await auth.login(password)
      onSignedIn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Could not sign in: ${errorMessage(e)}`)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/favicon.svg" alt="" className="mx-auto size-12" />
          <CardTitle className="text-lg">Sign in to {brand.displayName}</CardTitle>
          <CardDescription>This {brand.displayName} is hosted. Enter its admin password.</CardDescription>
        </CardHeader>
        <CardContent>
          {!passwordSet ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>No password set yet</AlertTitle>
              <AlertDescription>
                On the server, run <InlineCode>{brand.name} admin password</InlineCode>, then reload this
                page.
              </AlertDescription>
            </Alert>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <FieldGroup>
                <Field data-invalid={!!error || undefined}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    aria-invalid={!!error || undefined}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {error && <FieldError>{error}</FieldError>}
                </Field>
                <Button type="submit" disabled={busy}>
                  {busy && <Spinner data-icon="inline-start" />}
                  Sign in
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
