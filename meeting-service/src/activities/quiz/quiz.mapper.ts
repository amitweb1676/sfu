export interface NormalizedQuestion {
  questionId: string;
  questionType: string;
  question: string;
  options: any;
  correctAnswer?: any;
  points: number;
  negativeMarks: number;
  explanation: string;
  timeLimitSeconds?: number;
  sequenceOrder: number;
}

export function normalizeQuestion(q: any): NormalizedQuestion {
  return {
    questionId: q.questionId ?? q.question_id,
    questionType: q.questionType ?? q.question_type,
    question: q.question,
    options: q.options ?? [],
    correctAnswer: q.correctAnswer ?? q.correct_answer,
    points: Number(q.points ?? 0),
    negativeMarks: Number(q.negativeMarks ?? q.negative_marks ?? 0),
    explanation: q.explanation ?? "",
    timeLimitSeconds: q.timeLimitSeconds ?? q.time_limit_seconds ?? undefined,
    sequenceOrder: Number(q.sequenceOrder ?? q.sequence_order ?? 0),
  };
}

export function normalizeQuizSummary(q: any) {
  return {
    id: q.id ?? q.quiz_id,
    title: q.title,
    quizType: q.quizType ?? q.quiz_type,
    status: q.status,
    totalQuestions: q.totalQuestions ?? q.total_questions ?? 0,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Strips answer & explanation. For matching, shuffles the right column.
export function toStudentSafe(q: NormalizedQuestion) {
  let options: any = q.options;
  if (q.questionType === "matching") {
    const pairs: { left: string; right: string }[] = Array.isArray(q.options)
      ? q.options
      : [];
    options = {
      left: pairs.map((p) => p.left),
      right: shuffle(pairs.map((p) => p.right)),
    };
  }
  return {
    questionId: q.questionId,
    questionType: q.questionType,
    question: q.question,
    options,
    points: q.points,
    sequenceOrder: q.sequenceOrder,
    timeLimitSeconds: q.timeLimitSeconds,
  };
}
