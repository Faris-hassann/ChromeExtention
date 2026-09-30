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

describe('Backend and Ollama health', () => {
  it('runs locally on configurable host/port defaulting to 127.0.0.1:3333', async () => {
    contract('local backend address');
  });

  it('reports Ollama unavailable with a typed health state', async () => {
    contract('ollama health');
  });

  it('discovers installed Ollama models', async () => {
    contract('model discovery');
  });

  it('does not require any database service to start', async () => {
    contract('database-free startup');
  });

});
