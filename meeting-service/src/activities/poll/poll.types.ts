export type PollType = "single_choice" | "multiple_choice" | "yes_no" | "rating";
export type Ack<T = any> = (res: { ok: boolean; data?: T; error?: string }) => void;

export interface PollSettingsInput {
  question: string;
  pollType: PollType;
  options?: string[];
  ratingMax?: number;
  anonymous?: boolean;
  allowChange?: boolean;
  timeLimitSeconds?: number;
}

export interface PublicPoll {
  pollId: string;
  question: string;
  pollType: PollType;
  options: string[];
  ratingMax: number;
  anonymous: boolean;
  allowChange: boolean;
  timeLimitSeconds?: number;
  startedAt: number;
  expiresAt?: number;
}

export interface PollResults {
  pollId: string;
  totalVotes: number;
  options: { label: string; count: number; percent: number }[];
  average: number | null;
}

export interface RoomPollState {
  poll: PublicPoll;
  classroomId: string;
  tutorId: string;
  status: "active" | "closed";
  resultsVisible: boolean;
  voterAnswers: Map<string, any>;
  pendingVoters: Set<string>;
  finalResults?: PollResults;
}
