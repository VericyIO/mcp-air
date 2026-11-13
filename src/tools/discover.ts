import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { findProjectByPid } from "../client/find-project.js";
import type { IntegratorApiClient } from "../client/integrator-api.js";
import { MCP_AIR_DEFAULT_LIST_LIMIT } from "../config.js";
import { toolErrorResult, toolJsonResult } from "../errors.js";
import { MCP_AIR_TOOL_TITLES } from "../tool-titles.js";
import { planProjectChange } from "./project-change.js";

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

export const registerDiscoverTools = (
  server: McpServer,
  api: IntegratorApiClient,
) => {
  server.registerTool(
    "air_list_domains",
    {
      title: MCP_AIR_TOOL_TITLES.air_list_domains,
      description:
        "List domains visible to the API key. For domain-scoped service account keys, returns the single bound domain. Requires domains:read scope. Each result has webUrl, the page in the AIR web app; give the person that link when they ask where to see the domain.",
      inputSchema: {},
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_list_domains },
    },
    async () => {
      try {
        return toolJsonResult(await api.listDomains());
      } catch (error) {
        return toolErrorResult(error, "air_list_domains");
      }
    },
  );

  server.registerTool(
    "air_get_domain",
    {
      title: MCP_AIR_TOOL_TITLES.air_get_domain,
      description:
        "Resolve a domain by pid from air_list_domains results, or by orgSlug + domainSlug via slug lookup. The result has webUrl, the page in the AIR web app; give the person that link when they ask where to see the domain.",
      inputSchema: {
        domainPid: z
          .string()
          .optional()
          .describe("Domain pid from air_list_domains"),
        orgSlug: z.string().optional().describe("Organization slug for lookup"),
        domainSlug: z.string().optional().describe("Domain slug for lookup"),
      },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_get_domain },
    },
    async ({ domainPid, orgSlug, domainSlug }) => {
      try {
        if (orgSlug !== undefined && domainSlug !== undefined) {
          return toolJsonResult(await api.lookupDomain(orgSlug, domainSlug));
        }
        if (domainPid === undefined) {
          return toolErrorResult(
            new Error("Provide domainPid or both orgSlug and domainSlug"),
            "air_get_domain",
          );
        }
        const domains = await api.listDomains();
        const match = domains.find((row) => row.pid === domainPid);
        if (match === undefined) {
          return toolErrorResult(
            new Error(`Domain ${domainPid} not found`),
            "air_get_domain",
          );
        }
        return toolJsonResult(match);
      } catch (error) {
        return toolErrorResult(error, "air_get_domain");
      }
    },
  );

  server.registerTool(
    "air_list_projects",
    {
      title: MCP_AIR_TOOL_TITLES.air_list_projects,
      description:
        "List projects in a domain (paginated). Requires domains:read and projects:read. Use domainPid from air_list_domains. Each result has webUrl, the page in the AIR web app; give the person that link when they ask where to see the project.",
      inputSchema: {
        domainPid: z.string().describe("Domain pid"),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number (default 1)"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Page size (default 20)"),
        search: z.string().optional().describe("Filter projects by name"),
      },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_list_projects },
    },
    async ({ domainPid, page, pageSize, search }) => {
      try {
        const query = {
          ...(page !== undefined ? { page } : {}),
          ...(pageSize !== undefined ? { pageSize } : {}),
          ...(search !== undefined ? { search } : {}),
        };
        return toolJsonResult(await api.listProjects(domainPid, query));
      } catch (error) {
        return toolErrorResult(error, "air_list_projects");
      }
    },
  );

  server.registerTool(
    "air_get_project",
    {
      title: MCP_AIR_TOOL_TITLES.air_get_project,
      description:
        "Resolve a project by pid from air_list_projects, or by orgSlug + domainSlug + projectSlug. The result has webUrl, the page in the AIR web app; give the person that link when they ask where to see the project.",
      inputSchema: {
        projectPid: z
          .string()
          .optional()
          .describe("Project pid from air_list_projects"),
        orgSlug: z.string().optional(),
        domainSlug: z.string().optional(),
        projectSlug: z.string().optional(),
      },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_get_project },
    },
    async ({ projectPid, orgSlug, domainSlug, projectSlug }) => {
      try {
        if (
          orgSlug !== undefined &&
          domainSlug !== undefined &&
          projectSlug !== undefined
        ) {
          return toolJsonResult(
            await api.lookupProject(orgSlug, domainSlug, projectSlug),
          );
        }
        if (projectPid === undefined) {
          return toolErrorResult(
            new Error(
              "Provide projectPid or orgSlug + domainSlug + projectSlug",
            ),
            "air_get_project",
          );
        }
        const match = await findProjectByPid(api, projectPid);
        if (match === undefined) {
          return toolErrorResult(
            new Error(`Project ${projectPid} not found`),
            "air_get_project",
          );
        }
        return toolJsonResult(match);
      } catch (error) {
        return toolErrorResult(error, "air_get_project");
      }
    },
  );

  server.registerTool(
    "air_create_project",
    {
      title: MCP_AIR_TOOL_TITLES.air_create_project,
      description:
        "Create a project in a domain, edit an existing project, or rename the domain. To create: pass name and slug. To edit: pass projectPid with a new name and/or description. To rename the domain: pass domainName. Slugs never change, so links keep working. Requires domains:write (fullPipeline preset). The result has webUrl: give the person that link to the project in AIR.",
      inputSchema: {
        domainPid: z.string().describe("Domain pid from air_list_domains"),
        projectPid: z
          .string()
          .optional()
          .describe("Edit this project instead of creating one"),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("Project display name. Required to create; a new name when editing"),
        slug: z
          .string()
          .min(1)
          .optional()
          .describe("URL-safe slug, unique in the domain. Only when creating"),
        description: z
          .string()
          .optional()
          .describe("Project description. When editing, an empty string removes it"),
        domainName: z
          .string()
          .min(1)
          .optional()
          .describe("New display name for the domain"),
      },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_create_project },
    },
    async ({ domainPid, projectPid, name, slug, description, domainName }) => {
      try {
        const plan = planProjectChange({ projectPid, name, slug, description, domainName });
        const domain =
          domainName === undefined ? undefined : await api.renameDomain(domainPid, domainName);
        const project =
          plan.kind === "create"
            ? await api.createProject(domainPid, plan.payload)
            : plan.kind === "edit"
              ? await api.updateProject(domainPid, plan.projectPid, plan.payload)
              : undefined;
        if (project === undefined) {
          return toolJsonResult(domain);
        }
        return toolJsonResult(domain === undefined ? project : { ...project, domain });
      } catch (error) {
        return toolErrorResult(error, "air_create_project");
      }
    },
  );

  server.registerTool(
    "air_search",
    {
      title: MCP_AIR_TOOL_TITLES.air_search,
      description:
        "Full-text search across orgs, domains, and projects. Requires search:read scope (fullPipeline preset; not included in assessmentRunner).",
      inputSchema: {
        q: z.string().min(1).describe("Search query"),
        kind: z
          .enum(["org", "domain", "project"])
          .optional()
          .describe("Restrict to entity kind"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default 20)"),
      },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_search },
    },
    async ({ q, kind, limit }) => {
      try {
        const resolvedLimit = limit ?? MCP_AIR_DEFAULT_LIST_LIMIT;
        return toolJsonResult(await api.search(q, kind, resolvedLimit));
      } catch (error) {
        return toolErrorResult(error, "air_search");
      }
    },
  );
};
