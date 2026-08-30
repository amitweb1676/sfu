const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../config/recording.config");

function buildSdp({ ip, port, payloadType, codec, clockRate, kind, channels }) {
  const lines = [
    "v=0",
    "o=- 0 0 IN IP4 " + ip,
    "s=MediasoupRecording",
    "c=IN IP4 " + ip,
    "t=0 0",
    `m=${kind} ${port} RTP/AVP ${payloadType}`,
    `a=rtpmap:${payloadType} ${codec}/${clockRate}` + (channels > 1 ? `/${channels}` : ""),
  ];
  return lines.join("\n");
}

function startRecording({ roomId, participantId, audioRtp, videoRtp }) {
  const outDir = path.join(config.RECORDING_DIR, roomId);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outputFile = path.join(outDir, `${participantId}_${Date.now()}.mp4`);

  const audioSdpPath = path.join(outDir, `${participantId}_audio.sdp`);
  const videoSdpPath = path.join(outDir, `${participantId}_video.sdp`);
  fs.writeFileSync(audioSdpPath, buildSdp(audioRtp));
  fs.writeFileSync(videoSdpPath, buildSdp(videoRtp));

  const args = [
    "-protocol_whitelist",
    "file,udp,rtp",
    "-i",
    audioSdpPath,
    "-protocol_whitelist",
    "file,udp,rtp",
    "-i",
    videoSdpPath,
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "aac",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    outputFile,
  ];

  const ffmpegProcess = spawn(config.FFMPEG_PATH, args);

  ffmpegProcess.stderr.on("data", () => {
    // intentionally silent; enable temporarily for debugging only
  });

  return { ffmpegProcess, outputFile };
}

function stopRecording(ffmpegProcess) {
  if (ffmpegProcess && !ffmpegProcess.killed) {
    try {
      ffmpegProcess.stdin.write("q");
      ffmpegProcess.kill("SIGINT");
    } catch (e) {
      // Safe fallback
    }
  }
}

module.exports = { startRecording, stopRecording };
