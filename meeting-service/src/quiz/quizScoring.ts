// sfu-server/quiz/quizScoring.ts
import { QuizRoomState, QuizParticipantScore } from './quizState';

export interface LeaderboardEntry extends QuizParticipantScore {
  rank: number;
}

export interface AnswerResult {
  isCorrect: boolean;
  pointsAwarded: number;
  responseTimeMs: number;
}

/**
 * Speed bonus calculation:
 * - Incorrect answers award 0 points.
 * - Correct answers award basePoints + speed bonus (up to 50% extra),
 *   linearly decaying over the question time limit.
 *
 * Example: basePoints = 100, timeLimitSec = 20s:
 *   - Answered in 2s: 100 + Math.round(50 * (1 - 2/20)) = 100 + 45 = 145 pts
 *   - Answered in 10s: 100 + Math.round(50 * (1 - 10/20)) = 100 + 25 = 125 pts
 */
export function calculatePoints(question: any, responseTimeMs: number, isCorrect: boolean): number {
  if (!isCorrect) return 0;
  const timeLimitMs = (question?.timeLimitSec || 20) * 1000;
  const clampedResponseTime = Math.min(Math.max(0, responseTimeMs), timeLimitMs);
  const ratio = Math.max(0, 1 - clampedResponseTime / timeLimitMs);
  const speedBonus = Math.round((question?.basePoints || 100) * 0.5 * ratio);
  return (question?.basePoints || 100) + speedBonus;
}

export function applyAnswer(
  roomState: QuizRoomState,
  question: any,
  userId: string,
  optionId: string,
  submittedAt: number
): AnswerResult {
  const isCorrect = String(optionId) === String(question.correctOptionId);
  const responseTimeMs = Math.max(0, submittedAt - (roomState.questionStartedAt || submittedAt));
  const pointsAwarded = calculatePoints(question, responseTimeMs, isCorrect);

  const score = roomState.scores.get(userId);
  if (score) {
    score.totalPoints += pointsAwarded;
    score.totalResponseTimeMs += responseTimeMs;
    if (isCorrect) score.correctCount += 1;
  }

  return { isCorrect, pointsAwarded, responseTimeMs };
}

/**
 * Leaderboard Ranking Algorithm:
 * 1. totalPoints (descending)
 * 2. correctCount (descending)
 * 3. totalResponseTimeMs (ascending - faster players rank higher)
 * 4. stable join/submission order (tie-breaker)
 */
export function computeLeaderboard(roomState: QuizRoomState): LeaderboardEntry[] {
  const entries = roomState.getScoresSnapshot();
  const order = roomState.participantOrder;

  entries.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    if (a.totalResponseTimeMs !== b.totalResponseTimeMs) {
      return a.totalResponseTimeMs - b.totalResponseTimeMs;
    }
    return order.indexOf(a.userId) - order.indexOf(b.userId);
  });

  return entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
