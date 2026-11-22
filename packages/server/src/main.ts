/**
 * Starts the server: reads the settings from the environment (Node loads `packages/server/.env` through
 * `--env-file-if-exists`), checks them, and listens. A wrong setting stops the start with `config_invalid`.
 */
import { createServer } from './http/server';
import { readSettings } from './env';
import { createLog } from './log';
import { clientFor } from './providers/client';

async function main(): Promise<void> {
  const log = createLog(process.stdout, Date.now);
  const settings = readSettings(process.env);
  if (!settings.ok) {
    process.stderr.write(`${settings.message}\n${settings.hint ?? ''}\n`);
    process.exitCode = 1;
    return;
  }
  const client = clientFor(settings.value);
  const server = createServer({ settings: settings.value, ...(client !== undefined ? { client } : {}), log });
  const listening = await server.listen();
  if (!listening.ok) {
    process.stderr.write(`${listening.message}\n${listening.hint ?? ''}\n`);
    process.exitCode = 1;
    return;
  }
  log('listening', { host: listening.host, port: listening.port, provider: settings.value.provider, ready: client !== undefined });
  const stop = (): void => {
    void server.close().then(() => {
      process.exitCode = 0;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main();
