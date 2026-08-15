import { WebRtcTransport, Producer, MediaKind, RtpParameters } from "mediasoup/node/lib/types";
import { logger } from "../utils/logger";
import { sfuDebug, sfuError } from "../utils/debugLogger";

interface CreateProducerOptions {
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData?: any;
}

/**
 * Creates a producer on the given transport for the given kind (audio/video).
 */
export async function createProducer(
  transport: WebRtcTransport,
  { kind, rtpParameters, appData }: CreateProducerOptions
): Promise<Producer> {
  try {
    const producer = await transport.produce({ kind, rtpParameters, appData });

    producer.on("transportclose", () => {
      logger.info(`Producer closed due to transport close: ${producer.id}`);
      sfuDebug("Producer transport closed", {
        producerId: producer.id,
        kind: producer.kind,
        appData: producer.appData,
      });
      producer.close();
    });

    producer.observer.on("close", () => {
      sfuDebug("Producer observer close", {
        producerId: producer.id,
        kind: producer.kind,
      });
    });

    sfuDebug("Producer created", {
      producerId: producer.id,
      kind: producer.kind,
      paused: producer.paused,
      appData: producer.appData,
    });

    return producer;
  } catch (err) {
    sfuError("createProducer failed", err);
    throw err;
  }
}
