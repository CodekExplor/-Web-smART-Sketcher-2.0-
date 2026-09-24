import test from 'node:test';
import assert from 'node:assert/strict';
import { sendImageCommand, chunkBytes, sendImage } from '../js/protocol.js';

test('Send Image command is the eight documented bytes', () => {
  assert.deepEqual([...sendImageCommand()], [1, 0, 0, 0, 0x50, 0, 1, 0]);
});
test('chunking preserves all data and order', () => {
  const input = Uint8Array.from({ length: 320 }, (_, i) => i % 256);
  const parts = chunkBytes(input, 20);
  assert.equal(parts.length, 16);
  assert.ok(parts.every(part => part.length <= 20));
  assert.deepEqual([...parts.flatMap(part => [...part])], [...input]);
  assert.deepEqual(chunkBytes(Uint8Array.from([1, 2, 3, 4, 5]), 2).map(part => [...part]), [[1, 2], [3, 4], [5]]);
});
test('mock transfer writes one command, then each line sequentially and waits for acknowledgement', async () => {
  const calls = [];
  const transport = {
    clearAcks() { calls.push('clear'); },
    async write(bytes) { calls.push([...bytes]); },
    async waitForAck() { calls.push('ack'); }
  };
  const frame = Uint8Array.from({ length: 16 }, (_, i) => i);
  const progress = [];
  await sendImage(transport, frame, { width: 4, height: 2, chunkSize: 3, lineGapMs: 0, chunkGapMs: 0, pause: async () => {}, onProgress: (line, total) => progress.push([line, total]) });
  assert.deepEqual(calls, [
    'clear', [1, 0, 0, 0, 80, 0, 1, 0], 'clear', 'clear',
    [0, 1, 2], [3, 4, 5], [6, 7], 'ack', 'clear',
    [8, 9, 10], [11, 12, 13], [14, 15], 'ack'
  ]);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
});
test('transfer stops after missing acknowledgement', async () => {
  let writes = 0;
  const transport = { clearAcks() {}, async write() { writes++; }, async waitForAck() { throw Error('timeout'); } };
  await assert.rejects(sendImage(transport, new Uint8Array(16), { width: 4, height: 2, chunkSize: 8, lineGapMs: 0, chunkGapMs: 0, pause: async () => {} }), /timeout/);
  assert.equal(writes, 2); // command + first line only
});
