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

/** Hands the question over once and forgets it. A reload finds nothing. */
export function takeQuestion(id: string): string | undefined {
  const question = questions.get(id);
  questions.delete(id);
  return question;
}
