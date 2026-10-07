import { Server, Socket } from "socket.io";
import { isHostOrCoHost, isQuizRunning } from "../activity.guard";
import { getRoomPoll, setRoomPoll, clearRoomPoll } from "./poll.state";
import { schedulePollExpiry, clearPollTimer } from "./poll.timer";
import { buildResults } from "./poll.results";
import * as api from "./poll.backendClient";
import { Ack, PollResults, PollSettingsInput, PublicPoll, RoomPollState } from "./poll.types";

const pollRoom = (id: string) => `poll:${id}`;
const hostRoom = (id: string) => `poll-host:${id}`;
const RESULTS_THROTTLE_MS = 400;

const launching = new Set<string>();
const pendingBroadcast = new Map<string, NodeJS.Timeout>();
const voterBinding = new Map<string, string>(); // socket.id -> voterId

const ok = (ack: Ack | undefined, data?: any) => {
  if (typeof ack === "function") ack({ ok: true, data });
};
function fail(socket: Socket, ack: Ack | undefined, message: string) {
  if (typeof ack === "function") ack({ ok: false, error: message });
  else socket.emit("poll:error", { message });
}
function requireHost(socket: Socket, classroomId: string, ack?: Ack): boolean {
  if (isHostOrCoHost(socket, classroomId)) return true;
  fail(socket, ack, "Only host or co-host can do this");
  return false;
}

const currentResults = (state: RoomPollState): PollResults =>
  state.status === "closed" && state.finalResults ? state.finalResults : buildResults(state);

function emitResults(io: Server, classroomId: string) {
  const state = getRoomPoll(classroomId);
  if (!state) return;
  const payload = { pollId: state.poll.pollId, results: currentResults(state) };
  io.to(state.resultsVisible ? pollRoom(classroomId) : hostRoom(classroomId)).emit("poll:results_updated", payload);
}

function scheduleResults(io: Server, classroomId: string) {
  if (pendingBroadcast.has(classroomId)) return;
  pendingBroadcast.set(
    classroomId,
    setTimeout(() => {
      pendingBroadcast.delete(classroomId);
      emitResults(io, classroomId);
    }, RESULTS_THROTTLE_MS)
  );
}

async function finishPoll(io: Server, classroomId: string): Promise<PollResults | null> {
  const state = getRoomPoll(classroomId);
  if (!state) return null;
  if (state.status !== "active") return state.finalResults ?? null;

  state.status = "closed";
  clearPollTimer(classroomId);

  let results = buildResults(state);
  try {
    results = (await api.closePoll(state.poll.pollId, state.tutorId)).results ?? results;
  } catch (e) {
    console.error("[poll] close failed, using live results:", api.errMsg(e));
  }
  state.finalResults = results;
  setRoomPoll(classroomId, state);

  io.to(pollRoom(classroomId)).emit("poll:closed", { pollId: state.poll.pollId, serverNow: Date.now() });
  emitResults(io, classroomId);
  return results;
}

function sendSync(socket: Socket, classroomId: string) {
  const state = getRoomPoll(classroomId);
  if (!state) return socket.emit("poll:state_sync", { poll: null, serverNow: Date.now() });

  const voterId = voterBinding.get(socket.id);
  const canSeeResults = isHostOrCoHost(socket, classroomId) || state.resultsVisible;
  socket.emit("poll:state_sync", {
    poll: state.poll,
    status: state.status,
    resultsVisible: state.resultsVisible,
    results: canSeeResults ? currentResults(state) : null,
    myAnswer: voterId && state.voterAnswers.has(voterId) ? state.voterAnswers.get(voterId) : null,
    serverNow: Date.now(),
  });
}

export function cleanupPoll(classroomId: string) {
  clearPollTimer(classroomId);
  const t = pendingBroadcast.get(classroomId);
  if (t) clearTimeout(t);
  pendingBroadcast.delete(classroomId);
  clearRoomPoll(classroomId);
}

export function registerPollSocketHandlers(io: Server, socket: Socket) {
  socket.on("disconnect", () => voterBinding.delete(socket.id));

  // ───────── JOIN / LEAVE / SYNC ─────────
  socket.on("poll:join", (p: { classroomId: string; voterId?: string; tutorId?: string }) => {
    if (!p?.classroomId) return;
    socket.join(pollRoom(p.classroomId));
    if (isHostOrCoHost(socket, p.classroomId)) socket.join(hostRoom(p.classroomId));
    if (p.voterId && !voterBinding.has(socket.id)) voterBinding.set(socket.id, p.voterId);
    sendSync(socket, p.classroomId);
  });

  socket.on("poll:leave", (p: { classroomId: string }) => {
    socket.leave(pollRoom(p.classroomId));
    socket.leave(hostRoom(p.classroomId));
  });

  socket.on("poll:request-state-sync", (p: { classroomId: string }) => sendSync(socket, p.classroomId));

  // ───────── HOST: LAUNCH ─────────
  socket.on(
    "poll:host:launch",
    async (p: { classroomId: string; tutorId: string; poll: PollSettingsInput }, ack?: Ack) => {
      if (!requireHost(socket, p.classroomId, ack)) return;
      if (isQuizRunning(p.classroomId)) return fail(socket, ack, "A quiz is running. End it first.");
      if (getRoomPoll(p.classroomId)?.status === "active") return fail(socket, ack, "A poll is already running. Close it first.");
      if (launching.has(p.classroomId)) return fail(socket, ack, "Please wait a moment.");

      launching.add(p.classroomId);
      try {
        const created = await api.launchPoll({ classroomId: p.classroomId, tutorId: p.tutorId, ...p.poll });

        const startedAt = Date.now();
        const expiresAt = created.timeLimitSeconds ? startedAt + created.timeLimitSeconds * 1000 : undefined;
        const poll: PublicPoll = {
          pollId: created.pollId,
          question: created.question,
          pollType: created.pollType,
          options: created.options,
          ratingMax: created.ratingMax,
          anonymous: created.anonymous,
          allowChange: created.allowChange,
          timeLimitSeconds: created.timeLimitSeconds,
          startedAt,
          expiresAt,
        };

        cleanupPoll(p.classroomId);
        setRoomPoll(p.classroomId, {
          poll,
          classroomId: p.classroomId,
          tutorId: p.tutorId,
          status: "active",
          resultsVisible: false,
          voterAnswers: new Map(),
          pendingVoters: new Set(),
        });

        io.to(pollRoom(p.classroomId)).emit("poll:started", { poll, serverNow: Date.now() });
        emitResults(io, p.classroomId);
        if (expiresAt) schedulePollExpiry(p.classroomId, expiresAt - Date.now(), () => void finishPoll(io, p.classroomId));

        ok(ack, { pollId: poll.pollId });
      } catch (e) {
        fail(socket, ack, api.errMsg(e));
      } finally {
        launching.delete(p.classroomId);
      }
    }
  );

  // ───────── HOST: CLOSE / REVEAL / DISMISS ─────────
  socket.on("poll:host:close", async (p: { classroomId: string }, ack?: Ack) => {
    if (!requireHost(socket, p.classroomId, ack)) return;
    const state = getRoomPoll(p.classroomId);
    if (!state || state.status !== "active") return fail(socket, ack, "No poll is running");
    ok(ack, { results: await finishPoll(io, p.classroomId) });
  });

  socket.on("poll:host:reveal", async (p: { classroomId: string; visible: boolean }, ack?: Ack) => {
    if (!requireHost(socket, p.classroomId, ack)) return;
    const state = getRoomPoll(p.classroomId);
    if (!state) return fail(socket, ack, "No poll to show");
    try {
      await api.setResultsVisibility(state.poll.pollId, state.tutorId, !!p.visible);
      state.resultsVisible = !!p.visible;
      io.to(pollRoom(p.classroomId)).emit("poll:results_visibility", {
        pollId: state.poll.pollId,
        visible: state.resultsVisible,
        results: state.resultsVisible ? currentResults(state) : null,
      });
      ok(ack);
    } catch (e) {
      fail(socket, ack, api.errMsg(e));
    }
  });

  socket.on("poll:host:dismiss", (p: { classroomId: string }, ack?: Ack) => {
    if (!requireHost(socket, p.classroomId, ack)) return;
    if (getRoomPoll(p.classroomId)?.status === "active") return fail(socket, ack, "Close the poll first");
    cleanupPoll(p.classroomId);
    io.to(pollRoom(p.classroomId)).emit("poll:dismissed", {});
    ok(ack);
  });

  // ───────── STUDENT: VOTE ─────────
  socket.on(
    "poll:student:vote",
    async (p: { classroomId: string; pollId: string; voterId: string; voterName?: string; answer: any }, ack?: Ack) => {
      const state = getRoomPoll(p.classroomId);
      if (!state || state.status !== "active" || state.poll.pollId !== p.pollId) return fail(socket, ack, "This poll is not open");
      if (state.poll.expiresAt && Date.now() > state.poll.expiresAt) return fail(socket, ack, "Time is over");
      if (!p.voterId) return fail(socket, ack, "Missing voter");

      const bound = voterBinding.get(socket.id);
      if (!bound) voterBinding.set(socket.id, p.voterId);
      else if (bound !== p.voterId) return fail(socket, ack, "Identity mismatch");

      if (state.voterAnswers.has(p.voterId) && !state.poll.allowChange) return fail(socket, ack, "You have already voted");
      if (state.pendingVoters.has(p.voterId)) return fail(socket, ack, "Please wait");

      state.pendingVoters.add(p.voterId);
      try {
        const r = await api.votePoll({ pollId: p.pollId, voterId: p.voterId, voterName: p.voterName, answer: p.answer });
        state.voterAnswers.set(p.voterId, r.answer);
        ok(ack, { changed: r.changed, answer: r.answer });
        scheduleResults(io, p.classroomId);
      } catch (e) {
        fail(socket, ack, api.errMsg(e));
      } finally {
        state.pendingVoters.delete(p.voterId);
      }
    }
  );

  // ───────── HOST: HISTORY / RESULTS / CSV ─────────
  socket.on("poll:host:history", async (p: { classroomId: string; tutorId: string }, ack?: Ack) => {
    if (!requireHost(socket, p.classroomId, ack)) return;
    try { ok(ack, await api.getHistory(p.classroomId, p.tutorId)); } catch (e) { fail(socket, ack, api.errMsg(e)); }
  });

  socket.on("poll:host:get-results", async (p: { classroomId: string; pollId: string; tutorId: string }, ack?: Ack) => {
    if (!requireHost(socket, p.classroomId, ack)) return;
    try { ok(ack, await api.getResults(p.pollId, p.tutorId)); } catch (e) { fail(socket, ack, api.errMsg(e)); }
  });

  socket.on("poll:host:export-csv", async (p: { classroomId: string; pollId: string; tutorId: string }, ack?: Ack) => {
    if (!requireHost(socket, p.classroomId, ack)) return;
    try { ok(ack, await api.exportCsv(p.pollId, p.tutorId)); } catch (e) { fail(socket, ack, api.errMsg(e)); }
  });
}
