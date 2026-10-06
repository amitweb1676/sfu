// meeting-service/src/activities/quiz/quiz.backendClient.ts
import axios from "axios";

const MAIN_BACKEND_BASE_URL = (process.env.MAIN_BACKEND_URL || "http://localhost:5000").replace(/\/+$/, "");
const API_KEY = process.env.COLLABORATION_API_KEY || "";

const client = axios.create({
  baseURL: MAIN_BACKEND_BASE_URL,
  headers: { "x-collaboration-api-key": API_KEY },
  timeout: 8000,
});

export async function fetchActiveQuestion(classroomId: string, studentId: string) {
  const { data } = await client.get(
    `/api/v1/quiz/active-question?classroomId=${classroomId}&studentId=${studentId}`
  );
  return data?.data?.activeQuestion;
}

export async function activateQuestionInBackend(quizId: string, questionId: string) {
  const { data } = await client.post(`/api/v1/quiz/questions/activate`, { quizId, questionId });
  return data;
}

export async function submitAnswerInBackend(payload: {
  studentId: string;
  classroomId: string;
  questionId: string;
  studentAnswer: any;
  responseTimeSeconds: number;
}) {
  const { data } = await client.post(`/api/v1/quiz/submit-answer`, payload);
  return data?.data;
}

export async function getLeaderboard(quizId: string, isTutor: boolean) {
  const { data } = await client.get(`/api/v1/quiz/${quizId}/leaderboard?isTutor=${isTutor}`);
  return data?.data?.leaderboard || [];
}

export async function toggleLeaderboardPermission(quizId: string, showLeaderboard: boolean) {
  const { data } = await client.post(`/api/v1/quiz/${quizId}/leaderboard/permission`, {
    quizId,
    showLeaderboard,
  });
  return data;
}

export async function completeQuizInBackend(quizId: string, tutorId: string) {
  const { data } = await client.post(`/api/v1/quiz/${quizId}/complete`, { tutorId });
  return data;
}
