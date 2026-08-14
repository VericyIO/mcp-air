import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_SUPPORT_CREDIT_REQUEST_MAX,
  MCP_AIR_SUPPORT_FEEDBACK_CATEGORIES,
  MCP_AIR_SUPPORT_MESSAGE_MAX_LENGTH,
} from '../config.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'
import { MCP_AIR_TOOL_TITLES } from '../tool-titles.js'

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const

/**
 * Matches the repo's write-tool convention. A sent message cannot be unsent, and
 * the extra confirmation a destructive hint prompts in clients is wanted here.
 */
const writesToThalus = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const

type ConfirmedFeedback = {
  readonly category: string
  readonly message: string
  readonly contactEmail: string | undefined
}

const supportsElicitation = (server: McpServer): boolean =>
  server.server.getClientCapabilities()?.elicitation !== undefined

/**
 * The message is the user's words going to Thalus, so the human sees the exact
 * text and edits it before it is sent. Clients without elicitation submit the
 * draft as the model wrote it — the tool call itself is the human's approval,
 * and the alternative is losing the feedback entirely.
 */
const confirmFeedback = async (
  server: McpServer,
  draft: ConfirmedFeedback,
): Promise<ConfirmedFeedback | 'declined'> => {
  if (!supportsElicitation(server)) {
    return draft
  }

  const result = await server.server.elicitInput({
    message: 'Review the feedback before it is sent to Thalus. Edit anything you want to change.',
    requestedSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          title: 'Category',
          enum: [...MCP_AIR_SUPPORT_FEEDBACK_CATEGORIES],
          default: draft.category,
        },
        message: {
          type: 'string',
          title: 'Message',
          maxLength: MCP_AIR_SUPPORT_MESSAGE_MAX_LENGTH,
          default: draft.message,
        },
        contactEmail: {
          type: 'string',
          title: 'Contact email (optional)',
          format: 'email',
          ...(draft.contactEmail === undefined ? {} : { default: draft.contactEmail }),
        },
      },
      required: ['category', 'message'],
    },
  })

  if (result.action !== 'accept' || result.content === undefined) {
    return 'declined'
  }

  const content = result.content as Partial<Record<keyof ConfirmedFeedback, unknown>>
  const message = typeof content.message === 'string' ? content.message : draft.message
  const category = typeof content.category === 'string' ? content.category : draft.category
  const contactEmail =
    typeof content.contactEmail === 'string' && content.contactEmail.length > 0
      ? content.contactEmail
      : draft.contactEmail

  return { category, message, contactEmail }
}

const notSentResult = (what: string) => ({
  content: [{ type: 'text' as const, text: `${what} was not sent — you cancelled it.` }],
})

export const registerSupportTools = (server: McpServer, api: IntegratorApiClient) => {
  server.registerTool(
    'air_submit_feedback',
    {
      title: MCP_AIR_TOOL_TITLES.air_submit_feedback,
      description:
        'Send product feedback to Thalus. The text you write is shown to you for review before it is sent. Works without an AIR account — supply a contact email in that case, so Thalus can reply.',
      inputSchema: {
        category: z.enum(MCP_AIR_SUPPORT_FEEDBACK_CATEGORIES),
        message: z.string().min(1).max(MCP_AIR_SUPPORT_MESSAGE_MAX_LENGTH),
        contactEmail: z.string().email().optional(),
      },
      annotations: {
        ...writesToThalus,
        title: MCP_AIR_TOOL_TITLES.air_submit_feedback,
      },
    },
    async ({ category, message, contactEmail }) => {
      try {
        const confirmed = await confirmFeedback(server, {
          category,
          message,
          contactEmail,
        })
        if (confirmed === 'declined') {
          return notSentResult('Your feedback')
        }

        // No credential means no account yet, and "signup failed" is the most
        // valuable feedback there is — so it goes to the public path instead.
        if (api.resolveApiKey() === undefined) {
          if (confirmed.contactEmail === undefined) {
            return {
              isError: true as const,
              content: [
                {
                  type: 'text' as const,
                  text: 'Add a contact email so Thalus can reply, then send the feedback again.',
                },
              ],
            }
          }

          await api.submitPublicFeedback({
            category: confirmed.category,
            message: confirmed.message,
            contactEmail: confirmed.contactEmail,
          })
          return toolJsonResult({
            received: true,
            repliesTo: confirmed.contactEmail,
          })
        }

        return toolJsonResult(
          await api.submitFeedback({
            category: confirmed.category,
            message: confirmed.message,
            ...(confirmed.contactEmail === undefined
              ? {}
              : { contactEmail: confirmed.contactEmail }),
          }),
        )
      } catch (error) {
        return toolErrorResult(error, 'air_submit_feedback')
      }
    },
  )

  server.registerTool(
    'air_request_credits',
    {
      title: MCP_AIR_TOOL_TITLES.air_request_credits,
      description:
        'Ask Thalus for more assessment credits. You review the amount and the reason before the request is sent, and Thalus replies by email. To start immediately instead, call air_get_credit_balance for the purchase link.',
      inputSchema: {
        credits: z.number().int().positive().max(MCP_AIR_SUPPORT_CREDIT_REQUEST_MAX),
        reason: z.string().min(1).max(MCP_AIR_SUPPORT_MESSAGE_MAX_LENGTH),
        contactEmail: z.string().email().optional(),
      },
      annotations: {
        ...writesToThalus,
        title: MCP_AIR_TOOL_TITLES.air_request_credits,
      },
    },
    async ({ credits, reason, contactEmail }) => {
      try {
        const confirmed = await confirmCreditRequest(server, {
          credits,
          reason,
          contactEmail,
        })
        if (confirmed === 'declined') {
          return notSentResult('Your credit request')
        }

        return toolJsonResult(
          await api.requestCredits({
            credits: confirmed.credits,
            reason: confirmed.reason,
            ...(confirmed.contactEmail === undefined
              ? {}
              : { contactEmail: confirmed.contactEmail }),
          }),
        )
      } catch (error) {
        return toolErrorResult(error, 'air_request_credits')
      }
    },
  )

  server.registerTool(
    'air_get_credit_balance',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_credit_balance,
      description:
        'Assessment credits available to this organization, with the plan and the cost per assessment. Call it before a batch of assessments so the limit is predicted instead of hit.',
      inputSchema: {},
      annotations: {
        ...readOnly,
        title: MCP_AIR_TOOL_TITLES.air_get_credit_balance,
      },
    },
    async () => {
      try {
        return toolJsonResult(await api.creditBalance())
      } catch (error) {
        return toolErrorResult(error, 'air_get_credit_balance')
      }
    },
  )
}

type ConfirmedCreditRequest = {
  readonly credits: number
  readonly reason: string
  readonly contactEmail: string | undefined
}

/**
 * A domain API key has no mailbox behind it, so the API answers 422 without a
 * contact email. Collect it in the same dialog rather than failing afterwards.
 */
const confirmCreditRequest = async (
  server: McpServer,
  draft: ConfirmedCreditRequest,
): Promise<ConfirmedCreditRequest | 'declined'> => {
  if (!supportsElicitation(server)) {
    return draft
  }

  const result = await server.server.elicitInput({
    message:
      'Review the credit request before it is sent to Thalus. A contact email is required so Thalus can reply.',
    requestedSchema: {
      type: 'object',
      properties: {
        credits: {
          type: 'integer',
          title: 'Credits requested',
          minimum: 1,
          maximum: MCP_AIR_SUPPORT_CREDIT_REQUEST_MAX,
          default: draft.credits,
        },
        reason: {
          type: 'string',
          title: 'Reason',
          maxLength: MCP_AIR_SUPPORT_MESSAGE_MAX_LENGTH,
          default: draft.reason,
        },
        contactEmail: {
          type: 'string',
          title: 'Contact email',
          format: 'email',
          ...(draft.contactEmail === undefined ? {} : { default: draft.contactEmail }),
        },
      },
      required: ['credits', 'reason', 'contactEmail'],
    },
  })

  if (result.action !== 'accept' || result.content === undefined) {
    return 'declined'
  }

  const content = result.content as Partial<Record<keyof ConfirmedCreditRequest, unknown>>
  const credits = typeof content.credits === 'number' ? content.credits : draft.credits
  const reason = typeof content.reason === 'string' ? content.reason : draft.reason
  const contactEmail =
    typeof content.contactEmail === 'string' && content.contactEmail.length > 0
      ? content.contactEmail
      : draft.contactEmail

  return { credits, reason, contactEmail }
}
