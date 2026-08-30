import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import config from "../config/recording.config";

export interface TranscriptHandle {
  interval: NodeJS.Timeout;
  stop: () => void;
}

export function startTranscriptCapture({
  roomId,
  participantId,
  audioProducer,
}: {
  roomId: string;
  participantId: string;
  audioProducer: any;
}): TranscriptHandle {
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
            const { broadcastTranscript } = require("../socket/recordingEvents");
            broadcastTranscript(roomId, participantId, text);
          } catch (e) {
            console.error("[TranscriptCapture] Socket broadcast error:", e);
          }
          await saveTranscriptToBackend(roomId, participantId, text);
        }
      }
    } catch (err) {
      console.error("[TranscriptCapture] Processing error:", err);
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
      } catch {}
    },
  };
}

export function stopTranscriptCapture(handle?: TranscriptHandle | null): void {
  if (handle && typeof handle.stop === "function") {
    handle.stop();
  }
}

function captureChunkToWav(_audioProducer: any, wavFile: string, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const args = ["-y", "-i", "pipe:0", "-t", String(seconds), "-ar", "16000", "-ac", "1", wavFile];
    const proc = spawn(config.FFMPEG_PATH, args);
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

async function transcribeWithWhisper(wavFile: string): Promise<string | null> {
  if (!config.WHISPER_API_KEY) {
    return null;
  }
  try {
    const FormData = require("form-data");
    const fetch = require("node-fetch");
    const form = new FormData();
    form.append("file", fs.createReadStream(wavFile));
    form.append("model", config.WHISPER_MODEL);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WHISPER_API_KEY}` },
      body: form,
    });
    const data = await response.json();
    return data?.text || null;
  } catch (err) {
    console.error("[TranscriptCapture] Whisper error:", err);
    return null;
  }
}

async function saveTranscriptToBackend(roomId: string, participantId: string, text: string): Promise<void> {
  const backendUrl = process.env.BACKEND_API_URL || "http://localhost:5000";
  try {
    const fetch = require("node-fetch");
    await fetch(`${backendUrl}/api/collab/recording/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, participantId, text, timestamp: Date.now() }),
    });
  } catch (err) {
    console.error("[TranscriptCapture] Save to backend error:", err);
  }
}
