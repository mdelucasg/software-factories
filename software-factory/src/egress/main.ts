import { createLogger } from "../shared/logger.js";
import { loadEgressProxyConfig } from "./config.js";
import { createEgressProxyServer } from "./proxy-server.js";

const main = async (): Promise<void> => {
  const logger = createLogger({ service: "egress-proxy" });
  const config = loadEgressProxyConfig();
  const server = createEgressProxyServer({
    policy: {
      allowlistDomains: config.allowlistDomains,
      allowedPorts: config.allowedPorts,
    },
    logger,
  });

  const addresses = await server.listen({
    proxyPort: config.proxyPort,
    healthPort: config.healthPort,
    host: "0.0.0.0",
  });

  logger.info("egress.started", {
    proxyHost: addresses.proxy.host,
    proxyPort: addresses.proxy.port,
    healthHost: addresses.health.host,
    healthPort: addresses.health.port,
    allowlistDomains: config.allowlistDomains,
    allowedPorts: config.allowedPorts,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("egress.stopping", { signal });
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
      service: "egress-proxy",
      event: "egress.fatal",
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});
