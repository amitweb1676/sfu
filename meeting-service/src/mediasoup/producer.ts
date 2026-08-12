import { WebRtcTransport, Producer, MediaKind, RtpParameters } from "mediasoup/node/lib/types";
import { logger } from "../utils/logger";

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
  const producer = await transport.produce({ kind, rtpParameters, appData });

  producer.on("transportclose", () => {
    logger.info(`Producer closed due to transport close: ${producer.id}`);
    producer.close();
  });

  return producer;
}
