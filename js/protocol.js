import { WIDTH, HEIGHT, CHUNK_BYTES, LINE_GAP_MS, CHUNK_GAP_MS, ACK_TIMEOUT_MS, debug } from './config.js';

export function sendImageCommand() { return Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x50, 0x00, 0x01, 0x00]); }
export function chunkBytes(bytes, size = CHUNK_BYTES) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Nieprawidłowy rozmiar fragmentu.');
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
  return chunks;
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function sendImage(transport, frame, options = {}) {
  const { width = WIDTH, height = HEIGHT, chunkSize = width * 2, waitForAck = false, lineGapMs = LINE_GAP_MS, chunkGapMs = CHUNK_GAP_MS, ackTimeoutMs = ACK_TIMEOUT_MS, onProgress = () => {}, pause = sleep } = options;
  if (!(frame instanceof Uint8Array) || frame.length !== width * height * 2) throw new RangeError('Obraz musi mieć 160 × 128 pikseli RGB565.');
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError('Nieprawidłowy rozmiar fragmentu.');
  if (waitForAck) transport.clearAcks();
  await transport.write(sendImageCommand());
  // The reference implementation waits 50 ms before each line. Notifications may be
  // combined or missing, so they are diagnostics rather than the default pacing signal.
  await pause(lineGapMs);
  if (waitForAck) transport.clearAcks();
  for (let line = 0; line < height; line++) {
    if (waitForAck) transport.clearAcks();
    const bytes = frame.subarray(line * width * 2, (line + 1) * width * 2);
    const chunks = chunkBytes(bytes, chunkSize);
    debug('line', line + 1, 'chunks', chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      await transport.write(chunks[i]);
      if (i < chunks.length - 1 && chunkGapMs > 0) await pause(chunkGapMs);
    }
    if (waitForAck) await transport.waitForAck(ackTimeoutMs);
    onProgress(line + 1, height);
    if (line < height - 1 && lineGapMs > 0) await pause(lineGapMs);
  }
}
