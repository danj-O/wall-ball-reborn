// Run against `npm run relay:dev`. No game server or credentials are needed.
const base = process.env.RELAY_SMOKE_URL ?? 'http://127.0.0.1:8787';
const created = await fetch(`${base}/rooms`, { method: 'POST' });
if (!created.ok) throw new Error(`Create room: HTTP ${created.status}`);
const { code, token } = await created.json();
const wsBase = base.replace(/^http/, 'ws');
function connect(query) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/rooms/${code}/ws?${query}`);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}
function inbox(socket) {
  const queued = [];
  const waiters = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queued.push(message);
  });
  return () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for relay message')), 3000);
    waiters.push(message => { clearTimeout(timeout); resolve(message); });
  });
}
const host = await connect(`role=host&token=${token}`);
const hostNext = inbox(host);
const red = await connect('role=phone&seat=red');
const redNext = inbox(red);
const blue = await connect('role=phone&seat=blue');
const blueNext = inbox(blue);
const requested = [await hostNext(), await hostNext()].map(message => message.seat).sort();
assertEqual(JSON.stringify(requested), JSON.stringify(['blue', 'red']), 'both seat requests');
host.send(JSON.stringify({ v: 1, type: 'approve', seat: 'red' }));
host.send(JSON.stringify({ v: 1, type: 'approve', seat: 'blue' }));
const joined = [await hostNext(), await hostNext()].map(message => message.seat).sort();
assertEqual(JSON.stringify(joined), JSON.stringify(['blue', 'red']), 'both host joins');
assertEqual((await redNext()).team, 'red', 'red phone assignment');
assertEqual((await blueNext()).team, 'blue', 'blue phone assignment');
host.send(JSON.stringify({ v: 1, type: 'signal', seat: 'red', payload: {
  kind: 'description', description: { type: 'offer', sdp: 'v=0' },
} }));
assertEqual((await redNext()).payload.description.type, 'offer', 'offer reaches only red');
red.send(JSON.stringify({ v: 1, type: 'signal', payload: {
  kind: 'description', description: { type: 'answer', sdp: 'v=0' },
} }));
const answer = await hostNext();
assertEqual(answer.seat, 'red', 'answer seat attribution');
assertEqual(answer.payload.description.type, 'answer', 'answer reaches host');
host.send(JSON.stringify({ v: 1, type: 'signal', seat: 'blue', payload: {
  kind: 'candidate', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
} }));
assertEqual((await blueNext()).payload.kind, 'candidate', 'ICE candidate reaches blue');
red.send(JSON.stringify({ v: 1, type: 'move', x: 1, y: 0, seq: 1 }));
assertEqual((await hostNext()).seat, 'red', 'red input attribution');
blue.send(JSON.stringify({ v: 1, type: 'move', x: 0, y: 1, seq: 1 }));
assertEqual((await hostNext()).seat, 'blue', 'blue input attribution');
host.send(JSON.stringify({ v: 1, type: 'to-seat', seat: 'blue', payload: { v: 1, type: 'feedback', kind: 'bomb' } }));
assertEqual((await blueNext()).type, 'feedback', 'targeted feedback');
host.send(JSON.stringify({ v: 1, type: 'remove-seat', seat: 'red' }));
assertEqual((await redNext()).type, 'removed', 'host disconnect reaches red');
assertEqual((await hostNext()).seat, 'red', 'host disconnect frees red seat');
const replacement = await connect('role=phone&seat=red');
const replacementNext = inbox(replacement);
assertEqual((await hostNext()).type, 'join-request', 'replacement requests red seat');
host.send(JSON.stringify({ v: 1, type: 'approve', seat: 'red' }));
assertEqual((await hostNext()).seat, 'red', 'replacement approved');
assertEqual((await replacementNext()).team, 'red', 'replacement receives red seat');
const redLeft = hostNext();
replacement.send(JSON.stringify({ v: 1, type: 'leave' }));
const redDeparture = await redLeft;
assertEqual(redDeparture.seat, 'red', 'replacement disconnect');
assertEqual(redDeparture.final, true, 'deliberate leave releases direct seat');
blue.send(JSON.stringify({ v: 1, type: 'heartbeat', seq: 2 }));
assertEqual((await hostNext()).seat, 'blue', 'blue remains after red leaves');
const hostLeft = blueNext();
host.close();
assertEqual((await hostLeft).type, 'peer-left', 'host close reaches blue');
blue.close();
console.log('Relay smoke passed: one room, two seats, WebRTC signaling, isolated input, targeted feedback, host seat removal and replacement, independent disconnects');
function assertEqual(actual, expected, label) { if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`); }
