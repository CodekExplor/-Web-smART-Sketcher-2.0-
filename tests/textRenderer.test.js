import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, fitText, renderText } from '../js/textRenderer.js';
import { encodeRgb565 } from '../js/imageProcessor.js';

test('text wrapping preserves manual line breaks and splits long words', () => {
  assert.deepEqual(wrapText('Ala ma kota\n\nSupercalifragilistic', 10, value => value.length), [
    'Ala ma', 'kota', '', 'Supercalif', 'ragilistic'
  ]);
});

test('text fitting uses the largest allowed size that fits both dimensions', () => {
  const result = fitText('ABC DEF', 32, 1.2, (value, size) => value.length * size / 2, 90, 40);
  assert.equal(result.size, 25);
  assert.deepEqual(result.lines, ['ABC DEF']);
});

test('empty or excessive text cannot produce a frame', () => {
  assert.throws(() => fitText(' ', 32, 1.2, value => value.length), /Wpisz napis/);
  assert.throws(() => fitText('A\n'.repeat(30), 32, 1.2, value => value.length), /zbyt długi/);
});

test('text preview uses exactly the same RGB565 pixels as the transmitted frame', () => {
  const source = new Uint8ClampedArray(640 * 512 * 4).fill(255);
  let preview;
  let lastFontSize;
  const sampleContext = {
    measureText(value) { return { width: value.length * lastFontSize / 2 }; },
    set font(value) { lastFontSize = parseInt(value, 10); },
    fillRect() {},
    fillText() { source.set([0, 0, 0, 255], (255 * 640 + 320) * 4); },
    getImageData() { return { data: source, width: 640, height: 512 }; }
  };
  const targetContext = {
    createImageData() { return { data: new Uint8ClampedArray(160 * 128 * 4), width: 160, height: 128 }; },
    putImageData(pixels) { preview = pixels; }
  };
  const canvas = {
    getContext() { return targetContext; },
    ownerDocument: { createElement() { return { getContext() { return sampleContext; } }; } }
  };
  const frame = renderText(canvas, { text: 'TEST', font: 'sans-serif' });
  assert.equal(frame.length, 160 * 128 * 2);
  assert.deepEqual(frame, encodeRgb565(preview));
  assert.ok(frame.some(value => value !== 255));
});

test('light text on dark background uses normal antialiasing', () => {
  let drawCount = 0;
  let preview;
  const sample = { set font(value) { this.size = parseInt(value, 10); }, measureText(value) { return { width: value.length * this.size / 2 }; }, fillRect() {}, fillText() {} };
  const target = {
    drawImage() { drawCount++; },
    getImageData() { return { data: new Uint8ClampedArray(160 * 128 * 4).fill(0), width: 160, height: 128 }; },
    putImageData(value) { preview = value; }
  };
  const canvas = { getContext() { return target; }, ownerDocument: { createElement() { return { getContext() { return sample; } }; } } };
  const frame = renderText(canvas, { text: 'Światło', font: 'sans-serif', color: '#ffffff', background: '#000000' });
  assert.equal(drawCount, 1);
  assert.deepEqual(frame, encodeRgb565(preview));
});
