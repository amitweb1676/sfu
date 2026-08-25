"use strict";

import * as crypto from "crypto";

export interface AuditEvent {
  id: string;
  roomId: string;
  timestamp: string;
  action: string;
  actor: any;
  target: any;
  metadata: Record<string, any>;
}

const logsByRoom = new Map<string, AuditEvent[]>();
const MAX_EVENTS_PER_ROOM = 500;

export function sanitiseMetadata(metadata?: any): Record<string, any> {
  const value = metadata && typeof metadata === "object" ? metadata : {};
  const forbidden = new Set(["passcode", "password", "token", "authorization", "rtpParameters", "dtlsParameters"]);
  return Object.entries(value).reduce((result: Record<string, any>, [key, item]) => {
    if (!forbidden.has(key)) result[key] = item;
    return result;
  }, {});
}

export function identity(person: any) {
  if (!person) return null;
  return {
    socketId: person.socketId,
    userId: person.userId || null,
    displayName: person.displayName || person.name || "Unknown",
    role: person.role || "participant",
  };
}

export function appendAuditEvent({
  roomId,
  actor,
  action,
  target,
  metadata,
}: {
  roomId: string;
  actor?: any;
  action: string;
  target?: any;
  metadata?: any;
}): AuditEvent {
  const existing = logsByRoom.get(roomId) || [];
  const event: AuditEvent = Object.freeze({
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    roomId,
    timestamp: new Date().toISOString(),
    action,
    actor: identity(actor),
    target: identity(target),
    metadata: sanitiseMetadata(metadata),
  });
  existing.push(event);
  if (existing.length > MAX_EVENTS_PER_ROOM) existing.splice(0, existing.length - MAX_EVENTS_PER_ROOM);
  logsByRoom.set(roomId, existing);
  return event;
}

export function getAuditLog(roomId: string): AuditEvent[] {
  return [...(logsByRoom.get(roomId) || [])];
}

export function clearAuditLog(roomId: string): void {
  logsByRoom.delete(roomId);
}
