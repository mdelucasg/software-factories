import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHatchetDispatcher,
  type HatchetRunTrigger,
} from "../src/orchestrator/hatchet-client.js";
import type { WorkflowDispatcher } from "../src/orchestrator/ports.js";
import {
  executeStubFactoryRun,
  FACTORY_RUN_WORKFLOW_NAME,
} from "../src/orchestrator/workflows.js";
import { loadGatewayConfig, loadWorkerConfig } from "../src/shared/config.js";
import { createLogger } from "../src/shared/logger.js";
import type { FactoryRunInput } from "../src/shared/types.js";
import { createWebhookServer } from "../src/webhook/server.js";

const WEBHOOK_SECRET = "test-webhook-secret-value";

const signPayload = (body: string, secret = WEBHOOK_SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const SAMPLE_REPOSITORY = {
  full_name: "mdelucasg/software-factories",
  name: "software-factories",
  owner: { login: "mdelucasg" },
  clone_url: "https://github.com/mdelucasg/software-factories.git",
  default_branch: "main",
};

const makeIssueLabeledPayload = (labelName: string, issueNumber = 28) =>
  JSON.stringify({
    action: "labeled",
    label: { name: labelName },
    issue: { number: issueNumber, title: "Walking skeleton" },
    repository: SAMPLE_REPOSITORY,
  });

const makePullRequestLabeledPayload = (labelName: string, prNumber = 42) =>
  JSON.stringify({
    action: "labeled",
    label: { name: labelName },
    pull_request: {
      number: prNumber,
      title: "Add walking skeleton",
      head: { ref: "feat/ticket-28", sha: "abc123def456" },
      base: { ref: "main" },
    },
    repository: SAMPLE_REPOSITORY,
  });

const createFakeDispatcher = (): {
  dispatcher: WorkflowDispatcher;
  dispatched: FactoryRunInput[];
} => {
  const dispatched: FactoryRunInput[] = [];
  const dispatcher: WorkflowDispatcher = {
    dispatch: async (input) => {
      dispatched.push(input);
      return { runId: `run-${dispatched.length}` };
    },
  };
  return { dispatcher, dispatched };
};

describe("Webhook Gateway HTTP boundary", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = undefined;
    }
  });

  const startTestServer = async (dispatcher?: WorkflowDispatcher) => {
    const fake = createFakeDispatcher();
    const activeDispatcher = dispatcher ?? fake.dispatcher;
    const clock = () => new Date("2026-11-21T05:00:00.000Z");
    const server = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      dispatcher: activeDispatcher,
      clock,
      logger: createLogger({
        service: "webhook-gateway-test",
        clock,
        write: () => {},
      }),
    });
    const address = await server.listen(0, "127.0.0.1");
    closeServer = () => server.close();
    return {
      baseUrl: `http://${address.host}:${address.port}`,
      dispatched: fake.dispatched,
    };
  };

  it("responds with 200 ok on GET /healthz", async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("rejects POST /webhooks/github with 401 when X-Hub-Signature-256 is missing", async () => {
    const { baseUrl, dispatched } = await startTestServer();

    const response = await fetch(`${baseUrl}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": "delivery-missing-sig",
      },
      body: JSON.stringify({ action: "labeled" }),
    });

    expect(response.status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("rejects POST /webhooks/github with 401 when signature is wrong or malformed without leaking secrets", async () => {
    const { baseUrl, dispatched } = await startTestServer();
    const body = JSON.stringify({ action: "labeled" });
    const badSignatures = [
      signPayload(body, "wrong-secret"),
      "sha1=deadbeef",
      "sha256=short",
      signPayload(`${body} `),
    ];

    for (const signature of badSignatures) {
      const response = await fetch(`${baseUrl}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "issues",
          "x-github-delivery": "delivery-bad-sig",
          "x-hub-signature-256": signature,
        },
        body,
      });

      const responseText = await response.text();
      expect(response.status).toBe(401);
      expect(responseText).not.toContain(WEBHOOK_SECRET);
      expect(responseText).not.toContain("sha256=");
    }

    expect(dispatched).toHaveLength(0);
  });

  it("dispatches supported issues labeled events to the injected WorkflowDispatcher", async () => {
    const { baseUrl, dispatched } = await startTestServer();
    const body = makeIssueLabeledPayload("agent:implement", 28);

    const response = await fetch(`${baseUrl}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": "delivery-issue-28",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "dispatched",
      runId: "run-1",
      workflow: "agent-implement",
      concurrencyKey: "agent-implement-issue-28",
    });
    expect(dispatched).toEqual([
      {
        workflow: "agent-implement",
        concurrencyKey: "agent-implement-issue-28",
        deliveryId: "delivery-issue-28",
        repository: {
          owner: "mdelucasg",
          name: "software-factories",
          fullName: "mdelucasg/software-factories",
          cloneUrl: "https://github.com/mdelucasg/software-factories.git",
          defaultBranch: "main",
        },
        subject: {
          kind: "issue",
          number: 28,
          title: "Walking skeleton",
          label: "agent:implement",
        },
        receivedAt: "2026-11-21T05:00:00.000Z",
      },
    ]);
  });

  it("routes agent:explore, agent:implement-spec, and pull_request agent:review events with deterministic concurrency keys", async () => {
    const { baseUrl, dispatched } = await startTestServer();

    const cases = [
      {
        event: "issues",
        delivery: "del-explore",
        body: makeIssueLabeledPayload("agent:explore", 10),
        expectedWorkflow: "agent-explore",
        expectedKey: "agent-explore",
      },
      {
        event: "issues",
        delivery: "del-spec",
        body: makeIssueLabeledPayload("agent:implement-spec", 27),
        expectedWorkflow: "agent-implement-spec",
        expectedKey: "agent-implement-spec",
      },
      {
        event: "pull_request",
        delivery: "del-review",
        body: makePullRequestLabeledPayload("agent:review", 42),
        expectedWorkflow: "agent-review",
        expectedKey: "agent-review-pr-42",
      },
    ];

    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": testCase.event,
          "x-github-delivery": testCase.delivery,
          "x-hub-signature-256": signPayload(testCase.body),
        },
        body: testCase.body,
      });

      expect(response.status).toBe(202);
      const result = (await response.json()) as Record<string, unknown>;
      expect(result.workflow).toBe(testCase.expectedWorkflow);
      expect(result.concurrencyKey).toBe(testCase.expectedKey);
    }

    expect(dispatched).toHaveLength(3);
    expect(dispatched[2]?.subject).toEqual({
      kind: "pull_request",
      number: 42,
      title: "Add walking skeleton",
      label: "agent:review",
      headRef: "feat/ticket-28",
      headSha: "abc123def456",
      baseRef: "main",
    });
  });

  it("acknowledges and ignores validly signed unsupported events, actions, and labels", async () => {
    const { baseUrl, dispatched } = await startTestServer();
    const ignoredCases = [
      {
        event: "ping",
        body: JSON.stringify({ zen: "Keep it logically awesome." }),
      },
      { event: "push", body: JSON.stringify({ ref: "refs/heads/main" }) },
      {
        event: "issues",
        body: JSON.stringify({
          action: "opened",
          issue: { number: 1, title: "New" },
          repository: SAMPLE_REPOSITORY,
        }),
      },
      { event: "issues", body: makeIssueLabeledPayload("bug", 5) },
      {
        event: "pull_request",
        body: makePullRequestLabeledPayload("agent:implement", 9),
      },
    ];

    for (const ignoredCase of ignoredCases) {
      const response = await fetch(`${baseUrl}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": ignoredCase.event,
          "x-github-delivery": `del-ignored-${ignoredCase.event}`,
          "x-hub-signature-256": signPayload(ignoredCase.body),
        },
        body: ignoredCase.body,
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe("ignored");
    }

    expect(dispatched).toHaveLength(0);
  });

  it("returns 400 for validly signed malformed JSON or invalid supported payload", async () => {
    const { baseUrl, dispatched } = await startTestServer();
    const malformedBodies = [
      "{not-json",
      JSON.stringify({
        action: "labeled",
        label: { name: "agent:implement" },
      }),
    ];

    for (const body of malformedBodies) {
      const response = await fetch(`${baseUrl}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "issues",
          "x-github-delivery": "del-bad-payload",
          "x-hub-signature-256": signPayload(body),
        },
        body,
      });

      expect(response.status).toBe(400);
    }

    expect(dispatched).toHaveLength(0);
  });

  it("returns 502 when the WorkflowDispatcher fails", async () => {
    const failingDispatcher: WorkflowDispatcher = {
      dispatch: async () => {
        throw new Error("Hatchet gRPC unavailable");
      },
    };
    const { baseUrl } = await startTestServer(failingDispatcher);
    const body = makeIssueLabeledPayload("agent:implement", 28);

    const response = await fetch(`${baseUrl}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": "del-fail",
        "x-hub-signature-256": signPayload(body),
      },
      body,
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to dispatch workflow",
    });
  });

  it("returns 404 for unknown routes", async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/unknown`);

    expect(response.status).toBe(404);
  });
});

describe("Hatchet dispatcher adapter and stub workflow", () => {
  const sampleRunInput: FactoryRunInput = {
    workflow: "agent-implement",
    concurrencyKey: "agent-implement-issue-28",
    deliveryId: "delivery-28",
    repository: {
      owner: "mdelucasg",
      name: "software-factories",
      fullName: "mdelucasg/software-factories",
      cloneUrl: "https://github.com/mdelucasg/software-factories.git",
      defaultBranch: "main",
    },
    subject: {
      kind: "issue",
      number: 28,
      title: "Walking skeleton",
      label: "agent:implement",
    },
    receivedAt: "2026-11-21T05:00:00.000Z",
  };

  it("dispatches FactoryRunInput to Hatchet runNoWait and returns the workflow run id", async () => {
    const calls: Array<{ workflowName: string; input: FactoryRunInput }> = [];
    const runner: HatchetRunTrigger = {
      runNoWait: async (workflowName, input) => {
        calls.push({ workflowName, input });
        return {
          getWorkflowRunId: async () => "hatchet-run-uuid-001",
        };
      },
    };

    const dispatcher = createHatchetDispatcher(runner);
    const result = await dispatcher.dispatch(sampleRunInput);

    expect(result).toEqual({ runId: "hatchet-run-uuid-001" });
    expect(calls).toEqual([
      { workflowName: FACTORY_RUN_WORKFLOW_NAME, input: sampleRunInput },
    ]);
  });

  it("executes the stub factory run deterministically using the injected clock", () => {
    const clock = () => new Date("2026-11-21T05:01:30.000Z");
    const output = executeStubFactoryRun(sampleRunInput, {
      clock,
      logger: createLogger({
        service: "factory-worker-test",
        clock,
        write: () => {},
      }),
    });

    expect(output).toEqual({
      status: "completed",
      workflow: "agent-implement",
      concurrencyKey: "agent-implement-issue-28",
      deliveryId: "delivery-28",
      executedAt: "2026-11-21T05:01:30.000Z",
      summary:
        "Stub executed agent-implement for mdelucasg/software-factories#28",
    });
  });
});

describe("Environment configuration loading", () => {
  it("loads gateway config from env and falls back to HATCHET_CLIENT_TOKEN_FILE when env token is empty", () => {
    const config = loadGatewayConfig(
      {
        WEBHOOK_PORT: "3005",
        GITHUB_WEBHOOK_SECRET: "super-secret",
        HATCHET_CLIENT_TOKEN: "",
        HATCHET_CLIENT_TOKEN_FILE: "/shared/hatchet.token",
        HATCHET_CLIENT_HOST_PORT: "hatchet-lite:7077",
        HATCHET_CLIENT_TLS_STRATEGY: "none",
      },
      (filePath) => {
        expect(filePath).toBe("/shared/hatchet.token");
        return "jwt-from-shared-volume\n";
      }
    );

    expect(config).toEqual({
      webhookPort: 3005,
      githubWebhookSecret: "super-secret",
      hatchetClientToken: "jwt-from-shared-volume",
      hatchetHostPort: "hatchet-lite:7077",
      hatchetTlsStrategy: "none",
    });
  });

  it("rejects worker config when no Hatchet client token is available", () => {
    expect(() =>
      loadWorkerConfig(
        {
          HATCHET_CLIENT_HOST_PORT: "hatchet-lite:7077",
        },
        () => ""
      )
    ).toThrow(/HATCHET_CLIENT_TOKEN/);
  });
});
