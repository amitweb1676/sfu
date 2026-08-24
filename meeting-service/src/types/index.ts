import { Router, WebRtcTransport, Producer, Consumer } from "mediasoup/node/lib/types";

export type Role = "host" | "co-host" | "participant";

export interface Participant {
  socketId: string;
  userId: string;
  displayName: string;
  avatar?: string;
  role?: Role | string;
  handRaised?: boolean;
  approved?: boolean;
  isVideoOff?: boolean;
  isAudioOff?: boolean;
  joinedAt: number;
  transports?: { send?: WebRtcTransport; recv?: WebRtcTransport; [key: string]: WebRtcTransport | undefined };
  producers?: { [producerId: string]: Producer };
  consumers?: { [consumerId: string]: Consumer };
}

export interface Room {
  roomId: string;
  router: Router;
  participants: Map<string, Participant>;
  createdAt: number;
  allMuted: boolean;
  allVideoHidden: boolean;
}
