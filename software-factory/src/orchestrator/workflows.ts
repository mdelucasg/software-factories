import {
  ConcurrencyLimitStrategy,
  CreateTaskWorkflow,
  type Hatchet,
} from "@hatchet-dev/typescript-sdk";
import type { Logger } from "../shared/logger.js";
import { createLogger } from "../shared/logger.js";
import type {
  Clock,
  FactoryRunInput,
  FactoryRunOutput,
  ScheduledWakeupInput,
  ScheduledWakeupOutput,
} from "../shared/types.js";
import {
  FACTORY_WAKEUP_WORKFLOW_NAME,
  SPEC_QUEUE_WAKEUP_CRON,
  SPEC_QUEUE_WAKEUP_SCHEDULE_NAME,
  validateCronExpression,
} from "./crons.js";
import {
  DEFAULT_HEARTBEAT_INCREMENT,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  type HeartbeatDuration,
  type TimeoutRefresher,
  withTimeoutHeartbeat,
} from "./heartbeat.js";

export const FACTORY_RUN_WORKFLOW_NAME = "factory-run";
export const FACTORY_EXECUTION_TIMEOUT = "60m";
export const FACTORY_SCHEDULE_TIMEOUT = "30m";

export type StubFactoryRunOptions = {
  clock?: Clock;
  logger?: Logger;
};

export type FactoryRunTaskOptions = StubFactoryRunOptions & {
  heartbeatIntervalMs?: number;
  heartbeatIncrementBy?: HeartbeatDuration;
  executeRun?: (input: FactoryRunInput) => Promise<FactoryRunOutput>;
};

export type ScheduledWakeupTaskOptions = StubFactoryRunOptions & {
  cronExpression?: string;
  heartbeatIntervalMs?: number;
  heartbeatIncrementBy?: HeartbeatDuration;
  executeWakeup?: (
    input: ScheduledWakeupInput
  ) => Promise<ScheduledWakeupOutput>;
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

const normalizeWakeupInput = (
  raw: Partial<ScheduledWakeupInput>
): ScheduledWakeupInput => ({
  workflow: raw.workflow ?? "agent-implement-spec",
  concurrencyKey: raw.concurrencyKey ?? "agent-implement-spec",
  trigger: "cron",
  scheduleName: raw.scheduleName ?? SPEC_QUEUE_WAKEUP_SCHEDULE_NAME,
  ...(raw.repositoryFullName
    ? { repositoryFullName: raw.repositoryFullName }
    : {}),
});

export const executeStubScheduledWakeup = (
  input: ScheduledWakeupInput,
  options: StubFactoryRunOptions = {}
): ScheduledWakeupOutput => {
  const clock = options.clock ?? (() => new Date());
  const logger =
    options.logger ?? createLogger({ service: "factory-worker", clock });
  const executedAt = clock().toISOString();
  const summary = `Scheduled wakeup executed ${input.workflow} (${input.scheduleName})`;

  logger.info("workflow.scheduled_wakeup_executed", {
    workflow: input.workflow,
    concurrencyKey: input.concurrencyKey,
    scheduleName: input.scheduleName,
    repositoryFullName: input.repositoryFullName,
    executedAt,
  });

  return {
    status: "completed",
    workflow: input.workflow,
    concurrencyKey: input.concurrencyKey,
    scheduleName: input.scheduleName,
    executedAt,
    summary,
  };
};

type HeartbeatRunner = <T>(
  refresher: TimeoutRefresher,
  target: { workflow: string; concurrencyKey: string },
  work: () => Promise<T>
) => Promise<T>;

const createHeartbeatRunner = (
  options: {
    heartbeatIntervalMs?: number;
    heartbeatIncrementBy?: HeartbeatDuration;
  },
  logger: Logger,
  event: string
): HeartbeatRunner => {
  const intervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const incrementBy =
    options.heartbeatIncrementBy ?? DEFAULT_HEARTBEAT_INCREMENT;

  return (refresher, target, work) =>
    withTimeoutHeartbeat(
      {
        refresher,
        intervalMs,
        incrementBy,
        onRefreshError: (error) => {
          logger.warn(event, {
            workflow: target.workflow,
            concurrencyKey: target.concurrencyKey,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
      work
    );
};

export const createFactoryRunTask = (
  hatchet?: Hatchet,
  options: FactoryRunTaskOptions = {}
) => {
  const clock = options.clock ?? (() => new Date());
  const logger =
    options.logger ?? createLogger({ service: "factory-worker", clock });
  const runWithHeartbeat = createHeartbeatRunner(
    options,
    logger,
    "workflow.heartbeat_refresh_failed"
  );
  const executeRun =
    options.executeRun ??
    (async (input: FactoryRunInput) =>
      executeStubFactoryRun(input, { clock, logger }));

  return CreateTaskWorkflow(
    {
      name: FACTORY_RUN_WORKFLOW_NAME,
      executionTimeout: FACTORY_EXECUTION_TIMEOUT,
      scheduleTimeout: FACTORY_SCHEDULE_TIMEOUT,
      concurrency: [
        {
          expression: "input.concurrencyKey",
          maxRuns: 1,
          limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
        },
      ],
      fn: async (input: FactoryRunInput, context) =>
        runWithHeartbeat(context, input, () => executeRun(input)),
    },
    hatchet
  );
};

export const createScheduledWakeupTask = (
  hatchet?: Hatchet,
  options: ScheduledWakeupTaskOptions = {}
) => {
  const clock = options.clock ?? (() => new Date());
  const logger =
    options.logger ?? createLogger({ service: "factory-worker", clock });
  const runWithHeartbeat = createHeartbeatRunner(
    options,
    logger,
    "workflow.wakeup_heartbeat_refresh_failed"
  );
  const cronExpression = validateCronExpression(
    options.cronExpression ?? SPEC_QUEUE_WAKEUP_CRON
  );
  const executeWakeup =
    options.executeWakeup ??
    (async (input: ScheduledWakeupInput) =>
      executeStubScheduledWakeup(input, { clock, logger }));

  return CreateTaskWorkflow(
    {
      name: FACTORY_WAKEUP_WORKFLOW_NAME,
      executionTimeout: FACTORY_EXECUTION_TIMEOUT,
      scheduleTimeout: FACTORY_SCHEDULE_TIMEOUT,
      onCrons: [cronExpression],
      concurrency: [
        {
          expression:
            "has(input.concurrencyKey) ? input.concurrencyKey : 'agent-implement-spec'",
          maxRuns: 1,
          limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
        },
      ],
      fn: async (input: Partial<ScheduledWakeupInput>, context) => {
        const normalized = normalizeWakeupInput(input);
        return runWithHeartbeat(context, normalized, () =>
          executeWakeup(normalized)
        );
      },
    },
    hatchet
  );
};
