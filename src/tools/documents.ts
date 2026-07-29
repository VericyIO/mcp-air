import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { IntegratorApiClient } from "../client/integrator-api.js";
import { toolErrorResult, toolJsonResult } from "../errors.js";
import { MCP_AIR_TOOL_TITLES } from "../tool-titles.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const writeHint = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

export const registerDocumentTools = (
  server: McpServer,
  api: IntegratorApiClient,
) => {
  server.registerTool(
    "air_list_documents",
    {
      title: MCP_AIR_TOOL_TITLES.air_list_documents,
      description:
        "List document sources for a project. Poll until status is connected before starting an assessment. Requires projects:read.",
      inputSchema: {
        projectPid: z.string().describe("Project pid"),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived document sources"),
      },
      annotations: readOnly,
    },
    async ({ projectPid, includeArchived }) => {
      try {
        return toolJsonResult(
          await api.listDocuments(projectPid, includeArchived),
        );
      } catch (error) {
        return toolErrorResult(error, "air_list_documents");
      }
    },
  );

  server.registerTool(
    "air_get_document_download_url",
    {
      title: MCP_AIR_TOOL_TITLES.air_get_document_download_url,
      description:
        "Get a presigned download URL for an uploaded document source. Requires projects:read.",
      inputSchema: {
        projectPid: z.string(),
        sourcePid: z.string().describe("Document source pid (psrc_*)"),
      },
      annotations: readOnly,
    },
    async ({ projectPid, sourcePid }) => {
      try {
        return toolJsonResult(
          await api.getDocumentDownloadUrl(projectPid, sourcePid),
        );
      } catch (error) {
        return toolErrorResult(error, "air_get_document_download_url");
      }
    },
  );

  server.registerTool(
    "air_list_artifacts",
    {
      title: MCP_AIR_TOOL_TITLES.air_list_artifacts,
      description:
        "List document-derived artifacts for a project. Use artifact pids in air_start_assessment. Requires projects:read.",
      inputSchema: {
        projectPid: z.string(),
        includeArchived: z.boolean().optional(),
      },
      annotations: readOnly,
    },
    async ({ projectPid, includeArchived }) => {
      try {
        return toolJsonResult(
          await api.listArtifacts(projectPid, includeArchived),
        );
      } catch (error) {
        return toolErrorResult(error, "air_list_artifacts");
      }
    },
  );

  server.registerTool(
    "air_get_artifact_text",
    {
      title: MCP_AIR_TOOL_TITLES.air_get_artifact_text,
      description:
        "Get extracted plain text for an artifact. Requires projects:read.",
      inputSchema: {
        projectPid: z.string(),
        artifactPid: z.string().describe("Artifact pid (artf_*)"),
      },
      annotations: readOnly,
    },
    async ({ projectPid, artifactPid }) => {
      try {
        return toolJsonResult(
          await api.getArtifactText(projectPid, artifactPid),
        );
      } catch (error) {
        return toolErrorResult(error, "air_get_artifact_text");
      }
    },
  );

  server.registerTool(
    "air_upload_document_init",
    {
      title: MCP_AIR_TOOL_TITLES.air_upload_document_init,
      description:
        "Start presigned upload: returns uploadUrl and s3Key. PUT file bytes to uploadUrl, then call air_upload_document_complete. Requires projects:write.",
      inputSchema: {
        projectPid: z.string(),
        filename: z.string().describe("Original filename including extension"),
        contentType: z.string().describe("MIME type, e.g. application/pdf"),
      },
      annotations: writeHint,
    },
    async ({ projectPid, filename, contentType }) => {
      try {
        return toolJsonResult(
          await api.initUpload(projectPid, filename, contentType),
        );
      } catch (error) {
        return toolErrorResult(error, "air_upload_document_init");
      }
    },
  );

  server.registerTool(
    "air_upload_document_complete",
    {
      title: MCP_AIR_TOOL_TITLES.air_upload_document_complete,
      description:
        "Finalize presigned upload after PUT to uploadUrl. Dispatches document extraction workflow. Requires projects:write.",
      inputSchema: {
        projectPid: z.string(),
        s3Key: z.string().describe("Storage key from air_upload_document_init"),
        filename: z.string(),
        contentType: z.string(),
      },
      annotations: writeHint,
    },
    async ({ projectPid, s3Key, filename, contentType }) => {
      try {
        return toolJsonResult(
          await api.completeUpload(projectPid, {
            s3Key,
            filename,
            contentType,
          }),
        );
      } catch (error) {
        return toolErrorResult(error, "air_upload_document_complete");
      }
    },
  );
};
