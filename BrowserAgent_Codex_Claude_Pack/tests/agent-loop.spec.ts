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

describe('Agent loop', () => {
  it('automatically observes after every meaningful action before allowing the next action', async () => {
    contract('observe -> act -> fresh observe -> next decision invariant');
  });

  it('allows read-only/non-meaningful runtime bookkeeping without falsely advancing browser steps', async () => {
    contract('meaningful action classification');
  });

  it('creates a high-level plan but chooses concrete actions from the latest observation', async () => {
    contract('dynamic action planning');
  });

  it('pauses at the configured maximum step limit instead of looping forever', async () => {
    contract('max agent steps');
  });

  it('does not expose raw chain-of-thought in user-facing activity', async () => {
    contract('concise activity only');
  });

});
