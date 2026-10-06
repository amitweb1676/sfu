// meeting-service/src/activities/quiz/quiz.timer.ts
const activeTimers = new Map<string, NodeJS.Timeout>(); // key = classroomId

export function scheduleQuestionExpiry(
  classroomId: string,
  timeLimitSeconds: number,
  onExpire: () => void
): void {
  clearQuestionTimer(classroomId);
  const timeout = setTimeout(onExpire, timeLimitSeconds * 1000);
  activeTimers.set(classroomId, timeout);
}

export function clearQuestionTimer(classroomId: string): void {
  const existing = activeTimers.get(classroomId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(classroomId);
  }
}
