import { randomBytes } from 'node:crypto'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { brand } from '@switchboard/shared'
import type { SecretBackend } from '../secrets.ts'

/**
 * OAuth for remote MCP servers. Client registrations and tokens are kept in
 * the secret store (the OS keychain when available) under oauth.<server>.*;
 * the SDK refreshes tokens itself. When the user has to sign in, the
 * authorization URL is handed to `onAuthorize` for the web UI or CLI to open.
 */
export class StoredOAuthProvider implements OAuthClientProvider {
  #verifier?: string
  readonly nonce = randomBytes(16).toString('base64url')

  constructor(
    private readonly server: string,
    private readonly secrets: SecretBackend,
    private readonly redirect: () => string | undefined,
    private readonly onAuthorize: (url: URL) => void,
  ) {}

  get redirectUrl(): string {
    const url = this.redirect()
    if (!url) throw new Error(`${brand.displayName} must be running to sign in to ${this.server}.`)
    return url
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `${brand.displayName} (${this.server})`,
      client_uri: brand.repoUrl,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  /** Ties the callback to this server and this attempt. */
  state(): string {
    return `${this.server}.${this.nonce}`
  }

  async #read<T>(key: string): Promise<T | undefined> {
    const raw = await this.secrets.get(`oauth.${this.server}.${key}`)
    return raw ? (JSON.parse(raw) as T) : undefined
  }

  #write(key: string, value: unknown): Promise<void> {
    return this.secrets.set(`oauth.${this.server}.${key}`, JSON.stringify(value))
  }

  clientInformation() {
    return this.#read<OAuthClientInformationMixed>('client')
  }

  saveClientInformation(info: OAuthClientInformationMixed) {
    return this.#write('client', info)
  }

  tokens() {
    return this.#read<OAuthTokens>('tokens')
  }

  saveTokens(tokens: OAuthTokens) {
    return this.#write('tokens', tokens)
  }

  redirectToAuthorization(url: URL): void {
    this.onAuthorize(url)
  }

  saveCodeVerifier(verifier: string): void {
    this.#verifier = verifier
  }

  codeVerifier(): string {
    if (!this.#verifier) throw new Error('No sign-in in progress.')
    return this.#verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') await this.secrets.delete(`oauth.${this.server}.client`)
    if (scope === 'all' || scope === 'tokens') await this.secrets.delete(`oauth.${this.server}.tokens`)
    if (scope === 'all' || scope === 'verifier') this.#verifier = undefined
  }

  async signOut(): Promise<void> {
    await this.invalidateCredentials('all')
  }
}
