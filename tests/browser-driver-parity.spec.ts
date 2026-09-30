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

describe('BrowserDriver parity', () => {
  it('ExtensionBrowserDriver implements the shared browser contract', async () => {
    contract('extension driver contract');
  });

  it('PlaywrightBrowserDriver implements the shared browser contract', async () => {
    contract('playwright driver contract');
  });

  it('Playwright driver cannot bypass permission/risk policy', async () => {
    contract('driver policy parity');
  });

  it('Playwright driver cannot bypass automatic observation-after-action invariant', async () => {
    contract('driver observation parity');
  });

});
