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

describe('Screenshots and vision', () => {
  it('captures viewport screenshots', async () => {
    contract('viewport screenshot');
  });

  it('captures full-page screenshots', async () => {
    contract('full page screenshot');
  });

  it('captures a specific element screenshot', async () => {
    contract('element screenshot');
  });

  it('routes to the vision model when semantic state is insufficient', async () => {
    contract('vision routing');
  });

  it('does not persist screenshots as chat/task history', async () => {
    contract('ephemeral screenshots');
  });

});
