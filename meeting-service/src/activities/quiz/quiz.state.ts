// meeting-service/src/activities/quiz/quiz.state.ts
import { RoomQuizState } from "./quiz.types";

const roomQuizMap = new Map<string, RoomQuizState>(); // key = classroomId

export function getRoomQuiz(classroomId: string): RoomQuizState | undefined {
  return roomQuizMap.get(classroomId);
}

export function setRoomQuiz(classroomId: string, state: RoomQuizState): void {
  roomQuizMap.set(classroomId, state);
}

export function clearRoomQuiz(classroomId: string): void {
  roomQuizMap.delete(classroomId);
}

export function updateRoomQuiz(
  classroomId: string,
  updater: (state: RoomQuizState) => RoomQuizState
): RoomQuizState | undefined {
  const current = roomQuizMap.get(classroomId);
  if (!current) return undefined;
  const updated = updater(current);
  roomQuizMap.set(classroomId, updated);
  return updated;
}
