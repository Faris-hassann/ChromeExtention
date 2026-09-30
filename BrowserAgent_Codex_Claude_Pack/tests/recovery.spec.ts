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

describe('Recovery', () => {
  it('re-observes after an action target disappears', async () => {
    contract('stale/disappeared target recovery');
  });

  it('checks whether the step already succeeded before retrying', async () => {
    contract('success despite reported error');
  });

  it('bounds recovery cycles at the configured default', async () => {
    contract('bounded recovery');
  });

  it('does not blindly retry stale selectors or coordinates', async () => {
    contract('no blind retry');
  });

});
