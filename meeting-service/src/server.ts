import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { config } from "./config";
import { createMediasoupWorker } from "./mediasoup/worker";
import { registerSignallingHandlers } from "./socket/signalling";
import { logger } from "./utils/logger";

async function bootstrap() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "meeting-service" });
  });

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, methods: ["GET", "POST"] },
  });

  await createMediasoupWorker();

  registerSignallingHandlers(io);

  httpServer.listen(config.port, () => {
    logger.info(`meeting-service listening on port ${config.port}`);
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to start meeting-service:", err);
  process.exit(1);
});
