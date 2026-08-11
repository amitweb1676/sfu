import { Server, Socket } from "socket.io";
import { getOrCreateRoom, addParticipant, removeParticipant } from "../rooms/roomManager";
import { logger } from "../utils/logger";

export function registerSignallingHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    let currentRoomId: string | null = null;

    // Phase 1: only join-room is functional.
    // create-transport / produce / consume are placeholders for Phase 2.
    socket.on("join-room", async (
      payload: { roomId: string; displayName: string },
      callback: (res: { success: boolean; rtpCapabilities?: unknown; error?: string }) => void
    ) => {
      try {
        const { roomId, displayName } = payload;
        const room = await getOrCreateRoom(roomId);

        socket.join(roomId);
        currentRoomId = roomId;
        addParticipant(roomId, socket.id, displayName);

        socket.to(roomId).emit("participant-joined", {
          socketId: socket.id,
          displayName,
        });

        callback({
          success: true,
          rtpCapabilities: room.router.rtpCapabilities,
        });

        logger.info(`${displayName} (${socket.id}) joined room ${roomId}`);
      } catch (err) {
        logger.error("join-room failed:", err);
        callback({ success: false, error: "Failed to join room" });
      }
    });

    // Placeholder for Phase 2 — transport creation for send/receive.
    socket.on("create-transport", (_payload, callback: (res: unknown) => void) => {
      callback({ success: false, error: "Not implemented until Phase 2" });
    });

    // Placeholder for Phase 2 — producing media (mic/camera/screen).
    socket.on("produce", (_payload, callback: (res: unknown) => void) => {
      callback({ success: false, error: "Not implemented until Phase 2" });
    });

    // Placeholder for Phase 2 — consuming other participants' media.
    socket.on("consume", (_payload, callback: (res: unknown) => void) => {
      callback({ success: false, error: "Not implemented until Phase 2" });
    });

    socket.on("disconnect", () => {
      if (currentRoomId) {
        removeParticipant(currentRoomId, socket.id);
        socket.to(currentRoomId).emit("participant-left", { socketId: socket.id });
      }
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });
}
