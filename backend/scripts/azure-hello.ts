import { MetricsStore } from '../src/llm/metrics.js';
import { config } from '../src/config.js';
import { azureHello } from '../src/llm/azure-hello.js';
import { ProviderError } from '../src/llm/progress.js';
import { azureConfiguration } from '../src/llm/provider.js';

const metrics = new MetricsStore(null);
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
try {
  const configuration = azureConfiguration();
  if (!configuration.configured) throw new ProviderError(configuration.reason, 'CONFIGURATION');
  console.log(`Sending "hi" to your configured Azure deployment. Waiting up to ${config.azureTimeoutMs / 1000} seconds…`);
  const reply = await azureHello(config, fetch, controller.signal, record => metrics.accept(record));
  console.log(`Azure replied in ${(reply.elapsedMs / 1000).toFixed(1)} seconds:\n\n${reply.text}`);
  console.log('\nAccess test passed. This standalone test does not change the running panel status; use Test Azure connection in the panel to verify that backend session.');
} catch (error) {
  if (controller.signal.aborted) { console.error('Azure test cancelled.'); process.exitCode = 130; }
  else {
    const failure = error instanceof ProviderError ? `[${error.code}${error.status ? ` / HTTP ${error.status}` : ''}] ${error.message}` : 'Unexpected test failure. Check the backend configuration.';
    console.error(`Azure test failed: ${failure}`);
    process.exitCode = 1;
  }
} finally {
  if (metrics.snapshot().requestCount) console.log('Azure request metrics:', JSON.stringify(metrics.snapshot(), null, 2));
  process.removeListener('SIGINT', cancel);
}
