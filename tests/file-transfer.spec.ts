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

describe('File transfer', () => {
  it('tracks a downloaded file using an ephemeral logical file ID', async () => {
    contract('task file tracking');
  });

  it('uploads only a file known/approved in the current task', async () => {
    contract('controlled upload');
  });

  it('does not grant the model unrestricted filesystem access', async () => {
    contract('filesystem isolation');
  });

  it('clears task file metadata at task/session end', async () => {
    contract('ephemeral file memory');
  });

});
