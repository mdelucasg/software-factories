export type Clock = () => Date;

export type FactoryWorkflowName =
  | "agent-explore"
  | "agent-implement"
  | "agent-implement-spec"
  | "agent-review";

export type TriggerSubjectKind = "issue" | "pull_request";

export type FactoryRunInput = {
  workflow: FactoryWorkflowName;
  concurrencyKey: string;
  deliveryId: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
    cloneUrl: string;
    defaultBranch: string;
  };
  subject: {
    kind: TriggerSubjectKind;
    number: number;
    title: string;
    label: string;
    headRef?: string;
    headSha?: string;
    baseRef?: string;
  };
  receivedAt: string;
};

export type FactoryRunOutput = {
  status: "completed" | "failed";
  workflow: FactoryWorkflowName;
  concurrencyKey: string;
  deliveryId: string;
  executedAt: string;
  summary: string;
};

export type ScheduledWakeupInput = {
  workflow: FactoryWorkflowName;
  concurrencyKey: string;
  trigger: "cron";
  scheduleName: string;
  repositoryFullName?: string;
};

export type ScheduledWakeupOutput = {
  status: "completed" | "failed";
  workflow: FactoryWorkflowName;
  concurrencyKey: string;
  scheduleName: string;
  executedAt: string;
  summary: string;
};
