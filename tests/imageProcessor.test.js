import test from 'node:test';
import assert from 'node:assert/strict';
import { placement, rgbTo565, encodeRgb565, quantizePreview, renderImage } from '../js/imageProcessor.js';

test('fit keeps a wide image inside 160 × 128 with centered white margins', () => {
  assert.deepEqual(placement(320, 160, 'fit'), { x: 0, y: 24, width: 160, height: 80 });
});
test('fill crops a wide image symmetrically while preserving aspect ratio', () => {
  assert.deepEqual(placement(320, 160, 'fill'), { x: -48, y: 0, width: 256, height: 128 });
});
test('portrait placement preserves aspect ratio in both modes', () => {
  const fit = placement(100, 200, 'fit');
  const fill = placement(100, 200, 'fill');
  assert.equal(fit.width / fit.height, .5);
  assert.equal(fill.width / fill.height, .5);
  assert.deepEqual(fit, { x: 48, y: 0, width: 64, height: 128 });
  assert.deepEqual(fill, { x: 0, y: -96, width: 160, height: 320 });
});
test('RGB565 uses red 5, green 6, blue 5 bits and sends high byte first', () => {
  const colors = [
    [[0, 0, 0], 0x0000], [[255, 255, 255], 0xffff],
    [[255, 0, 0], 0xf800], [[0, 255, 0], 0x07e0], [[0, 0, 255], 0x001f]
  ];
  const rgba = new Uint8ClampedArray(colors.flatMap(([rgb]) => [...rgb, 255]));
  const bytes = encodeRgb565({ data: rgba, width: 5, height: 1 });
  for (let i = 0; i < colors.length; i++) {
    assert.equal(rgbTo565(...colors[i][0]), colors[i][1]);
    assert.deepEqual([...bytes.slice(i * 2, i * 2 + 2)], [colors[i][1] >> 8, colors[i][1] & 255]);
  }
});
test('preview quantization re-encodes to the same RGB565 color', () => {
  const image = { data: new Uint8ClampedArray([123, 201, 77, 128]), width: 1, height: 1 };
  const before = encodeRgb565(image);
  quantizePreview(image);
  assert.deepEqual(encodeRgb565(image), before);
  assert.equal(image.data[3], 255);
});
test('canvas processing paints white, draws with fit geometry and encodes the final pixels', () => {
  const calls = [];
  const pixels = new Uint8ClampedArray(160 * 128 * 4);
  pixels.set([255, 0, 0, 255]);
  const context = {
    fillRect(...args) { calls.push(['fill', ...args]); },
    drawImage(...args) { calls.push(['draw', ...args.slice(1)]); },
    getImageData() { return { data: pixels, width: 160, height: 128 }; },
    putImageData() { calls.push(['put']); }
  };
  const canvas = { getContext() { return context; } };
  const result = renderImage(canvas, { width: 320, height: 160 }, 'fit');
  assert.deepEqual(calls, [['fill', 0, 0, 160, 128], ['draw', 0, 24, 160, 80], ['put']]);
  assert.equal(canvas.width, 160); assert.equal(canvas.height, 128);
  assert.equal(result.length, 160 * 128 * 2);
  assert.deepEqual([...result.slice(0, 2)], [0xf8, 0]);
});
