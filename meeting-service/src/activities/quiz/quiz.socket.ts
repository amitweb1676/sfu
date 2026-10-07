// meeting-service/src/activities/quiz/quiz.socket.ts
import { Server, Socket } from "socket.io";
import {
  getRoomQuiz,
  setRoomQuiz,
  updateRoomQuiz,
  clearRoomQuiz,
} from "./quiz.state";
import { scheduleQuestionExpiry, clearQuestionTimer } from "./quiz.timer";
import {
  listTutorQuizzes,
  createQuiz,
  getQuizQuestions,
  addQuestion,
  instantLaunch,
  activateQuestion,
  submitAnswer,
  getLeaderboard,
  setLeaderboardPermission,
  completeQuiz,
  getAnalytics,
  exportCsv,
  errMsg,
} from "./quiz.backendClient";
import {
  QuizJoinPayload,
  LiveQuestionState,
  RoomQuizState,
  Ack,
} from "./quiz.types";
import {
  normalizeQuestion,
  normalizeQuizSummary,
  toStudentSafe,
} from "./quiz.mapper";
import { isHostOrCoHost } from "./quiz.permissions";
import { isPollRunning } from "../activity.guard";

const classroomRoom = (classroomId: string) => `classroom:${classroomId}`;
const quizHostRoom = (classroomId: string) => `quiz-host:${classroomId}`;
const quizRoom = (quizId: string) => `quiz:${quizId}`;

function safeAck(ack: any, res: { ok: boolean; data?: any; error?: string }) {
  if (typeof ack === "function") {
    try {
      ack(res);
    } catch (e) {
      console.error("[quiz.socket] ack error:", e);
    }
  }
}

export function registerQuizSocketHandlers(io: Server, socket: Socket) {
  // ---- 1. JOIN ROOM & STATE RECOVERY ----
  socket.on("quiz:join", async (payload: QuizJoinPayload, ack?: Ack) => {
    try {
      const { classroomId, role } = payload;
      if (!classroomId) {
        safeAck(ack, { ok: false, error: "classroomId is required" });
        return;
      }

      socket.join(classroomRoom(classroomId));
      const isHost = role === "host" || isHostOrCoHost(socket, classroomId);
      if (isHost) {
        socket.join(quizHostRoom(classroomId));
        socket.data.role = "host";
      }

      const roomState = getRoomQuiz(classroomId);
      if (roomState) {
        socket.emit("quiz:state_sync", {
          quizId: roomState.quizId,
          classroomId: roomState.classroomId,
          mode: roomState.mode,
          status: roomState.status,
          paused: roomState.paused,
          showLeaderboard: roomState.showLeaderboard,
          currentQuestion: roomState.currentQuestion
            ? {
                questionId: roomState.currentQuestion.questionId,
                questionType: roomState.currentQuestion.questionType,
                question: roomState.currentQuestion.question,
                options: roomState.currentQuestion.options,
                points: roomState.currentQuestion.points,
                sequenceOrder: roomState.currentQuestion.sequenceOrder,
                timeLimitSeconds: roomState.currentQuestion.timeLimitSeconds,
                activatedAt: roomState.currentQuestion.activatedAt,
                expiresAt: roomState.currentQuestion.expiresAt,
              }
            : null,
          leaderboard: roomState.showLeaderboard || isHost ? roomState.leaderboard : [],
          serverNow: Date.now(),
        });
      }

      safeAck(ack, { ok: true, data: { joined: true, classroomId, role: isHost ? "host" : "student" } });
    } catch (err: any) {
      safeAck(ack, { ok: false, error: errMsg(err) });
    }
  });

  // ---- 2. LEAVE ROOM ----
  socket.on("quiz:leave", (payload: { classroomId: string; quizId?: string }, ack?: Ack) => {
    if (payload?.classroomId) {
      socket.leave(classroomRoom(payload.classroomId));
      socket.leave(quizHostRoom(payload.classroomId));
    }
    if (payload?.quizId) {
      socket.leave(quizRoom(payload.quizId));
    }
    safeAck(ack, { ok: true });
  });

  // ---- 3. HOST: LIST QUIZZES ----
  socket.on("quiz:host:list-quizzes", async (payload: { tutorId: string }, ack?: Ack) => {
    try {
      const quizzes = await listTutorQuizzes(payload.tutorId);
      const normalized = Array.isArray(quizzes) ? quizzes.map(normalizeQuizSummary) : [];
      safeAck(ack, { ok: true, data: normalized });
    } catch (err: any) {
      safeAck(ack, { ok: false, error: errMsg(err) });
    }
  });

  // ---- 4. HOST: CREATE QUIZ ----
  socket.on(
    "quiz:host:create-quiz",
    async (
      payload: {
        classroomId: string;
        tutorId: string;
        title: string;
        quizType?: "instant" | "advance";
        quiz_type?: "instant" | "advance";
      },
      ack?: Ack
    ) => {
      try {
        const created = await createQuiz({
          classroomId: payload.classroomId,
          tutorId: payload.tutorId,
          title: payload.title,
          quiz_type: payload.quizType || payload.quiz_type || "instant",
        });
        safeAck(ack, { ok: true, data: normalizeQuizSummary(created) });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 5. HOST: GET QUESTIONS (LIBRARY / SAVED) ----
  socket.on(
    "quiz:host:get-questions",
    async (payload: { quizId: string; tutorId: string }, ack?: Ack) => {
      try {
        const questions = await getQuizQuestions(payload.quizId, { tutorId: payload.tutorId });
        const normalized = Array.isArray(questions) ? questions.map(normalizeQuestion) : [];
        safeAck(ack, { ok: true, data: normalized });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 6. HOST: ADD QUESTION TO LIBRARY ----
  socket.on("quiz:host:add-question", async (payload: any, ack?: Ack) => {
    try {
      const added = await addQuestion(payload);
      safeAck(ack, { ok: true, data: normalizeQuestion(added) });
    } catch (err: any) {
      safeAck(ack, { ok: false, error: errMsg(err) });
    }
  });

  // ---- 7. HOST: ACTIVATE SAVED QUESTION ----
  socket.on(
    "quiz:host:activate-question",
    async (
      payload: {
        classroomId: string;
        quizId: string;
        questionId: string;
        tutorId?: string;
        question?: any;
      },
      ack?: Ack
    ) => {
      try {
        const { classroomId, quizId, questionId, tutorId } = payload;
        if (isPollRunning(classroomId)) {
          safeAck(ack, { ok: false, error: "A poll is running. Close it first." });
          return;
        }
        await activateQuestion(quizId, questionId);

        let rawQ = payload.question;
        if (!rawQ || !rawQ.question) {
          const questions = await getQuizQuestions(quizId, { tutorId });
          rawQ = Array.isArray(questions)
            ? questions.find((q: any) => (q.question_id || q.questionId) === questionId)
            : null;
        }

        if (!rawQ) {
          safeAck(ack, { ok: false, error: "Question not found" });
          return;
        }

        const normalizedQ = normalizeQuestion(rawQ);
        const safeQ = toStudentSafe(normalizedQ);
        const activatedAt = Date.now();
        const expiresAt = safeQ.timeLimitSeconds
          ? activatedAt + safeQ.timeLimitSeconds * 1000
          : undefined;

        const liveQ: LiveQuestionState = {
          questionId: safeQ.questionId,
          questionType: safeQ.questionType,
          question: safeQ.question,
          options: safeQ.options,
          points: safeQ.points,
          sequenceOrder: safeQ.sequenceOrder,
          timeLimitSeconds: safeQ.timeLimitSeconds,
          activatedAt,
          expiresAt,
          submittedStudentIds: new Set(),
        };

        const existingRoom = getRoomQuiz(classroomId);
        setRoomQuiz(classroomId, {
          quizId,
          classroomId,
          tutorId: tutorId || existingRoom?.tutorId || "",
          mode: "live",
          status: "active",
          showLeaderboard: existingRoom?.showLeaderboard ?? false,
          paused: false,
          currentQuestion: liveQ,
          leaderboard: existingRoom?.leaderboard ?? [],
        });

        // Broadcast to all participants in the classroom
        io.to(classroomRoom(classroomId)).emit("quiz:question_activated", {
          quizId,
          ...safeQ,
          activatedAt,
          expiresAt,
          serverNow: Date.now(),
        });

        if (safeQ.timeLimitSeconds) {
          scheduleQuestionExpiry(classroomId, safeQ.timeLimitSeconds, () => {
            io.to(classroomRoom(classroomId)).emit("quiz:question_expired", {
              quizId,
              questionId: safeQ.questionId,
            });
          });
        }

        safeAck(ack, {
          ok: true,
          data: {
            quizId,
            ...safeQ,
            activatedAt,
            expiresAt,
          },
        });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 8. HOST: INSTANT LAUNCH QUESTION ----
  socket.on(
    "quiz:host:instant-launch",
    async (
      payload: {
        classroomId: string;
        tutorId: string;
        quizId?: string;
        title?: string;
        questionType: string;
        question: string;
        options?: any;
        correctAnswer?: any;
        points?: number;
        negativeMarks?: number;
        explanation?: string;
        timeLimitSeconds?: number;
      },
      ack?: Ack
    ) => {
      try {
        if (isPollRunning(payload.classroomId)) {
          safeAck(ack, { ok: false, error: "A poll is running. Close it first." });
          return;
        }
        const launchData = await instantLaunch(payload);
        const quizId = launchData.quizId;
        const questionId = launchData.questionId;
        const sequenceOrder = launchData.sequenceOrder ?? 1;

        const normalizedQ = normalizeQuestion({
          ...payload,
          questionId,
          sequenceOrder,
        });
        const safeQ = toStudentSafe(normalizedQ);
        const activatedAt = Date.now();
        const expiresAt = safeQ.timeLimitSeconds
          ? activatedAt + safeQ.timeLimitSeconds * 1000
          : undefined;

        const liveQ: LiveQuestionState = {
          questionId: safeQ.questionId,
          questionType: safeQ.questionType,
          question: safeQ.question,
          options: safeQ.options,
          points: safeQ.points,
          sequenceOrder: safeQ.sequenceOrder,
          timeLimitSeconds: safeQ.timeLimitSeconds,
          activatedAt,
          expiresAt,
          submittedStudentIds: new Set(),
        };

        const existingRoom = getRoomQuiz(payload.classroomId);
        setRoomQuiz(payload.classroomId, {
          quizId,
          classroomId: payload.classroomId,
          tutorId: payload.tutorId,
          mode: "live",
          status: "active",
          showLeaderboard: existingRoom?.showLeaderboard ?? false,
          paused: false,
          currentQuestion: liveQ,
          leaderboard: existingRoom?.leaderboard ?? [],
        });

        // Broadcast active question to classroom
        io.to(classroomRoom(payload.classroomId)).emit("quiz:question_activated", {
          quizId,
          ...safeQ,
          activatedAt,
          expiresAt,
          serverNow: Date.now(),
        });

        if (safeQ.timeLimitSeconds) {
          scheduleQuestionExpiry(payload.classroomId, safeQ.timeLimitSeconds, () => {
            io.to(classroomRoom(payload.classroomId)).emit("quiz:question_expired", {
              quizId,
              questionId: safeQ.questionId,
            });
          });
        }

        safeAck(ack, {
          ok: true,
          data: {
            quizId,
            ...safeQ,
            activatedAt,
            expiresAt,
          },
        });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 9. TIMER CONTROLS: PAUSE, RESUME, ADD-TIME ----
  socket.on(
    "quiz:host:pause",
    (payload: { classroomId: string; quizId: string }, ack?: Ack) => {
      try {
        const roomState = getRoomQuiz(payload.classroomId);
        if (!roomState || !roomState.currentQuestion) {
          safeAck(ack, { ok: false, error: "No active question to pause" });
          return;
        }

        clearQuestionTimer(payload.classroomId);
        let pausedRemainingMs = 0;
        if (roomState.currentQuestion.expiresAt) {
          pausedRemainingMs = Math.max(0, roomState.currentQuestion.expiresAt - Date.now());
        }

        updateRoomQuiz(payload.classroomId, (s) => ({
          ...s,
          paused: true,
          pausedRemainingMs,
        }));

        io.to(classroomRoom(payload.classroomId)).emit("quiz:paused", {
          quizId: payload.quizId,
          serverNow: Date.now(),
        });
        safeAck(ack, { ok: true, data: { pausedRemainingMs, serverNow: Date.now() } });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  socket.on(
    "quiz:host:resume",
    (
      payload: { classroomId: string; quizId: string; remainingSeconds?: number },
      ack?: Ack
    ) => {
      try {
        const roomState = getRoomQuiz(payload.classroomId);
        if (!roomState || !roomState.currentQuestion) {
          safeAck(ack, { ok: false, error: "No active question to resume" });
          return;
        }

        const remainingMs =
          payload.remainingSeconds !== undefined
            ? payload.remainingSeconds * 1000
            : roomState.pausedRemainingMs || 0;

        const expiresAt = remainingMs > 0 ? Date.now() + remainingMs : undefined;

        updateRoomQuiz(payload.classroomId, (s) => {
          if (s.currentQuestion) {
            s.currentQuestion.expiresAt = expiresAt;
          }
          return {
            ...s,
            paused: false,
            pausedRemainingMs: undefined,
          };
        });

        if (expiresAt && remainingMs > 0) {
          scheduleQuestionExpiry(payload.classroomId, Math.ceil(remainingMs / 1000), () => {
            io.to(classroomRoom(payload.classroomId)).emit("quiz:question_expired", {
              quizId: payload.quizId,
              questionId: roomState.currentQuestion?.questionId,
            });
          });
        }

        io.to(classroomRoom(payload.classroomId)).emit("quiz:resumed", {
          quizId: payload.quizId,
          expiresAt,
          serverNow: Date.now(),
        });

        safeAck(ack, { ok: true, data: { expiresAt, serverNow: Date.now() } });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  socket.on(
    "quiz:host:add-time",
    (
      payload: { classroomId: string; quizId: string; addSeconds: number },
      ack?: Ack
    ) => {
      try {
        const roomState = getRoomQuiz(payload.classroomId);
        if (!roomState || !roomState.currentQuestion) {
          safeAck(ack, { ok: false, error: "No active question" });
          return;
        }

        const now = Date.now();
        const currentExpiry = roomState.currentQuestion.expiresAt || now;
        const newExpiry = Math.max(now, currentExpiry) + payload.addSeconds * 1000;
        roomState.currentQuestion.expiresAt = newExpiry;

        clearQuestionTimer(payload.classroomId);
        const remainingMs = newExpiry - now;
        if (remainingMs > 0) {
          scheduleQuestionExpiry(payload.classroomId, Math.ceil(remainingMs / 1000), () => {
            io.to(classroomRoom(payload.classroomId)).emit("quiz:question_expired", {
              quizId: payload.quizId,
              questionId: roomState.currentQuestion?.questionId,
            });
          });
        }

        io.to(classroomRoom(payload.classroomId)).emit("quiz:time_added", {
          quizId: payload.quizId,
          expiresAt: newExpiry,
          serverNow: now,
        });

        safeAck(ack, { ok: true, data: { expiresAt: newExpiry, serverNow: now } });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 10. STUDENT: SUBMIT ANSWER (LIVE QUIZ) ----
  socket.on(
    "quiz:student:submit-answer",
    async (
      payload: {
        classroomId: string;
        quizId: string;
        questionId: string;
        studentId: string;
        studentName?: string;
        studentAnswer: any;
        responseTimeSeconds?: number;
      },
      ack?: Ack
    ) => {
      try {
        const { classroomId, quizId, questionId, studentId, studentName, studentAnswer } = payload;
        const roomState = getRoomQuiz(classroomId);

        if (!roomState || !roomState.currentQuestion) {
          safeAck(ack, { ok: false, error: "No active question" });
          return;
        }

        if (roomState.currentQuestion.questionId !== questionId) {
          safeAck(ack, { ok: false, error: "Question no longer active" });
          return;
        }

        // Expiry check with 3 second grace period for network jitter
        if (
          roomState.currentQuestion.expiresAt &&
          Date.now() > roomState.currentQuestion.expiresAt + 3000
        ) {
          safeAck(ack, { ok: false, error: "Time limit expired" });
          return;
        }

        // Prevent double submissions via authoritative Set check
        if (roomState.currentQuestion.submittedStudentIds.has(studentId)) {
          safeAck(ack, { ok: false, error: "Already submitted" });
          return;
        }
        roomState.currentQuestion.submittedStudentIds.add(studentId);

        // Calculate authoritative server-side response time
        const serverResponseTime = Number(
          Math.max(0.1, (Date.now() - roomState.currentQuestion.activatedAt) / 1000).toFixed(1)
        );

        const result = await submitAnswer({
          quizId,
          classroomId,
          questionId,
          studentId,
          studentName: studentName || "",
          studentAnswer,
          responseTimeSeconds: payload.responseTimeSeconds ?? serverResponseTime,
        });

        // Private acknowledgment to submitting student
        socket.emit("quiz:answer_submitted", {
          questionId,
          isCorrect: result?.isCorrect,
          pointsEarned: result?.pointsEarned,
        });

        safeAck(ack, { ok: true, data: result });

        // Realtime submission count progress to host
        io.to(quizHostRoom(classroomId)).emit("quiz:progress", {
          questionId,
          submittedCount: roomState.currentQuestion.submittedStudentIds.size,
        });

        // Update leaderboard
        try {
          const leaderboard = await getLeaderboard(quizId);
          roomState.leaderboard = leaderboard;
          if (roomState.showLeaderboard) {
            io.to(classroomRoom(classroomId)).emit("quiz:leaderboard_updated", {
              quizId,
              showLeaderboard: true,
              leaderboard,
            });
          } else {
            // Host always receives live leaderboard update
            io.to(quizHostRoom(classroomId)).emit("quiz:leaderboard_updated", {
              quizId,
              showLeaderboard: false,
              leaderboard,
            });
          }
        } catch (lbErr) {
          console.warn("[CollaborationQuiz] leaderboard refresh error:", lbErr);
        }
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 11. ADVANCE QUIZ MODE ----
  socket.on(
    "quiz:host:open-advance",
    async (
      payload: { classroomId: string; quizId: string; tutorId: string },
      ack?: Ack
    ) => {
      try {
        const { classroomId, quizId, tutorId } = payload;
        if (isPollRunning(classroomId)) {
          safeAck(ack, { ok: false, error: "A poll is running. Close it first." });
          return;
        }
        setRoomQuiz(classroomId, {
          quizId,
          classroomId,
          tutorId,
          mode: "advance",
          status: "active",
          showLeaderboard: false,
          paused: false,
          currentQuestion: null,
          leaderboard: [],
        });

        io.to(classroomRoom(classroomId)).emit("quiz:advance_opened", {
          quizId,
          serverNow: Date.now(),
        });

        safeAck(ack, { ok: true, data: { quizId, mode: "advance" } });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  socket.on(
    "quiz:student:get-questions",
    async (
      payload: { quizId: string; studentId?: string },
      ack?: Ack
    ) => {
      try {
        const questions = await getQuizQuestions(payload.quizId, { studentId: payload.studentId });
        const safeQuestions = Array.isArray(questions)
          ? questions.map((q: any) => toStudentSafe(normalizeQuestion(q)))
          : [];
        safeAck(ack, { ok: true, data: safeQuestions });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  socket.on(
    "quiz:student:submit-advance-answer",
    async (
      payload: {
        classroomId: string;
        quizId: string;
        questionId: string;
        studentId: string;
        studentName?: string;
        studentAnswer: any;
        responseTimeSeconds?: number;
      },
      ack?: Ack
    ) => {
      try {
        const result = await submitAnswer({
          quizId: payload.quizId,
          classroomId: payload.classroomId,
          questionId: payload.questionId,
          studentId: payload.studentId,
          studentName: payload.studentName || "",
          studentAnswer: payload.studentAnswer,
          responseTimeSeconds: payload.responseTimeSeconds || 0,
        });

        socket.emit("quiz:answer_submitted", {
          questionId: payload.questionId,
          isCorrect: result?.isCorrect,
          pointsEarned: result?.pointsEarned,
        });

        safeAck(ack, { ok: true, data: result });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 12. HOST: TOGGLE LEADERBOARD VISIBILITY ----
  socket.on(
    "quiz:host:toggle-leaderboard",
    async (
      payload: { classroomId: string; quizId: string; showLeaderboard: boolean },
      ack?: Ack
    ) => {
      try {
        await setLeaderboardPermission(payload.quizId, payload.showLeaderboard);
        updateRoomQuiz(payload.classroomId, (s) => ({
          ...s,
          showLeaderboard: payload.showLeaderboard,
        }));

        const leaderboard = await getLeaderboard(payload.quizId);
        io.to(classroomRoom(payload.classroomId)).emit("quiz:leaderboard_permission_changed", {
          quizId: payload.quizId,
          showLeaderboard: payload.showLeaderboard,
        });

        io.to(classroomRoom(payload.classroomId)).emit("quiz:leaderboard_updated", {
          quizId: payload.quizId,
          showLeaderboard: payload.showLeaderboard,
          leaderboard: payload.showLeaderboard ? leaderboard : [],
        });

        safeAck(ack, { ok: true, data: { showLeaderboard: payload.showLeaderboard } });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 13. HOST: END QUIZ ----
  socket.on(
    "quiz:host:end",
    async (
      payload: { classroomId: string; quizId: string; tutorId: string },
      ack?: Ack
    ) => {
      try {
        await completeQuiz(payload.quizId, payload.tutorId);
        clearQuestionTimer(payload.classroomId);

        const finalLeaderboard = await getLeaderboard(payload.quizId);
        io.to(classroomRoom(payload.classroomId)).emit("quiz:completed", {
          quizId: payload.quizId,
          finalLeaderboard,
        });

        clearRoomQuiz(payload.classroomId);
        safeAck(ack, { ok: true, data: { finalLeaderboard } });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 14. HOST: ANALYTICS & CSV EXPORT ----
  socket.on(
    "quiz:host:get-analytics",
    async (payload: { quizId: string; tutorId: string }, ack?: Ack) => {
      try {
        const analytics = await getAnalytics(payload.quizId, payload.tutorId);
        safeAck(ack, { ok: true, data: analytics });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  socket.on(
    "quiz:host:export-csv",
    async (payload: { quizId: string; tutorId: string }, ack?: Ack) => {
      try {
        const csv = await exportCsv(payload.quizId, payload.tutorId);
        safeAck(ack, { ok: true, data: csv });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );

  // ---- 15. RECONNECT / STATE SYNC ----
  socket.on(
    "quiz:request-state-sync",
    (payload: { classroomId: string; studentId?: string }, ack?: Ack) => {
      try {
        const roomState = getRoomQuiz(payload.classroomId);
        const syncData = {
          quizId: roomState ? roomState.quizId : null,
          classroomId: payload.classroomId,
          mode: roomState?.mode || "live",
          status: roomState?.status || "completed",
          paused: roomState?.paused || false,
          showLeaderboard: roomState?.showLeaderboard || false,
          currentQuestion: roomState?.currentQuestion
            ? {
                questionId: roomState.currentQuestion.questionId,
                questionType: roomState.currentQuestion.questionType,
                question: roomState.currentQuestion.question,
                options: roomState.currentQuestion.options,
                points: roomState.currentQuestion.points,
                sequenceOrder: roomState.currentQuestion.sequenceOrder,
                timeLimitSeconds: roomState.currentQuestion.timeLimitSeconds,
                activatedAt: roomState.currentQuestion.activatedAt,
                expiresAt: roomState.currentQuestion.expiresAt,
              }
            : null,
          leaderboard: roomState?.showLeaderboard ? roomState.leaderboard : [],
          serverNow: Date.now(),
        };

        socket.emit("quiz:state_sync", syncData);
        safeAck(ack, { ok: true, data: syncData });
      } catch (err: any) {
        safeAck(ack, { ok: false, error: errMsg(err) });
      }
    }
  );
}
