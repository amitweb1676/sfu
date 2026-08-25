import { registerHostControlEvents } from "../host-controls/registerHostControlEvents";
import { createRoomAdapter } from "../host-controls/createRoomAdapter";
import { getRoomControlState } from "../host-controls/hostControl.state";
import * as roomManager from "../rooms/roomManager";
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
  removeProducer,
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
  setRoomLocked,
  isRoomLocked,
  getParticipant,
  setHandRaised,
  setRole,
  setParticipantApproved,
  listParticipants,
  setParticipantMutedByHost,
  setParticipantVideoHiddenByHost,
  setRoomAllMuted,
  getRoomAllMuted,
  setRoomAllVideoHidden,
  getRoomAllVideoHidden,
  setRoomHostUserId,
  getRoomHostUserId,
  addAdmittedUserId,
  isUserAdmitted,
} from "../rooms/roomManager";
import { logger } from "../utils/logger";
import { config } from "../config";

const roomAdapter = createRoomAdapter(roomManager);

export function registerSignallingHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    const hostControlService = registerHostControlEvents({ io, socket, roomAdapter });
    socket.emit("server-version", {
      version: "UPDATED ONE",
      timestamp: Date.now(),
      iceServers: config.iceServers,
    });

    let currentRoomId: string | null = null;

    const isPrivileged = (roomId: string): boolean => {
      const p = getParticipant(roomId, socket.id);
      const hostUid = getRoomHostUserId(roomId);
      return p?.role === "host" || p?.role === "co-host" || (!!hostUid && p?.userId === hostUid);
    };

    const broadcastParticipants = (roomId: string) => {
      io.to(roomId).emit("participants-updated", {
        participants: listParticipants(roomId),
        locked: isRoomLocked(roomId),
      });
    };

    socket.on(
      "join-room",
      async (
        payload: { roomId: string; displayName?: string; userId?: string; avatar?: string; role?: string; isHost?: boolean },
        callback: (res: any) => void
      ) => {
        try {
          const { roomId, displayName, userId, avatar, role, isHost } = payload || {};

          if (!roomId) {
            if (typeof callback === "function") {
              callback({ success: false, error: "roomId is required" });
            }
            return;
          }

          const room = await getOrCreateRoom(roomId);

          socket.join(roomId);
          currentRoomId = roomId;
          socket.data.roomId = roomId;

          const joiningUserId = String(userId || socket.id);

          // ── Host identity resolution ─────────────────────────────────────────
          // If the client is the verified meeting host/creator, bind host identity.
          if (isHost === true) {
            setRoomHostUserId(roomId, joiningUserId, true);
          } else if (!getRoomHostUserId(roomId)) {
            // Only claim initial host if no host was ever set
            setRoomHostUserId(roomId, joiningUserId, false);
          }

          const roomHostUserId = getRoomHostUserId(roomId);

          // ── Authoritative role resolution ────────────────────────────────────
          // host   → isHost flag is true OR userId matches room's stored hostUserId
          // co-host → explicit co-host role
          // participant → everyone else
          let finalRole: string;
          if (isHost === true || (roomHostUserId && joiningUserId === roomHostUserId)) {
            finalRole = "host";
          } else if (role === "co-host") {
            finalRole = "co-host";
          } else {
            finalRole = "participant";
          }

          const locked = isRoomLocked(roomId);
          // Hosts and co-hosts are always approved.
          // Participants are approved if:
          // 1. Room is not locked, OR
          // 2. The user was previously admitted into this room session.
          const previouslyAdmitted = isUserAdmitted(roomId, joiningUserId);
          const isApproved = finalRole === "host" || finalRole === "co-host" || !locked || previouslyAdmitted;

          if (isApproved) {
            addAdmittedUserId(roomId, joiningUserId);
          }

          // Fetch room-level media state so late joiners sync immediately
          const roomAllMuted = getRoomAllMuted(roomId);
          const roomAllVideoHidden = getRoomAllVideoHidden(roomId);

          const participant = addParticipant(roomId, socket.id, {
            displayName: displayName || "Participant",
            userId: joiningUserId,
            avatar,
            role: finalRole,
          });
          if (participant) {
            participant.approved = isApproved;
          }
          attachMediaContainers(roomId, socket.id);

          socket.to(roomId).emit("participant-joined", {
            socketId: socket.id,
            userId: participant?.userId || socket.id,
            displayName: participant?.displayName || displayName,
            avatar: participant?.avatar,
            role: participant?.role || finalRole,
            handRaised: false,
            approved: isApproved,
          });

          broadcastParticipants(roomId);
          hostControlService.recordLifecycle(roomId, "PARTICIPANT_JOINED", participant, { approved: isApproved });

          if (typeof callback === "function") {
            callback({
              success: true,
              serverVersion: "updated one",
              rtpCapabilities: room.router.rtpCapabilities,
              iceServers: config.iceServers,
              role: finalRole,
              locked,
              approved: isApproved,
              allMuted: roomAllMuted,
              allVideoHidden: roomAllVideoHidden,
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

        const controlState = getRoomControlState(roomId);
        const source = appData && appData.source;
        const privileged = participant && (participant.role === "host" || participant.role === "cohost" || participant.role === "co-host");

        if (!participant || participant.approved === false) {
          return callback && callback({ success: false, error: "Participant is not admitted" });
        }
        if (source === "screen" && !privileged && !controlState.policy.participantScreenShareAllowed) {
          return callback && callback({ success: false, error: "SCREEN_SHARE_DISABLED" });
        }
        if (kind === "audio" && !privileged && (participant.mutedByHost || !controlState.policy.participantsCanUnmute || getRoomAllMuted(roomId))) {
          return callback && callback({ success: false, error: "PARTICIPANT_UNMUTE_DISABLED" });
        }
        if (kind === "video" && source !== "screen" && !privileged && (participant.videoHiddenByHost || !controlState.policy.participantsCanEnableVideo || getRoomAllVideoHidden(roomId))) {
          return callback && callback({ success: false, error: "PARTICIPANT_VIDEO_DISABLED" });
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
        console.log("[produce]", { socketId: socket.id, kind, producerId: producer.id, appData: producer.appData });

        if (typeof callback === "function") {
          callback({ success: true, id: producer.id, producerId: producer.id });
        }

        // Notify everyone else in the room, not the sender
        socket.to(roomId).emit("newProducer", {
          producerId: producer.id,
          kind: producer.kind,
          socketId: socket.id,
          appData: producer.appData,
        });

        socket.to(roomId).emit("new-producer", {
          producerId: producer.id,
          kind: producer.kind,
          socketId: socket.id,
          appData: producer.appData,
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
            appData: p.appData,
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
        console.log("[consume-created]", { socketId: socket.id, producerId, consumerId: consumer.id, appData: producer.appData });

        if (typeof callback === "function") {
          callback({
            success: true,
            params: {
              id: consumer.id,
              producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              appData: producer.appData,
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

    socket.on("close-producer", async ({ producerId, roomId }: { producerId: string; roomId?: string }, callback?: (res: any) => void) => {
      try {
        const effectiveRoomId = roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!effectiveRoomId) return callback && callback({ success: false, error: "Not in a room" });

        const producer = findProducer(effectiveRoomId, producerId);
        const appData = producer?.appData;
        removeProducer(effectiveRoomId, socket.id, producerId);

        socket.to(effectiveRoomId).emit("producer-closed", { producerId, socketId: socket.id, appData });
        console.log("[producer-closed]", { socketId: socket.id, producerId, appData });

        if (typeof callback === "function") callback({ success: true });
      } catch (err: any) {
        logger.error("close-producer failed:", err);
        if (typeof callback === "function") callback({ success: false, error: err.message });
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
        socket.to(roomId).emit("producer-paused", { producerId, socketId: socket.id, appData: producer.appData });
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

        const participant = getParticipant(roomId, socket.id);
        const privileged = participant && (participant.role === "host" || participant.role === "cohost" || participant.role === "co-host");
        const controlState = getRoomControlState(roomId);
        if (producer.kind === "audio" && !privileged && (participant?.mutedByHost || !controlState.policy.participantsCanUnmute || getRoomAllMuted(roomId))) {
          return callback && callback({ success: false, error: "PARTICIPANT_UNMUTE_DISABLED" });
        }
        if (producer.kind === "video" && producer.appData?.source !== "screen" && !privileged && (participant?.videoHiddenByHost || !controlState.policy.participantsCanEnableVideo || getRoomAllVideoHidden(roomId))) {
          return callback && callback({ success: false, error: "PARTICIPANT_VIDEO_DISABLED" });
        }

        await producer.resume();
        socket.to(roomId).emit("producer-resumed", { producerId, socketId: socket.id, appData: producer.appData });
        if (typeof callback === "function") callback({ success: true });
      } catch (err: any) {
        logger.error("resume-producer failed:", err);
        if (typeof callback === "function") callback({ success: false, error: err.message });
      }
    });

    socket.on("user-toggle-media", ({ roomId, type, enabled }: { roomId?: string; type: "video" | "audio"; enabled: boolean }) => {
      const effectiveRoomId = roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!effectiveRoomId) return;
      socket.to(effectiveRoomId).emit("user-media-state", { socketId: socket.id, type, enabled });
    });

    // ---------- PHASE 3: CHAT (RELIABLE BROADCAST) ----------
    socket.on("chat-message", (payload: any, ack?: (res: any) => void) => {
      try {
        const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
        if (!roomId) {
          if (typeof ack === "function") ack({ success: false, error: "no-room" });
          return;
        }

        const message = {
          id: payload?.message?.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          roomId,
          senderId: payload?.message?.senderId || payload?.userId || socket.id,
          senderName: payload?.message?.senderName || payload?.name || "Guest",
          senderAvatar: payload?.message?.senderAvatar || payload?.avatar || "",
          text: String(payload?.message?.text || payload?.text || "").substring(0, 2000),
          timestamp: payload?.message?.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          ts: Date.now(),
        };

        // Broadcast to EVERYONE in room INCLUDING sender for single source of truth
        io.to(roomId).emit("chat-message", message);
        logger.info(`[chat] ${message.senderName}: ${message.text}`);
        if (typeof ack === "function") ack({ success: true, id: message.id });
      } catch (err: any) {
        logger.error(`[chat] error: ${err?.message}`);
        if (typeof ack === "function") ack({ success: false, error: err?.message });
      }
    });

    // ---------- PHASE 3: RAISE HAND ----------
    socket.on("raise-hand", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId) {
        if (typeof ack === "function") ack({ success: false });
        return;
      }
      const raised = !!payload?.raised;
      setHandRaised(roomId, socket.id, raised);
      io.to(roomId).emit("hand-updated", { socketId: socket.id, raised });
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: ROOM LOCK / UNLOCK ----------
    socket.on("lock-room", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const locked = !!payload?.locked;
      setRoomLocked(roomId, locked);
      io.to(roomId).emit("room-lock-changed", { locked });
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true, locked });
    });

    // ---------- PHASE 3: MUTE A PARTICIPANT (INDIVIDUAL) ----------
    socket.on("mute-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        setParticipantMutedByHost(roomId, targetSocketId, true);
        io.to(targetSocketId).emit("force-mute", { type: "audio", muted: true, individual: true });
        broadcastParticipants(roomId);
      }
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: UNMUTE A PARTICIPANT (INDIVIDUAL) ----------
    socket.on("unmute-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        setParticipantMutedByHost(roomId, targetSocketId, false);
        io.to(targetSocketId).emit("force-mute", { type: "audio", muted: false, individual: true });
        broadcastParticipants(roomId);
      }
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: HIDE PARTICIPANT VIDEO (INDIVIDUAL) ----------
    socket.on("hide-video-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        setParticipantVideoHiddenByHost(roomId, targetSocketId, true);
        io.to(targetSocketId).emit("force-video", { hidden: true, individual: true });
        broadcastParticipants(roomId);
      }
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: UNHIDE PARTICIPANT VIDEO (INDIVIDUAL) ----------
    socket.on("unhide-video-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        setParticipantVideoHiddenByHost(roomId, targetSocketId, false);
        io.to(targetSocketId).emit("force-video", { hidden: false, individual: true });
        broadcastParticipants(roomId);
      }
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: MUTE ALL (except host) ----------
    socket.on("mute-all", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      setRoomAllMuted(roomId, true);
      socket.to(roomId).emit("force-mute", { type: "audio", muted: true, individual: false });
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: UNMUTE ALL ----------
    socket.on("unmute-all", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      setRoomAllMuted(roomId, false);
      // Emit force-mute with muted:false so all clients know they can unmute
      socket.to(roomId).emit("force-mute", { type: "audio", muted: false, individual: false });
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: HIDE ALL VIDEOS ----------
    socket.on("hide-all-videos", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      setRoomAllVideoHidden(roomId, true);
      socket.to(roomId).emit("force-video", { hidden: true, individual: false });
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: UNHIDE ALL VIDEOS ----------
    socket.on("unhide-all-videos", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      setRoomAllVideoHidden(roomId, false);
      socket.to(roomId).emit("force-video", { hidden: false, individual: false });
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: REMOVE / KICK ----------
    socket.on("remove-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        io.to(targetSocketId).emit("kicked", { reason: "removed-by-host" });
        const target = io.sockets.sockets.get(targetSocketId);
        if (target) {
          target.leave(roomId);
          target.disconnect(true);
        }
      }
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: PROMOTE / DEMOTE ROLE ----------
    socket.on("set-role", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      const role = payload?.role;
      if (targetSocketId && role) {
        setRole(roomId, targetSocketId, role);
        io.to(targetSocketId).emit("role-changed", { role });
      }
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: WAITING ROOM: approve / reject ----------
    socket.on("admit-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        const targetParticipant = getParticipant(roomId, targetSocketId);
        if (targetParticipant?.userId) {
          addAdmittedUserId(roomId, targetParticipant.userId);
        }
        setParticipantApproved(roomId, targetSocketId, true);
        hostControlService.recordLifecycle(roomId, "PARTICIPANT_ADMITTED", targetParticipant);
        io.to(targetSocketId).emit("admitted", { roomId });
      }
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    socket.on("reject-participant", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId || !isPrivileged(roomId)) {
        if (typeof ack === "function") ack({ success: false, error: "not-host" });
        return;
      }
      const targetSocketId = payload?.targetSocketId;
      if (targetSocketId) {
        const targetParticipant = getParticipant(roomId, targetSocketId);
        hostControlService.recordLifecycle(roomId, "PARTICIPANT_REJECTED", targetParticipant);
        io.to(targetSocketId).emit("rejected", { roomId });
        const target = io.sockets.sockets.get(targetSocketId);
        if (target) {
          target.leave(roomId);
          target.disconnect(true);
        }
      }
      broadcastParticipants(roomId);
      if (typeof ack === "function") ack({ success: true });
    });

    // ---------- PHASE 3: Snapshot request ----------
    socket.on("get-participants", (payload: any, ack?: (res: any) => void) => {
      const roomId = payload?.roomId || currentRoomId || getRoomBySocketId(socket.id)?.roomId;
      if (!roomId) {
        if (typeof ack === "function") ack({ success: false });
        return;
      }
      if (typeof ack === "function") {
        ack({
          success: true,
          participants: listParticipants(roomId),
          locked: isRoomLocked(roomId),
          allMuted: getRoomAllMuted(roomId),
          allVideoHidden: getRoomAllVideoHidden(roomId),
        });
      }
    });

    const handleLeaveRoom = (callback?: (res: any) => void) => {
      const roomId = currentRoomId || getRoomBySocketId(socket.id)?.roomId;

      if (roomId) {
        const room = getRoom(roomId);
        const participant = room?.participants.get(socket.id);
        const userId = participant?.userId || socket.id;

        if (participant) {
          hostControlService.recordLifecycle(roomId, "PARTICIPANT_LEFT", participant, { reason: "SOCKET_DISCONNECTED" });
        }
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

