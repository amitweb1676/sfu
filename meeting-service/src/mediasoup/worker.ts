import * as mediasoup from "mediasoup";
import { Worker, WorkerLogTag } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { sfuDebug, sfuError } from "../utils/debugLogger";

let worker: Worker | null = null;

const logTags: WorkerLogTag[] = ["info", "ice", "dtls", "rtp", "srtp", "rtcp"];

/**
 * Creates and returns a single mediasoup Worker.
 * IMPORTANT:
 * - Created ONCE when the service starts.
 * - NOT created per room, NOT created per participant.
 */
export async function createMediasoupWorker(): Promise<Worker> {
  try {
    sfuDebug("Creating mediasoup worker", {
      rtcMinPort: config.mediasoup.minPort,
      rtcMaxPort: config.mediasoup.maxPort,
      logLevel: config.debugSfu ? "debug" : "warn",
    });

    worker = await mediasoup.createWorker({
      rtcMinPort: config.mediasoup.minPort,
      rtcMaxPort: config.mediasoup.maxPort,
      logLevel: config.debugSfu ? "debug" : "warn",
      logTags,
    });

    logger.info(`Mediasoup worker created. PID: ${worker.pid}`);
    sfuDebug("Mediasoup worker created successfully", {
      pid: worker.pid,
      rtcMinPort: config.mediasoup.minPort,
      rtcMaxPort: config.mediasoup.maxPort,
    });

    worker.on("died", (error) => {
      logger.error("[SFU FATAL] Mediasoup worker died unexpectedly:", error);
      sfuError("Mediasoup worker died", error);
      setTimeout(() => process.exit(1), 2000);
    });

    return worker;
  } catch (err) {
    sfuError("createMediasoupWorker failed", err);
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

