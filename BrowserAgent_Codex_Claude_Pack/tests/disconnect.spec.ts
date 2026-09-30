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

describe('Backend disconnect', () => {
  it('pauses a running task when backend transport disconnects', async () => {
    contract('disconnect pause');
  });

  it('does not execute queued browser actions while backend is unavailable', async () => {
    contract('no orphan automation');
  });

  it('reconnects with backoff and requires safe resumption', async () => {
    contract('safe reconnect');
  });

  it('requests a fresh observation before continuing after reconnection', async () => {
    contract('fresh state after reconnect');
  });

});
