import * as mediasoup from "mediasoup";
import { Worker } from "mediasoup/node/lib/types";
import os from "os";
import { config } from "../config";
import { logger } from "../utils/logger";

const workers: Worker[] = [];
let nextWorkerIdx = 0;

export async function createMediasoupWorkers(): Promise<Worker[]> {
  const numWorkers = Math.max(2, Math.min(os.cpus().length, 4));
  logger.info(`Initializing Mediasoup Worker Pool with ${numWorkers} workers...`);

  for (let i = 0; i < numWorkers; i++) {
    try {
      const worker = await mediasoup.createWorker({
        rtcMinPort: config.mediasoup.minPort,
        rtcMaxPort: config.mediasoup.maxPort,
        logLevel: "warn",
      });

      logger.info(`Mediasoup worker [${i + 1}/${numWorkers}] created. PID: ${worker.pid}`);

      worker.on("died", (error) => {
        logger.error(`[SFU FATAL] Mediasoup worker (PID: ${worker.pid}) died unexpectedly:`, error);
        setTimeout(() => process.exit(1), 2000);
      });

      workers.push(worker);
    } catch (err) {
      logger.error(`Failed to create Mediasoup worker #${i + 1}:`, err);
      throw err;
    }
  }

  return workers;
}

export const createMediasoupWorker = createMediasoupWorkers;
export const createWorker = createMediasoupWorkers;

export function getNextWorker(): Worker {
  if (workers.length === 0) {
    throw new Error("No Mediasoup workers available in pool.");
  }
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

export function getWorker(): Worker {
  return getNextWorker();
}
