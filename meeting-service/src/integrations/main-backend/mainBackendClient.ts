import { config } from "../../config";
import { VerifyHostRequest, VerifyHostResponse } from "./mainBackend.types";

export const mainBackendClient = {
  async verifyHost(req: VerifyHostRequest): Promise<VerifyHostResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.mainBackendTimeoutMs);

    try {
      const baseUrl = config.mainBackendBaseUrl.replace(/\/+$/, "");
      const url = `${baseUrl}/api/sfu-collab/verify-host`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.mainBackendServiceToken ? { "x-service-token": config.mainBackendServiceToken } : {}),
        },
        body: JSON.stringify({ roomId: req.roomId, userId: req.userId }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 404 || data.exists === false) {
        return {
          success: false,
          exists: false,
          isHost: false,
          error: data.error || "Meeting not found",
          code: "MEETING_NOT_FOUND",
        };
      }

      if (!response.ok) {
        return {
          success: false,
          isHost: false,
          error: data.error || `Main backend returned status ${response.status}`,
        };
      }

      return {
        success: true,
        exists: true,
        isHost: data.isHost === true,
        hostUserId: data.hostUserId,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { success: false, isHost: false, error: "Main backend verify-host timeout" };
      }
      return { success: false, isHost: false, error: err.message || "Failed to reach main backend" };
    } finally {
      clearTimeout(timeout);
    }
  },
};
