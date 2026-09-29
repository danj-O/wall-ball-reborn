import { JevDecisionLayer } from './decision.ts';

export async function reviewScope(
  jev: JevDecisionLayer,
  request: string,
  focusedChange: string,
) {
  if (!request.trim() || !focusedChange.trim()) return { status: 'review' as const, reason: 'missing_evidence' };
  const result = await jev.judge('change_scope', { request, focusedChange }, {
    inScope: 'Does the focused change in state directly serve the user request in state, without adding a distinct unrequested feature? Answer no if unrelated or if the change adds a distinct feature outside the request.',
  });
  return { ...result, status: result.results.inScope.status };
}

export async function chooseRelevantEvidence(
  jev: JevDecisionLayer,
  question: string,
  candidates: Record<string, string>,
) {
  if (!question.trim()) return { status: 'review' as const, reason: 'missing_question' };
  if (Object.keys(candidates).length < 2 || Object.keys(candidates).length > 8 || 'none' in candidates) {
    return { status: 'review' as const, reason: 'expected_2_to_8_candidates' };
  }
  return jev.choose('evidence_relevance', { question, candidates },
    'Which candidate in state is the strongest evidence for answering the question? Choose none if none directly addresses it.',
    { ...Object.fromEntries(Object.keys(candidates).map(id => [id, `Candidate ${id} directly addresses the question.`])), none: 'No candidate directly addresses the question.' });
}
