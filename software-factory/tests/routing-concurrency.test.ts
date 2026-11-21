import { ConcurrencyLimitStrategy } from "@hatchet-dev/typescript-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDefaultFactoryCrons,
  FACTORY_WAKEUP_WORKFLOW_NAME,
  type HatchetCronClient,
  registerFactoryCrons,
  SPEC_QUEUE_WAKEUP_CRON,
} from "../src/orchestrator/crons.js";
import {
  DEFAULT_HEARTBEAT_INCREMENT,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  withTimeoutHeartbeat,
} from "../src/orchestrator/heartbeat.js";
import {
  createFactoryRunTask,
  createScheduledWakeupTask,
  FACTORY_EXECUTION_TIMEOUT,
  FACTORY_RUN_WORKFLOW_NAME,
  FACTORY_SCHEDULE_TIMEOUT,
} from "../src/orchestrator/workflows.js";
import { createLogger } from "../src/shared/logger.js";
import type { FactoryRunInput } from "../src/shared/types.js";
import {
  deriveConcurrencyKey,
  routeGitHubWebhookEvent,
} from "../src/webhook/route-event.js";

const SAMPLE_REPOSITORY = {
  full_name: "mdelucasg/software-factories",
  name: "software-factories",
  owner: { login: "mdelucasg" },
  clone_url: "https://github.com/mdelucasg/software-factories.git",
  default_branch: "main",
};

const RECEIVED_AT = "2026-11-21T06:00:00.000Z";

describe("Label routing and deterministic concurrency key derivation", () => {
  it("routes all supported issue and pull request label triggers to deterministic concurrency keys", () => {
    const exploreResult = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-explore",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "agent:explore" },
        issue: { number: 12, title: "Explore backlog" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(exploreResult).toMatchObject({
      kind: "dispatch",
      runInput: {
        workflow: "agent-explore",
        concurrencyKey: "agent-explore",
      },
    });

    const implementResult = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-implement",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "agent:implement" },
        issue: { number: 29, title: "GitHub App auth" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(implementResult).toMatchObject({
      kind: "dispatch",
      runInput: {
        workflow: "agent-implement",
        concurrencyKey: "agent-implement-issue-29",
      },
    });

    const specResult = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-spec",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "agent:implement-spec" },
        issue: { number: 27, title: "Factory spec" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(specResult).toMatchObject({
      kind: "dispatch",
      runInput: {
        workflow: "agent-implement-spec",
        concurrencyKey: "agent-implement-spec",
      },
    });

    const reviewResult = routeGitHubWebhookEvent({
      eventName: "pull_request",
      deliveryId: "del-review",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "agent:review" },
        pull_request: {
          number: 44,
          title: "Implement #29",
          head: { ref: "feat/ticket-29", sha: "deadbeef1234" },
          base: { ref: "feat/self-hosted-software-factory" },
        },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(reviewResult).toMatchObject({
      kind: "dispatch",
      runInput: {
        workflow: "agent-review",
        concurrencyKey: "agent-review-pr-44",
      },
    });

    expect(deriveConcurrencyKey("agent-explore", 99)).toBe("agent-explore");
    expect(deriveConcurrencyKey("agent-implement", 99)).toBe(
      "agent-implement-issue-99"
    );
    expect(deriveConcurrencyKey("agent-implement-spec", 99)).toBe(
      "agent-implement-spec"
    );
    expect(deriveConcurrencyKey("agent-review", 99)).toBe("agent-review-pr-99");
  });

  it("ignores PR-backed issues events, prototype property label names, and unrelated triggers cleanly", () => {
    const prBackedIssue = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-pr-as-issue",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "agent:implement" },
        issue: {
          number: 44,
          title: "PR surfaced in issues hook",
          pull_request: { url: "https://api.github.com/repos/o/r/pulls/44" },
        },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(prBackedIssue).toEqual({
      kind: "ignore",
      reason: "issue_is_pull_request",
    });

    const protoLabel = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-proto",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "constructor" },
        issue: { number: 1, title: "Prototype label" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(protoLabel).toEqual({
      kind: "ignore",
      reason: "unsupported_label:constructor",
    });

    const unlabeled = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-unlabeled",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "unlabeled",
        label: { name: "agent:implement" },
        issue: { number: 29, title: "Removed label" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(unlabeled).toEqual({
      kind: "ignore",
      reason: "unsupported_action:unlabeled",
    });

    const statusLabel = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-status",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "needs-a-human" },
        issue: { number: 29, title: "Status label" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(statusLabel).toEqual({
      kind: "ignore",
      reason: "unsupported_label:needs-a-human",
    });

    const crossWiredReview = routeGitHubWebhookEvent({
      eventName: "issues",
      deliveryId: "del-cross",
      receivedAt: RECEIVED_AT,
      payload: {
        action: "labeled",
        label: { name: "agent:review" },
        issue: { number: 29, title: "Review on issue" },
        repository: SAMPLE_REPOSITORY,
      },
    });
    expect(crossWiredReview).toEqual({
      kind: "ignore",
      reason: "unsupported_label:agent:review",
    });
  });
});

describe("Periodic timeout refresh heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the task timeout periodically during long-running work and stops once finished", async () => {
    vi.useFakeTimers();
    const increments: string[] = [];
    let releaseWork: (() => void) | undefined;

    const runPromise = withTimeoutHeartbeat(
      {
        refresher: {
          refreshTimeout: async (incrementBy) => {
            increments.push(incrementBy);
          },
        },
      },
      () =>
        new Promise<string>((resolve) => {
          releaseWork = () => resolve("done");
        })
    );

    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 2 + 100);
    expect(increments).toEqual([
      DEFAULT_HEARTBEAT_INCREMENT,
      DEFAULT_HEARTBEAT_INCREMENT,
    ]);

    releaseWork?.();
    await expect(runPromise).resolves.toBe("done");

    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    expect(increments).toHaveLength(2);
  });

  it("clears the heartbeat timer when work rejects, skips overlapping refreshes, and reports refresh errors safely", async () => {
    vi.useFakeTimers();
    const recordedErrors: unknown[] = [];
    let activeRefreshResolve: (() => void) | undefined;
    let refreshAttempts = 0;
    let failWork: ((error: Error) => void) | undefined;

    const runPromise = withTimeoutHeartbeat(
      {
        intervalMs: 1000,
        incrementBy: "5m",
        refresher: {
          refreshTimeout: () => {
            refreshAttempts += 1;
            if (refreshAttempts === 1) {
              return new Promise<void>((resolve) => {
                activeRefreshResolve = resolve;
              });
            }
            return Promise.reject(new Error("transient gRPC timeout"));
          },
        },
        onRefreshError: (error) => {
          recordedErrors.push(error);
        },
      },
      () =>
        new Promise<void>((_resolve, reject) => {
          failWork = reject;
        })
    );

    await vi.advanceTimersByTimeAsync(2500);
    expect(refreshAttempts).toBe(1);

    activeRefreshResolve?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshAttempts).toBe(2);
    expect(recordedErrors).toHaveLength(1);

    const failure = new Error("sandbox failed");
    const caught = runPromise.catch((error: unknown) => error);
    failWork?.(failure);
    await expect(caught).resolves.toBe(failure);

    await vi.advanceTimersByTimeAsync(5000);
    expect(refreshAttempts).toBe(2);
  });
});

describe("Native Hatchet cron schedule registration", () => {
  it("builds default 15-minute spec wakeup schedule and registers crons idempotently", async () => {
    const definitions = buildDefaultFactoryCrons({
      repositoryFullName: "mdelucasg/software-factories",
    });

    expect(definitions).toEqual([
      {
        name: "factory-spec-queue-wakeup",
        workflowName: FACTORY_WAKEUP_WORKFLOW_NAME,
        expression: SPEC_QUEUE_WAKEUP_CRON,
        input: {
          workflow: "agent-implement-spec",
          concurrencyKey: "agent-implement-spec",
          trigger: "cron",
          scheduleName: "factory-spec-queue-wakeup",
          repositoryFullName: "mdelucasg/software-factories",
        },
        additionalMetadata: {
          source: "software-factory",
          workflow: "agent-implement-spec",
        },
      },
    ]);

    const stored: Array<{
      workflow: string;
      name: string;
      cron: string;
      input?: Record<string, unknown>;
    }> = [];

    const cronClient: HatchetCronClient = {
      list: async (query) => ({
        rows: stored.filter(
          (entry) => !query.workflow || entry.workflow === query.workflow
        ),
      }),
      create: async (workflow, cron) => {
        stored.push({
          workflow,
          name: cron.name,
          cron: cron.expression,
          input: cron.input,
        });
      },
    };

    const firstPass = await registerFactoryCrons(cronClient, definitions);
    expect(firstPass).toEqual({
      created: ["factory-spec-queue-wakeup"],
      skipped: [],
    });
    expect(stored).toHaveLength(1);

    const secondPass = await registerFactoryCrons(cronClient, definitions);
    expect(secondPass).toEqual({
      created: [],
      skipped: ["factory-spec-queue-wakeup"],
    });
    expect(stored).toHaveLength(1);
  });

  it("rejects malformed cron expressions", () => {
    expect(() =>
      buildDefaultFactoryCrons({ specWakeupExpression: "not-a-cron" })
    ).toThrow(/cron/i);
  });
});

describe("Hatchet workflow definitions, concurrency locks, and heartbeat wiring", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const sampleRunInput: FactoryRunInput = {
    workflow: "agent-implement",
    concurrencyKey: "agent-implement-issue-29",
    deliveryId: "del-29",
    repository: {
      owner: "mdelucasg",
      name: "software-factories",
      fullName: "mdelucasg/software-factories",
      cloneUrl: "https://github.com/mdelucasg/software-factories.git",
      defaultBranch: "main",
    },
    subject: {
      kind: "issue",
      number: 29,
      title: "GitHub App authentication",
      label: "agent:implement",
    },
    receivedAt: RECEIVED_AT,
  };

  it("configures factory-run with 60m executionTimeout, GROUP_ROUND_ROBIN concurrency, and active heartbeat", async () => {
    vi.useFakeTimers();
    const fixedClock = () => new Date("2026-11-21T06:05:00.000Z");
    const refreshCalls: string[] = [];
    let finishRun: (() => void) | undefined;

    const factoryTask = createFactoryRunTask(undefined, {
      clock: fixedClock,
      logger: createLogger({
        service: "factory-worker-test",
        clock: fixedClock,
        write: () => {},
      }),
      heartbeatIntervalMs: 1000,
      heartbeatIncrementBy: "10m",
      executeRun: async (input) => {
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return {
          status: "completed",
          workflow: input.workflow,
          concurrencyKey: input.concurrencyKey,
          deliveryId: input.deliveryId,
          executedAt: fixedClock().toISOString(),
          summary: `Executed ${input.workflow}`,
        };
      },
    });

    expect(factoryTask.name).toBe(FACTORY_RUN_WORKFLOW_NAME);
    expect(factoryTask.taskDef.executionTimeout).toBe(
      FACTORY_EXECUTION_TIMEOUT
    );
    expect(factoryTask.taskDef.executionTimeout).toBe("60m");
    expect(factoryTask.taskDef.scheduleTimeout).toBe(FACTORY_SCHEDULE_TIMEOUT);
    expect(factoryTask.taskDef.concurrency).toEqual([
      {
        expression: "input.concurrencyKey",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
    ]);

    const taskHandler = factoryTask.taskDef.fn;
    expect(taskHandler).toBeDefined();
    if (!taskHandler) {
      throw new Error("Expected task handler to be defined");
    }

    const fakeContext = {
      refreshTimeout: async (incrementBy: string) => {
        refreshCalls.push(incrementBy);
      },
    };
    const executionPromise = taskHandler(sampleRunInput, fakeContext as never);

    await vi.advanceTimersByTimeAsync(2500);
    expect(refreshCalls).toEqual(["10m", "10m"]);

    finishRun?.();
    await expect(executionPromise).resolves.toEqual({
      status: "completed",
      workflow: "agent-implement",
      concurrencyKey: "agent-implement-issue-29",
      deliveryId: "del-29",
      executedAt: "2026-11-21T06:05:00.000Z",
      summary: "Executed agent-implement",
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(refreshCalls).toHaveLength(2);
  });

  it("configures factory-scheduled-wakeup with native Hatchet onCrons, 60m timeout, and GROUP_ROUND_ROBIN concurrency", async () => {
    const fixedClock = () => new Date("2026-11-21T06:15:00.000Z");
    const wakeupTask = createScheduledWakeupTask(undefined, {
      clock: fixedClock,
      logger: createLogger({
        service: "factory-worker-test",
        clock: fixedClock,
        write: () => {},
      }),
    });

    expect(wakeupTask.name).toBe(FACTORY_WAKEUP_WORKFLOW_NAME);
    expect(wakeupTask.definition.onCrons).toEqual([SPEC_QUEUE_WAKEUP_CRON]);
    expect(wakeupTask.taskDef.executionTimeout).toBe("60m");
    expect(wakeupTask.taskDef.concurrency).toEqual([
      {
        expression:
          "has(input.concurrencyKey) ? input.concurrencyKey : 'agent-implement-spec'",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
    ]);

    const taskHandler = wakeupTask.taskDef.fn;
    expect(taskHandler).toBeDefined();
    if (!taskHandler) {
      throw new Error("Expected wakeup handler to be defined");
    }

    const fakeContext = {
      refreshTimeout: async () => {},
    };
    const output = await taskHandler({}, fakeContext as never);

    expect(output).toEqual({
      status: "completed",
      workflow: "agent-implement-spec",
      concurrencyKey: "agent-implement-spec",
      scheduleName: "factory-spec-queue-wakeup",
      executedAt: "2026-11-21T06:15:00.000Z",
      summary:
        "Scheduled wakeup executed agent-implement-spec (factory-spec-queue-wakeup)",
    });
  });
});
