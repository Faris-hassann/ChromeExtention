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

describe('Task completion', () => {
  it('does not report done solely because a tool returned success', async () => {
    contract('tool success != goal success');
  });

  it('verifies final URL/page state for an open-site task', async () => {
    contract('navigation completion verification');
  });

  it('verifies final visible success/state for a record update', async () => {
    contract('mutation completion verification');
  });

  it('reports uncertainty/user-review requirement if the requested outcome cannot be verified', async () => {
    contract('honest unverifiable completion');
  });

});
