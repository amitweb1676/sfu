import { WebRtcTransport, Producer, Router, RtpCapabilities, Consumer } from "mediasoup/node/lib/types";
import { logger } from "../utils/logger";
import { sfuDebug, sfuError } from "../utils/debugLogger";

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
  try {
    if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
      logger.warn(`Cannot consume producer ${producer.id} — incompatible rtpCapabilities`);
      sfuDebug("Router cannot consume", {
        producerId: producer.id,
        transportId: transport.id,
      });
      return null;
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true, // start paused, resume after client confirms it's ready
    });

    consumer.on("transportclose", () => {
      logger.info(`Consumer closed due to transport close: ${consumer.id}`);
      sfuDebug("Consumer transport closed", {
        consumerId: consumer.id,
        producerId: producer.id,
      });
    });

    consumer.on("producerclose", () => {
      logger.info(`Consumer closed because its producer closed: ${consumer.id}`);
      sfuDebug("Consumer producer closed", {
        consumerId: consumer.id,
        producerId: producer.id,
      });
      consumer.close();
    });

    sfuDebug("Consumer created", {
      consumerId: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      paused: consumer.paused,
    });

    return consumer;
  } catch (err) {
    sfuError("createConsumer failed", err);
    throw err;
  }
}
