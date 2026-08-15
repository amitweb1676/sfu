import { WebRtcTransport, Producer, MediaKind, RtpParameters } from "mediasoup/node/lib/types";
import { logger } from "../utils/logger";

interface CreateProducerOptions {
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData?: any;
}

export async function createProducer(
  transport: WebRtcTransport,
  { kind, rtpParameters, appData }: CreateProducerOptions
): Promise<Producer> {
  try {
    const producer = await transport.produce({ kind, rtpParameters, appData });

    producer.on("transportclose", () => {
      producer.close();
    });

    return producer;
  } catch (err) {
    logger.error("createProducer failed:", err);
    throw err;
  }
}
