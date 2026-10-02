export type SignalPayload =
  | { kind: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { kind: 'candidate'; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment?: string } };

export function parseSignalPayload(value: unknown): SignalPayload | null {
  if (!value || typeof value !== 'object') return null;
  const signal = value as Record<string, unknown>;
  if (signal.kind === 'description' && signal.description && typeof signal.description === 'object') {
    const description = signal.description as Record<string, unknown>;
    if ((description.type === 'offer' || description.type === 'answer') &&
        typeof description.sdp === 'string' && description.sdp.length > 0 && description.sdp.length <= 16000) {
      return { kind: 'description', description: { type: description.type, sdp: description.sdp } };
    }
  }
  if (signal.kind === 'candidate' && signal.candidate && typeof signal.candidate === 'object') {
    const candidate = signal.candidate as Record<string, unknown>;
    if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 2048 ||
        (candidate.sdpMid !== null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 100)) ||
        (candidate.sdpMLineIndex !== null && (!Number.isInteger(candidate.sdpMLineIndex) ||
          Number(candidate.sdpMLineIndex) < 0 || Number(candidate.sdpMLineIndex) > 32)) ||
        (candidate.usernameFragment !== undefined &&
          (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256))) return null;
    return { kind: 'candidate', candidate: {
      candidate: candidate.candidate, sdpMid: candidate.sdpMid as string | null,
      sdpMLineIndex: candidate.sdpMLineIndex as number | null,
      ...(candidate.usernameFragment === undefined ? {} : { usernameFragment: candidate.usernameFragment }),
    } };
  }
  return null;
}
