export const pausedCloudWorkerMessage =
  "Cloud discovery is paused. Discovery is temporarily unavailable because the source worker is paused. Ask the operator to resolve the provider/setup issue before trying again. No search was run.";

/**
 * A worker status is optional because self-hosted deployments can use a separate
 * worker. Only an explicit `enabled: false` blocks new discovery work.
 */
export function workerIsKnownPaused(worker: unknown): boolean {
  return (
    typeof worker === "object" &&
    worker !== null &&
    "enabled" in worker &&
    worker.enabled === false
  );
}
