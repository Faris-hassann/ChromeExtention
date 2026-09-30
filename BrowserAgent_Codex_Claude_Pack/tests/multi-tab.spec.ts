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

describe('Multi-tab workflows', () => {
  it('detects a newly opened tab and reports it before the next agent decision', async () => {
    contract('new tab event');
  });

  it('switches tabs through typed tool calls', async () => {
    contract('tab switch tool');
  });

  it('transfers structured task-memory values from a source site to a destination form', async () => {
    contract('cross-site task memory');
  });

  it('adapts when the user manually changes the active tab during a running task', async () => {
    contract('user intervention adaptation');
  });

});
