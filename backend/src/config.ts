import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const int = (value: string | undefined, fallback: number) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
const price = (value: string | undefined) => value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const positive = (value: string | undefined, fallback: number) => value?.trim() && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const warning = (value: string | undefined, fallback: number, integer = false) => value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 && (!integer || Number.isSafeInteger(Number(value))) ? Number(value) : fallback;
export const config = {
  llmProvider: 'azure' as const,
  azureEndpoint: process.env.Azure_openAi_Endpoint?.trim() ?? '',
  azureApiKey: process.env.Azure_openAI_API_KEY?.trim() ?? '',
  azureDeployment: process.env.Azure_openai_deployment_Name?.trim() ?? '',
  azureApiVersion: process.env.azure_openai_API_version?.trim() ?? '',
  azureTimeoutMs: int(process.env.AZURE_OPENAI_TIMEOUT_MS, 90000),
  azureMaxTokens: int(process.env.AZURE_OPENAI_MAX_COMPLETION_TOKENS, 4096),
  azureInputRate: price(process.env.AZURE_OPENAI_INPUT_USD_PER_MILLION),
  azureCachedRate: price(process.env.AZURE_OPENAI_CACHED_INPUT_USD_PER_MILLION),
  azureOutputRate: price(process.env.AZURE_OPENAI_OUTPUT_USD_PER_MILLION),
  contextTargetTokens: Math.min(positive(process.env.AGENT_CONTEXT_TARGET_TOKENS, 1500), positive(process.env.AGENT_CONTEXT_MAX_TOKENS, 3000)),
  contextMaxTokens: positive(process.env.AGENT_CONTEXT_MAX_TOKENS, 3000),
  warnRequests: warning(process.env.AGENT_WARN_LLM_REQUESTS, 2, true),
  warnInputTokens: warning(process.env.AGENT_WARN_INPUT_TOKENS, 1500, true),
  warnCostUsd: warning(process.env.AGENT_WARN_COST_USD, 0.0011),
  host: process.env.HOST ?? '127.0.0.1',
  port: int(process.env.PORT, 3333),
  maxSteps: int(process.env.AGENT_MAX_STEPS, 50),
  recoveryLimit: int(process.env.AGENT_RECOVERY_LIMIT, 3),
  actionTimeoutMs: int(process.env.ACTION_TIMEOUT_MS, 15000),
  logMaxFileBytes: int(process.env.LOG_MAX_FILE_BYTES, 5 * 1024 * 1024),
  logRetainedFiles: int(process.env.LOG_RETAINED_FILES, 5),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
