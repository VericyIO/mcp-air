/** MCP tool surface — local stdio vs remote Streamable HTTP. */
export type McpAirSurface = 'local' | 'remote'

export const MCP_AIR_REMOTE_TOOL_COUNT = 26 as const

/**
 * Remote surface. Drops the two tools hosted Claude clients cannot drive:
 * - `air_run_assessment_from_file` (no local filesystem)
 * - `air_run_full_assessment_pipeline` (MCP Tasks is a draft extension hosted clients reject)
 */
export const MCP_AIR_REMOTE_TOOL_NAMES = [
  'air_list_domains',
  'air_get_domain',
  'air_list_projects',
  'air_get_project',
  'air_create_project',
  'air_search',
  'air_list_documents',
  'air_get_document_download_url',
  'air_list_artifacts',
  'air_get_artifact_text',
  'air_upload_document_init',
  'air_upload_document_complete',
  'air_list_assessments',
  'air_get_assessment',
  'air_get_assessment_report',
  'air_get_assessment_summary',
  'air_list_open_facts',
  'air_submit_fact_answers',
  'air_get_assessment_stages',
  'air_get_assessment_input_artifacts',
  'air_create_assessment_draft',
  'air_start_assessment',
  'air_retry_assessment',
  'air_get_domain_portfolio',
  'air_wait_for_document_extraction',
  'air_wait_for_assessment',
] as const satisfies ReadonlyArray<string>
