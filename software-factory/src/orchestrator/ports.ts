import type { FactoryRunInput } from "../shared/types.js";

export type DispatchResult = {
  runId: string;
};

export type WorkflowDispatcher = {
  dispatch: (input: FactoryRunInput) => Promise<DispatchResult>;
};
