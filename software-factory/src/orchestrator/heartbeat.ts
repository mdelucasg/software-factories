export type HeartbeatDuration = `${number}s` | `${number}m` | `${number}h`;

export type TimeoutRefresher = {
  refreshTimeout: (incrementBy: HeartbeatDuration) => Promise<void>;
};

export type HeartbeatScheduler = {
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type TimeoutHeartbeatOptions = {
  refresher: TimeoutRefresher;
  intervalMs?: number;
  incrementBy?: HeartbeatDuration;
  onRefreshError?: (error: unknown) => void;
  scheduler?: HeartbeatScheduler;
};

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_HEARTBEAT_INCREMENT: HeartbeatDuration = "10m";

const defaultScheduler: HeartbeatScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

export const withTimeoutHeartbeat = async <T>(
  options: TimeoutHeartbeatOptions,
  work: () => Promise<T>
): Promise<T> => {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Heartbeat intervalMs must be a positive finite number");
  }

  const incrementBy = options.incrementBy ?? DEFAULT_HEARTBEAT_INCREMENT;
  const scheduler = options.scheduler ?? defaultScheduler;

  let stopped = false;
  let inFlight = false;

  const triggerRefresh = (): void => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    void options.refresher
      .refreshTimeout(incrementBy)
      .catch((error: unknown) => {
        options.onRefreshError?.(error);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const handle = scheduler.setInterval(triggerRefresh, intervalMs);
  try {
    return await work();
  } finally {
    stopped = true;
    scheduler.clearInterval(handle);
  }
};
