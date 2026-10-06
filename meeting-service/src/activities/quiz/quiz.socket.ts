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
  fetchActiveQuestion,
  activateQuestionInBackend,
  submitAnswerInBackend,
  getLeaderboard,
  toggleLeaderboardPermission,
  completeQuizInBackend,
} from "./quiz.backendClient";
import {
  QuizJoinPayload,
  ActivateQuestionPayload,
  SubmitAnswerPayload,
} from "./quiz.types";

const quizRoom = (quizId: string) => `quiz:${quizId}`;
const classroomRoom = (classroomId: string) => `classroom:${classroomId}`;

export function registerQuizSocketHandlers(io: Server, socket: Socket) {
  // ---- JOIN / LEAVE ----
  socket.on("quiz:join", async (payload: QuizJoinPayload) => {
    try {
      const { quizId, classroomId } = payload;
      socket.join(quizRoom(quizId));
      socket.join(classroomRoom(classroomId));

      const roomState = getRoomQuiz(classroomId);
      if (roomState && roomState.currentQuestion) {
        // State recovery on join/reconnect
        socket.emit("quiz:state_sync", {
          quizId: roomState.quizId,
          status: roomState.status,
          paused: roomState.paused,
          showLeaderboard: roomState.showLeaderboard,
          currentQuestion: {
            questionId: roomState.currentQuestion.questionId,
            question: roomState.currentQuestion.question,
            options: roomState.currentQuestion.options,
            questionType: roomState.currentQuestion.questionType,
            points: roomState.currentQuestion.points,
            sequenceOrder: roomState.currentQuestion.sequenceOrder,
            activatedAt: roomState.currentQuestion.activatedAt,
            expiresAt: roomState.currentQuestion.expiresAt,
          },
        });
      }
    } catch (err) {
      socket.emit("quiz:error", { message: "Failed to join quiz room" });
    }
  });

  socket.on("quiz:leave", (payload: { quizId: string; classroomId: string }) => {
    socket.leave(quizRoom(payload.quizId));
    socket.leave(classroomRoom(payload.classroomId));
  });

  // ---- HOST: ACTIVATE QUESTION ----
  socket.on(
    "quiz:host:activate-question",
    async (payload: ActivateQuestionPayload & {
      questionType: string;
      question: string;
      options?: string[];
      points: number;
      sequenceOrder: number;
      timeLimitSeconds?: number;
    }) => {
      try {
        await activateQuestionInBackend(payload.quizId, payload.questionId);

        const activatedAt = Date.now();
        const expiresAt = payload.timeLimitSeconds
          ? activatedAt + payload.timeLimitSeconds * 1000
          : undefined;

        setRoomQuiz(payload.classroomId, {
          quizId: payload.quizId,
          classroomId: payload.classroomId,
          tutorId: payload.tutorId,
          status: "active",
          showLeaderboard: false,
          paused: false,
          currentQuestion: {
            questionId: payload.questionId,
            questionType: payload.questionType,
            question: payload.question,
            options: payload.options,
            points: payload.points,
            sequenceOrder: payload.sequenceOrder,
            timeLimitSeconds: payload.timeLimitSeconds,
            activatedAt,
            expiresAt,
            submittedStudentIds: new Set(),
          },
        });

        io.to(classroomRoom(payload.classroomId)).emit("quiz:question_activated", {
          quizId: payload.quizId,
          questionId: payload.questionId,
          questionType: payload.questionType,
          question: payload.question,
          options: payload.options,
          points: payload.points,
          sequenceOrder: payload.sequenceOrder,
          timeLimitSeconds: payload.timeLimitSeconds,
          activatedAt,
          expiresAt,
        });

        if (payload.timeLimitSeconds) {
          scheduleQuestionExpiry(payload.classroomId, payload.timeLimitSeconds, () => {
            io.to(classroomRoom(payload.classroomId)).emit("quiz:question_expired", {
              quizId: payload.quizId,
              questionId: payload.questionId,
            });
          });
        }
      } catch (err) {
        socket.emit("quiz:error", { message: "Failed to activate question" });
      }
    }
  );

  // ---- HOST: PAUSE / RESUME ----
  socket.on("quiz:host:pause", (payload: { classroomId: string; quizId: string }) => {
    const updated = updateRoomQuiz(payload.classroomId, (s) => ({ ...s, paused: true }));
    clearQuestionTimer(payload.classroomId);
    if (updated) {
      io.to(classroomRoom(payload.classroomId)).emit("quiz:paused", { quizId: payload.quizId });
    }
  });

  socket.on(
    "quiz:host:resume",
    (payload: { classroomId: string; quizId: string; remainingSeconds: number }) => {
      const updated = updateRoomQuiz(payload.classroomId, (s) => ({ ...s, paused: false }));
      if (updated && updated.currentQuestion) {
        const expiresAt = Date.now() + payload.remainingSeconds * 1000;
        updated.currentQuestion.expiresAt = expiresAt;
        setRoomQuiz(payload.classroomId, updated);

        io.to(classroomRoom(payload.classroomId)).emit("quiz:resumed", {
          quizId: payload.quizId,
          expiresAt,
        });

        scheduleQuestionExpiry(payload.classroomId, payload.remainingSeconds, () => {
          io.to(classroomRoom(payload.classroomId)).emit("quiz:question_expired", {
            quizId: payload.quizId,
            questionId: updated.currentQuestion?.questionId,
          });
        });
      }
    }
  );

  // ---- HOST: ADD TIME ----
  socket.on(
    "quiz:host:add-time",
    (payload: { classroomId: string; quizId: string; addSeconds: number }) => {
      const updated = updateRoomQuiz(payload.classroomId, (s) => {
        if (s.currentQuestion && s.currentQuestion.expiresAt) {
          s.currentQuestion.expiresAt += payload.addSeconds * 1000;
        }
        return s;
      });
      if (updated && updated.currentQuestion) {
        clearQuestionTimer(payload.classroomId);
        const remainingMs = updated.currentQuestion.expiresAt! - Date.now();
        scheduleQuestionExpiry(payload.classroomId, Math.ceil(remainingMs / 1000), () => {
          io.to(classroomRoom(payload.classroomId)).emit("quiz:question_expired", {
            quizId: payload.quizId,
            questionId: updated.currentQuestion?.questionId,
          });
        });
        io.to(classroomRoom(payload.classroomId)).emit("quiz:time_added", {
          quizId: payload.quizId,
          expiresAt: updated.currentQuestion.expiresAt,
        });
      }
    }
  );

  // ---- STUDENT: SUBMIT ANSWER ----
  socket.on("quiz:student:submit-answer", async (payload: SubmitAnswerPayload) => {
    try {
      const roomState = getRoomQuiz(payload.classroomId);
      if (!roomState || !roomState.currentQuestion) {
        return socket.emit("quiz:error", { message: "No active question" });
      }
      if (roomState.currentQuestion.questionId !== payload.questionId) {
        return socket.emit("quiz:error", { message: "Question no longer active" });
      }
      if (
        roomState.currentQuestion.expiresAt &&
        Date.now() > roomState.currentQuestion.expiresAt
      ) {
        return socket.emit("quiz:error", { message: "Time expired" });
      }
      if (roomState.currentQuestion.submittedStudentIds.has(payload.studentId)) {
        return socket.emit("quiz:error", { message: "Already submitted" });
      }

      const result = await submitAnswerInBackend({
        studentId: payload.studentId,
        classroomId: payload.classroomId,
        questionId: payload.questionId,
        studentAnswer: payload.studentAnswer,
        responseTimeSeconds: payload.responseTimeSeconds,
      });

      roomState.currentQuestion.submittedStudentIds.add(payload.studentId);
      setRoomQuiz(payload.classroomId, roomState);

      // Private ack to the submitting student only
      socket.emit("quiz:answer_submitted", {
        questionId: payload.questionId,
        isCorrect: result?.isCorrect,
        pointsEarned: result?.pointsEarned,
      });

      // Live leaderboard refresh to everyone in the classroom
      const leaderboard = await getLeaderboard(payload.quizId, true);
      io.to(classroomRoom(payload.classroomId)).emit("quiz:leaderboard_updated", {
        quizId: payload.quizId,
        showLeaderboard: roomState.showLeaderboard,
        leaderboard: roomState.showLeaderboard ? leaderboard : [],
      });
    } catch (err) {
      socket.emit("quiz:error", { message: "Failed to submit answer" });
    }
  });

  // ---- HOST: TOGGLE LEADERBOARD VISIBILITY ----
  socket.on(
    "quiz:host:toggle-leaderboard",
    async (payload: { classroomId: string; quizId: string; showLeaderboard: boolean }) => {
      await toggleLeaderboardPermission(payload.quizId, payload.showLeaderboard);
      updateRoomQuiz(payload.classroomId, (s) => ({
        ...s,
        showLeaderboard: payload.showLeaderboard,
      }));
      io.to(classroomRoom(payload.classroomId)).emit("quiz:leaderboard_permission_changed", {
        quizId: payload.quizId,
        showLeaderboard: payload.showLeaderboard,
      });
    }
  );

  // ---- HOST: END QUIZ ----
  socket.on(
    "quiz:host:end",
    async (payload: { classroomId: string; quizId: string; tutorId: string }) => {
      try {
        await completeQuizInBackend(payload.quizId, payload.tutorId);
        clearQuestionTimer(payload.classroomId);
        const finalLeaderboard = await getLeaderboard(payload.quizId, true);
        io.to(classroomRoom(payload.classroomId)).emit("quiz:completed", {
          quizId: payload.quizId,
          finalLeaderboard,
        });
        clearRoomQuiz(payload.classroomId);
      } catch (err) {
        socket.emit("quiz:error", { message: "Failed to end quiz" });
      }
    }
  );

  // ---- RECONNECT / STATE SYNC ----
  socket.on("quiz:request-state-sync", async (payload: { classroomId: string; studentId?: string }) => {
    const roomState = getRoomQuiz(payload.classroomId);
    if (!roomState) return socket.emit("quiz:state_sync", { quizId: null });

    let activeQuestionForStudent = null;
    if (payload.studentId) {
      activeQuestionForStudent = await fetchActiveQuestion(payload.classroomId, payload.studentId);
    }

    socket.emit("quiz:state_sync", {
      quizId: roomState.quizId,
      status: roomState.status,
      paused: roomState.paused,
      showLeaderboard: roomState.showLeaderboard,
      currentQuestion: activeQuestionForStudent ?? roomState.currentQuestion,
    });
  });
}
