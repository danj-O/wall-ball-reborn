import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSignalPayload } from './signaling.ts';

test('WebRTC signaling accepts bounded descriptions and candidates', () => {
  assert.deepEqual(parseSignalPayload({ kind: 'description', description: { type: 'offer', sdp: 'v=0' } }),
    { kind: 'description', description: { type: 'offer', sdp: 'v=0' } });
  assert.deepEqual(parseSignalPayload({ kind: 'candidate', candidate: {
    candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0,
  } }), { kind: 'candidate', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal(parseSignalPayload({ kind: 'description', description: { type: 'pranswer', sdp: 'v=0' } }), null);
  assert.equal(parseSignalPayload({ kind: 'description', description: { type: 'offer', sdp: 'x'.repeat(16001) } }), null);
  assert.equal(parseSignalPayload({ kind: 'candidate', candidate: { candidate: '', sdpMid: '0', sdpMLineIndex: -1 } }), null);
});
