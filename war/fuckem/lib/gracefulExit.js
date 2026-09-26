import { saveProspects } from './saveProspects.js';

// Ctrl-C (SIGINT), closing the terminal (SIGHUP) or `kill` (SIGTERM) mid-run
// would otherwise throw away everything a strategy collected so far. A run
// registers a "save what you have" callback; on the first signal it runs,
// then the process exits. Same approach as war/scraper/src/gracefulExit.ts.
//
// The callback must be synchronous (writeFileSync, XLSX.writeFile): nothing
// async is guaranteed to finish once we're exiting.

const EXIT_CODE = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

let saveCurrent = null;
let installed = false;
let exiting = false;

// After the terminal closes, writing to it throws — that must never stop
// the save itself.
function log(msg) {
  try {
    console.log(msg);
  } catch {
    // terminal gone
  }
}

function onSignal(signal) {
  if (exiting) process.exit(EXIT_CODE[signal]);
  exiting = true;
  log(`\n${signal} received, saving what's been collected so far...`);
  try {
    saveCurrent?.();
  } catch (error) {
    log(`Couldn't save partial results: ${error instanceof Error ? error.message : error}`);
  }
  process.exit(EXIT_CODE[signal]);
}

/** Registers the save-on-interrupt callback for the current run; returns an unregister function. */
export function saveOnInterrupt(save) {
  if (!installed) {
    installed = true;
    for (const signal of Object.keys(EXIT_CODE)) process.on(signal, () => onSignal(signal));
    process.stdout.on('error', () => {});
    process.stderr.on('error', () => {});
  }
  saveCurrent = save;
  return () => {
    if (saveCurrent === save) saveCurrent = null;
  };
}

/**
 * Runs one strategy and saves its prospects to war/recruits. If it's
 * interrupted or throws, whatever it reported so far is saved to a
 * "-partial" file instead of being lost.
 *
 * Strategies report progress by calling `onPartial(getProspects)` once with
 * a synchronous function that returns what they've collected so far.
 */
export async function runAndSave(strategyId, runStrategy) {
  let getPartial = () => [];
  const savePartial = () => {
    const prospects = getPartial();
    if (!prospects.length) {
      log(`${strategyId}: nothing collected yet, no file written.`);
      return null;
    }
    return saveProspects(strategyId, prospects, { partial: true });
  };
  const release = saveOnInterrupt(savePartial);
  try {
    const result = await runStrategy({ onPartial: (fn) => (getPartial = fn) });
    const file = saveProspects(strategyId, result.prospects ?? []);
    return { file, ...result };
  } catch (error) {
    log(`${strategyId} failed: ${error instanceof Error ? error.message : error}`);
    savePartial();
    throw error;
  } finally {
    release();
  }
}
