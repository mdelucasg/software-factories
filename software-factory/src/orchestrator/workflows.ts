import {
  ConcurrencyLimitStrategy,
  type Hatchet,
} from "@hatchet-dev/typescript-sdk";
import type { Logger } from "../shared/logger.js";
import { createLogger } from "../shared/logger.js";
import type {
  Clock,
  FactoryRunInput,
  FactoryRunOutput,
} from "../shared/types.js";

export const FACTORY_RUN_WORKFLOW_NAME = "factory-run";

export type StubFactoryRunOptions = {
  clock?: Clock;
  logger?: Logger;
};

export const executeStubFactoryRun = (
  input: FactoryRunInput,
  options: StubFactoryRunOptions = {}
): FactoryRunOutput => {
  const clock = options.clock ?? (() => new Date());
  const logger =
    options.logger ?? createLogger({ service: "factory-worker", clock });
  const executedAt = clock().toISOString();
  const summary = `Stub executed ${input.workflow} for ${input.repository.fullName}#${input.subject.number}`;

  logger.info("workflow.stub_executed", {
    workflow: input.workflow,
    concurrencyKey: input.concurrencyKey,
    deliveryId: input.deliveryId,
    repository: input.repository.fullName,
    subjectKind: input.subject.kind,
    subjectNumber: input.subject.number,
    executedAt,
  });

  return {
    status: "completed",
    workflow: input.workflow,
    concurrencyKey: input.concurrencyKey,
    deliveryId: input.deliveryId,
    executedAt,
    summary,
  };
};

export const createFactoryRunTask = (
  hatchet: Hatchet,
  options: StubFactoryRunOptions = {}
) =>
  hatchet.task<FactoryRunInput, FactoryRunOutput>({
    name: FACTORY_RUN_WORKFLOW_NAME,
    executionTimeout: "60m",
    scheduleTimeout: "30m",
    concurrency: [
      {
        expression: "input.concurrencyKey",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
    ],
    fn: async (input) => executeStubFactoryRun(input, options),
  });
