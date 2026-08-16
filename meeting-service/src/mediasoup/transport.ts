import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface TransportMeta {
  roomId?: string;
  userId?: string;
  socketId?: string;
  direction?: "send" | "recv" | string;
}

function attachTransportEvents(transport: WebRtcTransport) {
  transport.on("icestatechange", (iceState) => {
    logger.info(`[Transport] ICE state: ${iceState} for transport ${transport.id}`);
  }); 
  transport.on("dtlsstatechange", (dtlsState) => {

    logger.info(`[Transport] DTLS state: ${dtlsState} for transport ${transport.id}`);

    if (dtlsState === "failed" || dtlsState === "closed") {
      logger.error(`[Transport] Transport ${transport.id} DTLS state ${dtlsState}`);
      transport.close();
    }
  });
}

export async function createWebRtcTransport(
  router: Router,
  meta?: TransportMeta
): Promise<WebRtcTransport> {
  const announcedIp = config.mediasoup.announcedIp;
  const rtcMinPort = config.mediasoup.minPort;
  const rtcMaxPort = config.mediasoup.maxPort;

  let transport: WebRtcTransport;
  try {
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
    logger.warn(`[Transport] listenInfos failed, falling back to listenIps: ${(err as Error).message}`);
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

  attachTransportEvents(transport);

  const candidateSummary = transport.iceCandidates
    ?.map((c) => `${c.protocol}:${c.ip || (c as any).address}:${c.port}`)
    .join(", ");
  logger.info(
    `[Transport] WebRTC transport created: id=${transport.id} (${meta?.direction || "unknown"}), candidates=[${candidateSummary}]`
  );
  return transport;
}
