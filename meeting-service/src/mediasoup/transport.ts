import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { sfuDebug, sfuError } from "../utils/debugLogger";

export interface TransportMeta {
  roomId?: string;
  userId?: string;
  socketId?: string;
  direction?: "send" | "recv" | string;
}

/**
 * Attaches debug and lifecycle events to a WebRTC transport.
 */
function attachTransportDebugEvents(transport: WebRtcTransport, meta?: TransportMeta) {
  transport.on("icestatechange", (iceState) => {
    logger.info(`[Transport] ICE state: ${iceState} for transport ${transport.id}`);
    sfuDebug("Transport ICE state changed", {
      transportId: transport.id,
      iceState,
      roomId: meta?.roomId,
      userId: meta?.userId,
      direction: meta?.direction,
    });
  });

  transport.on("dtlsstatechange", (dtlsState) => {
    logger.info(`[Transport] DTLS state: ${dtlsState} for transport ${transport.id}`);
    sfuDebug("Transport DTLS state changed", {
      transportId: transport.id,
      dtlsState,
      roomId: meta?.roomId,
      userId: meta?.userId,
      direction: meta?.direction,
    });

    if (dtlsState === "failed" || dtlsState === "closed") {
      sfuDebug("Transport DTLS failure detail", {
        transportId: transport.id,
        iceSelectedTuple: (transport as any).iceSelectedTuple,
        tuple: (transport as any).tuple,
      });
      logger.warn(`[Transport] Closing transport ${transport.id} due to DTLS state ${dtlsState}`);
      transport.close();
    }
  });

  transport.on("sctpstatechange", (sctpState) => {
    sfuDebug("Transport SCTP state changed", {
      transportId: transport.id,
      sctpState,
      roomId: meta?.roomId,
      userId: meta?.userId,
      direction: meta?.direction,
    });
  });

  transport.on("trace", (trace) => {
    sfuDebug("Transport trace event", {
      transportId: transport.id,
      trace,
    });
  });

  transport.observer.on("close", () => {
    logger.info(`[Transport] Closed: ${transport.id}`);
    sfuDebug("Transport observer closed", {
      transportId: transport.id,
      roomId: meta?.roomId,
      userId: meta?.userId,
      direction: meta?.direction,
    });
  });
}

/**
 * Creates a WebRTC transport (for send or receive).
 * Supports both mediasoup listenInfos (v3.13+) and fallback listenIps.
 */
export async function createWebRtcTransport(
  router: Router,
  meta?: TransportMeta
): Promise<WebRtcTransport> {
  const announcedIp = config.mediasoup.announcedIp;
  const rtcMinPort = config.mediasoup.minPort;
  const rtcMaxPort = config.mediasoup.maxPort;

  sfuDebug("Creating WebRTC transport request", {
    roomId: meta?.roomId,
    userId: meta?.userId,
    socketId: meta?.socketId,
    direction: meta?.direction,
    announcedIp,
    rtcMinPort,
    rtcMaxPort,
  });

  let transport: WebRtcTransport;
  try {
    // mediasoup v3.13+ format (matches package.json mediasoup ^3.14.0)
    transport = await (router as any).createWebRtcTransport({
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          announcedAddress: announcedIp,
          portRange: { min: rtcMinPort, max: rtcMaxPort },
        },
        {
          protocol: "tcp",
          ip: "0.0.0.0",
          announcedAddress: announcedIp,
          portRange: { min: rtcMinPort, max: rtcMaxPort },
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

  attachTransportDebugEvents(transport, meta);

  sfuDebug("WebRTC transport created", {
    id: transport.id,
    roomId: meta?.roomId,
    userId: meta?.userId,
    direction: meta?.direction,
    iceRole: transport.iceRole,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  });

  logger.info(`[Transport] ✅ WebRTC transport created: id=${transport.id} (${meta?.direction || "unknown"})`);
  return transport;
}
