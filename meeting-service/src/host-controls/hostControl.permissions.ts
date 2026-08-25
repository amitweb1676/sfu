"use strict";

import { ROLES, PERMISSIONS, DEFAULT_COHOST_PERMISSIONS } from "./hostControl.constants";
import { HostControlError } from "./hostControl.errors";

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

export function normaliseRole(role?: string): string {
  if (role === ROLES.HOST || role === "host") return ROLES.HOST;
  if (role === ROLES.COHOST || role === ROLES.CO_HOST || role === "co-host" || role === "cohost") return ROLES.COHOST;
  return ROLES.PARTICIPANT;
}

export function sanitisePermissionPatch(patch: any): Record<string, boolean> {
  const source = patch && typeof patch === "object" ? patch : {};
  return (ALL_PERMISSIONS as string[]).reduce((result: Record<string, boolean>, permission: string) => {
    if (typeof source[permission] === "boolean") result[permission] = source[permission];
    return result;
  }, {});
}

export function resolvePermissions(participant: any, roomState: any): Record<string, boolean> {
  const role = normaliseRole(participant && participant.role);
  if (role === ROLES.HOST) {
    return (ALL_PERMISSIONS as string[]).reduce((r: Record<string, boolean>, p: string) => { r[p] = true; return r; }, {});
  }
  if (role === ROLES.COHOST) {
    return { ...DEFAULT_COHOST_PERMISSIONS, ...(roomState.rolePermissions?.cohost || {}) };
  }
  return (ALL_PERMISSIONS as string[]).reduce((r: Record<string, boolean>, p: string) => { r[p] = false; return r; }, {});
}

export function requirePermission(participant: any, roomState: any, permission: string): void {
  const permissions = resolvePermissions(participant, roomState);
  if (!permissions[permission]) {
    throw new HostControlError("FORBIDDEN", `Missing required permission: ${permission}`, 403);
  }
}
