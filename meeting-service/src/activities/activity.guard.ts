import { getRoomQuiz } from "./quiz/quiz.state";
import { getRoomPoll } from "./poll/poll.state";

export { isHostOrCoHost } from "./quiz/quiz.permissions";

export const isQuizRunning = (classroomId: string) => !!getRoomQuiz(classroomId);
export const isPollRunning = (classroomId: string) => getRoomPoll(classroomId)?.status === "active";
