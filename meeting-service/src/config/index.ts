import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || "*",
  debugSfu: process.env.DEBUG_SFU === "true",
  mediasoup: {
    minPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
    maxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 49999,
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "198.56.17.53",
  },
  turn: {
    urls: process.env.TURN_URL || "turn:198.56.17.53:3478",
    username: process.env.TURN_USERNAME || "demo",
    credential: process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || "password123",
  },
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
    {
      urls: process.env.TURN_URL || "turn:198.56.17.53:3478",
      username: process.env.TURN_USERNAME || "demo",
      credential: process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || "password123",
    },
  ],
};

