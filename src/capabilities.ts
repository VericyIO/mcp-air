/** Expected MCP surface — update when adding or removing tools, resources, or prompts. */
export const MCP_AIR_EXPECTED_TOOL_COUNT = 25 as const

export const MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_COUNT = 3 as const

export const MCP_AIR_EXPECTED_PROMPT_COUNT = 3 as const

export const MCP_AIR_EXPECTED_TOOL_NAMES = [
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
  'air_get_assessment_stages',
  'air_get_assessment_input_artifacts',
  'air_create_assessment_draft',
  'air_start_assessment',
  'air_retry_assessment',
  'air_get_domain_portfolio',
  'air_wait_for_document_extraction',
  'air_wait_for_assessment',
  'air_run_assessment_from_file',
  'air_run_full_assessment_pipeline',
] as const satisfies ReadonlyArray<string>

export const MCP_AIR_EXPECTED_PROMPT_NAMES = [
  'run-assessment-workflow',
  'review-assessment-report',
  'explore-portfolio',
] as const satisfies ReadonlyArray<string>

export const MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_NAMES = [
  'assessment-report',
  'assessment-stages',
  'project-assessments',
] as const satisfies ReadonlyArray<string>

export const MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_URI_PATTERNS = [
  'air://assessments/{assessmentPid}/report',
  'air://assessments/{assessmentPid}/stages',
  'air://projects/{projectPid}/assessments',
] as const satisfies ReadonlyArray<string>

/** Composite tools that require MCP Tasks (execution.taskSupport: required). */
export const MCP_AIR_TASK_REQUIRED_TOOL_NAMES = [
  'air_wait_for_document_extraction',
  'air_wait_for_assessment',
  'air_run_assessment_from_file',
  'air_run_full_assessment_pipeline',
] as const satisfies ReadonlyArray<string>
