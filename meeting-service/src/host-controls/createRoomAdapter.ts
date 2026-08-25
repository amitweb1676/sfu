"use strict";

export interface RoomAdapter {
  getParticipant: (roomId: string, socketId: string) => any;
  getParticipants: (roomId: string) => any[];
  setParticipantApproved: (roomId: string, socketId: string, approved: boolean) => boolean;
  removeParticipant: (roomId: string, socketId: string, reason?: string) => void;
  setParticipantRole: (roomId: string, socketId: string, role: string) => boolean;
  closeRoomMedia: (roomId: string, reason?: string) => Promise<void>;
}

export function createRoomAdapter(roomManager: any): RoomAdapter {
  return {
    getParticipant(roomId: string, socketId: string) {
      if (typeof roomManager.getParticipant === "function") {
        const p = roomManager.getParticipant(roomId, socketId);
        if (p) return p;
      }
      const room = typeof roomManager.getRoom === "function" ? roomManager.getRoom(roomId) : undefined;
      if (!room) return null;
      if (room.participants instanceof Map) return room.participants.get(socketId) || null;
      return room.participants ? room.participants[socketId] || null : null;
    },

    getParticipants(roomId: string) {
      const room = typeof roomManager.getRoom === "function" ? roomManager.getRoom(roomId) : undefined;
      if (!room || !room.participants) return [];
      return room.participants instanceof Map
        ? Array.from(room.participants.values())
        : Object.values(room.participants);
    },

    setParticipantApproved(roomId: string, socketId: string, approved: boolean) {
      if (typeof roomManager.setParticipantApproved === "function") {
        roomManager.setParticipantApproved(roomId, socketId, approved);
        return true;
      }
      const p = this.getParticipant(roomId, socketId);
      if (!p) return false;
      p.approved = approved;
      return true;
    },

    removeParticipant(roomId: string, socketId: string, reason?: string) {
      if (typeof roomManager.removeParticipant === "function") {
        return roomManager.removeParticipant(roomId, socketId, reason);
      }
    },

    setParticipantRole(roomId: string, socketId: string, role: string) {
      if (typeof roomManager.setRole === "function") {
        roomManager.setRole(roomId, socketId, role);
        return true;
      }
      const p = this.getParticipant(roomId, socketId);
      if (!p) return false;
      p.role = role;
      return true;
    },

    async closeRoomMedia(roomId: string, reason?: string) {
      if (typeof roomManager.closeRoom === "function") {
        return await roomManager.closeRoom(roomId, reason);
      }
      const room = typeof roomManager.getRoom === "function" ? roomManager.getRoom(roomId) : undefined;
      if (!room) return;
      const socketIds = room.participants instanceof Map
        ? Array.from(room.participants.keys())
        : Object.keys(room.participants || {});
      for (const socketId of socketIds) {
        try {
          if (typeof roomManager.removeParticipant === "function") {
            roomManager.removeParticipant(roomId, socketId, reason);
          }
        } catch {}
      }
    },
  };
}
