import {
  createHatchetClient,
  createHatchetDispatcher,
} from "../orchestrator/hatchet-client.js";
import { loadGatewayConfig } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { createWebhookServer } from "./server.js";

const main = async (): Promise<void> => {
  const logger = createLogger({ service: "webhook-gateway" });
  const config = loadGatewayConfig();
  const hatchet = createHatchetClient(config);
  const dispatcher = createHatchetDispatcher(hatchet);
  const server = createWebhookServer({
    webhookSecret: config.githubWebhookSecret,
    dispatcher,
    logger,
  });

  const address = await server.listen(config.webhookPort, "0.0.0.0");
  logger.info("webhook.started", {
    host: address.host,
    port: address.port,
    hatchetHostPort: config.hatchetHostPort,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("webhook.stopping", { signal });
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
};

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "webhook-gateway",
      event: "webhook.fatal",
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});
