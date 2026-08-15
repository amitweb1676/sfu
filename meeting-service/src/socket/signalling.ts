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
  getRoomBySocketId,
  getParticipantBySocketId,
} from "../rooms/roomManager";
import { logger } from "../utils/logger";
import { sfuDebug, sfuError } from "../utils/debugLogger";

export function registerSignallingHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    logger.info(`[Signalling] Socket connected: ${socket.id}`);
    sfuDebug("Socket connected", { socketId: socket.id, handshake: socket.handshake.address });

    socket.emit("server-version", { version: "UPDATED ONE", timestamp: Date.now() });

    let currentRoomId: string | null = null;

    // --- Phase 1 & 2: join room ---
    socket.on(
      "join-room",
      async (
        payload: { roomId: string; displayName?: string; userId?: string; avatar?: string; role?: string },
        callback: (res: any) => void
      ) => {
        try {
          const { roomId, displayName, userId, avatar, role } = payload || {};
          sfuDebug("Socket join-room received", { socketId: socket.id, roomId, displayName, userId });

          if (!roomId) {
            sfuError("join-room missing roomId", { socketId: socket.id });
            if (typeof callback === "function") {
              callback({ success: false, error: "roomId is required" });
            }
            return;
          }

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

          sfuDebug("Socket join-room success", {
            socketId: socket.id,
            roomId,
            userId: participant?.userId,
            rtpCapabilitiesCodecs: room.router.rtpCapabilities.codecs?.length,
          });

          if (typeof callback === "function") {
            callback({
              success: true,
              serverVersion: "updated one",
              rtpCapabilities: room.router.rtpCapabilities,
            });
          }

          logger.info(`[Signalling] ${displayName || "Participant"} (${socket.id}) joined room ${roomId}`);
        } catch (err: any) {
          sfuError("join-room handler failed", err);
          if (typeof callback === "function") {
            callback({ success: false, serverVersion: "updated one", error: err?.message || "Failed to join room" });
          }
        }
      }
    );

    // Robust helper for creating WebRTC transport
    const handleCreateTransport = async (
      direction: "send" | "recv",
      payloadOrCb: any,
      maybeCb?: (res: any) => void
    ) => {
      const callback = typeof payloadOrCb === "function" ? payloadOrCb : maybeCb;
      const payload = typeof payloadOrCb === "object" ? payloadOrCb : {};
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;

      sfuDebug(`Socket create-${direction}-transport received`, {
        socketId: socket.id,
        roomId,
        direction,
        payload,
      });

      if (!roomId) {
        sfuError(`create-${direction}-transport failed: Not in a room`, { socketId: socket.id });
        if (typeof callback === "function") {
          callback({ success: false, serverVersion: "updated one", error: "Not in a room" });
        }
        return;
      }

      try {
        const room = getRoom(roomId);
        if (!room) {
          sfuError(`create-${direction}-transport: Room ${roomId} not found`, { socketId: socket.id });
          if (typeof callback === "function") {
            callback({ success: false, serverVersion: "updated one", error: "Room not found" });
          }
          return;
        }

        const peer = room.participants.get(socket.id) || getParticipantBySocketId(socket.id);

        const transport = await createWebRtcTransport(room.router, {
          roomId,
          userId: peer?.userId,
          socketId: socket.id,
          direction,
        });

        setTransport(roomId, socket.id, direction, transport);

        const transportOptions = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        };

        sfuDebug(`Socket create-${direction}-transport response`, {
          socketId: socket.id,
          roomId,
          direction,
          transportId: transport.id,
          iceCandidates: transport.iceCandidates,
        });

        if (typeof callback === "function") {
          callback({
            success: true,
            serverVersion: "updated one",
            transportOptions,
            transportParams: transportOptions,
          });
        }
      } catch (err: any) {
        sfuError(`create-${direction}-transport handler failed`, err);
        if (typeof callback === "function") {
          callback({
            success: false,
            serverVersion: "updated one",
            error: err.message || "Failed to create transport",
          });
        }
      }
    };

    socket.on("create-send-transport", (arg1: any, arg2?: any) => {
      handleCreateTransport("send", arg1, arg2);
    });

    socket.on("create-recv-transport", (arg1: any, arg2?: any) => {
      handleCreateTransport("recv", arg1, arg2);
    });

    socket.on(
      "create-transport",
      (payload: { direction: "send" | "recv"; roomId?: string }, callback: (res: any) => void) => {
        handleCreateTransport(payload?.direction || "send", payload, callback);
      }
    );

    // Helper for connecting WebRTC transport
    const handleConnectTransport = async (
      direction: "send" | "recv",
      data: any,
      callback: (res: any) => void
    ) => {
      try {
        const { dtlsParameters, transportId } = data || {};
        sfuDebug(`Socket connect-${direction}-transport received`, {
          socketId: socket.id,
          direction,
          transportId,
          hasDtlsParameters: Boolean(dtlsParameters),
        });

        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) {
          sfuError(`connect-${direction}-transport failed: Not in a room`, { socketId: socket.id });
          return callback && callback({ success: false, error: "Not in a room" });
        }

        const transport = getTransport(roomId, socket.id, direction);
        if (!transport) {
          sfuError(`connect-${direction}-transport failed: ${direction} transport not found`, {
            socketId: socket.id,
            roomId,
          });
          return callback && callback({ success: false, error: `${direction} transport not found` });
        }

        await transport.connect({ dtlsParameters });

        sfuDebug(`Socket connect-${direction}-transport success`, {
          socketId: socket.id,
          direction,
          transportId: transport.id,
          iceSelectedTuple: (transport as any).iceSelectedTuple,
          tuple: (transport as any).tuple,
        });

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err: any) {
        sfuError(`connect-${direction}-transport failed`, err);
        if (typeof callback === "function") {
          callback({ success: false, error: err.message || `Failed to connect ${direction} transport` });
        }
      }
    };

    socket.on("connect-send-transport", (data: any, callback: (res: any) => void) => {
      handleConnectTransport("send", data, callback);
    });

    socket.on("connect-recv-transport", (data: any, callback: (res: any) => void) => {
      handleConnectTransport("recv", data, callback);
    });

    socket.on(
      "connect-transport",
      ({ direction, dtlsParameters, transportId }: { direction: "send" | "recv"; dtlsParameters: any; transportId?: string }, callback: (res: any) => void) => {
        handleConnectTransport(direction, { dtlsParameters, transportId }, callback);
      }
    );

    // --- Phase 2: produce mic/camera ---
    socket.on(
      "produce",
      async ({ kind, rtpParameters, appData }: { kind: any; rtpParameters: any; appData?: any }, callback: (res: any) => void) => {
        try {
          sfuDebug("Socket produce received", {
            socketId: socket.id,
            kind,
            appData,
            codecCount: rtpParameters?.codecs?.length || 0,
          });

          const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
          if (!roomId) {
            sfuError("produce failed: Not in a room", { socketId: socket.id });
            return callback && callback({ success: false, error: "Not in a room" });
          }

          const transport = getTransport(roomId, socket.id, "send");
          if (!transport) {
            sfuError("produce failed: Send transport not found", { socketId: socket.id, roomId });
            return callback && callback({ success: false, error: "Send transport not found for produce" });
          }

          const room = getRoom(roomId);
          const participant = room?.participants.get(socket.id) || getParticipantBySocketId(socket.id);

          const producer = await createProducer(transport, {
            kind,
            rtpParameters,
            appData: {
              socketId: socket.id,
              userId: participant?.userId || socket.id,
              kind,
              ...(appData || {}),
            },
          });

          setProducer(roomId, socket.id, kind, producer);

          // Tell everyone else in the room a new producer is available, with full user details
          socket.to(roomId).emit("new-producer", {
            socketId: socket.id,
            userId: participant?.userId || socket.id,
            displayName: participant?.displayName || "Participant",
            avatar: participant?.avatar,
            role: participant?.role,
            producerId: producer.id,
            kind,
          });

          sfuDebug("Socket produce response", {
            socketId: socket.id,
            producerId: producer.id,
            kind,
          });

          if (typeof callback === "function") {
            callback({ success: true, id: producer.id, producerId: producer.id });
          }
        } catch (err: any) {
          sfuError("produce handler failed", err);
          if (typeof callback === "function") {
            callback({ success: false, error: err.message || "Failed to produce" });
          }
        }
      }
    );

    // --- Phase 2: consume another participant's producer ---
    socket.on(
      "consume",
      async (
        { producerId, rtpCapabilities, transportId }: { producerId: string; rtpCapabilities: any; transportId?: string },
        callback: (res: any) => void
      ) => {
        try {
          sfuDebug("Socket consume received", {
            socketId: socket.id,
            transportId,
            producerId,
            hasRtpCapabilities: Boolean(rtpCapabilities),
          });

          const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
          if (!roomId) {
            sfuError("consume failed: Not in a room", { socketId: socket.id });
            return callback && callback({ success: false, error: "Not in a room" });
          }

          const room = getRoom(roomId);
          const transport = getTransport(roomId, socket.id, "recv");
          if (!room || !transport) {
            sfuError("consume failed: Room or recv transport not found", { socketId: socket.id, roomId });
            return callback && callback({ success: false, error: "Room or recv transport not found" });
          }

          const producer = findProducer(roomId, producerId);
          if (!producer) {
            sfuError(`consume failed: Producer ${producerId} not found in room ${roomId}`, { socketId: socket.id });
            return callback && callback({ success: false, error: "Producer not found" });
          }

          const consumer = await createConsumer(transport, producer, room.router, rtpCapabilities);
          if (!consumer) {
            sfuError(`consume failed: Cannot consume producer ${producerId}`, { socketId: socket.id });
            return callback && callback({ success: false, error: "Router cannot consume this producer" });
          }

          addConsumer(roomId, socket.id, consumer);

          const params = {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          };

          sfuDebug("Socket consume response", {
            socketId: socket.id,
            consumerId: consumer.id,
            producerId,
            kind: consumer.kind,
          });

          if (typeof callback === "function") {
            callback({
              success: true,
              params,
            });
          }
        } catch (err: any) {
          sfuError("consume handler failed", err);
          if (typeof callback === "function") {
            callback({ success: false, error: err.message || "Failed to consume" });
          }
        }
      }
    );

    // --- Phase 2: resume a paused consumer ---
    socket.on("resume-consumer", async ({ consumerId }: { consumerId: string }, callback: (res: any) => void) => {
      try {
        sfuDebug("Socket resume-consumer received", { socketId: socket.id, consumerId });
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) return callback && callback({ success: false, error: "Not in a room" });

        const room = getRoom(roomId);
        const participant = room?.participants.get(socket.id);
        const consumer = participant?.consumers?.[consumerId];
        if (!consumer) {
          sfuError(`resume-consumer failed: Consumer ${consumerId} not found`, { socketId: socket.id });
          return callback && callback({ success: false, error: "Consumer not found" });
        }

        await consumer.resume();
        sfuDebug("Socket resume-consumer success", { socketId: socket.id, consumerId });

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err: any) {
        sfuError("resume-consumer failed", err);
        if (typeof callback === "function") {
          callback({ success: false, error: err.message || "Failed to resume consumer" });
        }
      }
    });

    // --- Phase 2: list existing producers when joining ---
    socket.on("get-producers", (_payload: unknown, callback: (res: any) => void) => {
      const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      sfuDebug("Socket get-producers received", { socketId: socket.id, roomId });

      if (!roomId) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Not in a room", producers: [] });
        }
        return;
      }
      const producers = getAllProducersExcept(roomId, socket.id);
      sfuDebug("Socket get-producers response", { socketId: socket.id, roomId, count: producers.length });

      if (typeof callback === "function") {
        callback({ success: true, producers });
      }
    });

    // --- Leave room & disconnect handling ---
    const handleLeaveRoom = (callback?: (res: any) => void) => {
      const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      sfuDebug("Socket handleLeaveRoom", { socketId: socket.id, roomId });
      if (roomId) {
        const room = getRoom(roomId);
        const participant = room?.participants.get(socket.id);
        const userId = participant?.userId || socket.id;

        removeParticipant(roomId, socket.id);
        socket.to(roomId).emit("participant-left", { socketId: socket.id, userId });
        socket.leave(roomId);
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
      sfuDebug("Socket disconnected", { socketId: socket.id });
    });
  });
}
