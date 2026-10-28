import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { IntegratorApiClient } from "../client/integrator-api.js";
import {
  MCP_AIR_ASK_OPEN_FACTS_DESCRIPTION,
  MCP_AIR_CHECKLIST_FIELD,
  MCP_AIR_FACT_FORM_DECLINED_NOTE,
  MCP_AIR_FACT_FORM_DETAIL_MESSAGE,
  MCP_AIR_FACT_FORM_JUSTIFICATION,
  MCP_AIR_FACT_FORM_MAX_PAGES,
  MCP_AIR_FACT_FORM_MAX_QUESTIONS,
  MCP_AIR_FACT_FORM_MESSAGE,
  MCP_AIR_FACT_FORM_SUGGESTED_MESSAGE,
  MCP_AIR_MORE_QUESTIONS_NEXT_STEP,
  MCP_AIR_NO_FORM_NEXT_STEP,
  MCP_AIR_NO_OPEN_QUESTIONS_NOTE,
  MCP_AIR_STILL_OPEN_NOTE,
} from "../config.js";
import { supportsElicitation } from "../elicitation.js";
import { toolErrorResult, toolJsonResult } from "../errors.js";
import {
  askPage,
  checklistField,
  conflictContext,
  questionField,
  readChecklist,
  readQuestion,
  readQuestionAnswer,
  readScreeningGroups,
  suggestionContext,
  type FactAnswer,
  type FactValue,
  type FieldContext,
  type Question,
  type ScreeningGroup,
} from "../forms/fact-form.js";
import { MCP_AIR_TOOL_TITLES } from "../tool-titles.js";

const writeHint = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

type Conflict = {
  readonly question: Question;
  readonly keptValue: FactValue;
  readonly scanValue: FactValue;
  readonly excerpts: readonly string[];
};

type OpenFactsPayload = {
  readonly openFacts: readonly Question[];
  readonly screeningGroups: readonly ScreeningGroup[];
  readonly answerConflicts: readonly Conflict[];
  readonly tier: unknown;
};

type Proposal = {
  readonly factPath: string;
  readonly value: FactValue;
  readonly reason: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFactValue = (
  value: unknown,
  question: Question,
  field: string,
): FactValue => {
  if (value === null) return null;
  if (question.valueKind === "boolean" && typeof value === "boolean")
    return value;
  if (
    question.valueKind === "array" &&
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value;
  }
  throw new Error(
    `Open fact ${question.factPath} ${field} does not match its kind`,
  );
};

const readConflict = (raw: unknown): Conflict => {
  const question = readQuestion(raw);
  const row = raw as Record<string, unknown>;
  if (
    !Array.isArray(row.excerpts) ||
    row.excerpts.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Open fact ${question.factPath} excerpts are not text`);
  }
  return {
    question,
    keptValue: readFactValue(row.keptValue, question, "keptValue"),
    scanValue: readFactValue(row.scanValue, question, "scanValue"),
    excerpts: row.excerpts as string[],
  };
};

const readList = (value: unknown, key: string): readonly unknown[] => {
  if (!Array.isArray(value))
    throw new Error(`Open facts response is missing ${key}`);
  return value;
};

const parseOpenFactsPayload = (raw: unknown): OpenFactsPayload => {
  if (!isRecord(raw)) throw new Error("Open facts response is not an object");
  if (!isRecord(raw.euAiActTier) || !("tier" in raw.euAiActTier)) {
    throw new Error("Open facts response is missing euAiActTier.tier");
  }
  return {
    openFacts: readList(raw.openFacts, "openFacts").map(readQuestion),
    screeningGroups: readScreeningGroups(raw.screeningGroups),
    answerConflicts: readList(raw.answerConflicts, "answerConflicts").map(
      readConflict,
    ),
    tier: raw.euAiActTier.tier,
  };
};

const indexProposals = (proposed: ReadonlyArray<Proposal> | undefined) => {
  const byPath = new Map<string, Proposal>();
  for (const proposal of proposed ?? []) {
    if (byPath.has(proposal.factPath)) {
      throw new Error(`Duplicate proposed answer for ${proposal.factPath}`);
    }
    byPath.set(proposal.factPath, proposal);
  }
  return byPath;
};

/** A suggestion may start a field only where the code can show the answer. */
const suggestion = (
  question: Question,
  proposals: ReadonlyMap<string, Proposal>,
): FieldContext | undefined => {
  const proposal = proposals.get(question.factPath);
  if (proposal === undefined) return undefined;
  if (!question.suggestFromCode) {
    throw new Error(
      `proposedAnswers may only cover facts the code can show. "${question.question}" must come from the person.`,
    );
  }
  return suggestionContext(question, proposal.value, proposal.reason);
};

/** The checklist lines still worth ticking: open facts not answered "Not sure" or in conflict. */
const checklistGroups = (
  payload: OpenFactsPayload,
  skip: ReadonlySet<string>,
): readonly ScreeningGroup[] => {
  const conflicted = new Set(
    payload.answerConflicts.map((conflict) => conflict.question.factPath),
  );
  return payload.screeningGroups
    .map((group) => ({
      ...group,
      factPaths: group.factPaths.filter(
        (factPath) => !skip.has(factPath) && !conflicted.has(factPath),
      ),
    }))
    .filter((group) => group.factPaths.length > 0);
};

const chatQuestion = (question: Question, proposal: Proposal | undefined) => ({
  factPath: question.factPath,
  question: question.question,
  help: question.help,
  valueKind: question.valueKind,
  ...(question.valueKind === "array" ? { options: question.options } : {}),
  ...(proposal === undefined ? {} : { proposal }),
});

export const registerAskOpenFactsTool = (
  server: McpServer,
  api: IntegratorApiClient,
) => {
  server.registerTool(
    "air_ask_open_facts",
    {
      title: MCP_AIR_TOOL_TITLES.air_ask_open_facts,
      description: MCP_AIR_ASK_OPEN_FACTS_DESCRIPTION,
      inputSchema: {
        assessmentPid: z.string(),
        proposedAnswers: z
          .array(
            z.object({
              factPath: z.string(),
              value: z.union([z.boolean(), z.array(z.string()), z.null()]),
              reason: z.string(),
            }),
          )
          .optional(),
        skipFactPaths: z
          .array(z.string())
          .optional()
          .describe(
            "notSureFactPaths from the last call: questions the person is not sure about",
          ),
      },
      annotations: {
        ...writeHint,
        title: MCP_AIR_TOOL_TITLES.air_ask_open_facts,
      },
    },
    async ({ assessmentPid, proposedAnswers, skipFactPaths }) => {
      try {
        const proposals = indexProposals(proposedAnswers);
        const notSure = new Set(skipFactPaths ?? []);
        let payload = parseOpenFactsPayload(
          await api.listOpenFacts(assessmentPid),
        );
        for (const question of payload.openFacts)
          suggestion(question, proposals);

        const askable = () => ({
          conflicts: payload.answerConflicts.filter(
            (conflict) => !notSure.has(conflict.question.factPath),
          ),
          openFacts: payload.openFacts.filter(
            (question) => !notSure.has(question.factPath),
          ),
        });

        if (
          askable().conflicts.length === 0 &&
          askable().openFacts.length === 0
        ) {
          return toolJsonResult({
            assessmentPid,
            tier: payload.tier,
            openFactsRemaining: payload.openFacts.length,
            ...(payload.openFacts.length === 0
              ? { note: MCP_AIR_NO_OPEN_QUESTIONS_NOTE }
              : {}),
          });
        }

        if (!supportsElicitation(server)) {
          return toolJsonResult({
            assessmentPid,
            checklist: checklistGroups(payload, notSure),
            conflicts: askable().conflicts.map((conflict) => ({
              ...chatQuestion(conflict.question, undefined),
              keptValue: conflict.keptValue,
              scanValue: conflict.scanValue,
              excerpts: conflict.excerpts,
            })),
            questions: askable().openFacts.map((question) =>
              chatQuestion(question, proposals.get(question.factPath)),
            ),
            nextStep: MCP_AIR_NO_FORM_NEXT_STEP,
          });
        }

        let answered = 0;
        const submit = async (answers: readonly FactAnswer[]) => {
          for (const answer of answers) {
            if (answer.value === null) notSure.add(answer.factPath);
          }
          if (answers.length === 0) return;
          payload = parseOpenFactsPayload(
            await api.submitFactAnswers(
              assessmentPid,
              answers.map((answer) => ({
                factPath: answer.factPath,
                value: answer.value,
                justification: MCP_AIR_FACT_FORM_JUSTIFICATION,
              })),
            ),
          );
          answered += answers.length;
        };
        const declined = () =>
          toolJsonResult({
            assessmentPid,
            declined: true,
            answered,
            tier: payload.tier,
            openFactsRemaining: payload.openFacts.length,
            note: MCP_AIR_FACT_FORM_DECLINED_NOTE,
          });

        for (let page = 0; page < MCP_AIR_FACT_FORM_MAX_PAGES; page += 1) {
          const { conflicts, openFacts } = askable();
          if (conflicts.length === 0 && openFacts.length === 0) break;

          const groups = checklistGroups(payload, notSure);
          const onChecklist = new Set(
            groups.flatMap((group) => group.factPaths),
          );
          const conflicted = new Set(
            conflicts.map((conflict) => conflict.question.factPath),
          );
          const singles = openFacts
            .filter(
              (question) =>
                !onChecklist.has(question.factPath) &&
                !conflicted.has(question.factPath),
            )
            .slice(0, MCP_AIR_FACT_FORM_MAX_QUESTIONS);
          const properties: ElicitRequestFormParams["requestedSchema"]["properties"] =
            {};
          for (const conflict of conflicts) {
            properties[conflict.question.factPath] = questionField(
              conflict.question,
              conflictContext(
                conflict.question,
                conflict.keptValue,
                conflict.scanValue,
                conflict.excerpts[0],
              ),
            );
          }
          if (groups.length > 0)
            properties[MCP_AIR_CHECKLIST_FIELD] = checklistField(groups);
          let suggested = false;
          for (const question of singles) {
            const context = suggestion(question, proposals);
            suggested ||= context !== undefined;
            properties[question.factPath] = questionField(question, context);
          }

          const content = await askPage(
            server,
            suggested
              ? MCP_AIR_FACT_FORM_SUGGESTED_MESSAGE
              : MCP_AIR_FACT_FORM_MESSAGE,
            properties,
          );
          if (content === null) return declined();

          const questionsByPath = new Map(
            openFacts.map((question) => [question.factPath, question]),
          );
          const pageAnswers: FactAnswer[] = [
            ...conflicts.map((conflict) => ({
              factPath: conflict.question.factPath,
              value: readQuestionAnswer(
                conflict.question,
                content[conflict.question.factPath],
              ),
            })),
            ...singles.map((question) => ({
              factPath: question.factPath,
              value: readQuestionAnswer(question, content[question.factPath]),
            })),
          ];
          const checklist =
            groups.length === 0
              ? { answers: [], next: [] }
              : readChecklist(
                  groups,
                  questionsByPath,
                  content[MCP_AIR_CHECKLIST_FIELD],
                );
          await submit([...pageAnswers, ...checklist.answers]);

          if (checklist.next.length > 0) {
            const detail: ElicitRequestFormParams["requestedSchema"]["properties"] =
              {};
            for (const question of checklist.next) {
              detail[question.factPath] = questionField(
                question,
                suggestion(question, proposals),
              );
            }
            const details = await askPage(
              server,
              MCP_AIR_FACT_FORM_DETAIL_MESSAGE,
              detail,
            );
            if (details === null) return declined();
            await submit(
              checklist.next.map((question) => ({
                factPath: question.factPath,
                value: readQuestionAnswer(question, details[question.factPath]),
              })),
            );
          }
        }

        const left = askable();
        const stillOpen = payload.openFacts
          .filter((question) => notSure.has(question.factPath))
          .map((question) => question.question);
        return toolJsonResult({
          assessmentPid,
          answered,
          tier: payload.tier,
          openFactsRemaining: payload.openFacts.length,
          notSureFactPaths: [...notSure],
          ...(stillOpen.length === 0
            ? {}
            : { stillOpen, note: MCP_AIR_STILL_OPEN_NOTE }),
          ...(left.conflicts.length > 0 || left.openFacts.length > 0
            ? { nextStep: MCP_AIR_MORE_QUESTIONS_NEXT_STEP }
            : {}),
        });
      } catch (error) {
        return toolErrorResult(error, "air_ask_open_facts");
      }
    },
  );
};
