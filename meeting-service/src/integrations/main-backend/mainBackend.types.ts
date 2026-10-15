export interface VerifyHostRequest {
  roomId: string;
  userId: string;
}

export interface VerifyHostResponse {
  success: boolean;
  exists?: boolean;
  isHost: boolean;
  hostUserId?: string;
  allowMultipleDevices?: boolean;
  error?: string;
  code?: string;
}
