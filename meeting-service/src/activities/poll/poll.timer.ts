const timers = new Map<string, NodeJS.Timeout>();

export function schedulePollExpiry(classroomId: string, ms: number, onExpire: () => void): void {
  clearPollTimer(classroomId);
  timers.set(classroomId, setTimeout(onExpire, Math.max(0, ms)));
}

export function clearPollTimer(classroomId: string): void {
  const t = timers.get(classroomId);
  if (t) {
    clearTimeout(t);
    timers.delete(classroomId);
  }
}
