export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number };

export type ApiResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type DecisionStatus = 'accept' | 'reject' | 'review';
export type Thresholds = { yes: number; no: number; choice: number; humanBelow: number };
export const DEFAULT_THRESHOLDS: Thresholds = { yes: 0.85, no: 0.15, choice: 0.8, humanBelow: 0.6 };

export type Metric = {
  at: string;
  decisionType: string;
  requests: number;
  judgments: number;
  latencyMs: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  confidences: number[];
  fallbacks: number;
  escalations: number;
  estimatedLlmJudgmentsAvoided: number;
  error?: string;
};

export type Evaluation = {
  answers: Record<string, Answer>;
  model?: string;
  usage?: ApiResponse['usage'];
  latencyMs: number;
  error?: string;
};

export type Transport = (state: unknown, questions: Record<string, Question>) => Promise<ApiResponse>;

export class JevDecisionLayer {
  private readonly transport: Transport;
  private readonly record: (metric: Metric) => void | Promise<void>;
  readonly thresholds: Thresholds;
  constructor(
    transport: Transport,
    record: (metric: Metric) => void | Promise<void> = () => {},
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
  ) {
    if (!(thresholds.no >= 0 && thresholds.no < 0.5 && thresholds.yes > 0.5 && thresholds.yes <= 1 && thresholds.choice > 0.5 && thresholds.choice <= 1 && thresholds.humanBelow >= 0.5 && thresholds.humanBelow < thresholds.choice)) {
      throw new Error('Invalid Jev thresholds');
    }
    this.transport = transport;
    this.record = record;
    this.thresholds = thresholds;
  }

  async evaluate(decisionType: string, state: unknown, questions: Record<string, Question>): Promise<Evaluation> {
    const started = performance.now();
    let response: ApiResponse | undefined;
    let error: string | undefined;
    try {
      if (Object.keys(questions).length === 0) throw new Error('No questions supplied');
      response = await this.transport(state, questions);
      for (const [id, question] of Object.entries(questions)) validateAnswer(response.answers[id], question);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unknown Jev error';
      // HTTP error bodies and request state may contain sensitive data; the transport supplies status-only errors.
      error = error.slice(0, 120);
    }
    const answers = error ? {} : response!.answers;
    const confidences = Object.values(answers).map(answer => answer.type === 'noul' ? Math.max(answer.noul, 1 - answer.noul) : answer.confidence);
    const fallbacks = error ? Object.keys(questions).length : Object.values(answers).filter(answer => this.status(answer) === 'review').length;
    const metric: Metric = {
      at: new Date().toISOString(), decisionType, requests: 1, judgments: Object.keys(questions).length,
      latencyMs: Math.round(performance.now() - started), model: response?.model,
      inputTokens: response?.usage?.input_tokens, outputTokens: response?.usage?.output_tokens,
      confidences, fallbacks, escalations: error ? 0 : Object.values(answers).filter(answer => this.reviewRoute(answer) === 'human').length,
      estimatedLlmJudgmentsAvoided: error ? 0 : Object.values(answers).filter(answer => this.status(answer) !== 'review').length,
      ...(error ? { error } : {}),
    };
    try { await this.record(metric); } catch { /* Metrics must never block a decision. */ }
    return { answers, model: response?.model, usage: response?.usage, latencyMs: metric.latencyMs, ...(error ? { error } : {}) };
  }

  status(answer: Answer | undefined): DecisionStatus {
    if (!answer) return 'review';
    if (answer.type === 'noul') {
      if (answer.noul >= this.thresholds.yes) return 'accept';
      if (answer.noul <= this.thresholds.no) return 'reject';
      return 'review';
    }
    return answer.confidence >= this.thresholds.choice ? 'accept' : 'review';
  }

  reviewRoute(answer: Answer | undefined): 'none' | 'codex' | 'human' {
    if (this.status(answer) !== 'review') return 'none';
    if (!answer) return 'codex';
    const certainty = answer.type === 'noul' ? Math.max(answer.noul, 1 - answer.noul) : answer.confidence;
    return certainty < this.thresholds.humanBelow ? 'human' : 'codex';
  }

  async judge(decisionType: string, state: unknown, statements: Record<string, string>) {
    const questions = Object.fromEntries(Object.entries(statements).map(([id, instructions]) => [id, { type: 'noul', instructions } satisfies Question]));
    const evaluation = await this.evaluate(decisionType, state, questions);
    return { ...evaluation, results: Object.fromEntries(Object.keys(statements).map(id => [id, {
      probabilityYes: evaluation.answers[id]?.type === 'noul' ? evaluation.answers[id].noul : undefined,
      status: this.status(evaluation.answers[id]),
      reviewRoute: this.reviewRoute(evaluation.answers[id]),
    }])) };
  }

  async choose(decisionType: string, state: unknown, instructions: string, options: Record<string, string | null>) {
    if (Object.keys(options).length < 2) throw new Error('Choice requires at least two options');
    const evaluation = await this.evaluate(decisionType, state, { selection: { type: 'choice', instructions, criteria: options } });
    const answer = evaluation.answers.selection;
    return { ...evaluation, selection: answer?.type === 'choice' ? answer.choice : undefined,
      probabilities: answer?.type === 'choice' ? answer.probabilities : undefined,
      confidence: answer?.type === 'choice' ? answer.confidence : undefined,
      status: this.status(answer), reviewRoute: this.reviewRoute(answer) };
  }

  async verify(
    evidence: string,
    requirements: Record<string, string>,
    gates: { testsPass: boolean; buildPass: boolean; artifactsExist: boolean },
  ) {
    // Known failures are exact facts. Do not spend a model call on them.
    if (!gates.testsPass || !gates.buildPass || !gates.artifactsExist) {
      return { status: 'reject' as const, gates, reason: 'deterministic_gate_failed', results: {} };
    }
    if (!evidence.trim()) return { status: 'review' as const, gates, reason: 'missing_evidence', results: {} };
    if (Object.keys(requirements).length === 0) return { status: 'review' as const, gates, reason: 'missing_requirements', results: {} };
    const statements = Object.fromEntries(Object.entries(requirements).map(([id, requirement]) => [id,
      `Does the implementation evidence in state directly support this requirement: ${requirement}? Answer no if evidence is absent, unrelated, or contradicts it.`]));
    const result = await this.judge('requirement_coverage', { evidence }, statements);
    const statuses = Object.values(result.results).map(value => value.status);
    const status: DecisionStatus = result.error || statuses.includes('review') ? 'review' : statuses.includes('reject') ? 'reject' : 'accept';
    return { ...result, gates, status };
  }
}

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateAnswer(answer: Answer | undefined, question: Question): void {
  if (!answer || answer.type !== question.type) throw new Error('Invalid Jev response');
  if (answer.type === 'noul') {
    if (!validProbability(answer.noul)) throw new Error('Invalid Jev probability');
  } else if (question.type === 'choice') {
    if (!(answer.choice in question.criteria) || !validProbability(answer.confidence) ||
      Object.keys(question.criteria).some(option => !validProbability(answer.probabilities?.[option]))) {
      throw new Error('Invalid Jev choice');
    }
  }
}
