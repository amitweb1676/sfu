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

export function registerSignallingHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    socket.emit("server-version", { version: "UPDATED ONE", timestamp: Date.now() });

    let currentRoomId: string | null = null;

    socket.on(
      "join-room",
      async (
        payload: { roomId: string; displayName?: string; userId?: string; avatar?: string; role?: string },
        callback: (res: any) => void
      ) => {
        try {
          const { roomId, displayName, userId, avatar, role } = payload || {};

          if (!roomId) {
            logger.error(`join-room failed: roomId is required (socket: ${socket.id})`);
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

          if (typeof callback === "function") {
            callback({
              success: true,
              serverVersion: "updated one",
              rtpCapabilities: room.router.rtpCapabilities,
            });
          }
        } catch (err: any) {
          logger.error("join-room handler failed:", err);
          if (typeof callback === "function") {
            callback({ success: false, serverVersion: "updated one", error: err?.message || "Failed to join room" });
          }
        }
      }
    );

    const handleCreateTransport = async (
      direction: "send" | "recv",
      payloadOrCb: any,
      maybeCb?: (res: any) => void
    ) => {
      const callback = typeof payloadOrCb === "function" ? payloadOrCb : maybeCb;
      const payload = typeof payloadOrCb === "object" ? payloadOrCb : {};
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;

      if (!roomId) {
        logger.error(`create-${direction}-transport failed: Not in a room (socket: ${socket.id})`);
        if (typeof callback === "function") {
          callback({ success: false, serverVersion: "updated one", error: "Not in a room" });
        }
        return;
      }

      try {
        const room = getRoom(roomId);
        if (!room) {
          logger.error(`create-${direction}-transport failed: Room ${roomId} not found (socket: ${socket.id})`);
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

        if (typeof callback === "function") {
          callback({
            success: true,
            serverVersion: "updated one",
            transportOptions,
            transportParams: transportOptions,
          });
        }
      } catch (err: any) {
        logger.error(`create-${direction}-transport handler failed:`, err);
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

    const handleConnectTransport = async (
      direction: "send" | "recv",
      data: any,
      callback: (res: any) => void
    ) => {
      try {
        const { dtlsParameters } = data || {};
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;

        if (!roomId) {
          logger.error(`connect-${direction}-transport failed: Not in a room (socket: ${socket.id})`);
          return callback && callback({ success: false, error: "Not in a room" });
        }

        const transport = getTransport(roomId, socket.id, direction);
        if (!transport) {
          logger.error(`connect-${direction}-transport failed: ${direction} transport not found (socket: ${socket.id})`);
          return callback && callback({ success: false, error: `${direction} transport not found` });
        }

        await transport.connect({ dtlsParameters });

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err: any) {
        logger.error(`connect-${direction}-transport failed:`, err);
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

    socket.on(
      "produce",
      async ({ kind, rtpParameters, appData }: { kind: any; rtpParameters: any; appData?: any }, callback: (res: any) => void) => {
        try {
          const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
          if (!roomId) {
            logger.error(`produce failed: Not in a room (socket: ${socket.id})`);
            return callback && callback({ success: false, error: "Not in a room" });
          }

          const transport = getTransport(roomId, socket.id, "send");
          if (!transport) {
            logger.error(`produce failed: Send transport not found (socket: ${socket.id})`);
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

          socket.to(roomId).emit("new-producer", {
            socketId: socket.id,
            userId: participant?.userId || socket.id,
            displayName: participant?.displayName || "Participant",
            avatar: participant?.avatar,
            role: participant?.role,
            producerId: producer.id,
            kind,
          });

          if (typeof callback === "function") {
            callback({ success: true, id: producer.id, producerId: producer.id });
          }
        } catch (err: any) {
          logger.error("produce handler failed:", err);
          if (typeof callback === "function") {
            callback({ success: false, error: err.message || "Failed to produce" });
          }
        }
      }
    );

    socket.on(
      "consume",
      async (
        { producerId, rtpCapabilities }: { producerId: string; rtpCapabilities: any; transportId?: string },
        callback: (res: any) => void
      ) => {
        try {
          const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
          if (!roomId) {
            logger.error(`consume failed: Not in a room (socket: ${socket.id})`);
            return callback && callback({ success: false, error: "Not in a room" });
          }

          const room = getRoom(roomId);
          const transport = getTransport(roomId, socket.id, "recv");
          if (!room || !transport) {
            logger.error(`consume failed: Room or recv transport not found (socket: ${socket.id})`);
            return callback && callback({ success: false, error: "Room or recv transport not found" });
          }

          const producer = findProducer(roomId, producerId);
          if (!producer) {
            logger.error(`consume failed: Producer ${producerId} not found in room ${roomId} (socket: ${socket.id})`);
            return callback && callback({ success: false, error: "Producer not found" });
          }

          const consumer = await createConsumer(transport, producer, room.router, rtpCapabilities);
          if (!consumer) {
            logger.error(`consume failed: Cannot consume producer ${producerId} (socket: ${socket.id})`);
            return callback && callback({ success: false, error: "Router cannot consume this producer" });
          }

          addConsumer(roomId, socket.id, consumer);

          const params = {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          };

          if (typeof callback === "function") {
            callback({
              success: true,
              params,
            });
          }
        } catch (err: any) {
          logger.error("consume handler failed:", err);
          if (typeof callback === "function") {
            callback({ success: false, error: err.message || "Failed to consume" });
          }
        }
      }
    );

    socket.on("resume-consumer", async ({ consumerId }: { consumerId: string }, callback: (res: any) => void) => {
      try {
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) return callback && callback({ success: false, error: "Not in a room" });

        const room = getRoom(roomId);
        const participant = room?.participants.get(socket.id);
        const consumer = participant?.consumers?.[consumerId];
        if (!consumer) {
          logger.error(`resume-consumer failed: Consumer ${consumerId} not found (socket: ${socket.id})`);
          return callback && callback({ success: false, error: "Consumer not found" });
        }

        await consumer.resume();

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err: any) {
        logger.error("resume-consumer failed:", err);
        if (typeof callback === "function") {
          callback({ success: false, error: err.message || "Failed to resume consumer" });
        }
      }
    });

    socket.on("get-producers", (_payload: unknown, callback: (res: any) => void) => {
      const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;

      if (!roomId) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Not in a room", producers: [] });
        }
        return;
      }
      const producers = getAllProducersExcept(roomId, socket.id);

      if (typeof callback === "function") {
        callback({ success: true, producers });
      }
    });

    const handleLeaveRoom = (callback?: (res: any) => void) => {
      const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;

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
    });
  });
}
