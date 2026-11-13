/**
 * Entry point of the built `zero-to.mjs`. Everything else lives in `run.ts`, which tests call directly.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeIo } from './io';
import { run } from './run';

const scriptDir = dirname(fileURLToPath(import.meta.url));

run(process.argv.slice(2), nodeIo(scriptDir)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`zero-to stopped on an unexpected problem: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 2;
  },
);
