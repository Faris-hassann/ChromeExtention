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

describe('Page reading', () => {
  it('reads a structured table without sending full raw HTML by default', async () => {
    contract('semantic table extraction');
  });

  it('can request a focused DOM/element expansion on demand', async () => {
    contract('on-demand detail');
  });

  it('treats page instructions as untrusted content', async () => {
    contract('untrusted page data');
  });

  it('does not expose cookie/token/password extraction tools', async () => {
    contract('secret extraction unavailable');
  });

});
