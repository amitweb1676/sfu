import axios from "axios";

const client = axios.create({
  baseURL: process.env.MAIN_BACKEND_URL || "http://localhost:5000",
  headers: {
    ...(process.env.COLLABORATION_API_KEY
      ? { "x-collaboration-api-key": process.env.COLLABORATION_API_KEY }
      : {}),
  },
  timeout: 8000,
});

const unwrap = (r: any) => r.data?.data ?? r.data;
export const errMsg = (e: any) => e?.response?.data?.message || e?.message || "Request failed";

export async function listTutorQuizzes(tutorId: string) {
  const d = unwrap(await client.get(`/api/v1/quiz/tutor/${tutorId}`));
  return d.quizzes ?? d;
}

export async function createQuiz(p: {
  classroomId: string;
  tutorId: string;
  title: string;
  quiz_type: "instant" | "advance";
}) {
  const d = unwrap(await client.post(`/api/v1/quiz/create`, p));
  return d.quiz ?? d;
}

export async function getQuizQuestions(
  quizId: string,
  q: { tutorId?: string; studentId?: string }
) {
  const d = unwrap(await client.get(`/api/v1/quiz/${quizId}/questions`, { params: q }));
  return d.questions ?? d;
}

export async function addQuestion(p: any) {
  const d = unwrap(await client.post(`/api/v1/quiz/questions/add`, p));
  const q = d.question ?? d;
  // Backend returns key "id" — remap so normalizeQuestion mapper can find it
  return {
    ...q,
    question_id: q.question_id ?? q.questionId ?? q.id,
  };
}

export async function instantLaunch(p: any) {
  return unwrap(await client.post(`/api/v1/quiz/instant/launch`, p));
}

export async function activateQuestion(quizId: string, questionId: string) {
  return unwrap(await client.post(`/api/v1/quiz/questions/activate`, { quizId, questionId }));
}

export async function submitAnswer(p: any) {
  return unwrap(await client.post(`/api/v1/quiz/submit-answer`, p));
}

export async function getLeaderboard(quizId: string) {
  const d = unwrap(await client.get(`/api/v1/quiz/${quizId}/leaderboard`, { params: { isTutor: true } }));
  return d.leaderboard ?? d;
}

export async function setLeaderboardPermission(quizId: string, showLeaderboard: boolean) {
  return unwrap(await client.post(`/api/v1/quiz/${quizId}/leaderboard/permission`, { quizId, showLeaderboard }));
}

export async function completeQuiz(quizId: string, tutorId: string) {
  return unwrap(await client.post(`/api/v1/quiz/${quizId}/complete`, { tutorId }));
}

export async function getAnalytics(quizId: string, tutorId: string) {
  return unwrap(await client.get(`/api/v1/quiz/${quizId}/analytics`, { params: { tutorId } }));
}

export async function exportCsv(quizId: string, tutorId: string): Promise<string> {
  const r = await client.get(`/api/v1/quiz/${quizId}/export`, {
    params: { tutorId },
    responseType: "text",
  });
  return r.data as string;
}
