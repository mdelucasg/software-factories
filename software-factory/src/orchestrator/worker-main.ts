import { loadWorkerConfig } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { createHatchetClient } from "./hatchet-client.js";
import { createFactoryRunTask } from "./workflows.js";

const main = async (): Promise<void> => {
  const logger = createLogger({ service: "factory-worker" });
  const config = loadWorkerConfig();
  const hatchet = createHatchetClient(config);
  const factoryRunTask = createFactoryRunTask(hatchet, { logger });

  const worker = await hatchet.worker("software-factory-worker", {
    workflows: [factoryRunTask],
    slots: config.workerSlots,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("worker.stopping", { signal });
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  logger.info("worker.starting", {
    hatchetHostPort: config.hatchetHostPort,
    slots: config.workerSlots,
  });
  await worker.start();
};

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "factory-worker",
      event: "worker.fatal",
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});
