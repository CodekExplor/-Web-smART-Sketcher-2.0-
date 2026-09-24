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
  const { width = WIDTH, height = HEIGHT, chunkSize = CHUNK_BYTES, lineGapMs = LINE_GAP_MS, chunkGapMs = CHUNK_GAP_MS, ackTimeoutMs = ACK_TIMEOUT_MS, onProgress = () => {}, pause = sleep } = options;
  if (!(frame instanceof Uint8Array) || frame.length !== width * height * 2) throw new RangeError('Obraz musi mieć 160 × 128 pikseli RGB565.');
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError('Nieprawidłowy rozmiar fragmentu.');
  transport.clearAcks();
  await transport.write(sendImageCommand());
  // A command response can arrive before the first line; it is not a line acknowledgement.
  await pause(lineGapMs);
  transport.clearAcks();
  for (let line = 0; line < height; line++) {
    transport.clearAcks();
    const bytes = frame.subarray(line * width * 2, (line + 1) * width * 2);
    const chunks = chunkBytes(bytes, chunkSize);
    debug('line', line + 1, 'chunks', chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      await transport.write(chunks[i]);
      if (i < chunks.length - 1 && chunkGapMs > 0) await pause(chunkGapMs);
    }
    await transport.waitForAck(ackTimeoutMs);
    onProgress(line + 1, height);
    if (line < height - 1 && lineGapMs > 0) await pause(lineGapMs);
  }
}
