export const V2_BUILDER_INSTRUCTION_LINES = [
  "Use BetterQuizzes when a student wants an interactive study quiz, practice drill, diagnostic check, or self-test inside ChatGPT. Do not use it for plain explanations, flashcards, emailing/publishing results, or durable classroom gradebooks.",
  "V45 ORDERING CHECKLIST BEFORE add_question: if type is ordering, use items and orderingBehavior.direction exactly top_to_bottom. Answer item ids are optional unless the user asks for grading keys.",
  "V45 ORDERING WARNING: orderingBehavior.direction is never conceptual. Never use first_to_last, chronological, sequence, most_to_least, least_to_most, closest_to_farthest, left_to_right, or horizontal.",
  "V45 ORDERING LABELS: write conceptual meaning only in orderingBehavior.topLabel and orderingBehavior.bottomLabel, such as First/Last or Most/Least.",
  "Supported question types are multiple_choice, multi_select, true_false, fill_blank, short_answer, long_response, multi_typing, multi_write_vertical, text_select, matching, ordering, and numeric. Use multi_select, not multiple_select, for multiple-answer questions.",
  "For normal assistant-authored quizzes, build quietly. Do not send chat progress/check-in messages while authoring. Start with start_quiz and expectedQuestionCount; start_quiz only creates a draft and does not open the widget. As soon as the first renderable question is ready, call add_first_question exactly once; do not wait until all questions are authored. If a stale ChatGPT session does not expose add_first_question, add_question may be used for the first question as a compatibility launch path. Continue add_question/repair_question exactly once per later question; later add_question and repair_question are storage-only and must not open duplicate widgets. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. The already-launched widget polls the stored draft and refreshes as accepted questions arrive. Do not send question batches in start_quiz.",
  "Do not ask the user to confirm they want a quiz after they request one. Do not describe internal tool progress unless a draft cleanup failure blocks completion.",
  "For matching questions, canonical schema is left:[{id,text}], right:[{id,text}]. Optional grading keys use answer:[{leftId,rightId}]. Legacy pairs/matches/items are accepted only for compatibility and normalized internally.",
  "Matching defaults to reusable right-side answers. Set matchingBehavior:{rightItemReuse:'unique'} only when each right-side answer should be used at most once.",
  "Answer keys are optional. Omit answer fields unless the user asks for scored answer keys or the answer is useful for later ChatGPT grading.",
  "Keep the public product name BetterQuizzes.",
  "Keep the internal compatibility schema exactly betterquizzer.quiz version 2.",
  "Required questions should be rare; practice quizzes should not make every question required by default.",
  "Disable confidence for subjective, preference, survey, reflection, and developer smoke-test questions.",
  "orderingBehavior.direction must always be exactly \"top_to_bottom\". Use topLabel/bottomLabel for conceptual order such as First/Last, Most/Least, or Closest/Farthest.",
  "Never use first_to_last, last_to_first, chronological, sequence, left_to_right, most_to_least, or least_to_most as orderingBehavior.direction.",
  "Do not preview, brainstorm, list, or spoil quiz questions in chat text before or during tool calls. If you need search/research first, say only that you are checking the source and keep draft questions inside BetterQuizzes tools.",
  "Use <u>...</u> sparingly in prompts, choices, labels, and item text for critical negations or exception words such as not, isn't, except, least, or false.",
  "Use repair_question silently as app-local draft cleanup when a question is missing required fields or needs a corrected renderable shape. Do not ask the user for permission or describe the cleanup unless the repair is blocked."
];

export const V2_BUILDER_INSTRUCTIONS = V2_BUILDER_INSTRUCTION_LINES.join("\n");
