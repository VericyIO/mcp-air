import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, onTestFinished } from 'vitest'

import {
  MCP_AIR_STDIO_SESSION_TOOL_COUNT,
  MCP_AIR_STDIO_SESSION_TOOL_NAMES,
} from '../src/capabilities.js'
import {
  CredentialsFileError,
  clearCredentials,
  credentialsPath,
  readCredentials,
  writeCredentials,
  type StoredCredentials,
} from '../src/credentials.js'
import { createAirMcpServer } from '../src/server.js'
import { StdioSession } from '../src/session.js'

/**
 * Per-test directory, cleaned up by that same test. Tests in this project run
 * concurrently, so a shared cleanup list would delete another test's file
 * mid-run.
 */
const scratchFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-air-creds-'))
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  return join(dir, 'credentials.json')
}

const credentials: StoredCredentials = {
  apiKey: 'air_test.ak_1234567890ABCDEF.secretsecretsecretsecretsecret12',
  apiUrl: 'https://api.air.thalus.ai',
  orgSlug: 'acme',
  domainPid: 'dom_1234567890ABCDEF',
  domainSlug: 'acme',
  createdAt: '2026-08-14T00:00:00.000Z',
}

const connect = async (session: StdioSession) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: () => session.apiKey },
    { session },
  )
  const client = new Client({ name: 'setup-mode-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const toolNames = async (client: Client) =>
  (await client.listTools()).tools.map((tool) => tool.name)

describe('credential store', () => {
  it('writes the file owner-only and reads it back', () => {
    const path = scratchFile()

    writeCredentials(credentials, path)

    expect(readCredentials(path)).toEqual(credentials)
    // A bearer key on disk must not be world- or group-readable.
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('treats a missing file as setup mode, not an error', () => {
    expect(readCredentials(scratchFile())).toBeUndefined()
  })

  it('refuses a damaged file instead of pretending it is signed out', () => {
    const path = scratchFile()
    writeFileSync(path, '{ not json')

    expect(() => readCredentials(path)).toThrow(CredentialsFileError)
  })

  it('refuses a file that parses but has no key', () => {
    const path = scratchFile()
    writeFileSync(path, JSON.stringify({ orgSlug: 'acme' }))

    expect(() => readCredentials(path)).toThrow(/missing required fields/)
  })

  it('reports whether anything was actually removed', () => {
    const path = scratchFile()
    writeCredentials(credentials, path)

    expect(clearCredentials(path)).toBe(true)
    expect(clearCredentials(path)).toBe(false)
  })

  it('honours AIR_CREDENTIALS_PATH and otherwise lands in ~/.air', () => {
    expect(credentialsPath({ AIR_CREDENTIALS_PATH: '/tmp/x.json' })).toBe('/tmp/x.json')
    expect(credentialsPath({})).toMatch(/\.air\/credentials\.json$/)
  })
})

describe('setup mode', () => {
  it('offers only the tools that work without an account', async () => {
    const names = await toolNames(await connect(new StdioSession(undefined, scratchFile())))

    expect(names.sort()).toEqual([
      'air_create_account',
      'air_sign_out',
      'air_signup_send_code',
      'air_signup_verify_code',
      'air_submit_feedback',
    ])
  })

  it('hides the task-based pipeline tools too', async () => {
    const names = await toolNames(await connect(new StdioSession(undefined, scratchFile())))

    // These register through experimental.tasks, a separate path that is easy
    // to miss when disabling the credential-dependent surface.
    expect(names).not.toContain('air_run_full_assessment_pipeline')
    expect(names).not.toContain('air_run_assessment_from_file')
  })

  it('offers the full surface when a credential is present', async () => {
    const names = await toolNames(await connect(new StdioSession(credentials, scratchFile())))

    expect(names).toContain('air_list_domains')
    expect(names).toContain('air_run_full_assessment_pipeline')
    expect(names.length).toBeGreaterThan(30)
  })
})

describe('sign in and out', () => {
  it('grows the surface the moment credentials are stored, without a restart', async () => {
    const path = scratchFile()
    const session = new StdioSession(undefined, path)
    const client = await connect(session)

    expect(await toolNames(client)).not.toContain('air_list_domains')

    session.signIn(credentials)

    expect(await toolNames(client)).toContain('air_list_domains')
    expect(readCredentials(path)).toEqual(credentials)
  })

  it('clears the file and returns to setup mode on sign out', async () => {
    const path = scratchFile()
    const session = new StdioSession(credentials, path)
    writeCredentials(credentials, path)
    const client = await connect(session)

    expect(session.signOut().signedOut).toBe(true)

    expect(readCredentials(path)).toBeUndefined()
    expect(await toolNames(client)).not.toContain('air_list_domains')
    expect(await toolNames(client)).toContain('air_create_account')
  })

  it('never returns the raw key through air_sign_out', async () => {
    const path = scratchFile()
    writeCredentials(credentials, path)
    const client = await connect(new StdioSession(credentials, path))

    const result = await client.callTool({ name: 'air_sign_out', arguments: {} })
    const text = (result.content as ReadonlyArray<{ text?: string }>)
      .map((part) => part.text ?? '')
      .join('')

    expect(text).not.toContain(credentials.apiKey)
    expect(text).toContain(path)
  })
})

describe('stdio session surface', () => {
  it('matches the declared stdio tool list exactly', async () => {
    const names = await toolNames(await connect(new StdioSession(credentials, scratchFile())))

    expect(names).toHaveLength(MCP_AIR_STDIO_SESSION_TOOL_COUNT)
    expect(names.sort()).toEqual([...MCP_AIR_STDIO_SESSION_TOOL_NAMES].sort())
  })
})

describe('signing out a key that came from the environment', () => {
  it('does not claim success, and says where the key actually lives', () => {
    const session = new StdioSession(credentials, scratchFile(), 'environment')

    const result = session.signOut()

    // Reporting `signedOut: true` here would be a lie: the key is still in the
    // client configuration and a restart brings the whole surface back.
    expect(result.signedOut).toBe(false)
    expect(result.source).toBe('environment')
    expect(result.removedFile).toBe(false)
    expect(result.next).toContain('AIR_API_KEY')
    expect(result.next).toContain('Remove it there')
  })

  it('leaves the tool surface alone, because the key still works', async () => {
    const session = new StdioSession(credentials, scratchFile(), 'environment')
    const client = await connect(session)

    session.signOut()

    expect(await toolNames(client)).toContain('air_list_domains')
  })

  it('warns when a stored file would take over once the variable is removed', () => {
    const path = scratchFile()
    writeCredentials(credentials, path)
    const session = new StdioSession(credentials, path, 'environment')

    const result = session.signOut()

    expect(result.next).toContain(path)
    expect(result.next).toContain('delete it too')
    // The file is left alone: it is not the credential in use.
    expect(readCredentials(path)).toEqual(credentials)
  })

  it('removes an unusable file in setup mode and says so without claiming a sign-out', () => {
    const path = scratchFile()
    writeFileSync(path, '{ not json')
    const session = new StdioSession(undefined, path, 'none')

    const result = session.signOut()

    expect(result.signedOut).toBe(false)
    expect(result.removedFile).toBe(true)
    expect(result.next).toContain('unusable credential file was removed')
  })
})
