import { RouterRtpCodecCapability } from "mediasoup/node/lib/types";

// Standard codec set used by mediasoup for audio/video.
// Only defined now so the router can be created correctly.
// Actual audio/video producing/consuming happens in Phase 2.
export const mediaCodecs: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

