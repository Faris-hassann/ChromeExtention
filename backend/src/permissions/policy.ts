import type { PermissionRule, ToolDefinition } from '../types.js';

export class PolicyEngine {
  private rules: PermissionRule[] = [];
  addRule(rule: PermissionRule) { this.rules = this.rules.filter(r => r.id !== rule.id).concat(rule); }
  clearSession() { this.rules = this.rules.filter(r => r.duration === 'persistent'); }
  evaluate(url: string, tool: ToolDefinition, mode: 'manual' | 'auto' | 'always' = 'auto') {
    const host = safeHost(url);
    const matching = this.rules.filter(r => scopeMatches(r.scope, url, host) && r.capabilities.includes(tool.capability));
    if (matching.some(r => r.effect === 'block')) return { allowed: false, approval: false, reason: 'Site or capability is blocked' };
    if (tool.risk === 'CRITICAL') return { allowed: false, approval: true, reason: 'Critical action requires explicit approval' };
    if (mode === 'always') return { allowed: true, approval: false };
    if (tool.risk === 'HIGH') return { allowed: false, approval: true, reason: 'High-risk action requires approval' };
    if (matching.some(r => r.effect === 'allow')) return { allowed: true, approval: false };
    if (mode === 'manual' || tool.risk === 'MEDIUM') return { allowed: false, approval: true, reason: 'Permission required' };
    return { allowed: true, approval: false };
  }
}
const safeHost = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
const scopeMatches = (scope: string, url: string, host: string) => scope === url || scope === host || (scope.startsWith('*.') && host.endsWith(scope.slice(1)));
