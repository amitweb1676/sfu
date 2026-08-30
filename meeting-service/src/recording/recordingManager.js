const { startRecording, stopRecording } = require("./ffmpegRecorder");
const { startTranscriptCapture, stopTranscriptCapture } = require("./transcriptCapture");

const activeRecordings = new Map(); // roomId -> { participants: Map(participantId -> {ffmpegProcess, outputFile, transcriptHandle}), startedAt }

async function startRoomRecording(roomId, room) {
  if (activeRecordings.has(roomId)) return activeRecordings.get(roomId);

  const roomState = { participants: new Map(), startedAt: Date.now() };
  activeRecordings.set(roomId, roomState);

  if (room && room.peers) {
    for (const [participantId, peer] of room.peers.entries()) {
      try {
        await recordParticipant(roomId, participantId, peer);
      } catch (err) {
        console.error(`[RecordingManager] Error recording peer ${participantId}:`, err);
      }
    }
  }
  return roomState;
}

async function recordParticipant(roomId, participantId, peer) {
  const roomState = activeRecordings.get(roomId);
  if (!roomState || roomState.participants.has(participantId)) return;

  if (!peer || !peer.producers) return;
  const audioProducer = peer.producers.get("audio");
  const videoProducer = peer.producers.get("video");
  if (!audioProducer || !videoProducer) return;

  try {
    const audioRtp = await peer.router.createRecordingPlainTransport(audioProducer);
    const videoRtp = await peer.router.createRecordingPlainTransport(videoProducer);

    const { ffmpegProcess, outputFile } = startRecording({
      roomId,
      participantId,
      audioRtp,
      videoRtp,
    });

    const transcriptHandle = startTranscriptCapture({ roomId, participantId, audioProducer });

    roomState.participants.set(participantId, { ffmpegProcess, outputFile, transcriptHandle });
  } catch (err) {
    console.error(`[RecordingManager] Failed to start recording participant ${participantId}:`, err);
  }
}

async function stopRoomRecording(roomId) {
  const roomState = activeRecordings.get(roomId);
  if (!roomState) return [];

  const finishedFiles = [];
  for (const [participantId, entry] of roomState.participants.entries()) {
    try {
      stopRecording(entry.ffmpegProcess);
      stopTranscriptCapture(entry.transcriptHandle);
      finishedFiles.push({ participantId, file: entry.outputFile });
    } catch (err) {
      console.error(`[RecordingManager] Error stopping recording for ${participantId}:`, err);
    }
  }
  activeRecordings.delete(roomId);
  return finishedFiles;
}

module.exports = { startRoomRecording, stopRoomRecording, recordParticipant, activeRecordings };
