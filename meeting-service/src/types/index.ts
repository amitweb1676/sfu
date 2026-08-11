import { Router } from "mediasoup/node/lib/types";

export interface Participant {
  socketId: string;
  displayName: string;
  joinedAt: number;
}

export interface Room {
  roomId: string;
  router: Router;
  participants: Map<string, Participant>;
  createdAt: number;
}
