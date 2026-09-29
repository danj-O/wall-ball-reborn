import assert from 'node:assert/strict';
import test from 'node:test';
import { JevDecisionLayer, type Metric } from './decision.ts';
import { chooseRelevantEvidence, reviewScope } from './workflows.ts';

test('requirements batch after deterministic gates and retain probabilities and usage', async () => {
  let calls = 0;
  const metrics: Metric[] = [];
  const jev = new JevDecisionLayer(async (_state, questions) => {
    calls++;
    assert.equal(Object.keys(questions).length, 2);
    return { model: 'jev-test', usage: { input_tokens: 42, output_tokens: 8 }, answers: {
      movement: { type: 'noul', noul: 0.94 }, flags: { type: 'noul', noul: 0.91 },
    } };
  }, metric => { metrics.push(metric); });
  const gates = { testsPass: true, buildPass: true, artifactsExist: true };
  const result = await jev.verify('Focused implementation excerpt', { movement: 'Players move', flags: 'Flags exist' }, gates);
  assert.equal(result.status, 'accept');
  assert.equal(result.results.flags.probabilityYes, 0.91);
  assert.equal(calls, 1);
  assert.equal(metrics[0].judgments, 2);
  assert.equal(metrics[0].inputTokens, 42);
  assert.equal(metrics[0].estimatedLlmJudgmentsAvoided, 2);
  const failed = await jev.verify('Evidence', { movement: 'Players move' }, { ...gates, testsPass: false });
  assert.equal(failed.status, 'reject');
  assert.equal(calls, 1);
});

test('ambiguous answers route to review and very low certainty to human', async () => {
  const jev = new JevDecisionLayer(async () => ({ model: 'jev-test', answers: {
    inScope: { type: 'noul', noul: 0.51 },
  } }));
  const result = await reviewScope(jev, 'Add walls', 'Change wall controls');
  assert.equal(result.status, 'review');
  assert.ok('results' in result);
  assert.equal(result.results.inScope.reviewRoute, 'human');
});

test('choice includes no-match and rejects malformed or unavailable answers', async () => {
  const jev = new JevDecisionLayer(async (_state, questions) => {
    assert.ok(questions.selection.type === 'choice' && 'none' in questions.selection.criteria);
    return { model: 'jev-test', answers: { selection: {
      type: 'choice', choice: 'none', probabilities: { a: 0.02, b: 0.03, none: 0.95 }, confidence: 0.9,
    } } };
  });
  const result = await chooseRelevantEvidence(jev, 'Where is wall HP shown?', { a: 'camera config', b: 'input config' });
  assert.equal(result.status, 'accept');
  assert.equal(result.selection, 'none');
  const broken = new JevDecisionLayer(async () => ({ model: 'jev-test', answers: { selection: { type: 'noul', noul: 0.9 } } }));
  const fallback = await chooseRelevantEvidence(broken, 'Question', { a: 'A', b: 'B' });
  assert.equal(fallback.status, 'review');
  assert.ok('reviewRoute' in fallback);
  assert.equal(fallback.reviewRoute, 'codex');
});

test('service failure is a safe review fallback', async () => {
  const jev = new JevDecisionLayer(async () => { throw new Error('TypeSafe HTTP 529'); });
  const result = await jev.verify('evidence', { item: 'A requirement' }, { testsPass: true, buildPass: true, artifactsExist: true });
  assert.equal(result.status, 'review');
  assert.ok('error' in result);
  assert.equal(result.error, 'TypeSafe HTTP 529');
});
