"use strict";

import { HostControlError } from "./hostControl.errors";

export function requireString(value: any, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HostControlError("INVALID_PAYLOAD", `${field} is required`);
  }
  const clean = value.trim();
  if (clean.length > maxLength) {
    throw new HostControlError("INVALID_PAYLOAD", `${field} is too long`);
  }
  return clean;
}

export function createRateLimiter({ windowMs = 10000, max = 40 } = {}) {
  const buckets = new Map<string, { startedAt: number; count: number }>();
  return function enforce(socketId: string) {
    const now = Date.now();
    const current = buckets.get(socketId);
    if (!current || now - current.startedAt > windowMs) {
      buckets.set(socketId, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > max) {
      throw new HostControlError("RATE_LIMITED", "Too many host-control requests", 429);
    }
  };
}

export function safeAck(ack: any, payload: any): void {
  if (typeof ack === "function") {
    try {
      ack(payload);
    } catch {}
  }
}
