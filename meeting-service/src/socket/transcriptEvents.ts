import type { Socket, Server } from 'socket.io';
import { forwardFinalChunk } from '../services/transcriptForwarder';

export function registerTranscriptEvents(socket: Socket, io: Server): void {
  socket.on('transcript:send-chunk', (chunk: any) => {
    if (!chunk || !chunk.roomId || !chunk.participantId || !chunk.text) return;

    socket.to(chunk.roomId).emit('transcript:update', chunk);
    socket.emit('transcript:update', chunk);

    if (chunk.isFinal) {
      forwardFinalChunk(chunk).catch(() => {});
    }
  });
}

export default { registerTranscriptEvents };
