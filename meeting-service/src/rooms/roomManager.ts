import { getWorker } from "../mediasoup/worker";
import { mediaCodecs } from "../mediasoup/mediaCodecs";
import { Room, Participant } from "../types";
import { logger } from "../utils/logger";

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
  displayName: string
): Participant | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const participant: Participant = {
    socketId,
    displayName,
    joinedAt: Date.now(),
  };

  room.participants.set(socketId, participant);
  return participant;
}

export function removeParticipant(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.participants.delete(socketId);
  logger.info(`Participant ${socketId} left room ${roomId}`);

  // Clean up empty room to free the router.
  if (room.participants.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    logger.info(`Room closed (empty): ${roomId}`);
  }
}

export function getParticipantCount(roomId: string): number {
  return rooms.get(roomId)?.participants.size || 0;
}
