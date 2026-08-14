import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Environment variable that relocates the credential file (tests, sandboxes). */
export const MCP_AIR_CREDENTIALS_PATH_ENV = 'AIR_CREDENTIALS_PATH' as const

/** Owner-only, because this file holds a bearer key. */
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700

export type StoredCredentials = {
  readonly apiKey: string
  readonly apiUrl: string
  readonly orgSlug: string
  readonly domainPid: string
  readonly domainSlug: string
  readonly createdAt: string
}

export class CredentialsFileError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'CredentialsFileError'
    this.path = path
  }
}

export const credentialsPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const override = env[MCP_AIR_CREDENTIALS_PATH_ENV]?.trim()
  return override !== undefined && override.length > 0
    ? override
    : join(homedir(), '.air', 'credentials.json')
}

const isStoredCredentials = (value: unknown): value is StoredCredentials => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record['apiKey'] === 'string' &&
    record['apiKey'].length > 0 &&
    typeof record['apiUrl'] === 'string' &&
    typeof record['orgSlug'] === 'string' &&
    typeof record['domainPid'] === 'string' &&
    typeof record['domainSlug'] === 'string' &&
    typeof record['createdAt'] === 'string'
  )
}

/**
 * Undefined when no file exists — that is setup mode, not an error.
 * A file that exists but cannot be used throws, because silently treating a
 * damaged credential file as "signed out" would look like an unexplained
 * sign-out and hide the real cause.
 */
export const readCredentials = (
  path: string = credentialsPath(),
): StoredCredentials | undefined => {
  if (!existsSync(path)) {
    return undefined
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new CredentialsFileError(path, `Cannot read ${path}: ${String(cause)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CredentialsFileError(
      path,
      `${path} is not valid JSON. Delete it and create your account again.`,
    )
  }

  if (!isStoredCredentials(parsed)) {
    throw new CredentialsFileError(
      path,
      `${path} is missing required fields. Delete it and create your account again.`,
    )
  }

  return parsed
}

/** Whether a credential file is present, without reading or validating it. */
export const existingCredentialsFile = (path: string = credentialsPath()): boolean =>
  existsSync(path)

export const writeCredentials = (
  credentials: StoredCredentials,
  path: string = credentialsPath(),
): void => {
  mkdirSync(dirname(path), { recursive: true, mode: DIRECTORY_MODE })
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: FILE_MODE })
  // writeFileSync's mode is ignored when the file already exists.
  chmodSync(path, FILE_MODE)
}

/** Returns whether a file was actually removed, so callers can be truthful. */
export const clearCredentials = (path: string = credentialsPath()): boolean => {
  if (!existsSync(path)) {
    return false
  }
  rmSync(path)
  return true
}
