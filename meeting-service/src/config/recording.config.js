module.exports = {
  RECORDING_DIR: process.env.RECORDING_DIR || "/var/recordings",
  FFMPEG_PATH: process.env.FFMPEG_PATH || "ffmpeg",
  WHISPER_API_KEY: process.env.WHISPER_API_KEY,
  WHISPER_MODEL: process.env.WHISPER_MODEL || "whisper-1",
  TRANSCRIPT_CHUNK_SECONDS: 15,
  RTP_PORT_MIN: 30000,
  RTP_PORT_MAX: 30999,
};
