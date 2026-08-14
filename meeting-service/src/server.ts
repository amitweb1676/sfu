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
    res.json({ status: "ok", service: "meeting-service"});
  });

  const httpServer = http.createServer(app);

  httpServer.on("upgrade", (request, socket, head) => {
    console.log("\n========== WEBSOCKET UPGRADE ==========");
    console.log("URL:", request.url);
    console.log("Method:", request.method);
    console.log("Headers:", request.headers);
    console.log("Upgrade:", request.headers.upgrade);
    console.log("Connection:", request.headers.connection);
    console.log("Sec-WebSocket-Key:", request.headers["sec-websocket-key"]);
    console.log(
      "Sec-WebSocket-Version:",
      request.headers["sec-websocket-version"]
    );
    console.log("=======================================\n");
  });

  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, methods: ["GET", "POST"] },
  });

  // Mediasoup worker MUST start before signalling is registered.
  await createMediasoupWorker();

  registerSignallingHandlers(io);

  httpServer.listen(config.port, () => {
    logger.info(`meeting-service 12345678999999999999999 listening on port ${config.port}  updated     22222222222222222222222222222222222222222222222222222222222111111111111111111111111111111111111111111111111111111111111111111111111111111`);
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to start meeting-service:", err);
  process.exit(1);
});
