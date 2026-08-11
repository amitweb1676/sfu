import * as mediasoup from "mediasoup";
import { Worker } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";

let worker: Worker | null = null;

/**
 * Creates and returns a single mediasoup Worker.
 * IMPORTANT:
 * - Created ONCE when the service starts.
 * - NOT created per room, NOT created per participant.
 */
export async function createMediasoupWorker(): Promise<Worker> {
  worker = await mediasoup.createWorker({
    rtcMinPort: config.mediasoup.minPort,
    rtcMaxPort: config.mediasoup.maxPort,
    logLevel: "warn",
  });

  logger.info(`Mediasoup worker created. PID: ${worker.pid}`);

  worker.on("died", (error) => {
    logger.error("Mediasoup worker died unexpectedly:", error);
    // In production, you may want to exit and let a process manager restart it.
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
}

export function getWorker(): Worker {
  if (!worker) {
    throw new Error("Mediasoup worker has not been created yet.");
  }
  return worker;
}
