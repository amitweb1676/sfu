import { Server, Socket } from "socket.io";
import { createWebRtcTransport } from "../mediasoup/transport";
import { createProducer } from "../mediasoup/producer";
import { createConsumer } from "../mediasoup/consumer";
import {
  getOrCreateRoom,
  addParticipant,
  removeParticipant,
  attachMediaContainers,
  setTransport,
  getTransport,
  setProducer,
  getAllProducersExcept,
  findProducer,
  addConsumer,
  getRoom,
} from "../rooms/roomManager";
import { logger } from "../utils/logger";

export function registerSignallingHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    let currentRoomId: string | null = null;

    // --- Phase 1 & 2: join room ---
    socket.on("join-room", async (
      payload: { roomId: string; displayName?: string; userId?: string; avatar?: string; role?: string },
      callback: (res: any) => void
    ) => {
      try {
        const { roomId, displayName, userId, avatar, role } = payload;
        const room = await getOrCreateRoom(roomId);

        socket.join(roomId);
        currentRoomId = roomId;

        const participant = addParticipant(roomId, socket.id, {
          displayName: displayName || "Participant",
          userId: userId || socket.id,
          avatar,
          role,
        });
        attachMediaContainers(roomId, socket.id);

        socket.to(roomId).emit("participant-joined", {
          socketId: socket.id,
          userId: participant?.userId || socket.id,
          displayName: participant?.displayName || displayName,
          avatar: participant?.avatar,
          role: participant?.role,
        });

        if (typeof callback === "function") {
          callback({
            success: true,
            serverVersion: "updated one",
            rtpCapabilities: room.router.rtpCapabilities,
          });
        }

        logger.info(`[Signalling] [updated one] ${displayName || "Participant"} (${socket.id}) joined room ${roomId}`);
      } catch (err) {
        logger.error("[Signalling] [updated one] join-room failed:", err);
        if (typeof callback === "function") {
          callback({ success: false, serverVersion: "updated one", error: "Failed to join room" });
        }
      }
    });

    // Robust helper for creating WebRTC transport
    const handleCreateTransport = async (
      direction: "send" | "recv",
      payloadOrCb: any,
      maybeCb?: (res: any) => void
    ) => {
      const callback = typeof payloadOrCb === "function" ? payloadOrCb : maybeCb;
      const payload = typeof payloadOrCb === "object" ? payloadOrCb : {};
      const roomId = payload?.roomId || currentRoomId;

      logger.info(`[Signalling] [updated one] create-${direction}-transport request | socket=${socket.id} | room=${roomId}`);

      if (!roomId) {
        logger.error(`[Signalling] [updated one] create-${direction}-transport failed: Not in a room (socket: ${socket.id})`);
        if (typeof callback === "function") {
          callback({ success: false, serverVersion: "updated one", error: "Not in a room" });
        }
        return;
      }

      try {
        const room = getRoom(roomId);
        if (!room) {
          logger.error(`[Signalling] [updated one] create-${direction}-transport: Room ${roomId} not found`);
          if (typeof callback === "function") {
            callback({ success: false, serverVersion: "updated one", error: "Room not found" });
          }
          return;
        }

        const transport = await createWebRtcTransport(room.router);
        setTransport(roomId, socket.id, direction, transport);

        const transportParams = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };

        logger.info(`[Signalling] ✅ [updated one] create-${direction}-transport success: ${transport.id}`);
        if (typeof callback === "function") {
          callback({
            success: true,
            serverVersion: "updated one",
            transportOptions: transportParams,
            transportParams: transportParams,
          });
        }
      } catch (err: any) {
        logger.error(`[Signalling] ❌ [updated one] create-${direction}-transport failed:`, err);
        if (typeof callback === "function") {
          callback({ success: false, serverVersion: "updated one", error: err.message || "Failed to create transport" });
        }
      }
    };

    socket.on("create-send-transport", (arg1: any, arg2?: any) => {
      handleCreateTransport("send", arg1, arg2);
    });

    socket.on("create-recv-transport", (arg1: any, arg2?: any) => {
      handleCreateTransport("recv", arg1, arg2);
    });

    socket.on("create-transport", (payload: { direction: "send" | "recv"; roomId?: string }, callback: (res: any) => void) => {
      handleCreateTransport(payload?.direction || "send", payload, callback);
    });

    // Helper for connecting WebRTC transport
    const handleConnectTransport = async (direction: "send" | "recv", dtlsParameters: any, callback: (res: any) => void) => {
      try {
        if (!currentRoomId) return callback({ success: false, error: "Not in a room" });
        const transport = getTransport(currentRoomId, socket.id, direction);
        if (!transport) return callback({ success: false, error: "Transport not found" });

        await transport.connect({ dtlsParameters });
        callback({ success: true });
      } catch (err) {
        logger.error(`connect-${direction}-transport failed:`, err);
        callback({ success: false, error: "Failed to connect transport" });
      }
    };

    socket.on("connect-send-transport", ({ dtlsParameters }: { dtlsParameters: any }, callback: (res: any) => void) => {
      handleConnectTransport("send", dtlsParameters, callback);
    });

    socket.on("connect-recv-transport", ({ dtlsParameters }: { dtlsParameters: any }, callback: (res: any) => void) => {
      handleConnectTransport("recv", dtlsParameters, callback);
    });

    socket.on("connect-transport", ({ direction, dtlsParameters }: { direction: "send" | "recv"; dtlsParameters: any }, callback: (res: any) => void) => {
      handleConnectTransport(direction, dtlsParameters, callback);
    });

    // --- Phase 2: produce mic/camera ---
    socket.on("produce", async ({ kind, rtpParameters, appData }: { kind: any; rtpParameters: any; appData?: any }, callback: (res: any) => void) => {
      try {
        if (!currentRoomId) return callback({ success: false, error: "Not in a room" });
        const transport = getTransport(currentRoomId, socket.id, "send");
        if (!transport) return callback({ success: false, error: "Send transport not found" });

        const producer = await createProducer(transport, { kind, rtpParameters, appData });
        setProducer(currentRoomId, socket.id, kind, producer);

        const room = getRoom(currentRoomId);
        const participant = room?.participants.get(socket.id);

        // Tell everyone else in the room a new producer is available, with full user details
        socket.to(currentRoomId).emit("new-producer", {
          socketId: socket.id,
          userId: participant?.userId || socket.id,
          displayName: participant?.displayName || "Participant",
          avatar: participant?.avatar,
          role: participant?.role,
          producerId: producer.id,
          kind,
        });

        callback({ success: true, id: producer.id, producerId: producer.id });
      } catch (err) {
        logger.error("produce failed:", err);
        callback({ success: false, error: "Failed to produce" });
      }
    });

    // --- Phase 2: consume another participant's producer ---
    socket.on("consume", async ({ producerId, rtpCapabilities }: { producerId: string; rtpCapabilities: any }, callback: (res: any) => void) => {
      try {
        if (!currentRoomId) return callback({ success: false, error: "Not in a room" });
        const room = getRoom(currentRoomId);
        const transport = getTransport(currentRoomId, socket.id, "recv");
        if (!room || !transport) {
          return callback({ success: false, error: "Room or recv transport not found" });
        }

        const producer = findProducer(currentRoomId, producerId);
        if (!producer) return callback({ success: false, error: "Producer not found" });

        const consumer = await createConsumer(transport, producer, room.router, rtpCapabilities);
        if (!consumer) return callback({ success: false, error: "Cannot consume" });

        addConsumer(currentRoomId, socket.id, consumer);

        callback({
          success: true,
          params: {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          },
        });
      } catch (err) {
        logger.error("consume failed:", err);
        callback({ success: false, error: "Failed to consume" });
      }
    });

    // --- Phase 2: resume a paused consumer ---
    socket.on("resume-consumer", async ({ consumerId }: { consumerId: string }, callback: (res: any) => void) => {
      try {
        if (!currentRoomId) return callback({ success: false, error: "Not in a room" });
        const room = getRoom(currentRoomId);
        const participant = room?.participants.get(socket.id);
        const consumer = participant?.consumers?.[consumerId];
        if (!consumer) return callback({ success: false, error: "Consumer not found" });

        await consumer.resume();
        callback({ success: true });
      } catch (err) {
        logger.error("resume-consumer failed:", err);
        callback({ success: false, error: "Failed to resume consumer" });
      }
    });

    // --- Phase 2: list existing producers when joining ---
    socket.on("get-producers", (_payload: unknown, callback: (res: any) => void) => {
      if (!currentRoomId) return callback({ success: false, error: "Not in a room", producers: [] });
      const producers = getAllProducersExcept(currentRoomId, socket.id);
      callback({ success: true, producers });
    });

    // --- Leave room & disconnect handling ---
    const handleLeaveRoom = (callback?: (res: any) => void) => {
      if (currentRoomId) {
        const room = getRoom(currentRoomId);
        const participant = room?.participants.get(socket.id);
        const userId = participant?.userId || socket.id;

        removeParticipant(currentRoomId, socket.id);
        socket.to(currentRoomId).emit("participant-left", { socketId: socket.id, userId });
        socket.leave(currentRoomId);
        currentRoomId = null;
      }
      if (typeof callback === "function") {
        callback({ success: true });
      }
    };

    socket.on("leave-room", (_payload: unknown, callback?: (res: any) => void) => {
      handleLeaveRoom(callback);
    });

    socket.on("disconnect", () => {
      handleLeaveRoom();
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });
}
