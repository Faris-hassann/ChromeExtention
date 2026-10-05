import { defaults, type Settings } from '../shared/types';
const ALLOWED_KEYS = ['settings', 'sitePermissions', 'workflows', 'uiPreferences'] as const;
export async function loadSettings(): Promise<Settings> { const data = await chrome.storage.local.get('settings'); const saved = data.settings as Partial<Settings> | undefined; const settings = { ...defaults, ...(saved ?? {}) }; if (saved?.approvalPolicyVersion !== 2 && settings.approvalMode === 'auto') settings.approvalMode = 'always'; settings.approvalPolicyVersion = 2; return settings; }
export async function saveSettings(settings: Settings) { await chrome.storage.local.set({ settings }); }
export const allowedPersistentKeys = [...ALLOWED_KEYS];
export function validateWorkflow(value: unknown) { const w = value as any; return !!w && w.version === 1 && typeof w.name === 'string' && Array.isArray(w.inputs) && Array.isArray(w.goals) && !JSON.stringify(w).match(/selector|xpath/i); }
