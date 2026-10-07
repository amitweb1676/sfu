import axios from "axios";
import { PollResults, PollSettingsInput, PublicPoll } from "./poll.types";

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

export async function launchPoll(p: { classroomId: string; tutorId: string } & PollSettingsInput) {
  return unwrap(await client.post(`/api/v1/poll/launch`, p)).poll as any;
}

export async function votePoll(p: { pollId: string; voterId: string; voterName?: string; answer: any }) {
  return unwrap(await client.post(`/api/v1/poll/vote`, p)) as { changed: boolean; answer: any };
}

export async function closePoll(pollId: string, tutorId: string) {
  return unwrap(await client.post(`/api/v1/poll/${pollId}/close`, { tutorId })) as { results: PollResults };
}

export async function setResultsVisibility(pollId: string, tutorId: string, visible: boolean) {
  return unwrap(await client.post(`/api/v1/poll/${pollId}/reveal`, { tutorId, visible }));
}

export async function getResults(pollId: string, tutorId: string) {
  return unwrap(await client.get(`/api/v1/poll/${pollId}/results`, { params: { tutorId } })) as {
    results: PollResults;
    poll: PublicPoll;
  };
}

export async function getHistory(classroomId: string, tutorId: string) {
  const d = unwrap(await client.get(`/api/v1/poll/classroom/${classroomId}/history`, { params: { tutorId } }));
  return (d?.polls ?? d) as any[];
}
export const getPollHistory = getHistory;

export async function exportCsv(pollId: string, tutorId: string): Promise<string> {
  const r = await client.get(`/api/v1/poll/${pollId}/export`, {
    params: { tutorId },
    responseType: "text",
  });
  return r.data as string;
}
