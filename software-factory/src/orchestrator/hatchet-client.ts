import { Hatchet } from "@hatchet-dev/typescript-sdk";
import type { HatchetConnectionConfig } from "../shared/config.js";
import type { FactoryRunInput } from "../shared/types.js";
import type { HatchetCronClient } from "./crons.js";
import type { WorkflowDispatcher } from "./ports.js";
import { FACTORY_RUN_WORKFLOW_NAME } from "./workflows.js";

export type HatchetRunRefLike = {
  getWorkflowRunId: () => Promise<string>;
};

export type HatchetRunTrigger = {
  runNoWait: (
    workflowName: string,
    input: FactoryRunInput
  ) => Promise<HatchetRunRefLike>;
};

export const createHatchetClient = (config: HatchetConnectionConfig): Hatchet =>
  Hatchet.init({
    token: config.hatchetClientToken,
    host_port: config.hatchetHostPort,
    tls_config: {
      tls_strategy: config.hatchetTlsStrategy,
    },
  });

export const createHatchetDispatcher = (
  runner: HatchetRunTrigger
): WorkflowDispatcher => ({
  dispatch: async (input) => {
    const runRef = await runner.runNoWait(FACTORY_RUN_WORKFLOW_NAME, input);
    const runId = await runRef.getWorkflowRunId();
    return { runId };
  },
});

export const createHatchetCronClient = (
  hatchet: Hatchet
): HatchetCronClient => ({
  list: async (query) => hatchet.crons.list(query),
  create: async (workflow, cron) => hatchet.crons.create(workflow, cron),
});
