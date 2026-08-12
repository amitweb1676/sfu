import { WebRtcTransport, Producer, Router, RtpCapabilities, Consumer } from "mediasoup/node/lib/types";
import { logger } from "../utils/logger";

/**
 * Creates a consumer on the given transport for an existing producer,
 * ONLY if the client's rtpCapabilities can consume it.
 */
export async function createConsumer(
  transport: WebRtcTransport,
  producer: Producer,
  router: Router,
  rtpCapabilities: RtpCapabilities
): Promise<Consumer | null> {
  if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
    logger.warn(`Cannot consume producer ${producer.id} — incompatible rtpCapabilities`);
    return null;
  }

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: true, // start paused, resume after client confirms it's ready
  });

  consumer.on("transportclose", () => {
    logger.info(`Consumer closed due to transport close: ${consumer.id}`);
  });

  consumer.on("producerclose", () => {
    logger.info(`Consumer closed because its producer closed: ${consumer.id}`);
    consumer.close();
  });

  return consumer;
}
