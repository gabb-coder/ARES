import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

interface Stored {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
}

/**
 * OAuth for remote MCP servers (Linear, Notion, …). Registration, tokens and
 * the PKCE verifier persist in ~/.ares/oauth/<server>.json (mode 600), so a
 * sign-in survives restarts. The browser comes back to ARES's own callback.
 */
export class FileOAuthProvider implements OAuthClientProvider {
  #cache: Stored | null = null;
  readonly #file: string;

  constructor(
    readonly serverName: string,
    dataDir: string,
    private readonly callbackUrl: string,
    /** Called with the URL the user must open to sign in. */
    private readonly onAuthorize: (url: URL) => void,
  ) {
    this.#file = path.join(dataDir, 'oauth', `${serverName}.json`);
  }

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'ARES',
      redirect_uris: [this.callbackUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  /** Encodes which server the callback belongs to, plus a nonce checked on return. */
  async state(): Promise<string> {
    const state = `${this.serverName}.${randomBytes(16).toString('hex')}`;
    await this.#update({ state });
    return state;
  }

  async expectedState(): Promise<string | undefined> {
    return (await this.#read()).state;
  }

  async clientInformation() {
    return (await this.#read()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.#update({ clientInformation });
  }

  async tokens() {
    return (await this.#read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.#update({ tokens });
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.onAuthorize(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.#update({ codeVerifier });
  }

  async codeVerifier() {
    const verifier = (await this.#read()).codeVerifier;
    if (!verifier) throw new Error('No sign-in in progress');
    return verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    const current = await this.#read();
    if (scope === 'all') return this.#write({});
    if (scope === 'client') delete current.clientInformation;
    if (scope === 'tokens') delete current.tokens;
    if (scope === 'verifier') delete current.codeVerifier;
    await this.#write(current);
  }

  /** Forgets everything (used by "disconnect"). */
  async clear() {
    await this.#write({});
  }

  async #read(): Promise<Stored> {
    if (this.#cache) return this.#cache;
    try {
      this.#cache = JSON.parse(await fs.readFile(this.#file, 'utf8')) as Stored;
    } catch {
      this.#cache = {};
    }
    return this.#cache;
  }

  async #update(patch: Partial<Stored>) {
    await this.#write({ ...(await this.#read()), ...patch });
  }

  async #write(data: Stored) {
    this.#cache = data;
    await fs.mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.#file, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
}
