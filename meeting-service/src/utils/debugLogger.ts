const DEBUG_SFU = process.env.DEBUG_SFU === "true";

function safeJson(value: any): string {
  try {
    return JSON.stringify(
      value,
      (key, val) => {
        if (typeof key === "string") {
          const lower = key.toLowerCase();
          if (lower.includes("password") || lower.includes("secret") || lower.includes("token")) {
            return "[hidden]";
          }
        }
        return val;
      },
      2
    );
  } catch (err) {
    return String(value);
  }
}

export function sfuDebug(label: string, data?: any): void {
  if (process.env.DEBUG_SFU !== "true") return;
  const time = new Date().toISOString();
  if (data === undefined) {
    console.log(`[SFU DEBUG] ${time} | ${label}`);
    return;
  }
  console.log(`[SFU DEBUG] ${time} | ${label}\n${safeJson(data)}`);
}

export function sfuError(label: string, err: any): void {
  const time = new Date().toISOString();
  console.error(`[SFU ERROR] ${time} | ${label}`, {
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? err.stack : undefined,
  });
}
