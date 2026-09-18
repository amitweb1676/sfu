import type { Socket, Server } from 'socket.io';
import { forwardFinalChunk } from '../services/transcriptForwarder';

export function registerTranscriptEvents(socket: Socket, io: Server): void {
  socket.on('transcript:send-chunk', (chunk: any) => {
    if (!chunk || !chunk.roomId || !chunk.text) return;

    // Broadcast live chunk to room participants for real-time captions
    socket.to(chunk.roomId).emit('transcript:update', chunk);
    socket.emit('transcript:update', chunk);

    // Forward final chunk to main backend for database storage
    if (chunk.isFinal) {
      forwardFinalChunk({
        roomId: chunk.roomId,
        participantId: chunk.participantId || chunk.userId || 'unknown',
        userId: chunk.userId || chunk.participantId || 'unknown',
        speakerName: chunk.speakerName || 'Speaker',
        role: chunk.role || 'participant',
        text: chunk.text,
        segmentId: chunk.segmentId,
        sequence: chunk.sequence || 1,
        language: chunk.language || 'en-US',
        isFinal: true,
      }).catch((err) => {
        console.error('[SFU] forwardFinalChunk error:', err.message);
      });
    }
  });
}

export default { registerTranscriptEvents };

