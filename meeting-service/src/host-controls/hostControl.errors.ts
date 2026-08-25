"use strict";

export class HostControlError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "HostControlError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const toAckError = (error: any) => ({
  ok: false,
  code: error && error.code ? error.code : "HOST_CONTROL_ERROR",
  message: error && error.message ? error.message : "Host control action failed",
});
