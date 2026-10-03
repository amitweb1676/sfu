// sfu-server/quiz/quizSocketHandlers.ts
import { Server, Socket } from 'socket.io';
import axios from 'axios';
import { quizStateManager } from './quizState';
import { applyAnswer, computeLeaderboard } from './quizScoring';
import { config } from '../config';
import { logger } from '../utils/logger';

// Optional direct MongoDB models fallback if collocated
let QuizCompetition: any = null;
let QuizAttempt: any = null;

try {
  // Try local or backend model paths
  QuizCompetition = require('../../../new-express-backup/models/QuizCompetition').default || require('../../../new-express-backup/models/QuizCompetition');
  QuizAttempt = require('../../../new-express-backup/models/QuizAttempt').default || require('../../../new-express-backup/models/QuizAttempt');
} catch (e) {
  // SFU server runs decoupled from direct database connection; will use REST fallback
}

const QUESTION_END_GRACE_MS = 1200;

export function registerQuizHandlers(io: Server, socket: Socket) {
  // ── 1. Host Starts Quiz ───────────────────────────────────────────────────
  socket.on('quiz:start', async (payload: { roomId: string; quizId: string; quiz?: any }) => {
    try {
      const { roomId, quizId } = payload || {};
      if (!roomId || !quizId) return;

      let quizDoc = payload.quiz || null;

      // If quiz not sent in payload, try direct DB
      if (!quizDoc && QuizCompetition) {
        try {
          quizDoc = await QuizCompetition.findById(quizId).lean();
        } catch (e: any) {
          logger.warn(`[quiz:start] direct DB fetch failed: ${e.message}`);
        }
      }

      // If still not found, fetch via Main Backend REST API
      if (!quizDoc) {
        try {
          const baseUrl = config.mainBackendBaseUrl.replace(/\/+$/, '');
          const res = await axios.get(`${baseUrl}/api/collab/quiz/${quizId}/results`, {
            timeout: config.mainBackendTimeoutMs || 5000,
          }).catch(() =>
            axios.get(`${baseUrl}/collab/quiz/${quizId}/results`, {
              timeout: config.mainBackendTimeoutMs || 5000,
            })
          );
          if (res?.data?.quiz) {
            quizDoc = res.data.quiz;
          }
        } catch (err: any) {
          logger.warn(`[quiz:start] REST fetch failed: ${err.message}`);
        }
      }

      // If DB / REST did not return it, construct from socket or fallback
      if (!quizDoc) {
        quizDoc = socket.data?.activeQuiz || { id: quizId, roomId, questions: [], title: 'Quiz Competition' };
      }

      const roomState = quizStateManager.create(roomId, quizDoc);

      // Register all existing connected sockets in this room
      const roomSockets = await io.in(roomId).fetchSockets();
      roomSockets.forEach((s: any) => {
        const uId = s.data?.userId || s.id;
        const uName = s.data?.userName || s.data?.displayName || 'Participant';
        roomState.ensureParticipant(uId, uName);
      });

      // Persist status change
      if (QuizCompetition) {
        QuizCompetition.findByIdAndUpdate(quizId, { status: 'welcome' }).catch(() => {});
      } else {
        const baseUrl = config.mainBackendBaseUrl.replace(/\/+$/, '');
        axios.put(`${baseUrl}/api/collab/quiz/${quizId}/status`, { status: 'welcome' }).catch(() => {});
      }

      io.to(roomId).emit('quiz:welcome', { quiz: { ...quizDoc, status: 'welcome' } });

      // Automatically advance to Question 1 after 4 seconds welcome screen
      setTimeout(() => {
        advanceQuestion(io, roomId, quizId);
      }, 4000);
    } catch (err) {
      logger.error('[quiz:start] error:', err);
    }
  });

  // ── 2. Host Advances Manually ─────────────────────────────────────────────
  socket.on('quiz:next-question', ({ roomId, quizId }: { roomId: string; quizId: string }) => {
    advanceQuestion(io, roomId, quizId);
  });

  // ── 3. Participant Submits Answer ─────────────────────────────────────────
  socket.on(
    'quiz:answer-submit',
    async ({
      roomId,
      quizId,
      questionId,
      optionId,
    }: {
      roomId: string;
      quizId: string;
      questionId: string;
      optionId: string;
    }) => {
      try {
        const roomState = quizStateManager.get(roomId);
        if (!roomState || roomState.status !== 'active') return;

        const userId = socket.data?.userId || socket.id;
        const userName = socket.data?.userName || socket.data?.displayName || 'Participant';

        // Idempotency: Reject double submissions on the same question
        if (roomState.hasSubmitted(questionId, userId)) return;

        const question = roomState.getCurrentQuestion();
        if (!question || question.id !== questionId) return;

        const submittedAt = Date.now();
        roomState.recordSubmission(questionId, userId, optionId, submittedAt);
        roomState.ensureParticipant(userId, userName);

        const result = applyAnswer(roomState, question, userId, optionId, submittedAt);

        // Persist attempt to MongoDB or REST (non-blocking)
        if (QuizAttempt) {
          QuizAttempt.create({
            quizId,
            roomId,
            userId,
            questionId,
            optionId,
            isCorrect: result.isCorrect,
            pointsAwarded: result.pointsAwarded,
            responseTimeMs: result.responseTimeMs,
            submittedAt: new Date(submittedAt),
          }).catch((e: any) => logger.warn('[QuizAttempt.create] duplicate/error:', e.message));
        } else {
          const baseUrl = config.mainBackendBaseUrl.replace(/\/+$/, '');
          axios
            .post(`${baseUrl}/api/collab/quiz/attempt`, {
              quizId,
              roomId,
              userId,
              questionId,
              optionId,
              isCorrect: result.isCorrect,
              pointsAwarded: result.pointsAwarded,
              responseTimeMs: result.responseTimeMs,
              submittedAt: new Date(submittedAt),
            })
            .catch(() => {});
        }

        // 1. Reply privately to the answering participant
        socket.emit('quiz:answer-result', {
          userId,
          questionId,
          isCorrect: result.isCorrect,
          pointsAwarded: result.pointsAwarded,
          responseTimeMs: result.responseTimeMs,
        });

        // 2. Broadcast updated leaderboard to everyone in the room
        const leaderboard = computeLeaderboard(roomState);
        io.to(roomId).emit('quiz:leaderboard-update', leaderboard);
      } catch (err) {
        logger.error('[quiz:answer-submit] error:', err);
      }
    }
  );

  // ── 4. Host Pauses / Resumes ──────────────────────────────────────────────
  socket.on('quiz:pause', ({ roomId }: { roomId: string }) => {
    const roomState = quizStateManager.get(roomId);
    if (!roomState) return;
    roomState.pause();
    io.to(roomId).emit('quiz:paused');
  });

  socket.on('quiz:resume', ({ roomId }: { roomId: string }) => {
    const roomState = quizStateManager.get(roomId);
    if (!roomState) return;
    roomState.resume();
    io.to(roomId).emit('quiz:resumed');
  });

  // ── 5. Host Ends Quiz Early ───────────────────────────────────────────────
  socket.on('quiz:end', async ({ roomId, quizId }: { roomId: string; quizId: string }) => {
    await endQuiz(io, roomId, quizId);
  });

  // ── 6. State Sync on Reconnect ────────────────────────────────────────────
  socket.on('quiz:request-state-sync', ({ roomId }: { roomId: string }) => {
    const roomState = quizStateManager.get(roomId);
    if (!roomState) return;
    socket.emit('quiz:state-sync', {
      quiz: {
        ...roomState.quiz,
        status: roomState.status,
        currentQuestionIndex: roomState.currentQuestionIndex,
      },
      currentQuestion: roomState.getCurrentQuestion(),
      serverStartedAt: roomState.questionStartedAt,
      leaderboard: computeLeaderboard(roomState),
    });
  });
}

async function advanceQuestion(io: Server, roomId: string, quizId: string) {
  const roomState = quizStateManager.get(roomId);
  if (!roomState) return;

  const nextIndex = roomState.currentQuestionIndex + 1;
  if (!roomState.quiz?.questions || nextIndex >= roomState.quiz.questions.length) {
    await endQuiz(io, roomId, quizId);
    return;
  }

  const question = roomState.startQuestion(nextIndex);
  if (!question) {
    await endQuiz(io, roomId, quizId);
    return;
  }

  if (QuizCompetition) {
    QuizCompetition.findByIdAndUpdate(quizId, {
      status: 'active',
      currentQuestionIndex: nextIndex,
    }).catch(() => {});
  } else {
    const baseUrl = config.mainBackendBaseUrl.replace(/\/+$/, '');
    axios
      .put(`${baseUrl}/api/collab/quiz/${quizId}/status`, {
        status: 'active',
        currentQuestionIndex: nextIndex,
      })
      .catch(() => {});
  }

  io.to(roomId).emit('quiz:question-start', {
    question: {
      id: question.id,
      text: question.text,
      imageUrl: question.imageUrl,
      options: question.options,
      basePoints: question.basePoints,
      timeLimitSec: question.timeLimitSec,
      // NOTE: correctOptionId is intentionally omitted from broadcast for anti-cheat
    },
    index: nextIndex,
    serverStartedAt: roomState.questionStartedAt,
  });

  // Server-authoritative auto advance timer
  const durationMs = ((question.timeLimitSec || 20) * 1000) + QUESTION_END_GRACE_MS;
  setTimeout(() => {
    const current = quizStateManager.get(roomId);
    if (!current || current.currentQuestionIndex !== nextIndex) return; // host already advanced
    io.to(roomId).emit('quiz:question-end');

    if (current.isLastQuestion()) {
      endQuiz(io, roomId, quizId);
    } else {
      advanceQuestion(io, roomId, quizId);
    }
  }, durationMs);
}

async function endQuiz(io: Server, roomId: string, quizId: string) {
  const roomState = quizStateManager.get(roomId);
  if (!roomState) return;

  roomState.end();
  const leaderboard = computeLeaderboard(roomState);

  if (QuizCompetition) {
    QuizCompetition.findByIdAndUpdate(quizId, {
      status: 'ended',
      finalLeaderboard: leaderboard,
    }).catch(() => {});
  } else {
    const baseUrl = config.mainBackendBaseUrl.replace(/\/+$/, '');
    axios
      .put(`${baseUrl}/api/collab/quiz/${quizId}/status`, {
        status: 'ended',
        finalLeaderboard: leaderboard,
      })
      .catch(() => {});
  }

  io.to(roomId).emit('quiz:ended', { leaderboard });
  quizStateManager.remove(roomId);
}
