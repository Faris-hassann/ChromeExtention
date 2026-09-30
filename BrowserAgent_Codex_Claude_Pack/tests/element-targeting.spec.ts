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

describe('Element targeting', () => {
  it('clicks a semantic element ID resolved from accessibility semantics', async () => {
    contract('semantic target resolution');
  });

  it('prefers role/name/label/stable attributes before brittle CSS', async () => {
    contract('target priority');
  });

  it('detects stale element IDs and re-observes instead of blindly retrying', async () => {
    contract('stale element recovery');
  });

  it('supports a visual fallback only when semantic resolution is insufficient', async () => {
    contract('controlled visual fallback');
  });

});
