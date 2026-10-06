// meeting-service/src/activities/quiz/index.ts
import { Server, Socket } from "socket.io";
import { registerQuizSocketHandlers } from "./quiz.socket";

export function initQuizModule(io: Server) {
  io.on("connection", (socket: Socket) => {
    registerQuizSocketHandlers(io, socket);
  });
}

export { registerQuizSocketHandlers };
