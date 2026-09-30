export interface ReusableWorkflow {
  name: string;
  version: 1;
  description?: string;
  inputs: string[];
  sites?: string[];
  goals: string[];
  mappings?: Array<{ source: string; target: string }>;
  approvalRules?: unknown[];
}

export const CURRENT_WORKFLOW_VERSION = 1 as const;
