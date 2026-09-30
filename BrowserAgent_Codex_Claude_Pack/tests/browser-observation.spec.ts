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

describe('Browser observation', () => {
  it('returns URL, title, active tab and loading state', async () => {
    contract('basic observation metadata');
  });

  it('returns semantic interactive elements with temporary element IDs', async () => {
    contract('semantic element registry');
  });

  it('reports dialogs/toasts/forms/tables when present', async () => {
    contract('structured page state');
  });

  it('returns a compact diff after meaningful changes while preserving sufficient context', async () => {
    contract('observation diffing');
  });

  it('marks the previous observation stale after a meaningful action', async () => {
    contract('freshness tracking');
  });

});
