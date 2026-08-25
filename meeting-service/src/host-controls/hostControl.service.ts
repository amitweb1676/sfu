"use strict";

import { PERMISSIONS, ROLES } from "./hostControl.constants";
import { HostControlError } from "./hostControl.errors";
import { requirePermission, sanitisePermissionPatch } from "./hostControl.permissions";
import {
  getRoomControlState,
  updateRoomControlState,
  setRoomPasscode,
  verifyRoomPasscode,
  toPublicState,
} from "./hostControl.state";
import { appendAuditEvent, getAuditLog } from "./hostControl.audit";
import { RoomAdapter } from "./createRoomAdapter";

function validateAdapter(adapter: RoomAdapter) {
  const required: Array<keyof RoomAdapter> = [
    "getParticipant",
    "getParticipants",
    "setParticipantApproved",
    "removeParticipant",
    "setParticipantRole",
    "closeRoomMedia",
  ];
  required.forEach((name) => {
    if (!adapter || typeof adapter[name] !== "function") {
      throw new Error(`Host controls room adapter is missing ${name}()`);
    }
  });
}

export function createHostControlService({ io, roomAdapter }: { io: any; roomAdapter: RoomAdapter }) {
  validateAdapter(roomAdapter);

  function actorFor(socket: any, roomId: string) {
    const actor = roomAdapter.getParticipant(roomId, socket.id);
    if (!actor) {
      throw new HostControlError("PARTICIPANT_NOT_FOUND", "You are not an active room participant", 404);
    }
    return actor;
  }

  function roomStateFor(socket: any, roomId: string, permission: string) {
    const actor = actorFor(socket, roomId);
    const state = getRoomControlState(roomId);
    requirePermission(actor, state, permission);
    if (state.ended) {
      throw new HostControlError("MEETING_ENDED", "Meeting has already ended", 409);
    }
    return { actor, state };
  }

  function broadcastState(roomId: string) {
    const state = toPublicState(getRoomControlState(roomId));
    io.to(roomId).emit("host:control-state", state);
    return state;
  }

  function getState(socket: any, roomId: string) {
    const actor = actorFor(socket, roomId);
    return {
      state: toPublicState(getRoomControlState(roomId)),
      currentRole: actor.role || "participant",
    };
  }

  function updatePolicy(socket: any, roomId: string, patch: any) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.MANAGE_ROOM_POLICY);
    const allowed = ["participantScreenShareAllowed", "participantsCanUnmute", "participantsCanEnableVideo"];
    const cleanPatch = Object.entries(patch || {}).reduce((result: Record<string, boolean>, [key, value]) => {
      if (allowed.includes(key) && typeof value === "boolean") result[key] = value;
      return result;
    }, {});

    const next = updateRoomControlState(roomId, (state) => ({
      ...state,
      policy: { ...state.policy, ...cleanPatch },
    }));

    if (typeof patch?.passcode === "string") {
      setRoomPasscode(roomId, patch.passcode.trim());
    }

    appendAuditEvent({ roomId, actor, action: "ROOM_POLICY_UPDATED", metadata: cleanPatch });

    if (cleanPatch.participantsCanUnmute === false) {
      io.to(roomId).emit("host:participant-force-muted", { reason: "HOST_POLICY" });
    }
    if (cleanPatch.participantsCanEnableVideo === false) {
      io.to(roomId).emit("host:participant-force-video-off", { reason: "HOST_POLICY" });
    }

    io.to(roomId).emit("host:policy-changed", toPublicState(next).policy);
    return broadcastState(roomId);
  }

  function admitAll(socket: any, roomId: string) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.MANAGE_WAITING_ROOM);
    const waiting = roomAdapter.getParticipants(roomId).filter((p) => p.approved === false);
    waiting.forEach((p) => {
      roomAdapter.setParticipantApproved(roomId, p.socketId, true);
      io.to(p.socketId).emit("admitted");
      appendAuditEvent({ roomId, actor, action: "PARTICIPANT_ADMITTED", target: p });
    });
    return { affected: waiting.length };
  }

  function rejectAll(socket: any, roomId: string) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.MANAGE_WAITING_ROOM);
    const waiting = roomAdapter.getParticipants(roomId).filter((p) => p.approved === false);
    waiting.forEach((p) => {
      io.to(p.socketId).emit("rejected", { reason: "HOST_REJECTED" });
      roomAdapter.removeParticipant(roomId, p.socketId, "HOST_REJECTED");
      appendAuditEvent({ roomId, actor, action: "PARTICIPANT_REJECTED", target: p });
    });
    return { affected: waiting.length };
  }

  function setSpotlight(socket: any, roomId: string, targetSocketId: string) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.MANAGE_SPOTLIGHT);
    const target = roomAdapter.getParticipant(roomId, targetSocketId);
    if (!target || target.approved === false) {
      throw new HostControlError("INVALID_TARGET", "Spotlight target is not admitted", 404);
    }
    const next = updateRoomControlState(roomId, (state) => ({ ...state, spotlightSocketId: targetSocketId }));
    appendAuditEvent({ roomId, actor, action: "SPOTLIGHT_SET", target });
    io.to(roomId).emit("host:spotlight-changed", { spotlightSocketId: targetSocketId });
    return toPublicState(next);
  }

  function clearSpotlight(socket: any, roomId: string) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.MANAGE_SPOTLIGHT);
    const next = updateRoomControlState(roomId, (state) => ({ ...state, spotlightSocketId: null }));
    appendAuditEvent({ roomId, actor, action: "SPOTLIGHT_CLEARED" });
    io.to(roomId).emit("host:spotlight-changed", { spotlightSocketId: null });
    return toPublicState(next);
  }

  function setRolePermissions(socket: any, roomId: string, patch: any) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.MANAGE_ROLES);
    const clean = sanitisePermissionPatch(patch);
    updateRoomControlState(roomId, (state) => ({
      ...state,
      rolePermissions: {
        ...state.rolePermissions,
        cohost: { ...state.rolePermissions.cohost, ...clean },
      },
    }));
    appendAuditEvent({ roomId, actor, action: "COHOST_PERMISSIONS_UPDATED", metadata: clean });
    return broadcastState(roomId);
  }

  function getRoomAuditLog(socket: any, roomId: string) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.VIEW_AUDIT_LOG);
    appendAuditEvent({ roomId, actor, action: "AUDIT_LOG_VIEWED" });
    return getAuditLog(roomId);
  }

  function requestScreenShare(socket: any, roomId: string) {
    const actor = actorFor(socket, roomId);
    const state = getRoomControlState(roomId);
    const privileged = actor.role === ROLES.HOST || actor.role === ROLES.COHOST || actor.role === "co-host";
    const allowed = privileged || state.policy.participantScreenShareAllowed;
    if (!allowed) {
      socket.emit("host:screen-share-denied", {
        code: "SCREEN_SHARE_DISABLED",
        message: "The host has disabled participant screen sharing",
      });
      appendAuditEvent({ roomId, actor, action: "SCREEN_SHARE_DENIED" });
      return { allowed: false };
    }
    appendAuditEvent({ roomId, actor, action: "SCREEN_SHARE_ALLOWED" });
    return { allowed: true };
  }

  function verifyPasscode(socket: any, roomId: string, passcode: string) {
    const participant = actorFor(socket, roomId);
    const valid = verifyRoomPasscode(roomId, passcode);
    appendAuditEvent({
      roomId,
      actor: participant,
      action: valid ? "PASSCODE_VERIFIED" : "PASSCODE_REJECTED",
    });
    return { valid };
  }

  async function endMeeting(socket: any, roomId: string) {
    const { actor } = roomStateFor(socket, roomId, PERMISSIONS.END_MEETING);
    const participants = roomAdapter.getParticipants(roomId);
    const endedAt = new Date().toISOString();

    updateRoomControlState(roomId, (state) => ({ ...state, ended: true, endedAt }));
    appendAuditEvent({
      roomId,
      actor,
      action: "MEETING_ENDED",
      metadata: { participantCount: participants.length },
    });

    io.to(roomId).emit("host:meeting-ended", {
      roomId,
      endedAt,
      endedBy: actor.displayName || actor.name || "Host",
    });

    // Delegate media teardown to the EXISTING idempotent room cleanup.
    await roomAdapter.closeRoomMedia(roomId, "HOST_ENDED_MEETING");

    participants.forEach((p) => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.leave(roomId);
    });
    return { endedAt, affected: participants.length };
  }

  function recordLifecycle(roomId: string, action: string, participant: any, metadata?: any) {
    return appendAuditEvent({ roomId, actor: participant, action, target: participant, metadata });
  }

  return {
    getState,
    updatePolicy,
    admitAll,
    rejectAll,
    setSpotlight,
    clearSpotlight,
    setRolePermissions,
    getRoomAuditLog,
    requestScreenShare,
    verifyPasscode,
    endMeeting,
    recordLifecycle,
  };
}
