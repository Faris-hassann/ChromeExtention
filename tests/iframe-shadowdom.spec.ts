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

describe('Frames and Shadow DOM', () => {
  it('builds a frame tree in observations', async () => {
    contract('frame tree');
  });

  it('interacts with an accessible iframe field through semantic targeting', async () => {
    contract('iframe interaction');
  });

  it('discovers and interacts with open Shadow DOM controls', async () => {
    contract('open shadow dom');
  });

});
