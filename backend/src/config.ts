import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
if (process.env.LLM_PROVIDER && !['openrouter', 'ollama'].includes(process.env.LLM_PROVIDER)) throw new Error('LLM_PROVIDER must be openrouter or ollama');
const int = (value: string | undefined, fallback: number) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
export const config = {
  llmProvider: process.env.LLM_PROVIDER ?? 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterModel: process.env.OPENROUTER_MODEL ?? 'openrouter/free',
  openrouterTimeoutMs: int(process.env.OPENROUTER_TIMEOUT_MS, 45000),
  host: process.env.HOST ?? '127.0.0.1',
  port: int(process.env.PORT, 3333),
  ollamaUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
  mainModel: process.env.OLLAMA_MAIN_MODEL ?? 'qwen2.5:7b',
  visionModel: process.env.OLLAMA_VISION_MODEL ?? '',
  maxSteps: int(process.env.AGENT_MAX_STEPS, 50),
  recoveryLimit: int(process.env.AGENT_RECOVERY_LIMIT, 3),
  actionTimeoutMs: int(process.env.ACTION_TIMEOUT_MS, 15000),
  llmTimeoutMs: int(process.env.LLM_TIMEOUT_MS, 300000),
  llmAttemptTimeoutMs: int(process.env.LLM_ATTEMPT_TIMEOUT_MS, 150000),
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE ?? '10m',
  ollamaNumCtx: int(process.env.OLLAMA_NUM_CTX, 4096),
  ollamaNumPredict: int(process.env.OLLAMA_NUM_PREDICT, 256),
  logMaxFileBytes: int(process.env.LOG_MAX_FILE_BYTES, 5 * 1024 * 1024),
  logRetainedFiles: int(process.env.LOG_RETAINED_FILES, 5),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
