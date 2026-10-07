import { PollResults, RoomPollState } from "./poll.types";

export function buildResults(state: RoomPollState): PollResults {
  const { poll, voterAnswers } = state;
  const counts = new Map<string, number>(poll.options.map((o): [string, number] => [o, 0]));
  let ratingSum = 0;

  voterAnswers.forEach((answer) => {
    (Array.isArray(answer) ? answer : [answer]).forEach((a) => {
      const key = String(a);
      if (counts.has(key)) counts.set(key, (counts.get(key) as number) + 1);
    });
    if (poll.pollType === "rating") ratingSum += Number(answer);
  });

  const total = voterAnswers.size;
  return {
    pollId: poll.pollId,
    totalVotes: total,
    options: poll.options.map((label) => {
      const count = counts.get(label) ?? 0;
      return { label, count, percent: total ? Math.round((count / total) * 100) : 0 };
    }),
    average: poll.pollType === "rating" ? (total ? Number((ratingSum / total).toFixed(2)) : 0) : null,
  };
}
