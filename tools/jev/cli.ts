import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THRESHOLDS, JevDecisionLayer } from './decision.ts';
import { createHttpTransport, loadProjectCredential } from './client.ts';
import { chooseRelevantEvidence, reviewScope } from './workflows.ts';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run jev:review -- path/to/review.json');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
    const key = loadProjectCredential(projectRoot);
    const jev = new JevDecisionLayer(createHttpTransport(key), async metric => {
      await appendFile(resolve(projectRoot, '.jev-metrics.jsonl'), `${JSON.stringify(metric)}\n`, { mode: 0o600 });
    }, { ...DEFAULT_THRESHOLDS, ...input.thresholds });
    let result: unknown;
    if (input.kind === 'requirements') result = await jev.verify(input.evidence, input.requirements, input.gates);
    else if (input.kind === 'scope') result = await reviewScope(jev, input.request, input.focusedChange);
    else if (input.kind === 'relevance') result = await chooseRelevantEvidence(jev, input.question, input.candidates);
    else throw new Error('Unknown review kind');
    console.log(JSON.stringify(result, null, 2));
    if (result && typeof result === 'object' && 'error' in result && String(result.error).includes('HTTP 401')) process.exitCode = 1;
  } catch (error) {
    // Never print raw input, response bodies, or the credential.
    console.error(error instanceof Error ? error.message : 'Jev review failed');
    process.exitCode = 1;
  }
}
