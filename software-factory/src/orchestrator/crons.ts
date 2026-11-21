import { z } from "zod";
import type { Logger } from "../shared/logger.js";
import type { ScheduledWakeupInput } from "../shared/types.js";

export const FACTORY_WAKEUP_WORKFLOW_NAME = "factory-scheduled-wakeup";
export const SPEC_QUEUE_WAKEUP_CRON = "*/15 * * * *";
export const SPEC_QUEUE_WAKEUP_SCHEDULE_NAME = "factory-spec-queue-wakeup";

const CRON_FIELD_PATTERN = /^[\d*/,-]+$/;

const CronExpressionSchema = z
  .string()
  .trim()
  .refine((value) => {
    const fields = value.split(/\s+/);
    return (
      fields.length === 5 &&
      fields.every((field) => CRON_FIELD_PATTERN.test(field))
    );
  }, "Invalid 5-field cron expression");

export type FactoryCronDefinition = {
  name: string;
  workflowName: string;
  expression: string;
  input: ScheduledWakeupInput;
  additionalMetadata?: Record<string, string>;
};

export type ExistingCronTrigger = {
  name?: string;
  cron?: string;
};

export type HatchetCronClient = {
  list: (query: {
    workflow?: string;
  }) => Promise<{ rows?: ExistingCronTrigger[] }>;
  create: (
    workflow: string,
    cron: {
      name: string;
      expression: string;
      input?: Record<string, unknown>;
      additionalMetadata?: Record<string, string>;
    }
  ) => Promise<unknown>;
};

export type CronRegistrationSummary = {
  created: string[];
  skipped: string[];
};

export type DefaultFactoryCronsOptions = {
  repositoryFullName?: string;
  specWakeupExpression?: string;
};

export const validateCronExpression = (expression: string): string =>
  CronExpressionSchema.parse(expression);

export const buildDefaultFactoryCrons = (
  options: DefaultFactoryCronsOptions = {}
): readonly FactoryCronDefinition[] => {
  const expression = validateCronExpression(
    options.specWakeupExpression ?? SPEC_QUEUE_WAKEUP_CRON
  );
  const repositoryFullName = options.repositoryFullName?.trim();

  const input: ScheduledWakeupInput = {
    workflow: "agent-implement-spec",
    concurrencyKey: "agent-implement-spec",
    trigger: "cron",
    scheduleName: SPEC_QUEUE_WAKEUP_SCHEDULE_NAME,
    ...(repositoryFullName ? { repositoryFullName } : {}),
  };

  return [
    {
      name: SPEC_QUEUE_WAKEUP_SCHEDULE_NAME,
      workflowName: FACTORY_WAKEUP_WORKFLOW_NAME,
      expression,
      input,
      additionalMetadata: {
        source: "software-factory",
        workflow: "agent-implement-spec",
      },
    },
  ];
};

const fetchExistingCronsByWorkflow = async (
  cronClient: HatchetCronClient,
  definitions: readonly FactoryCronDefinition[]
): Promise<Map<string, ExistingCronTrigger[]>> => {
  const workflowNames = [
    ...new Set(definitions.map((definition) => definition.workflowName)),
  ];
  const existingByWorkflow = new Map<string, ExistingCronTrigger[]>();

  for (const workflowName of workflowNames) {
    const listed = await cronClient.list({ workflow: workflowName });
    existingByWorkflow.set(workflowName, listed.rows ?? []);
  }

  return existingByWorkflow;
};

export const registerFactoryCrons = async (
  cronClient: HatchetCronClient,
  definitions: readonly FactoryCronDefinition[],
  logger?: Logger
): Promise<CronRegistrationSummary> => {
  const existingByWorkflow = await fetchExistingCronsByWorkflow(
    cronClient,
    definitions
  );
  const created: string[] = [];
  const skipped: string[] = [];

  for (const definition of definitions) {
    const expression = validateCronExpression(definition.expression);
    const existingRows = existingByWorkflow.get(definition.workflowName) ?? [];
    const alreadyRegistered = existingRows.some(
      (row) => row.name === definition.name && row.cron === expression
    );

    if (alreadyRegistered) {
      skipped.push(definition.name);
      logger?.info("cron.skipped_existing", {
        name: definition.name,
        workflowName: definition.workflowName,
        expression,
      });
      continue;
    }

    await cronClient.create(definition.workflowName, {
      name: definition.name,
      expression,
      input: definition.input,
      additionalMetadata: definition.additionalMetadata,
    });
    created.push(definition.name);
    logger?.info("cron.registered", {
      name: definition.name,
      workflowName: definition.workflowName,
      expression,
    });
  }

  return { created, skipped };
};
