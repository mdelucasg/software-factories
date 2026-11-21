import { z } from "zod";
import type { FactoryRunInput, FactoryWorkflowName } from "../shared/types.js";

const RepositorySchema = z.object({
  full_name: z.string().min(1),
  name: z.string().min(1),
  owner: z.object({
    login: z.string().min(1),
  }),
  clone_url: z.string().url(),
  default_branch: z.string().min(1).default("main"),
});

const BaseActionLabelSchema = z.object({
  action: z.string().optional(),
  label: z
    .object({
      name: z.string(),
    })
    .optional(),
});

const IssueLabeledPayloadSchema = z.object({
  action: z.literal("labeled"),
  label: z.object({
    name: z.string().min(1),
  }),
  issue: z.object({
    number: z.number().int().positive(),
    title: z.string(),
  }),
  repository: RepositorySchema,
});

const PullRequestLabeledPayloadSchema = z.object({
  action: z.literal("labeled"),
  label: z.object({
    name: z.string().min(1),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    title: z.string(),
    head: z.object({
      ref: z.string().min(1),
      sha: z.string().min(1),
    }),
    base: z.object({
      ref: z.string().min(1),
    }),
  }),
  repository: RepositorySchema,
});

export type RouteWebhookInput = {
  eventName: string | undefined;
  deliveryId: string;
  payload: unknown;
  receivedAt: string;
};

export type RouteWebhookResult =
  | { kind: "dispatch"; runInput: FactoryRunInput }
  | { kind: "ignore"; reason: string }
  | { kind: "invalid"; reason: string };

const ISSUE_LABEL_WORKFLOWS: Record<string, FactoryWorkflowName> = {
  "agent:explore": "agent-explore",
  "agent:implement": "agent-implement",
  "agent:implement-spec": "agent-implement-spec",
};

const PR_LABEL_WORKFLOWS: Record<string, FactoryWorkflowName> = {
  "agent:review": "agent-review",
};

const computeIssueConcurrencyKey = (
  workflow: FactoryWorkflowName,
  issueNumber: number
): string => {
  if (workflow === "agent-implement") {
    return `agent-implement-issue-${issueNumber}`;
  }
  return workflow;
};

const routeIssueEvent = (
  input: RouteWebhookInput,
  labelName: string
): RouteWebhookResult => {
  const workflow = ISSUE_LABEL_WORKFLOWS[labelName];
  if (!workflow) {
    return { kind: "ignore", reason: `unsupported_label:${labelName}` };
  }

  const parsed = IssueLabeledPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    return { kind: "invalid", reason: "invalid_issue_payload" };
  }

  const { issue, repository } = parsed.data;
  return {
    kind: "dispatch",
    runInput: {
      workflow,
      concurrencyKey: computeIssueConcurrencyKey(workflow, issue.number),
      deliveryId: input.deliveryId,
      repository: {
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        cloneUrl: repository.clone_url,
        defaultBranch: repository.default_branch,
      },
      subject: {
        kind: "issue",
        number: issue.number,
        title: issue.title,
        label: labelName,
      },
      receivedAt: input.receivedAt,
    },
  };
};

const routePullRequestEvent = (
  input: RouteWebhookInput,
  labelName: string
): RouteWebhookResult => {
  const workflow = PR_LABEL_WORKFLOWS[labelName];
  if (!workflow) {
    return { kind: "ignore", reason: `unsupported_label:${labelName}` };
  }

  const parsed = PullRequestLabeledPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    return { kind: "invalid", reason: "invalid_pull_request_payload" };
  }

  const { pull_request: pullRequest, repository } = parsed.data;
  return {
    kind: "dispatch",
    runInput: {
      workflow,
      concurrencyKey: `agent-review-pr-${pullRequest.number}`,
      deliveryId: input.deliveryId,
      repository: {
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        cloneUrl: repository.clone_url,
        defaultBranch: repository.default_branch,
      },
      subject: {
        kind: "pull_request",
        number: pullRequest.number,
        title: pullRequest.title,
        label: labelName,
        headRef: pullRequest.head.ref,
        headSha: pullRequest.head.sha,
        baseRef: pullRequest.base.ref,
      },
      receivedAt: input.receivedAt,
    },
  };
};

export const routeGitHubWebhookEvent = (
  input: RouteWebhookInput
): RouteWebhookResult => {
  if (input.eventName !== "issues" && input.eventName !== "pull_request") {
    return {
      kind: "ignore",
      reason: `unsupported_event:${input.eventName ?? "missing"}`,
    };
  }

  const envelope = BaseActionLabelSchema.safeParse(input.payload);
  if (!envelope.success) {
    return { kind: "invalid", reason: "invalid_webhook_envelope" };
  }

  if (envelope.data.action !== "labeled") {
    return {
      kind: "ignore",
      reason: `unsupported_action:${envelope.data.action ?? "missing"}`,
    };
  }

  const labelName = envelope.data.label?.name;
  if (!labelName) {
    return { kind: "invalid", reason: "missing_label_name" };
  }

  if (input.eventName === "issues") {
    return routeIssueEvent(input, labelName);
  }
  return routePullRequestEvent(input, labelName);
};
