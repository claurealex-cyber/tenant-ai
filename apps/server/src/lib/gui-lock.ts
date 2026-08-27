/**
 * Process-wide mutex for GUI/screen automation. The Zillow Safari scrape
 * (osascript) and the Text-Em-All Iris drive both take over the real screen;
 * running two at once = a focus war that corrupts both (rev.4 H). Every
 * screen-driving path MUST run inside withGuiLock(). All such paths live in the
 * one Fastify server process, so an in-process async lock is sufficient.
 */
let chain: Promise<unknown> = Promise.resolve();
let held = false;

export function isGuiBusy(): boolean {
  return held;
}

/** Run `fn` with exclusive GUI access. Queues behind any in-flight GUI work. */
export function withGuiLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    held = true;
    try {
      return await fn();
    } finally {
      held = false;
    }
  };
  const result = chain.then(run, run); // run even if a prior task rejected
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
