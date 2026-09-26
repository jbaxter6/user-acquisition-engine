import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAndSave } from './lib/gracefulExit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runOpp1() {
  const entries = await fs.readdir(__dirname, { withFileTypes: true });
  const oppDirs = entries
    .filter((entry) => entry.isDirectory() && /^OPP\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (!oppDirs.length) {
    throw new Error('No OPP directories found under war/fuckem. Add OPP1, OPP2, etc.');
  }

  const results = [];

  for (const oppName of oppDirs) {
    const oppDir = path.join(__dirname, oppName);
    const oppEntries = await fs.readdir(oppDir, { withFileTypes: true });
    const strategies = oppEntries
      .filter((entry) => entry.isDirectory() && /^strat-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    for (const strategyName of strategies) {
      const runFile = path.join(oppDir, strategyName, 'run.js');
      const mod = await import(pathToFileURL(runFile).href);

      if (typeof mod.runStrategy !== 'function') {
        throw new Error(`Strategy ${strategyName} is missing runStrategy().`);
      }

      const strategyId = `${oppName}/${strategyName}`;
      // Saves partial results if interrupted (Ctrl-C / terminal closed) or on error.
      const result = await runAndSave(strategyId, mod.runStrategy);
      results.push({ strategy: strategyId, ...result });
    }
  }

  if (!results.length) {
    throw new Error('No strategy folders found under any OPP directory.');
  }

  console.log(JSON.stringify({ strategyCount: results.length, results }, null, 2));
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOpp1().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
