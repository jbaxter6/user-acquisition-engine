// Ctrl-C (SIGINT), closing the terminal (SIGHUP) or `kill` (SIGTERM) mid-run
// would otherwise throw away everything collected so far. A run registers a
// "save what you have" callback; on the first signal it runs, then the
// process exits.
//
// The callback must be synchronous (writeFileSync, XLSX.writeFile): nothing
// async is guaranteed to finish once we're exiting.

const EXIT_CODE: Record<string, number> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

let saveCurrent: (() => void) | null = null;
let installed = false;
let exiting = false;

// After the terminal closes, writing to it throws — that must never stop
// the save itself.
function log(msg: string) {
  try {
    console.log(msg);
  } catch {
    /* terminal gone */
  }
}

function onSignal(signal: string) {
  if (exiting) process.exit(EXIT_CODE[signal]);
  exiting = true;
  log(`\n${signal} received, saving what's been collected so far...`);
  try {
    saveCurrent?.();
  } catch (err) {
    log(`Couldn't save partial results: ${err instanceof Error ? err.message : err}`);
  }
  process.exit(EXIT_CODE[signal]);
}

/** Registers the save-on-interrupt callback for the current run; returns an unregister function. */
export function saveOnInterrupt(save: () => void): () => void {
  if (!installed) {
    installed = true;
    for (const signal of Object.keys(EXIT_CODE)) process.on(signal, () => onSignal(signal));
    process.stdout.on("error", () => {});
    process.stderr.on("error", () => {});
  }
  saveCurrent = save;
  return () => {
    if (saveCurrent === save) saveCurrent = null;
  };
}
