import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiResponse, Question, Transport } from './decision.ts';

export function loadProjectCredential(projectRoot: string): string {
  const envPath = resolve(projectRoot, '.env');
  try {
    execFileSync('git', ['check-ignore', '-q', '--', '.env'], { cwd: projectRoot, stdio: 'ignore' });
  } catch { throw new Error('Refusing to read .env: Git does not ignore it'); }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', '.env'], { cwd: projectRoot, stdio: 'ignore' });
    throw new Error('Refusing to read .env: it is tracked by Git');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing')) throw error;
  }
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find(row => /^\s*TYPESAFE_API_KEY\s*=/.test(row));
  if (!line) throw new Error('TYPESAFE_API_KEY is missing from project .env');
  let value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value) throw new Error('TYPESAFE_API_KEY is empty');
  process.env.TYPESAFE_API_KEY = value;
  return value;
}

export function createHttpTransport(apiKey: string, fetchImpl: typeof fetch = fetch): Transport {
  return async (state: unknown, questions: Record<string, Question>): Promise<ApiResponse> => {
    let response: Response;
    try {
      response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, model: 'jev-latest', questions }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error('TypeSafe network or timeout failure'); }
    if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('Invalid TypeSafe JSON response'); }
    if (!body || typeof body !== 'object' || !('answers' in body) || !('model' in body)) throw new Error('Invalid TypeSafe response');
    return body as ApiResponse;
  };
}
