import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  clearCredentials,
  credentialsPath,
  existingCredentialsFile,
  writeCredentials,
  type StoredCredentials,
} from './credentials.js'
import { MCP_AIR_PUBLIC_TOOL_NAMES } from './surface.js'

/**
 * Reachable in setup mode. This is the public tool set plus `air_sign_out`,
 * which must stay callable so a damaged credential file can be cleared without
 * hunting for it on disk. Note it is a different axis from the transport's
 * public set: this is "works with no credential", not "needs no token".
 */
const SETUP_MODE_TOOLS = new Set<string>([...MCP_AIR_PUBLIC_TOOL_NAMES, 'air_sign_out'])

/**
 * Records every tool handle as it is registered, so the surface can be switched
 * between setup mode and the full tool set without rebuilding the server.
 * `McpServer` keeps its registry private, and the register functions discard
 * the handles they get back.
 */
export const recordingServer = (
  server: McpServer,
  handles: Map<string, RegisteredTool>,
): McpServer =>
  new Proxy(server, {
    get(target, property) {
      if (property === 'registerTool') {
        return (name: string, ...rest: ReadonlyArray<unknown>) => {
          const register = target.registerTool.bind(target) as (
            ...args: ReadonlyArray<unknown>
          ) => RegisteredTool
          const handle = register(name, ...rest)
          handles.set(name, handle)
          return handle
        }
      }
      // Task tools register through `experimental.tasks.registerToolTask`, a
      // separate path — miss it and the two pipeline tools stay visible in
      // setup mode, where they cannot work.
      if (property === 'experimental') {
        const experimental = target.experimental
        return {
          ...experimental,
          tasks: {
            ...experimental.tasks,
            registerToolTask: (name: string, ...rest: ReadonlyArray<unknown>) => {
              const register = experimental.tasks.registerToolTask.bind(experimental.tasks) as (
                ...args: ReadonlyArray<unknown>
              ) => RegisteredTool
              const handle = register(name, ...rest)
              handles.set(name, handle)
              return handle
            },
          },
        }
      }

      const value = Reflect.get(target, property) as unknown
      // Bound to the real server: McpServer uses private fields, which throw
      // when a method runs with the proxy as `this`.
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as McpServer

/**
 * The stdio surface's credential state. Setup mode is a real mode, not an
 * error: with no key, the tools that need one are disabled rather than absent,
 * so a client sees the surface grow when the account is created.
 */
/**
 * Where the current key came from. It decides what signing out can actually do:
 * a stored file can be deleted, an environment variable cannot.
 */
export type CredentialSource = 'environment' | 'file' | 'none'

export type SignOutResult = {
  /** False when nothing was signed out, whatever the caller hoped. */
  readonly signedOut: boolean
  readonly source: CredentialSource
  readonly removedFile: boolean
  readonly path: string
  readonly next: string
}

export class StdioSession {
  private credentials: StoredCredentials | undefined
  private source: CredentialSource
  private readonly handles = new Map<string, RegisteredTool>()
  readonly path: string

  constructor(
    initial: StoredCredentials | undefined,
    path: string = credentialsPath(),
    source: CredentialSource = initial === undefined ? 'none' : 'file',
  ) {
    this.credentials = initial
    this.source = source
    this.path = path
  }

  get credentialSource(): CredentialSource {
    return this.source
  }

  get apiKey(): string | undefined {
    return this.credentials?.apiKey
  }

  get isSetupMode(): boolean {
    return this.credentials === undefined
  }

  get current(): StoredCredentials | undefined {
    return this.credentials
  }

  /** Wraps a server so tool registrations are captured for later enabling. */
  record(server: McpServer): McpServer {
    return recordingServer(server, this.handles)
  }

  /**
   * Enable or disable the credential-dependent tools. The SDK emits
   * `tools/list_changed` for each change, so a connected client updates
   * without a restart.
   */
  applyToolState(): void {
    for (const [name, handle] of this.handles) {
      const shouldBeEnabled = this.credentials !== undefined || SETUP_MODE_TOOLS.has(name)
      if (handle.enabled !== shouldBeEnabled) {
        if (shouldBeEnabled) {
          handle.enable()
        } else {
          handle.disable()
        }
      }
    }
  }

  /** Persists the key to disk at 0600 and opens the full surface. */
  signIn(credentials: StoredCredentials): void {
    writeCredentials(credentials, this.path)
    this.credentials = credentials
    this.source = 'file'
    this.applyToolState()
  }

  /**
   * Describes the state the person will actually be in, rather than claiming a
   * success. A key from `AIR_API_KEY` cannot be removed from here: deleting a
   * file that is not being used, or disabling tools that a restart would bring
   * straight back, would both be lies about what happened.
   */
  signOut(): SignOutResult {
    if (this.source === 'environment') {
      const shadowed = existingCredentialsFile(this.path)
      return {
        signedOut: false,
        source: 'environment',
        removedFile: false,
        path: this.path,
        next: shadowed
          ? `This key comes from AIR_API_KEY in your MCP client configuration, so it cannot be removed from here. Remove it there and restart. Note ${this.path} also holds a key, which would then be used instead — delete it too to reach setup mode.`
          : `This key comes from AIR_API_KEY in your MCP client configuration, so it cannot be removed from here. Remove it there and restart to reach setup mode.`,
      }
    }

    // Clears a damaged file too: in setup mode the file may exist and simply be
    // unreadable, and this is the only tool that can get rid of it.
    const removedFile = clearCredentials(this.path)
    const hadCredentials = this.credentials !== undefined
    this.credentials = undefined
    this.source = 'none'
    this.applyToolState()

    return {
      signedOut: hadCredentials,
      source: 'none',
      removedFile,
      path: this.path,
      next: hadCredentials
        ? 'Signed out. Run air_create_account to start again, or set AIR_API_KEY in your client configuration for an existing key.'
        : removedFile
          ? 'There was no active credential; an unusable credential file was removed. Run air_create_account to start again.'
          : 'There was nothing to sign out of. Run air_create_account to create an account.',
    }
  }
}
