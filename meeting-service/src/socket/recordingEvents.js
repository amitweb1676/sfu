const { startRoomRecording, stopRoomRecording } = require("../recording/recordingManager");

let ioInstance = null;

function registerRecordingEvents(io, socket, room) {
  ioInstance = io;

  socket.on("host:start-recording", async () => {
    try {
      await startRoomRecording(room.roomId, room);
      io.to(room.roomId).emit("recording-status", { active: true });
    } catch (err) {
      console.error("[RecordingEvents] host:start-recording failed:", err);
    }
  });

  socket.on("host:stop-recording", async () => {
    try {
      const files = await stopRoomRecording(room.roomId);
      io.to(room.roomId).emit("recording-status", { active: false, files });
    } catch (err) {
      console.error("[RecordingEvents] host:stop-recording failed:", err);
    }
  });
}

function broadcastTranscript(roomId, participantId, text) {
  if (ioInstance && roomId) {
    ioInstance.to(roomId).emit("transcript-update", {
      participantId,
      text,
      timestamp: Date.now(),
    });
  }
}

module.exports = { registerRecordingEvents, broadcastTranscript };
