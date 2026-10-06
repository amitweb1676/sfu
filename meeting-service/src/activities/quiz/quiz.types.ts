// meeting-service/src/activities/quiz/quiz.types.ts

export interface QuizJoinPayload {
  quizId: string;
  classroomId: string;
  studentId?: string;
  tutorId?: string;
  role: "host" | "student";
}

export interface ActivateQuestionPayload {
  quizId: string;
  classroomId: string;
  questionId: string;
  tutorId: string;
}

export interface SubmitAnswerPayload {
  quizId: string;
  classroomId: string;
  questionId: string;
  studentId: string;
  studentAnswer: any;
  responseTimeSeconds: number;
}

export interface LiveQuestionState {
  questionId: string;
  questionType: string;
  question: string;
  options?: string[];
  points: number;
  sequenceOrder: number;
  timeLimitSeconds?: number;
  activatedAt: number;        // epoch ms, server-authoritative
  expiresAt?: number;         // epoch ms, server-authoritative
  submittedStudentIds: Set<string>;
}

export interface RoomQuizState {
  quizId: string;
  classroomId: string;
  tutorId: string;
  status: "draft" | "active" | "completed" | "cancelled";
  showLeaderboard: boolean;
  currentQuestion: LiveQuestionState | null;
  paused: boolean;
  pausedRemainingMs?: number;
}
