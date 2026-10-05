import { describe, expect, it } from 'vitest';
import { PolicyEngine } from './policy.js';

describe('PolicyEngine', () => {
  it('allows normal actions and form submission without one-off approval in always mode', () => {
    const policy = new PolicyEngine();
    expect(policy.evaluate('https://example.test/', { name: 'click', risk: 'MEDIUM', capability: 'interact', meaningful: true }, 'always')).toEqual({ allowed: true, approval: false });
    expect(policy.evaluate('https://example.test/', { name: 'submit_form', risk: 'HIGH', capability: 'submit', meaningful: true }, 'always')).toEqual({ allowed: true, approval: false });
    policy.addRule({ id: 'blocked', scope: 'example.test', capabilities: ['interact'], duration: 'session', effect: 'block' });
    expect(policy.evaluate('https://example.test/', { name: 'click', risk: 'MEDIUM', capability: 'interact', meaningful: true }, 'always')).toMatchObject({ allowed: false, approval: false });
  });
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
