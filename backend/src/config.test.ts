import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('Azure environment configuration', () => {
  it('reads the four exact environment variable names and ignores old routing', async () => {
    vi.stubEnv('Azure_openAi_Endpoint', ' https://resource.openai.azure.com/ ');
    vi.stubEnv('Azure_openAI_API_KEY', ' test-key ');
    vi.stubEnv('Azure_openai_deployment_Name', ' deployed-mini ');
    vi.stubEnv('azure_openai_API_version', ' 2025-04-01-preview ');
    vi.stubEnv('LLM_PROVIDER', 'openrouter');
    vi.stubEnv('OPENROUTER_API_KEY', 'old-key');
    vi.resetModules();
    const { config } = await import('./config.js');
    expect(config).toMatchObject({ llmProvider: 'azure', azureEndpoint: 'https://resource.openai.azure.com/', azureApiKey: 'test-key', azureDeployment: 'deployed-mini', azureApiVersion: '2025-04-01-preview' });
    expect(config).not.toHaveProperty('openrouterApiKey'); expect(config).not.toHaveProperty('ollamaUrl');
  });
  it('defaults the Azure request budget to 90 seconds and 4096 completion tokens', async () => {
    vi.stubEnv('AZURE_OPENAI_TIMEOUT_MS', undefined);
    vi.stubEnv('AZURE_OPENAI_MAX_COMPLETION_TOKENS', undefined);
    vi.resetModules();
    const { config } = await import('./config.js');
    expect(config.azureTimeoutMs).toBe(90000); expect(config.azureMaxTokens).toBe(4096);
  });
});
