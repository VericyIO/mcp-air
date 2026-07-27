import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const

const writeHint = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const

export const registerDocumentTools = (server: McpServer, api: IntegratorApiClient) => {
  server.tool(
    'air_list_documents',
    'List document sources for a project. Poll until status is connected before starting an assessment. Requires projects:read.',
    {
      projectPid: z.string().describe('Project pid'),
      includeArchived: z.boolean().optional().describe('Include archived document sources'),
    },
    readOnly,
    async ({ projectPid, includeArchived }) => {
      try {
        return toolJsonResult(await api.listDocuments(projectPid, includeArchived))
      } catch (error) {
        return toolErrorResult(error, 'air_list_documents')
      }
    },
  )

  server.tool(
    'air_get_document_download_url',
    'Get a presigned download URL for an uploaded document source. Requires projects:read.',
    {
      projectPid: z.string(),
      sourcePid: z.string().describe('Document source pid (psrc_*)'),
    },
    readOnly,
    async ({ projectPid, sourcePid }) => {
      try {
        return toolJsonResult(await api.getDocumentDownloadUrl(projectPid, sourcePid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_document_download_url')
      }
    },
  )

  server.tool(
    'air_list_artifacts',
    'List document-derived artifacts for a project. Use artifact pids in air_start_assessment. Requires projects:read.',
    {
      projectPid: z.string(),
      includeArchived: z.boolean().optional(),
    },
    readOnly,
    async ({ projectPid, includeArchived }) => {
      try {
        return toolJsonResult(await api.listArtifacts(projectPid, includeArchived))
      } catch (error) {
        return toolErrorResult(error, 'air_list_artifacts')
      }
    },
  )

  server.tool(
    'air_get_artifact_text',
    'Get extracted plain text for an artifact. Requires projects:read.',
    {
      projectPid: z.string(),
      artifactPid: z.string().describe('Artifact pid (artf_*)'),
    },
    readOnly,
    async ({ projectPid, artifactPid }) => {
      try {
        return toolJsonResult(await api.getArtifactText(projectPid, artifactPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_artifact_text')
      }
    },
  )

  server.tool(
    'air_upload_document_init',
    'Start presigned upload: returns uploadUrl and s3Key. PUT file bytes to uploadUrl, then call air_upload_document_complete. Requires projects:write.',
    {
      projectPid: z.string(),
      filename: z.string().describe('Original filename including extension'),
      contentType: z.string().describe('MIME type, e.g. application/pdf'),
    },
    writeHint,
    async ({ projectPid, filename, contentType }) => {
      try {
        return toolJsonResult(await api.initUpload(projectPid, filename, contentType))
      } catch (error) {
        return toolErrorResult(error, 'air_upload_document_init')
      }
    },
  )

  server.tool(
    'air_upload_document_complete',
    'Finalize presigned upload after PUT to uploadUrl. Dispatches document extraction workflow. Requires projects:write.',
    {
      projectPid: z.string(),
      s3Key: z.string().describe('Storage key from air_upload_document_init'),
      filename: z.string(),
      contentType: z.string(),
    },
    writeHint,
    async ({ projectPid, s3Key, filename, contentType }) => {
      try {
        return toolJsonResult(
          await api.completeUpload(projectPid, { s3Key, filename, contentType }),
        )
      } catch (error) {
        return toolErrorResult(error, 'air_upload_document_complete')
      }
    },
  )
}
