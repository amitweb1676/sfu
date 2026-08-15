import * as mediasoup from "mediasoup";
import { Worker } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";

let worker: Worker | null = null;

export async function createMediasoupWorker(): Promise<Worker> {
  try {
    worker = await mediasoup.createWorker({
      rtcMinPort: config.mediasoup.minPort,
      rtcMaxPort: config.mediasoup.maxPort,
      logLevel: "warn",
    });

    logger.info(`Mediasoup worker created. PID: ${worker.pid}`);

    worker.on("died", (error) => {
      logger.error("[SFU FATAL] Mediasoup worker died unexpectedly:", error);
      setTimeout(() => process.exit(1), 2000);
    });

    return worker;
  } catch (err) {
    logger.error("createMediasoupWorker failed:", err);
    throw err;
  }
}

export const createWorker = createMediasoupWorker;

export function getWorker(): Worker {
  if (!worker) {
    throw new Error("Mediasoup worker has not been created yet.");
  }
  return worker;
}
