import { getNextWorker, getWorker } from "../mediasoup/worker";
import { mediaCodecs } from "../mediasoup/mediaCodecs";
import { Room, Participant } from "../types";
import { WebRtcTransport, Producer, Consumer } from "mediasoup/node/lib/types";

const rooms: Map<string, Room> = new Map();

export async function getOrCreateRoom(roomId: string): Promise<Room> {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs });

  const room: Room = {
    roomId,
    router,
    participants: new Map(),
    createdAt: Date.now(),
    allMuted: false,
    allVideoHidden: false,
  };

  rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getRoomBySocketId(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.participants.has(socketId)) {
      return room;
    }
  }
  return undefined;
}

export function getParticipantBySocketId(socketId: string): Participant | undefined {
  for (const room of rooms.values()) {
    const p = room.participants.get(socketId);
    if (p) return p;
  }
  return undefined;
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

export function attachMediaContainers(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const participant = room.participants.get(socketId);
  if (!participant) return;

  participant.transports = {};
  participant.producers = {};
  participant.consumers = {};
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
  producer: Producer
): void {
  const participant = rooms.get(roomId)?.participants.get(socketId);
  if (!participant) return;
  if (!participant.producers) participant.producers = {};
  participant.producers[producer.id] = producer;
}

export function removeProducer(
  roomId: string,
  socketId: string,
  producerId: string
): Producer | null {
  const participant = rooms.get(roomId)?.participants.get(socketId);
  if (!participant || !participant.producers) return null;
  const producer = participant.producers[producerId];
  if (producer) {
    try {
      if (!producer.closed) {
        producer.close();
      }
    } catch {
      // Ignore
    }
    delete participant.producers[producerId];
    return producer;
  }
  return null;
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
  appData?: any;
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
    appData?: any;
  }> = [];
  for (const [socketId, participant] of room.participants.entries()) {
    if (socketId === excludeSocketId) continue;
    for (const producer of Object.values(participant.producers || {})) {
      if (producer && !producer.closed) {
        result.push({
          socketId,
          userId: participant.userId,
          kind: producer.kind,
          producerId: producer.id,
          displayName: participant.displayName,
          avatar: participant.avatar,
          role: participant.role,
          appData: producer.appData,
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
      if (producer && producer.id === producerId && !producer.closed) return producer;
    }
  }
  return null;
}

export function getProducersInRoom(roomId: string): Producer[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  const producers: Producer[] = [];
  for (const participant of room.participants.values()) {
    for (const producer of Object.values(participant.producers || {})) {
      if (producer && !producer.closed) {
        producers.push(producer);
      }
    }
  }
  return producers;
}

export function addProducer(roomId: string, producer: Producer, socketId: string): void {
  setProducer(roomId, socketId, producer);
}

export function getTransportById(roomId: string, transportId: string): WebRtcTransport | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  for (const participant of room.participants.values()) {
    if (participant.transports) {
      for (const transport of Object.values(participant.transports)) {
        if (transport && transport.id === transportId) return transport;
      }
    }
  }
  return undefined;
}

export function getRouter(roomId: string) {
  return rooms.get(roomId)?.router;
}

export function addConsumer(roomId: string, socketId: string, consumer: Consumer): void {
  const participant = rooms.get(roomId)?.participants.get(socketId);
  if (!participant) return;
  if (!participant.consumers) participant.consumers = {};
  participant.consumers[consumer.id] = consumer;
}

export function findConsumer(socketId: string, consumerId: string): Consumer | undefined {
  for (const room of rooms.values()) {
    const participant = room.participants.get(socketId);
    if (participant && participant.consumers?.[consumerId]) {
      return participant.consumers[consumerId];
    }
  }
  return undefined;
}

export function removeParticipant(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(socketId);
  if (participant) {
    Object.values(participant.producers || {}).forEach((p) => p && p.close());
    Object.values(participant.consumers || {}).forEach((c) => c && c.close());
    Object.values(participant.transports || {}).forEach((t) => t && t.close());
  }

  room.participants.delete(socketId);

  if (room.participants.size === 0) {
    room.router.close();
    rooms.delete(roomId);
  }
}

export function removeAllProducersAndConsumersFor(socketId: string): void {
  for (const [roomId, room] of rooms.entries()) {
    if (room.participants.has(socketId)) {
      removeParticipant(roomId, socketId);
    }
  }
}

export function getParticipantCount(roomId: string): number {
  return rooms.get(roomId)?.participants.size || 0;
}

// ================= PHASE 3 HELPERS (Room Lock, Roles, Moderation) =================

const lockedRooms: Set<string> = new Set();

export function setRoomLocked(roomId: string, locked: boolean): void {
  if (locked) lockedRooms.add(roomId);
  else lockedRooms.delete(roomId);
}

export function isRoomLocked(roomId: string): boolean {
  return lockedRooms.has(roomId);
}

/**
 * Store the authoritative host userId for a room.
 * Called once when the first participant joins (room creation).
 * NEVER overwritten — host identity is immutable for the lifetime of the room.
 */
export function setRoomHostUserId(roomId: string, userId: string): void {
  const room = rooms.get(roomId);
  if (room && !room.hostUserId) {
    room.hostUserId = String(userId);
  }
}

/**
 * Returns the stored host userId for the room, or undefined if not yet set.
 */
export function getRoomHostUserId(roomId: string): string | undefined {
  return rooms.get(roomId)?.hostUserId;
}

/**
 * Kept for backward compat — always returns 'participant' now.
 * Role assignment is handled authoritatively in signalling.ts by comparing
 * the joining userId against the room's stored hostUserId.
 */
export function assignRoleOnJoin(_roomId: string, _socketId: string): "participant" {
  return "participant";
}

export function getParticipant(roomId: string, socketId: string): Participant | undefined {
  const room = getRoom(roomId);
  return room?.participants.get(socketId);
}

export function setHandRaised(roomId: string, socketId: string, raised: boolean): void {
  const p = getParticipant(roomId, socketId);
  if (p) p.handRaised = raised;
}

export function setRole(roomId: string, socketId: string, role: "host" | "co-host" | "participant"): void {
  const p = getParticipant(roomId, socketId);
  if (p) p.role = role;
}

export function setParticipantApproved(roomId: string, socketId: string, approved: boolean): void {
  const p = getParticipant(roomId, socketId);
  if (p) p.approved = approved;
}

export function setParticipantMutedByHost(roomId: string, socketId: string, muted: boolean): void {
  const p = getParticipant(roomId, socketId);
  if (p) {
    p.mutedByHost = muted;
    if (muted) p.isAudioOff = true;
  }
}

export function setParticipantVideoHiddenByHost(roomId: string, socketId: string, hidden: boolean): void {
  const p = getParticipant(roomId, socketId);
  if (p) {
    p.videoHiddenByHost = hidden;
    if (hidden) p.isVideoOff = true;
  }
}

export function listParticipants(roomId: string): Array<any> {
  const room = getRoom(roomId);
  if (!room) return [];
  return Array.from(room.participants.values()).map((p: Participant) => ({
    socketId: p.socketId,
    userId: p.userId,
    name: p.displayName || "Guest",
    displayName: p.displayName || "Guest",
    avatar: p.avatar,
    role: p.role || "participant",
    handRaised: !!p.handRaised,
    isVideoOff: !!p.isVideoOff,
    isAudioOff: !!p.isAudioOff,
    mutedByHost: !!p.mutedByHost,
    videoHiddenByHost: !!p.videoHiddenByHost,
    approved: p.approved !== false,
  }));
}

// ================= Room-level media state (mute/video) =================

export function setRoomAllMuted(roomId: string, muted: boolean): void {
  const room = rooms.get(roomId);
  if (room) room.allMuted = muted;
}

export function getRoomAllMuted(roomId: string): boolean {
  return rooms.get(roomId)?.allMuted ?? false;
}

export function setRoomAllVideoHidden(roomId: string, hidden: boolean): void {
  const room = rooms.get(roomId);
  if (room) room.allVideoHidden = hidden;
}

export function getRoomAllVideoHidden(roomId: string): boolean {
  return rooms.get(roomId)?.allVideoHidden ?? false;
}
