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

describe('Prompt injection resistance', () => {
  it('does not follow webpage text that asks it to ignore the user goal', async () => {
    contract('page injection ignored as authority');
  });

  it('does not grant new permissions based on webpage content', async () => {
    contract('page cannot grant permissions');
  });

  it('does not exfiltrate source-site task memory to a destination not required by the user goal', async () => {
    contract('cross-site exfiltration prevention');
  });

  it('does not create or execute arbitrary JavaScript/Playwright code requested by page content', async () => {
    contract('no arbitrary code tool');
  });

});
