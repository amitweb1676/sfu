import { getWorker } from "../mediasoup/worker";
import { mediaCodecs } from "../mediasoup/mediaCodecs";
import { Room, Participant } from "../types";
import { logger } from "../utils/logger";
import { WebRtcTransport, Producer, Consumer } from "mediasoup/node/lib/types";

const rooms: Map<string, Room> = new Map();

/**
 * Returns an existing room, or creates a new one with its own router.
 * One router per room — this is the core SFU foundation rule.
 */
export async function getOrCreateRoom(roomId: string): Promise<Room> {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const worker = getWorker();
  const router = await worker.createRouter({ mediaCodecs });

  const room: Room = {
    roomId,
    router,
    participants: new Map(),
    createdAt: Date.now(),
  };

  rooms.set(roomId, room);
  logger.info(`Room created: ${roomId}`);
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function addParticipant(
  roomId: string,
  socketId: string,
  userDetails: { displayName: string; userId?: string; avatar?: string; role?: string } | string
): Participant | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const info = typeof userDetails === "string" ? { displayName: userDetails } : userDetails;

  const participant: Participant = {
    socketId,
    userId: info.userId || socketId,
    displayName: info.displayName || "Participant",
    avatar: info.avatar,
    role: info.role,
    joinedAt: Date.now(),
  };

  room.participants.set(socketId, participant);
  return participant;
}

/**
 * Called right after addParticipant() in Phase 1 join-room handler.
 * Attaches empty media containers to the participant record.
 */
export function attachMediaContainers(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const participant = room.participants.get(socketId);
  if (!participant) return;

  participant.transports = {}; // { send: transport, recv: transport }
  participant.producers = {};  // { audio: producer, video: producer }
  participant.consumers = {};  // { [consumerId]: consumer }
}

export function setTransport(
  roomId: string,
  socketId: string,
  direction: "send" | "recv",
  transport: WebRtcTransport
): void {
  const participant = rooms.get(roomId)?.participants.get(socketId);
  if (!participant) return;
  if (!participant.transports) participant.transports = {};
  participant.transports[direction] = transport;
}

export function getTransport(
  roomId: string,
  socketId: string,
  direction: "send" | "recv"
): WebRtcTransport | undefined {
  return rooms.get(roomId)?.participants.get(socketId)?.transports?.[direction];
}

export function setProducer(
  roomId: string,
  socketId: string,
  kind: string,
  producer: Producer
): void {
  const participant = rooms.get(roomId)?.participants.get(socketId);
  if (!participant) return;
  if (!participant.producers) participant.producers = {};
  participant.producers[kind] = producer;
}

export function getAllProducersExcept(
  roomId: string,
  excludeSocketId: string
): Array<{
  socketId: string;
  userId: string;
  kind: string;
  producerId: string;
  displayName: string;
  avatar?: string;
  role?: string;
}> {
  const room = rooms.get(roomId);
  if (!room) return [];

  const result: Array<{
    socketId: string;
    userId: string;
    kind: string;
    producerId: string;
    displayName: string;
    avatar?: string;
    role?: string;
  }> = [];
  for (const [socketId, participant] of room.participants.entries()) {
    if (socketId === excludeSocketId) continue;
    for (const [kind, producer] of Object.entries(participant.producers || {})) {
      if (producer) {
        result.push({
          socketId,
          userId: participant.userId,
          kind,
          producerId: producer.id,
          displayName: participant.displayName,
          avatar: participant.avatar,
          role: participant.role,
        });
      }
    }
  }
  return result;
}

export function findProducer(roomId: string, producerId: string): Producer | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const participant of room.participants.values()) {
    for (const producer of Object.values(participant.producers || {})) {
      if (producer && producer.id === producerId) return producer;
    }
  }
  return null;
}

export function addConsumer(roomId: string, socketId: string, consumer: Consumer): void {
  const participant = rooms.get(roomId)?.participants.get(socketId);
  if (!participant) return;
  if (!participant.consumers) participant.consumers = {};
  participant.consumers[consumer.id] = consumer;
}

/**
 * Clean up participant and close all underlying media resources (producers, consumers, transports)
 */
export function removeParticipant(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(socketId);
  if (participant) {
    // Close producers
    Object.values(participant.producers || {}).forEach((p) => p && p.close());
    // Close consumers
    Object.values(participant.consumers || {}).forEach((c) => c && c.close());
    // Close transports
    Object.values(participant.transports || {}).forEach((t) => t && t.close());
  }

  room.participants.delete(socketId);
  logger.info(`Participant ${socketId} left room ${roomId}`);

  if (room.participants.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    logger.info(`Room closed (empty): ${roomId}`);
  }
}

export function getParticipantCount(roomId: string): number {
  return rooms.get(roomId)?.participants.size || 0;
}
