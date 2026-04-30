import type { SubmissionCapsule } from "./types";

export function encodeCompactSubmission(submission: SubmissionCapsule): string {
  const confidence = submission.answers.filter((answer) => answer.confidence !== undefined).length;
  return [
    "BQS2",
    `quiz=${encodeURIComponent(submission.quizId)}`,
    `session=${encodeURIComponent(submission.sessionId)}`,
    `mode=${submission.mode}`,
    `answers=${submission.answers.length}`,
    `conf=${confidence}`,
    `grader=${submission.gradingPolicy.preferredGrader}`,
  ].join("|");
}

export function buildCompactReturnPrompt(submission: SubmissionCapsule): string {
  return [
    "I completed a BetterQuizzes activity.",
    "Compact submission:",
    encodeCompactSubmission(submission),
    "",
    "Use the full submission capsule if available; otherwise ask me to paste/export it.",
  ].join("\n");
}
