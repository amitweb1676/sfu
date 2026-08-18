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
  getTransportById,
  setProducer,
  addProducer,
  getAllProducersExcept,
  getProducersInRoom,
  findProducer,
  addConsumer,
  findConsumer,
  removeAllProducersAndConsumersFor,
  getRoom,
  getRoomBySocketId,
  getParticipantBySocketId,
  getRouter,
} from "../rooms/roomManager";
import { logger } from "../utils/logger";
import { config } from "../config";

export function registerSignallingHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    socket.emit("server-version", {
      version: "UPDATED ONE",
      timestamp: Date.now(),
      iceServers: config.iceServers,
    });

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
              iceServers: config.iceServers,
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
        if (typeof callback === "function") {
          callback({ success: false, serverVersion: "updated one", error: "Not in a room" });
        }
        return;
      }

      try {
        const room = getRoom(roomId);
        if (!room) {
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
          iceServers: config.iceServers,
        };

        if (typeof callback === "function") {
          callback({
            success: true,
            serverVersion: "updated one",
            transportOptions,
            transportParams: transportOptions,
            iceServers: config.iceServers,
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
        const { dtlsParameters, transportId } = data || {};
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;

        if (!roomId) {
          return callback && callback({ success: false, error: "Not in a room" });
        }

        const transport = (transportId ? getTransportById(roomId, transportId) : undefined) || getTransport(roomId, socket.id, direction);
        if (!transport) {
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

    socket.on("connect-recv-transport", async ({ transportId, dtlsParameters }: any, callback: (res: any) => void) => {
      const roomId = getRoomBySocketId(socket.id)?.roomId || currentRoomId;
      if (!roomId) {
        if (typeof callback === "function") callback({ success: false, error: "No room" });
        return;
      }
      const transport = (transportId ? getTransportById(roomId, transportId) : undefined) || getTransport(roomId, socket.id, "recv");
      if (!transport) {
        if (typeof callback === "function") callback({ success: false, error: "Recv transport not found" });
        return;
      }
      try {
        await transport.connect({ dtlsParameters });
        callback({ success: true });
      } catch (err: any) {
        callback({ success: false, error: err.message });
      }
    });

    socket.on(
      "connect-transport",
      ({ direction, dtlsParameters, transportId }: { direction: "send" | "recv"; dtlsParameters: any; transportId?: string }, callback: (res: any) => void) => {
        handleConnectTransport(direction, { dtlsParameters, transportId }, callback);
      }
    );

    // Store owner socketId on every producer so we can filter it out for the owner
    socket.on("produce", async ({ kind, rtpParameters, transportId, appData }: any, callback: (res: any) => void) => {
      try {
        const roomId = getRoomBySocketId(socket.id)?.roomId || currentRoomId;
        if (!roomId) return callback && callback({ success: false, error: "No room" });

        const room = getRoom(roomId);
        const participant = room?.participants.get(socket.id) || getParticipantBySocketId(socket.id);
        const transport = (transportId ? getTransportById(roomId, transportId) : undefined) || getTransport(roomId, socket.id, "send");
        if (!transport) {
          return callback && callback({ success: false, error: "Send transport not found" });
        }

        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData: {
            socketId: socket.id,
            userId: participant?.userId || socket.id,
            kind,
            ...(appData || {}),
          },
        });

        addProducer(roomId, producer, socket.id);
        console.log("[produce]", { socketId: socket.id, kind, producerId: producer.id });

        if (typeof callback === "function") {
          callback({ success: true, id: producer.id, producerId: producer.id });
        }

        // Notify everyone else in the room, not the sender
        socket.to(roomId).emit("newProducer", {
          producerId: producer.id,
          kind: producer.kind,
          socketId: socket.id,
        });

        socket.to(roomId).emit("new-producer", {
          producerId: producer.id,
          kind: producer.kind,
          socketId: socket.id,
        });
      } catch (err: any) {
        logger.error("produce handler failed:", err);
        if (typeof callback === "function") {
          callback({ success: false, error: err.message || "Failed to produce" });
        }
      }
    });

    // Return ALL existing producers except the requester's own
    socket.on("get-producers", (payload: any, callback: (res: any) => void) => {
      const roomId = (payload && typeof payload === "object" ? payload.roomId : undefined) || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId) {
        if (typeof callback === "function") callback({ success: false, error: "No room", producers: [] });
        return;
      }

      const producers = getProducersInRoom(roomId).filter(
        (p) => (p.appData as any)?.socketId !== socket.id
      );

      console.log("[get-producers]", {
        requester: socket.id,
        count: producers.length,
      });

      if (typeof callback === "function") {
        callback({
          success: true,
          producers: producers.map((p) => ({
            producerId: p.id,
            kind: p.kind,
            socketId: (p.appData as any)?.socketId,
          })),
        });
      }
    });

    socket.on("consume", async ({ transportId, producerId, rtpCapabilities }: any, callback: (res: any) => void) => {
      try {
        const roomId = getRoomBySocketId(socket.id)?.roomId || currentRoomId;
        if (!roomId) return callback && callback({ success: false, error: "No room" });

        const room = getRoom(roomId);
        const router = room?.router || getRouter(roomId);
        if (!router) return callback && callback({ success: false, error: "Router not found" });

        if (!router.canConsume({ producerId, rtpCapabilities })) {
          return callback && callback({ success: false, error: "Cannot consume" });
        }

        const transport = (transportId ? getTransportById(roomId, transportId) : undefined) || getTransport(roomId, socket.id, "recv");
        if (!transport) {
          return callback && callback({ success: false, error: "Recv transport not found" });
        }

        const producer = findProducer(roomId, producerId);
        if (!producer) {
          return callback && callback({ success: false, error: "Producer not found" });
        }

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // always start paused, resume explicitly after frontend is ready
        });

        consumer.on("transportclose", () => {
          consumer.close();
        });

        consumer.on("producerclose", () => {
          consumer.close();
        });

        addConsumer(roomId, socket.id, consumer);
        console.log("[consume-created]", { socketId: socket.id, producerId, consumerId: consumer.id });

        if (typeof callback === "function") {
          callback({
            success: true,
            params: {
              id: consumer.id,
              producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
            },
          });
        }
      } catch (err: any) {
        logger.error("consume failed:", err);
        if (typeof callback === "function") {
          callback({ success: false, error: err.message || "Failed to consume" });
        }
      }
    });

    socket.on("set-consumer-layers", async ({ consumerId, spatialLayer, temporalLayer }: { consumerId: string; spatialLayer: number; temporalLayer?: number }, callback?: (res: any) => void) => {
      try {
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) return callback && callback({ success: false, error: "Not in a room" });

        const room = getRoom(roomId);
        const participant = room?.participants.get(socket.id);
        const consumer = participant?.consumers?.[consumerId];
        if (!consumer) {
          return callback && callback({ success: false, error: "Consumer not found" });
        }

        await consumer.setPreferredLayers({ spatialLayer, temporalLayer });
        if (typeof callback === "function") callback({ success: true });
      } catch (err: any) {
        logger.error("set-consumer-layers failed:", err);
        if (typeof callback === "function") callback({ success: false, error: err.message });
      }
    });

    socket.on("resume-consumer", async ({ consumerId }: { consumerId: string }, callback?: (res: any) => void) => {
      try {
        const consumer = findConsumer(socket.id, consumerId);
        if (!consumer) return callback?.({ success: false, error: "Consumer not found" });

        await consumer.resume();
        console.log("[consumer-resumed]", { socketId: socket.id, consumerId });
        callback?.({ success: true });
      } catch (err: any) {
        logger.error("resume-consumer failed:", err);
        callback?.({ success: false, error: err.message });
      }
    });

    socket.on("pause-producer", async ({ producerId }: { producerId: string }, callback?: (res: any) => void) => {
      try {
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) return callback && callback({ success: false, error: "Not in a room" });

        const producer = findProducer(roomId, producerId);
        if (!producer) {
          return callback && callback({ success: false, error: "Producer not found" });
        }

        await producer.pause();
        socket.to(roomId).emit("producer-paused", { producerId, socketId: socket.id });
        if (typeof callback === "function") callback({ success: true });
      } catch (err: any) {
        logger.error("pause-producer failed:", err);
        if (typeof callback === "function") callback({ success: false, error: err.message });
      }
    });

    socket.on("resume-producer", async ({ producerId }: { producerId: string }, callback?: (res: any) => void) => {
      try {
        const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) return callback && callback({ success: false, error: "Not in a room" });

        const producer = findProducer(roomId, producerId);
        if (!producer) {
          return callback && callback({ success: false, error: "Producer not found" });
        }

        await producer.resume();
        socket.to(roomId).emit("producer-resumed", { producerId, socketId: socket.id });
        if (typeof callback === "function") callback({ success: true });
      } catch (err: any) {
        logger.error("resume-producer failed:", err);
        if (typeof callback === "function") callback({ success: false, error: err.message });
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
      removeAllProducersAndConsumersFor(socket.id);
      if (typeof callback === "function") {
        callback({ success: true });
      }
    };

    socket.on("leave-room", (_payload: unknown, callback?: (res: any) => void) => {
      handleLeaveRoom(callback);
    });

    // Cleanup on disconnect - required so ghost producers don't get "consumed" later
    socket.on("disconnect", () => {
      handleLeaveRoom();
    });
  });
}

