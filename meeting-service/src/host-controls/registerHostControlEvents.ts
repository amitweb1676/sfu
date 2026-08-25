"use strict";

import { EVENTS } from "./hostControl.constants";
import { toAckError } from "./hostControl.errors";
import { createRateLimiter, safeAck, requireString } from "./hostControl.security";
import { createHostControlService } from "./hostControl.service";
import { RoomAdapter } from "./createRoomAdapter";

export function registerHostControlEvents({
  io,
  socket,
  roomAdapter,
}: {
  io: any;
  socket: any;
  roomAdapter: RoomAdapter;
}) {
  const service = createHostControlService({ io, roomAdapter });
  const enforceRateLimit = createRateLimiter({ windowMs: 10000, max: 40 });

  function execute(handler: (roomId: string, payload: any) => Promise<any> | any) {
    return async (payload: any = {}, ack?: any) => {
      try {
        enforceRateLimit(socket.id);
        const roomId = requireString(payload?.roomId, "roomId", 120);
        const data = await handler(roomId, payload);
        safeAck(ack, { ok: true, data });
      } catch (error) {
        safeAck(ack, toAckError(error));
      }
    };
  }

  socket.on(EVENTS.GET_STATE, execute((roomId) => service.getState(socket, roomId)));
  socket.on(EVENTS.UPDATE_POLICY, execute((roomId, p) => service.updatePolicy(socket, roomId, p.patch || {})));
  socket.on(EVENTS.ADMIT_ALL, execute((roomId) => service.admitAll(socket, roomId)));
  socket.on(EVENTS.REJECT_ALL, execute((roomId) => service.rejectAll(socket, roomId)));
  socket.on(
    EVENTS.SET_SPOTLIGHT,
    execute((roomId, p) =>
      service.setSpotlight(socket, roomId, requireString(p.targetSocketId, "targetSocketId", 120))
    )
  );
  socket.on(EVENTS.CLEAR_SPOTLIGHT, execute((roomId) => service.clearSpotlight(socket, roomId)));
  socket.on(
    EVENTS.SET_ROLE_PERMISSIONS,
    execute((roomId, p) => service.setRolePermissions(socket, roomId, p.permissions || {}))
  );
  socket.on(EVENTS.GET_AUDIT_LOG, execute((roomId) => service.getRoomAuditLog(socket, roomId)));
  socket.on(EVENTS.REQUEST_SCREEN_SHARE, execute((roomId) => service.requestScreenShare(socket, roomId)));
  socket.on(
    EVENTS.VERIFY_PASSCODE,
    execute((roomId, p) => service.verifyPasscode(socket, roomId, String(p.passcode || "")))
  );
  socket.on(EVENTS.END_MEETING, execute((roomId) => service.endMeeting(socket, roomId)));

  return service;
}
