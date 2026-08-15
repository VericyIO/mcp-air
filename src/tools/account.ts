import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

import {
  getUiCapability,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_PORTAL_SIGNUP_URL,
  MCP_AIR_SERVER_NAME,
  MCP_AIR_SERVER_VERSION,
  MCP_AIR_SIGNUP_FORM_URI,
} from '../config.js'
import { toolJsonResult } from '../errors.js'
import type { StdioSession } from '../session.js'
import { MCP_AIR_TOOL_TITLES } from '../tool-titles.js'

const require = createRequire(import.meta.url)

/**
 * A self-contained ESM bundle with no bare imports, inlined into the resource so
 * the form needs no bundler and no network fetch inside the iframe.
 */
const appRuntime = (): string =>
  readFileSync(require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8')

const appOnly = (uri: string) => ({ ui: { resourceUri: uri, visibility: ['app'] as const } })

const jsonError = (message: string) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
})

type SignupStart = {
  readonly continuationToken: string
  readonly otpSentTo: string
  readonly termsVersion: string
  readonly termsUrl: string
  readonly privacyUrl?: string
  /** The API owns the code length; the form does not assume six. */
  readonly otpLength?: number
}

/**
 * The API owns the terms version and the link to the document. A client must
 * never pin its own copy: `mcp-air` ships to npm, so a pinned version would
 * start failing signup for every installed release the day the terms change.
 */
const readSignupStart = (response: Record<string, unknown>): SignupStart | string => {
  const continuationToken = response['continuationToken']
  const otpSentTo = response['otpSentTo']
  const termsVersion = response['termsVersion']
  const termsUrl = response['termsUrl']

  if (typeof continuationToken !== 'string' || typeof otpSentTo !== 'string') {
    return (
      'The AIR API did not return a usable signup session. Sign up at ' + MCP_AIR_PORTAL_SIGNUP_URL
    )
  }

  if (typeof termsVersion !== 'string' || typeof termsUrl !== 'string') {
    return `This AIR API does not report the current terms version, so the terms cannot be shown or accepted here. Sign up at ${MCP_AIR_PORTAL_SIGNUP_URL}`
  }

  const privacyUrl = response['privacyUrl']
  const otpLength = response['otpLength']

  return {
    continuationToken,
    otpSentTo,
    termsVersion,
    termsUrl,
    ...(typeof privacyUrl === 'string' ? { privacyUrl } : {}),
    ...(typeof otpLength === 'number' && Number.isInteger(otpLength) && otpLength > 0
      ? { otpLength }
      : {}),
  }
}

const formHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 var(--font-sans, system-ui); color: var(--color-text-primary, #1a1a1a);
    background: var(--color-background-primary, transparent); margin: 0; padding: 16px; }
  h1 { font-size: 15px; margin: 0 0 12px; }
  label { display: block; margin: 10px 0 4px; color: var(--color-text-secondary, #555); }
  input[type=text], input[type=email] { width: 100%; box-sizing: border-box; padding: 8px 10px;
    border: 1px solid var(--color-border-primary, #ccc); border-radius: var(--border-radius-md, 6px);
    background: var(--color-background-secondary, #fff); color: inherit; font: inherit; }
  .row { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; }
  .row label { margin: 0; }
  button { margin-top: 14px; padding: 8px 14px; font: inherit; cursor: pointer; border: 0;
    border-radius: var(--border-radius-md, 6px); background: var(--color-background-inverse, #1a1a1a);
    color: var(--color-text-inverse, #fff); }
  button[disabled] { opacity: .5; cursor: default; }
  .note { margin-top: 12px; color: var(--color-text-secondary, #555); }
  .err { color: var(--color-text-danger, #c00); }
  a { color: var(--color-text-accent, #06c); }
  [hidden] { display: none !important; }
</style></head><body>
  <section id="step-details">
    <h1>Create your AIR account</h1>
    <label for="name">Your name</label><input id="name" type="text" autocomplete="name" />
    <label for="email">Work email</label><input id="email" type="email" autocomplete="email" />
    <label for="org">Organization</label><input id="org" type="text" autocomplete="organization" />
    <button id="send" disabled>Send me a code</button>
    <p id="details-error" class="note err" hidden></p>
  </section>
  <section id="step-code" hidden>
    <h1>Enter the code we emailed</h1>
    <p class="note" id="sent-note"></p>
    <label for="code" id="code-label">Verification code</label><input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" />
    <div class="row">
      <input id="terms" type="checkbox" />
      <label for="terms">I accept the <a id="terms-link" href="#" target="_blank" rel="noreferrer">Thalus terms</a><span id="privacy-wrap" hidden> and the <a id="privacy-link" href="#" target="_blank" rel="noreferrer">privacy policy</a></span></label>
    </div>
    <button id="verify" disabled>Create my account</button>
    <p id="code-error" class="note err" hidden></p>
  </section>
  <section id="step-done" hidden>
    <h1>Your account is ready</h1>
    <p class="note" id="done-note"></p>
    <button id="signin">Open AIR and finish signing in</button>
  </section>
  <script type="module">
${appRuntime()}
    const app = new App({ name: '${MCP_AIR_SERVER_NAME}-signup-form', version: '${MCP_AIR_SERVER_VERSION}' }, {})
    await app.connect()
    const $ = (id) => document.getElementById(id)
    const show = (id) => {
      for (const s of ['step-details', 'step-code', 'step-done']) $(s).hidden = s !== id
    }
    const fail = (el, m) => { el.textContent = m; el.hidden = false }
    const call = async (name, args) => {
      const r = await app.callServerTool({ name, arguments: args })
      const parsed = JSON.parse(r?.content?.find((c) => c.type === 'text')?.text ?? '{}')
      if (r?.isError) throw new Error(parsed.error ?? 'That did not work. Try again.')
      return parsed
    }

    let session = null

    const syncSend = () => {
      $('send').disabled = !($('name').value.trim() && $('email').value.trim() && $('org').value.trim())
    }
    for (const id of ['name', 'email', 'org']) $(id).addEventListener('input', syncSend)
    // No otpLength from the server means no assumption about the length here:
    // any non-empty code is allowed and the API is the judge.
    const syncVerify = () => {
      const code = $('code').value.trim()
      const expected = session?.otpLength
      const codeOk = typeof expected === 'number' ? code.length === expected : code.length > 0
      $('verify').disabled = !(codeOk && $('terms').checked)
    }
    $('code').addEventListener('input', syncVerify)
    $('terms').addEventListener('change', syncVerify)

    $('send').addEventListener('click', async () => {
      $('details-error').hidden = true
      $('send').disabled = true
      try {
        session = await call('air_signup_send_code', {
          name: $('name').value.trim(),
          email: $('email').value.trim(),
          orgName: $('org').value.trim(),
        })
        $('sent-note').textContent = 'We emailed a code to ' + session.otpSentTo + '.'
        $('terms-link').href = session.termsUrl
        if (typeof session.otpLength === 'number') {
          $('code').maxLength = session.otpLength
          $('code-label').textContent = session.otpLength + '-digit code'
        }
        if (session.privacyUrl) {
          $('privacy-link').href = session.privacyUrl
          $('privacy-wrap').hidden = false
        }
        syncVerify()
        show('step-code')
      } catch (e) {
        fail($('details-error'), e.message)
        $('send').disabled = false
      }
    })

    $('verify').addEventListener('click', async () => {
      $('code-error').hidden = true
      $('verify').disabled = true
      try {
        // acceptTerms is read from the checkbox here and nowhere else.
        const done = await call('air_signup_verify_code', {
          continuationToken: session.continuationToken,
          otp: $('code').value.trim(),
          termsVersion: session.termsVersion,
          acceptTerms: $('terms').checked,
        })
        $('done-note').textContent =
          'Organization ' + done.orgSlug + ', domain ' + done.domainSlug + ', ' + done.credits +
          ' assessment credit' + (done.credits === 1 ? '' : 's') + ' to start.'
        $('signin').onclick = () => { void app.openLink({ url: done.signInUrl }) }
        show('step-done')
        await app.updateModelContext({
          content: [{
            type: 'text',
            text: 'The AIR account is ready: organization ' + done.orgSlug + ', domain ' +
              done.domainSlug + '. Tell the person to open the sign-in button in the form, then connect.',
          }],
        })
      } catch (e) {
        fail($('code-error'), e.message)
        $('verify').disabled = false
      }
    })
  </script>
</body></html>`

export const registerAccountTools = (
  server: McpServer,
  api: IntegratorApiClient,
  session?: StdioSession,
) => {
  registerAppResource(server, 'AIR signup form', MCP_AIR_SIGNUP_FORM_URI, {}, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: formHtml() }],
  }))

  registerAppTool(
    server,
    'air_create_account',
    {
      title: MCP_AIR_TOOL_TITLES.air_create_account,
      description:
        'Open a form in this conversation to create an AIR account. The person types their own details and accepts the terms; the model supplies nothing. Needs no existing account.',
      inputSchema: {},
      _meta: { ui: { resourceUri: MCP_AIR_SIGNUP_FORM_URI } },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async () => {
      const capabilities = server.server.getClientCapabilities() ?? {}

      // Richest first: an MCP App keeps every field out of the model entirely.
      if (getUiCapability(capabilities) !== undefined) {
        return toolJsonResult({ status: 'form_open' })
      }

      // Claude Code is not on the MCP Apps support matrix but does support
      // elicitation, so without this branch the client most likely to be in
      // front of a developer would fall back to the portal.
      if (capabilities.elicitation !== undefined) {
        return await createAccountByElicitation(server, api, session)
      }

      // Neither: the portal is the honest answer. The model is never asked for
      // the details instead.
      return {
        content: [
          {
            type: 'text' as const,
            text: `This client cannot show a signup form or a dialog. Create your AIR account at ${MCP_AIR_PORTAL_SIGNUP_URL}, then come back and connect.`,
          },
        ],
      }
    },
  )

  // App-only, and also public: two different axes. `visibility: ['app']` keeps
  // the tool out of the model's list; the transport still has to let the call
  // through without a credential, because the caller has no account yet.
  //
  // Note the boundary: `visibility: ['app']` is a client-side contract, not a
  // server-side guarantee. We cannot prove the caller was the iframe rather
  // than a model or a script, so the honest claim is that a compliant client
  // keeps the consent with the human and the record names the client that
  // asserted it — not that a model cannot accept the terms. What backs it is
  // the evidence the API records (terms version, channel, client, caller IP)
  // and the emailed code, which no model can read.
  registerAppTool(
    server,
    'air_signup_send_code',
    {
      title: MCP_AIR_TOOL_TITLES.air_signup_send_code,
      description: 'Signup form step one: send the verification code.',
      inputSchema: {
        name: z.string().min(1),
        email: z.string().email(),
        orgName: z.string().min(1),
      },
      _meta: appOnly(MCP_AIR_SIGNUP_FORM_URI),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ name, email, orgName }) => {
      try {
        const started = readSignupStart(
          await api.agentSignup({
            name,
            email,
            orgName,
            client: { name: MCP_AIR_SERVER_NAME, version: MCP_AIR_SERVER_VERSION },
            mcpAirVersion: MCP_AIR_SERVER_VERSION,
          }),
        )

        return typeof started === 'string' ? jsonError(started) : toolJsonResult(started)
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : String(error))
      }
    },
  )

  registerAppTool(
    server,
    'air_signup_verify_code',
    {
      title: MCP_AIR_TOOL_TITLES.air_signup_verify_code,
      description: 'Signup form step two: verify the code and create the account.',
      inputSchema: {
        continuationToken: z.string().min(1),
        otp: z.string().min(1),
        termsVersion: z.string().min(1),
        acceptTerms: z.boolean(),
      },
      _meta: appOnly(MCP_AIR_SIGNUP_FORM_URI),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ continuationToken, otp, termsVersion, acceptTerms }) => {
      if (acceptTerms !== true) {
        return jsonError('Tick the terms checkbox in the form to create the account.')
      }

      try {
        const created = await api.agentVerifyEmail({
          continuationToken,
          otp,
          termsVersion,
          acceptTerms,
        })

        return toolJsonResult(storeIfPossible(created, session, api, 'form'))
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : String(error))
      }
    },
  )

  if (session !== undefined) {
    server.registerTool(
      'air_sign_out',
      {
        title: MCP_AIR_TOOL_TITLES.air_sign_out,
        description:
          'Remove the AIR credentials stored on this machine and return to setup mode. The account itself is untouched. A key supplied through AIR_API_KEY cannot be removed here — the result says where to remove it instead.',
        inputSchema: {},
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      // The session decides what actually happened; the tool must not claim a
      // success it did not achieve.
      async () => toolJsonResult(session.signOut()),
    )
  }
}

/**
 * The raw key goes to disk and never into a tool result — a result is model
 * context and client transcript. The caller is told where it was written.
 */
const storeIfPossible = (
  created: Record<string, unknown>,
  session: StdioSession | undefined,
  api: IntegratorApiClient,
  /**
   * True only for the MCP App form, whose result is read by the iframe and not
   * by the model. Every other caller must leave the sign-in URL out.
   */
  audience: 'form' | 'model',
): Record<string, unknown> => {
  const apiKey = created['apiKey']
  const { apiKey: _omittedKey, signInUrl, ...rest } = created

  // `signInUrl` is a bearer credential too: whoever holds it gets a browser
  // session for the new account. The form passes it to `openLink` inside the
  // iframe; a model-visible result must never carry it. On stdio it is not
  // needed anyway — the stored key is already the credential.
  const safe = audience === 'form' && signInUrl !== undefined ? { ...rest, signInUrl } : rest

  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return safe
  }

  if (session === undefined) {
    // Hosted transport: the OAuth token is the credential, so there is nothing
    // to store here. Still never echo the key back.
    return safe
  }

  session.signIn({
    apiKey,
    apiUrl: api.apiUrlForStorage(),
    orgSlug: String(created['orgSlug'] ?? ''),
    domainPid: String(created['domainPid'] ?? ''),
    domainSlug: String(created['domainSlug'] ?? ''),
    createdAt: new Date().toISOString(),
  })

  return {
    ...safe,
    credentialsStoredAt: session.path,
    next: 'Your key is saved on this machine. The full AIR tool set is available now.',
  }
}

const cancelled = (text: string) => ({ content: [{ type: 'text' as const, text }] })

/**
 * Two dialogs, mirroring the MCP App form: details, then the code and the terms
 * tick. The person types every field; the model supplies nothing and sees no
 * field value. Elicitation must never request a secret — a one-time code the
 * person received and a checkbox are the only inputs here.
 */
const createAccountByElicitation = async (
  server: McpServer,
  api: IntegratorApiClient,
  session: StdioSession | undefined,
) => {
  const details = await server.server.elicitInput({
    message: 'Create your AIR account. Thalus emails a verification code to this address.',
    requestedSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Your name' },
        email: { type: 'string', title: 'Work email', format: 'email' },
        orgName: { type: 'string', title: 'Organization' },
      },
      required: ['name', 'email', 'orgName'],
    },
  })

  if (details.action !== 'accept' || details.content === undefined) {
    // Nothing has been sent yet, so there is nothing to undo.
    return cancelled('No account was created — you cancelled. Ask again whenever you want to.')
  }

  const typed = details.content as Record<string, unknown>
  const name = String(typed['name'] ?? '').trim()
  const email = String(typed['email'] ?? '').trim()
  const orgName = String(typed['orgName'] ?? '').trim()

  if (name.length === 0 || email.length === 0 || orgName.length === 0) {
    return jsonError('Name, work email and organization are all needed. Ask again to retry.')
  }

  let started: SignupStart | string
  try {
    started = readSignupStart(
      await api.agentSignup({
        name,
        email,
        orgName,
        client: { name: MCP_AIR_SERVER_NAME, version: MCP_AIR_SERVER_VERSION },
        mcpAirVersion: MCP_AIR_SERVER_VERSION,
      }),
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error))
  }

  if (typeof started === 'string') {
    return jsonError(started)
  }

  const documents =
    started.privacyUrl === undefined
      ? `the Thalus terms (${started.termsUrl})`
      : `the Thalus terms (${started.termsUrl}) and privacy policy (${started.privacyUrl})`

  const codeTitle =
    started.otpLength === undefined
      ? 'Verification code'
      : `${String(started.otpLength)}-digit code`

  const verification = await server.server.elicitInput({
    message: `We emailed a code to ${started.otpSentTo}. Enter it and accept ${documents} to finish.`,
    requestedSchema: {
      type: 'object',
      properties: {
        otp: {
          type: 'string',
          title: codeTitle,
          ...(started.otpLength === undefined ? {} : { maxLength: started.otpLength }),
        },
        acceptTerms: {
          type: 'boolean',
          title: `I accept ${documents}`,
          default: false,
        },
      },
      required: ['otp', 'acceptTerms'],
    },
  })

  if (verification.action !== 'accept' || verification.content === undefined) {
    // The code was emailed but no account exists yet — say so plainly, since
    // the person has a code in their inbox that now leads nowhere.
    return cancelled(
      'No account was created — you cancelled before confirming. The code we emailed is unused; ask again to start over.',
    )
  }

  const confirmed = verification.content as Record<string, unknown>
  if (confirmed['acceptTerms'] !== true) {
    return jsonError(
      'The account was not created: the terms were not accepted. Ask again and tick the box to continue.',
    )
  }

  const otp = String(confirmed['otp'] ?? '').trim()
  if (otp.length === 0) {
    return jsonError('The account was not created: no code was entered. Ask again to retry.')
  }

  try {
    const created = await api.agentVerifyEmail({
      continuationToken: started.continuationToken,
      otp,
      termsVersion: started.termsVersion,
      acceptTerms: true,
    })

    return toolJsonResult(storeIfPossible(created, session, api, 'model'))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error))
  }
}
