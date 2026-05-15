export const V2_BUILDER_INSTRUCTION_LINES = [
  "V45 ORDERING CHECKLIST BEFORE add_question: if type is ordering, use items and orderingBehavior.direction exactly top_to_bottom. Answer item ids are optional unless the user asks for grading keys.",
  "V45 ORDERING WARNING: orderingBehavior.direction is never conceptual. Never use first_to_last, chronological, sequence, most_to_least, least_to_most, closest_to_farthest, left_to_right, or horizontal.",
  "V45 ORDERING LABELS: write conceptual meaning only in orderingBehavior.topLabel and orderingBehavior.bottomLabel, such as First/Last or Most/Least.",
  "Supported question types are multiple_choice, multi_select, true_false, fill_blank, short_answer, long_response, multi_typing, multi_write_vertical, text_select, matching, ordering, and numeric. Use multi_select, not multiple_select, for multiple-answer questions.",
  "For normal assistant-authored quizzes, build quietly. Do not send chat progress/check-in messages while authoring. Start with start_quiz and expectedQuestionCount; start_quiz only creates a draft and does not open the widget. Next, call add_first_question exactly once for the first question; add_first_question is the only builder tool that launches the widget. Continue add_question/repair_question exactly once per later question; add_question is storage-only and must not open duplicate widgets. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. The already-launched widget polls the stored draft and refreshes as accepted questions arrive. Do not send question batches in start_quiz.",
  "Do not ask the user to confirm they want a quiz after they request one. Do not describe internal tool progress unless a repair failure blocks completion.",
  "For matching questions, canonical schema is left:[{id,text}], right:[{id,text}]. Optional grading keys use answer:[{leftId,rightId}]. Legacy pairs/matches/items are accepted only for compatibility and normalized internally.",
  "Answer keys are optional. Omit answer fields unless the user asks for scored answer keys or the answer is useful for later ChatGPT grading.",
  "Keep the public product name BetterQuizzes.",
  "Keep the internal compatibility schema exactly betterquizzer.quiz version 2.",
  "Required questions should be rare; practice quizzes should not make every question required by default.",
  "Disable confidence for subjective, preference, survey, reflection, and developer smoke-test questions.",
  "orderingBehavior.direction must always be exactly \"top_to_bottom\". Use topLabel/bottomLabel for conceptual order such as First/Last, Most/Least, or Closest/Farthest.",
  "Never use first_to_last, last_to_first, chronological, sequence, left_to_right, most_to_least, or least_to_most as orderingBehavior.direction.",
  "Use repair_question when a question is missing required fields or needs replacement."
];

export const V2_BUILDER_INSTRUCTIONS = V2_BUILDER_INSTRUCTION_LINES.join("\n");
