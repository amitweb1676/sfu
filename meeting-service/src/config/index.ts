import dotenv from "dotenv";
import { logger } from "../utils/logger";
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

if (config.mediasoup.announcedIp === "127.0.0.1") {
  logger.warn(
    "MEDIASOUP_ANNOUNCED_IP is set to '127.0.0.1'. This is suitable for local development, but will cause WebRTC connection failures in remote/production environments. Please set MEDIASOUP_ANNOUNCED_IP to your public IP or DNS name (e.g. sfu.universalgurukul.com) in production."
  );
} else {
  logger.info(`MEDIASOUP_ANNOUNCED_IP configured as: ${config.mediasoup.announcedIp}`);
}

