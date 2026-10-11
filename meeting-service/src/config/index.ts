import dotenv from "dotenv";
dotenv.config();

const parseCorsOrigin = (raw?: string): string | string[] => {
  if (!raw || raw.trim() === "*") return "*";
  if (raw.includes(",")) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return raw.trim();
};

export const config = {
  port: Number(process.env.SFU_PORT || process.env.PORT) || 4000,
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  debugSfu: process.env.DEBUG_SFU === "true",
  mainBackendBaseUrl: process.env.MAIN_BACKEND_BASE_URL || "http://localhost:5000",
  mainBackendServiceToken: process.env.MAIN_BACKEND_SERVICE_TOKEN || "",
  mainBackendTimeoutMs: Number(process.env.MAIN_BACKEND_REQUEST_TIMEOUT_MS) || 5000,
  mediasoup: {
    minPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
    maxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 49999,
    listenIp: process.env.LISTEN_IP || process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
    announcedIp: process.env.ANNOUNCED_IP || process.env.MEDIASOUP_ANNOUNCED_IP || "198.56.17.53",
  },
  turn: {
    urls: process.env.TURN_URL || "turn:198.56.17.53:3478",
    username: process.env.TURN_USERNAME || "demo",
    credential: process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || "password123",
  },
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    {
      urls: process.env.TURN_URL || "turn:198.56.17.53:3478",
      username: process.env.TURN_USERNAME || "demo",
      credential: process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || "password123",
    },
  ],
};
