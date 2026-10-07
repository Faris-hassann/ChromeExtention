import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const int = (value: string | undefined, fallback: number) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
export const config = {
  llmProvider: 'azure' as const,
  azureEndpoint: process.env.Azure_openAi_Endpoint?.trim() ?? '',
  azureApiKey: process.env.Azure_openAI_API_KEY?.trim() ?? '',
  azureDeployment: process.env.Azure_openai_deployment_Name?.trim() ?? '',
  azureApiVersion: process.env.azure_openai_API_version?.trim() ?? '',
  azureTimeoutMs: int(process.env.AZURE_OPENAI_TIMEOUT_MS, 90000),
  azureMaxTokens: int(process.env.AZURE_OPENAI_MAX_COMPLETION_TOKENS, 4096),
  host: process.env.HOST ?? '127.0.0.1',
  port: int(process.env.PORT, 3333),
  maxSteps: int(process.env.AGENT_MAX_STEPS, 50),
  recoveryLimit: int(process.env.AGENT_RECOVERY_LIMIT, 3),
  actionTimeoutMs: int(process.env.ACTION_TIMEOUT_MS, 15000),
  logMaxFileBytes: int(process.env.LOG_MAX_FILE_BYTES, 5 * 1024 * 1024),
  logRetainedFiles: int(process.env.LOG_RETAINED_FILES, 5),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
