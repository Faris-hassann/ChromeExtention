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

describe('Reusable workflows', () => {
  it('validates a versioned workflow JSON document', async () => {
    contract('workflow schema validation');
  });

  it('stores workflows as configuration without a database', async () => {
    contract('no database workflow storage');
  });

  it('exports and imports workflows as JSON', async () => {
    contract('workflow import export');
  });

  it('uses goal-based workflow steps rather than fixed selectors', async () => {
    contract('resilient workflow design');
  });

});
