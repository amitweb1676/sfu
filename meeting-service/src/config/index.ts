import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || "*",
  debugSfu: process.env.DEBUG_SFU === "true",
  mediasoup: {
    minPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
    maxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 49999,
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1",
  },
};

