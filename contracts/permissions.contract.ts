import type { RiskLevel } from './browser-tools.contract';

export type PermissionDuration = 'once' | 'session' | 'persistent';
export type PermissionEffect = 'allow' | 'block';

export type SiteCapability =
  | 'read_page'
  | 'extract_data'
  | 'screenshot'
  | 'navigate'
  | 'interact'
  | 'file_transfer'
  | 'submit';

export interface SitePermissionRule {
  id: string;
  scope: string;
  capabilities: SiteCapability[];
  duration: PermissionDuration;
  effect: PermissionEffect;
}

export interface ApprovalRequest {
  taskId: string;
  toolCallId: string;
  site: string;
  risk: RiskLevel;
  actionSummary: string;
  changeSummary?: unknown;
}
