import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Creates a WebRTC transport (used for both send and receive directions).
 * One send transport + one receive transport per participant.
 */
export async function createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: config.mediasoup.announcedIp, // your machine's LAN/public IP
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
  });

  transport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "closed" || dtlsState === "failed") {
      logger.warn(`Transport DTLS state: ${dtlsState}. Closing transport ${transport.id}`);
      transport.close();
    }
  });

  transport.on("@close", () => {
    logger.info(`Transport closed: ${transport.id}`);
  });

  return transport;
}
