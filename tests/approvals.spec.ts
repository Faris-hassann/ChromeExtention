/**
 * Local Browser Agent executable contract test.
 *
 * MUST be wired to the real implementation.
 * Do not skip/delete required scenarios. Replace `contract()` with real setup/assertions.
 */

const contract = (scenario: string): never => {
  throw new Error(
    `CONTRACT TEST NOT WIRED: ${scenario}. Wire this scenario before declaring the project finished.`,
  );
};

describe('Permissions and approvals', () => {
  it('supports allow once', async () => {
    contract('allow once');
  });

  it('supports allow for session', async () => {
    contract('allow for session');
  });

  it('supports always allow for website', async () => {
    contract('persistent site permission');
  });

  it('supports blocking a site', async () => {
    contract('block site');
  });

  it('enforces capability-level permissions', async () => {
    contract('granular capability policy');
  });

  it('requires appropriate approval for HIGH and CRITICAL actions regardless of model request', async () => {
    contract('risk-enforced approval');
  });

});
