import { describe, expect, it } from 'vitest';
import { PolicyEngine } from './policy.js';

describe('PolicyEngine', () => {
  it('never lets the model bypass approval for high-risk actions', () => {
    const policy = new PolicyEngine();
    policy.addRule({ id: 'allowed', scope: 'example.test', capabilities: ['submit'], duration: 'persistent', effect: 'allow' });
    expect(policy.evaluate('https://example.test/form', { name: 'submit_form', risk: 'HIGH', capability: 'submit', meaningful: true }).approval).toBe(true);
  });
  it('blocks a denied capability', () => {
    const policy = new PolicyEngine(); policy.addRule({ id: 'blocked', scope: 'example.test', capabilities: ['interact'], duration: 'session', effect: 'block' });
    expect(policy.evaluate('https://example.test/', { name: 'click', risk: 'MEDIUM', capability: 'interact', meaningful: true })).toMatchObject({ allowed: false, approval: false });
  });
});
