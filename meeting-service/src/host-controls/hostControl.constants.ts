"use strict";

export const EVENTS = Object.freeze({
  GET_STATE: "host:get-control-state",
  UPDATE_POLICY: "host:update-policy",
  ADMIT_ALL: "host:admit-all",
  REJECT_ALL: "host:reject-all",
  SET_SPOTLIGHT: "host:set-spotlight",
  CLEAR_SPOTLIGHT: "host:clear-spotlight",
  END_MEETING: "host:end-meeting",
  GET_AUDIT_LOG: "host:get-audit-log",
  SET_ROLE_PERMISSIONS: "host:set-role-permissions",
  VERIFY_PASSCODE: "room:verify-passcode",
  REQUEST_SCREEN_SHARE: "room:request-screen-share",

  CONTROL_STATE: "host:control-state",
  SPOTLIGHT_CHANGED: "host:spotlight-changed",
  MEETING_ENDED: "host:meeting-ended",
  FORCE_MUTED: "host:participant-force-muted",
  FORCE_VIDEO_OFF: "host:participant-force-video-off",
  SCREEN_SHARE_DENIED: "host:screen-share-denied",
  POLICY_CHANGED: "host:policy-changed",
});

export const ROLES = Object.freeze({
  HOST: "host",
  COHOST: "cohost",
  CO_HOST: "co-host",
  PARTICIPANT: "participant",
});

export const PERMISSIONS = Object.freeze({
  MANAGE_WAITING_ROOM: "manageWaitingRoom",
  MUTE_PARTICIPANTS: "muteParticipants",
  DISABLE_PARTICIPANT_VIDEO: "disableParticipantVideo",
  REMOVE_PARTICIPANTS: "removeParticipants",
  MANAGE_SCREEN_SHARE: "manageScreenShare",
  MANAGE_SPOTLIGHT: "manageSpotlight",
  VIEW_AUDIT_LOG: "viewAuditLog",
  MANAGE_ROOM_POLICY: "manageRoomPolicy",
  END_MEETING: "endMeeting",
  MANAGE_ROLES: "manageRoles",
});

export const DEFAULT_POLICY = Object.freeze({
  participantScreenShareAllowed: false,
  participantsCanUnmute: true,
  participantsCanEnableVideo: true,
  passcodeRequired: false,
});

export const DEFAULT_COHOST_PERMISSIONS = Object.freeze({
  manageWaitingRoom: true,
  muteParticipants: true,
  disableParticipantVideo: true,
  removeParticipants: false,
  manageScreenShare: true,
  manageSpotlight: true,
  viewAuditLog: true,
  manageRoomPolicy: false,
  endMeeting: false,
  manageRoles: false,
});
