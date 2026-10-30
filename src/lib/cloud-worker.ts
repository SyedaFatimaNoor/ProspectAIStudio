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
/**
 * The pause flag belongs to the hosted scheduler. When the server is configured
 * with a locally readable source, a separate worker runs the job instead, so the
 * hosted pause must not block queueing; the UI has to say who will run it.
 */
export function cloudPauseBlocksDiscovery(
  worker: unknown,
  selfHostedWorker: boolean,
): boolean {
  return !selfHostedWorker && workerIsKnownPaused(worker);
}
export const selfHostedWorkerMessage =
  "The hosted scheduler is paused, so searches are not run automatically on the platform. A locally configured source will still run queued jobs: start the worker with npm run worker -- --user=<your user id>.";
