import { RoomPollState } from "./poll.types";

const roomPollMap = new Map<string, RoomPollState>();

export const getRoomPoll = (classroomId: string) => roomPollMap.get(classroomId);
export const setRoomPoll = (classroomId: string, state: RoomPollState) => void roomPollMap.set(classroomId, state);
export const clearRoomPoll = (classroomId: string) => void roomPollMap.delete(classroomId);
