import { Socket } from "socket.io";
import { getRoom, getParticipant } from "../../rooms/roomManager";

export function isHostOrCoHost(socket: Socket, classroomId: string): boolean {
  try {
    const room = getRoom(classroomId);
    if (!room) {
      return (
        socket.data?.role === "host" ||
        socket.data?.role === "co-host" ||
        socket.data?.role === "cohost"
      );
    }
    const peer = room.participants.get(socket.id) || getParticipant(classroomId, socket.id);
    if (peer) {
      return (
        peer.role === "host" ||
        peer.role === "co-host" ||
        peer.role === "cohost" ||
        (peer as any).isHost === true ||
        (peer as any).isCoHost === true
      );
    }
    // Fallback socket data check
    return (
      socket.data?.role === "host" ||
      socket.data?.role === "co-host" ||
      socket.data?.role === "cohost"
    );
  } catch (err) {
    return false;
  }
}
