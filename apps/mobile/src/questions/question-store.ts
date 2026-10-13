// Questions typed on the home screen, handed to the table screen. Like chat drafts, they only
// live in memory: a route param would put the question text in the URL and web history.
const questions = new Map<string, string>();
let nextQuestionId = 0;

export function saveQuestion(question: string): string {
  nextQuestionId += 1;
  const id = `question-${Date.now()}-${nextQuestionId}`;
  questions.set(id, question);
  return id;
}

/** A reload finds nothing, since questions are never persisted. */
export function getQuestion(id: string): string | undefined {
  return questions.get(id);
}
