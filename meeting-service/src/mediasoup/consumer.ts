import { WebRtcTransport, Producer, Router, RtpCapabilities, Consumer } from "mediasoup/node/lib/types";
import { logger } from "../utils/logger";

export async function createConsumer(
  transport: WebRtcTransport,
  producer: Producer,
  router: Router,
  rtpCapabilities: RtpCapabilities
): Promise<Consumer | null> {
  try {
    if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      return null;
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });

    consumer.on("transportclose", () => {
      consumer.close();
    });

    consumer.on("producerclose", () => {
      consumer.close();
    });

    return consumer;
  } catch (err) {
    logger.error("createConsumer failed:", err);
    throw err;
  }
}
