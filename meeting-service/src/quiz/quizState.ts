/**
 * In-memory per-room quiz state manager.
 * Keeps quiz state in-memory on the Socket server for instant scoring
 * and real-time broadcasting without blocking database round-trips.
 */

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  text: string;
  imageUrl?: string;
  options: QuizOption[];
  correctOptionId: string;
  basePoints?: number;
  timeLimitSec?: number;
}

export interface QuizParticipantScore {
  userId: string;
  name: string;
  totalPoints: number;
  correctCount: number;
  totalResponseTimeMs: number;
}

export interface QuizSubmission {
  optionId: string;
  submittedAt: number;
}

export class QuizRoomState {
  public quiz: any; // full quiz document (questions, options, timer)
  public status: 'welcome' | 'active' | 'paused' | 'ended';
  public currentQuestionIndex: number;
  public questionStartedAt: number | null; // server authoritative timestamp (ms)
  public submissions: Map<string, Map<string, QuizSubmission>>; // questionId -> Map(userId -> { optionId, submittedAt })
  public scores: Map<string, QuizParticipantScore>; // userId -> { userId, name, totalPoints, correctCount, totalResponseTimeMs }
  public participantOrder: string[]; // preserves submission-time tie-break ordering

  constructor(quiz: any) {
    this.quiz = quiz;
    this.status = 'welcome';
    this.currentQuestionIndex = -1;
    this.questionStartedAt = null;
    this.submissions = new Map();
    this.scores = new Map();
    this.participantOrder = [];
  }

  ensureParticipant(userId: string, name?: string): void {
    if (!this.scores.has(userId)) {
      this.scores.set(userId, {
        userId,
        name: name || 'Participant',
        totalPoints: 0,
        correctCount: 0,
        totalResponseTimeMs: 0,
      });
      this.participantOrder.push(userId);
    } else if (name && name !== 'Participant') {
      const existing = this.scores.get(userId);
      if (existing && (existing.name === 'Participant' || !existing.name)) {
        existing.name = name;
      }
    }
  }

  startQuestion(index: number): QuizQuestion | null {
    this.currentQuestionIndex = index;
    this.questionStartedAt = Date.now();
    this.status = 'active';
    const question = this.quiz?.questions?.[index] || null;
    if (question && question.id) {
      this.submissions.set(question.id, new Map());
    }
    return question;
  }

  getCurrentQuestion(): QuizQuestion | null {
    if (this.currentQuestionIndex < 0 || !this.quiz?.questions) return null;
    return this.quiz.questions[this.currentQuestionIndex] || null;
  }

  hasSubmitted(questionId: string, userId: string): boolean {
    const subs = this.submissions.get(questionId);
    return !!(subs && subs.has(userId));
  }

  recordSubmission(questionId: string, userId: string, optionId: string, submittedAt: number): void {
    if (!this.submissions.has(questionId)) {
      this.submissions.set(questionId, new Map());
    }
    this.submissions.get(questionId)!.set(userId, { optionId, submittedAt });
  }

  isLastQuestion(): boolean {
    if (!this.quiz?.questions) return true;
    return this.currentQuestionIndex >= this.quiz.questions.length - 1;
  }

  pause(): void {
    this.status = 'paused';
  }

  resume(): void {
    this.status = 'active';
  }

  end(): void {
    this.status = 'ended';
  }

  getScoresSnapshot(): QuizParticipantScore[] {
    return Array.from(this.scores.values());
  }
}

export class QuizStateManager {
  private rooms: Map<string, QuizRoomState>;

  constructor() {
    this.rooms = new Map(); // roomId -> QuizRoomState
  }

  create(roomId: string, quiz: any): QuizRoomState {
    const state = new QuizRoomState(quiz);
    this.rooms.set(roomId, state);
    return state;
  }

  get(roomId: string): QuizRoomState | null {
    return this.rooms.get(roomId) || null;
  }

  remove(roomId: string): void {
    this.rooms.delete(roomId);
  }
}

// Singleton export
export const quizStateManager = new QuizStateManager();
export default quizStateManager;
