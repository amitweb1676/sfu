"use strict";

import * as crypto from "crypto";
import { DEFAULT_POLICY, DEFAULT_COHOST_PERMISSIONS } from "./hostControl.constants";

export interface RoomControlState {
  roomId: string;
  policy: {
    participantScreenShareAllowed: boolean;
    participantsCanUnmute: boolean;
    participantsCanEnableVideo: boolean;
    passcodeRequired: boolean;
  };
  passcode: {
    salt: string | null;
    hash: string | null;
  };
  spotlightSocketId: string | null;
  rolePermissions: {
    cohost: Record<string, boolean>;
  };
  ended: boolean;
  endedAt: string | null;
  version: number;
}

const states = new Map<string, RoomControlState>();

export function createInitialState(roomId: string): RoomControlState {
  return {
    roomId,
    policy: { ...DEFAULT_POLICY },
    passcode: { salt: null, hash: null },
    spotlightSocketId: null,
    rolePermissions: { cohost: { ...DEFAULT_COHOST_PERMISSIONS } },
    ended: false,
    endedAt: null,
    version: 1,
  };
}

export function getRoomControlState(roomId: string): RoomControlState {
  if (!states.has(roomId)) states.set(roomId, createInitialState(roomId));
  return states.get(roomId)!;
}

export function updateRoomControlState(
  roomId: string,
  updater: (state: RoomControlState) => RoomControlState
): RoomControlState {
  const current = getRoomControlState(roomId);
  const next = updater(current) || current;
  next.version = current.version + 1;
  states.set(roomId, next);
  return next;
}

export function hashPasscode(passcode: string, salt: string): string {
  return crypto.scryptSync(String(passcode), salt, 64).toString("hex");
}

export function setRoomPasscode(roomId: string, passcode?: string | null): RoomControlState {
  return updateRoomControlState(roomId, (state) => {
    if (!passcode || !passcode.trim()) {
      return {
        ...state,
        policy: { ...state.policy, passcodeRequired: false },
        passcode: { salt: null, hash: null },
      };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    return {
      ...state,
      policy: { ...state.policy, passcodeRequired: true },
      passcode: { salt, hash: hashPasscode(passcode.trim(), salt) },
    };
  });
}

export function verifyRoomPasscode(roomId: string, candidate?: string | null): boolean {
  const state = getRoomControlState(roomId);
  if (!state.policy.passcodeRequired) return true;
  if (!state.passcode.salt || !state.passcode.hash || !candidate) return false;
  try {
    const candidateHash = hashPasscode(candidate, state.passcode.salt);
    const expected = Buffer.from(state.passcode.hash, "hex");
    const actual = Buffer.from(candidateHash, "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function toPublicState(state: RoomControlState) {
  return {
    roomId: state.roomId,
    policy: { ...state.policy },
    spotlightSocketId: state.spotlightSocketId,
    rolePermissions: { cohost: { ...state.rolePermissions.cohost } },
    ended: state.ended,
    endedAt: state.endedAt,
    version: state.version,
  };
}

export function deleteRoomControlState(roomId: string): void {
  states.delete(roomId);
}
