import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Creates a WebRTC transport (for send or receive).
 * Supports both mediasoup listenInfos (v3.13+) and fallback listenIps.
 */
export async function createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
  const announcedIp = config.mediasoup.announcedIp;
  logger.info(`[Transport] Creating WebRTC transport with announcedIp: ${announcedIp}`);
  let transport: WebRtcTransport;
  try {
    // mediasoup v3.13+ format (matches your package.json mediasoup ^3.14.0)
    transport = await (router as any).createWebRtcTransport({
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          announcedAddress: announcedIp,
        },
        {
          protocol: "tcp",
          ip: "0.0.0.0",
          announcedAddress: announcedIp,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
    });
  } catch (err) {
    logger.warn("[Transport] listenInfos failed, trying legacy listenIps fallback:", err);
    transport = await router.createWebRtcTransport({
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: announcedIp,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
    });
  }
  logger.info(`[Transport] ✅ WebRTC transport created: id=${transport.id}`);
  transport.on("dtlsstatechange", (dtlsState) => {
    logger.info(`[Transport] DTLS state: ${dtlsState} for transport ${transport.id}`);
    if (dtlsState === "closed" || dtlsState === "failed") {
      logger.warn(`[Transport] Closing transport ${transport.id} due to DTLS state ${dtlsState}`);
      transport.close();
    }
  });
  transport.on("icestatechange", (iceState) => {
    logger.info(`[Transport] ICE state: ${iceState} for transport ${transport.id}`);
  });
  transport.on("@close", () => {
    logger.info(`[Transport] Closed: ${transport.id}`);
  });
  return transport;
}
