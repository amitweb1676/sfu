// meeting-service/src/activities/quiz/quiz.types.ts

export type QuizMode = "live" | "advance";
export type Ack = (res: { ok: boolean; data?: any; error?: string }) => void;

export type ActivityUiMode = "classic" | "chalkboard";

export interface QuizJoinPayload {
  classroomId: string;
  studentId?: string;
  tutorId?: string;
  role: "host" | "student";
}

export interface LiveQuestionState {
  questionId: string;
  questionType: string;
  question: string;
  options: any; // student-safe options only
  points: number;
  sequenceOrder: number;
  timeLimitSeconds?: number;
  activatedAt: number;
  expiresAt?: number;
  submittedStudentIds: Set<string>;
  uiMode?: ActivityUiMode;
}

export interface RoomQuizState {
  quizId: string;
  classroomId: string;
  tutorId: string;
  mode: QuizMode;
  uiMode?: ActivityUiMode;
  status: "active" | "completed";
  showLeaderboard: boolean;
  paused: boolean;
  pausedRemainingMs?: number;
  currentQuestion: LiveQuestionState | null;
  leaderboard: any[];
}
