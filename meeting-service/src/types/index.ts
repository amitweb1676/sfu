import { Router, WebRtcTransport, Producer, Consumer } from "mediasoup/node/lib/types";

export interface Participant {
  socketId: string;
  userId: string;
  displayName: string;
  avatar?: string;
  role?: string;
  joinedAt: number;
  transports?: { send?: WebRtcTransport; recv?: WebRtcTransport; [key: string]: WebRtcTransport | undefined };
  producers?: { audio?: Producer; video?: Producer; [key: string]: Producer | undefined };
  consumers?: { [consumerId: string]: Consumer };
}

export interface Room {
  roomId: string;
  router: Router;
  participants: Map<string, Participant>;
  createdAt: number;
}
