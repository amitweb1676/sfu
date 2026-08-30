const { spawn } = require("child_process");
const fetch = require("node-fetch");
const FormData = require("form-data");
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("../config/recording.config");

function startTranscriptCapture({ roomId, participantId, audioProducer }) {
  const chunkDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-"));
  let stopped = false;

  const interval = setInterval(async () => {
    if (stopped) return;
    const wavFile = path.join(chunkDir, `${Date.now()}.wav`);
    try {
      await captureChunkToWav(audioProducer, wavFile, config.TRANSCRIPT_CHUNK_SECONDS);
      if (fs.existsSync(wavFile) && fs.statSync(wavFile).size > 1000) {
        const text = await transcribeWithWhisper(wavFile);
        if (text && text.trim()) {
          try {
            require("../socket/recordingEvents").broadcastTranscript(roomId, participantId, text);
          } catch (e) {
            console.error("[TranscriptCapture] Error broadcasting socket event:", e);
          }
          await saveTranscriptToBackend(roomId, participantId, text);
        }
      }
    } catch (err) {
      console.error("[TranscriptCapture] Error in transcript chunk processing:", err);
    } finally {
      if (fs.existsSync(wavFile)) {
        fs.unlink(wavFile, () => {});
      }
    }
  }, config.TRANSCRIPT_CHUNK_SECONDS * 1000);

  return {
    interval,
    stop: () => {
      stopped = true;
      clearInterval(interval);
      try {
        if (fs.existsSync(chunkDir)) {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        }
      } catch (e) {}
    },
  };
}

function stopTranscriptCapture(handle) {
  if (handle && handle.stop) handle.stop();
}

function captureChunkToWav(audioProducer, wavFile, seconds) {
  return new Promise((resolve) => {
    const args = ["-y", "-i", "pipe:0", "-t", String(seconds), "-ar", "16000", "-ac", "1", wavFile];
    const proc = spawn(config.FFMPEG_PATH, args);
    proc.on("close", resolve);
    proc.on("error", () => resolve());
  });
}

async function transcribeWithWhisper(wavFile) {
  if (!config.WHISPER_API_KEY) {
    return null;
  }
  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(wavFile));
    form.append("model", config.WHISPER_MODEL);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WHISPER_API_KEY}` },
      body: form,
    });
    const data = await response.json();
    return data && data.text ? data.text : null;
  } catch (err) {
    console.error("[TranscriptCapture] Whisper API error:", err);
    return null;
  }
}

async function saveTranscriptToBackend(roomId, participantId, text) {
  const backendUrl = process.env.BACKEND_API_URL || "http://localhost:5000";
  try {
    await fetch(`${backendUrl}/api/collab/recording/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, participantId, text, timestamp: Date.now() }),
    });
  } catch (err) {
    console.error("[TranscriptCapture] Failed to save transcript chunk to backend:", err);
  }
}

module.exports = { startTranscriptCapture, stopTranscriptCapture };
