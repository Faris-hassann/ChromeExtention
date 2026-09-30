const int = (value: string | undefined, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: int(process.env.PORT, 3333),
  ollamaUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
  mainModel: process.env.OLLAMA_MAIN_MODEL ?? 'qwen2.5:7b',
  visionModel: process.env.OLLAMA_VISION_MODEL ?? '',
  maxSteps: int(process.env.AGENT_MAX_STEPS, 50),
  recoveryLimit: int(process.env.AGENT_RECOVERY_LIMIT, 3),
  actionTimeoutMs: int(process.env.ACTION_TIMEOUT_MS, 15000),
  llmTimeoutMs: int(process.env.LLM_TIMEOUT_MS, 120000),
};
