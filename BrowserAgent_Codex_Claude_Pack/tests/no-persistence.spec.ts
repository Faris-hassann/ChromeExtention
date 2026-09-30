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

describe('No persistent task history', () => {
  it('does not write chat history to persistent storage', async () => {
    contract('no chat history');
  });

  it('does not write task history to persistent storage', async () => {
    contract('no task history');
  });

  it('does not persist browser observations/page content', async () => {
    contract('no page history');
  });

  it('does not persist screenshots', async () => {
    contract('no screenshot history');
  });

  it('does not persist extracted task data after session end', async () => {
    contract('no task data persistence');
  });

  it('allows only minimal settings/site permissions/workflows in chrome.storage.local', async () => {
    contract('allowed configuration persistence');
  });

});
