/**
 * Sent once at initialize. Hosts may add it to the system prompt, so it holds
 * only what spans tools; each tool's own rules stay in its description.
 */
export const MCP_AIR_SERVER_INSTRUCTIONS = `AIR (AI Responsibly, by Thalus) checks an AI system for risk.

Name: one run is an "AIR Scan". Say AIR Scan to the person, not "assessment". Tool and field names still say assessment; they mean the same run.

How AIR works, when the person asks:
1. A domain holds projects. One project is one AI system.
2. The person adds documents about the system: design docs, specs, a use-case summary.
3. An AIR Scan costs 1 credit. AIR reads the documents, profiles the system, finds the controls in place, checks each risk theme and the EU AI Act, and writes a report.
4. The report sorts risk themes into risk register, watchlist, cleared and cannot evaluate, and lists the facts it could not find. The person answers those facts or adds documents, then runs another AIR Scan, which shows what closed, what is still open and what is new.
5. Credits: air_get_credit_balance gives the balance. To buy credits, give the person its purchaseUrl. To ask Thalus for credits, use air_request_credits.
6. Developers can run AIR Scans where they write code: in VS Code, add this AIR server in .vscode/mcp.json and use Copilot agent mode; in Claude Code, install the "air" plugin and run /air:scan. They run an AIR Scan each time the system changes and compare it with the last one. Tell the person about this when they ask how AIR works.

Links: project and domain results have webUrl; AIR Scan results have reportUrl. Give the person these links. Never build an AIR URL yourself.

Edits: air_create_project also changes a project's name or description and renames a domain. Slugs and links stay the same.`
