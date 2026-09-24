import test from 'node:test';
import assert from 'node:assert/strict';
import { placement, transformedPlacement, rgbTo565, encodeRgb565, quantizePreview, downsamplePreservingLines, renderImage } from '../js/imageProcessor.js';

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
test('90-degree turns swap effective dimensions before fitting and zoom around the center', () => {
  const right = transformedPlacement(320, 160, 'fit', 90, 1);
  assert.deepEqual(right, { centerX: 80, centerY: 64, drawWidth: 128, drawHeight: 64, radians: Math.PI / 2 });
  const left = transformedPlacement(320, 160, 'fit', -90, 1.5);
  assert.deepEqual(left, { centerX: 80, centerY: 64, drawWidth: 192, drawHeight: 96, radians: -Math.PI / 2 });
  assert.deepEqual(transformedPlacement(320, 160, 'fill', 180, .5), { centerX: 80, centerY: 64, drawWidth: 128, drawHeight: 64, radians: Math.PI });
  assert.throws(() => transformedPlacement(320, 160, 'fit', 45, 1));
  assert.throws(() => transformedPlacement(320, 160, 'fit', 90, 0));
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
    save() { calls.push(['save']); },
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); },
    drawImage(...args) { calls.push(['draw', ...args.slice(1)]); },
    restore() { calls.push(['restore']); },
    getImageData() { return { data: pixels, width: 160, height: 128 }; },
    putImageData() { calls.push(['put']); }
  };
  const canvas = { getContext() { return context; } };
  const result = renderImage(canvas, { width: 320, height: 160 }, 'fit');
  assert.deepEqual(calls, [['fill', 0, 0, 160, 128], ['save'], ['translate', 80, 64], ['rotate', 0], ['draw', -80, -40, 160, 80], ['restore'], ['put']]);
  assert.equal(canvas.width, 160); assert.equal(canvas.height, 128);
  assert.equal(result.length, 160 * 128 * 2);
  assert.deepEqual([...result.slice(0, 2)], [0xf8, 0]);
});
test('canvas applies zoom and a clockwise quarter turn before reading final pixels', () => {
  const calls = [];
  const context = {
    fillRect() {}, save() {}, restore() {},
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(angle) { calls.push(['rotate', angle]); },
    drawImage(_image, ...args) { calls.push(['draw', ...args]); },
    getImageData() { return { data: new Uint8ClampedArray(160 * 128 * 4), width: 160, height: 128 }; },
    putImageData() {}
  };
  const canvas = { getContext() { return context; } };
  const frame = renderImage(canvas, { width: 320, height: 160 }, 'fit', { rotation: 90, zoom: 2 });
  assert.deepEqual(calls, [['translate', 80, 64], ['rotate', Math.PI / 2], ['draw', -128, -64, 256, 128]]);
  assert.equal(frame.length, 160 * 128 * 2);
});
test('downsampling keeps a one-subpixel black line visible on white', () => {
  const source = { data: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 };
  source.data.set([0, 0, 0, 255], (2 * 4 + 2) * 4);
  const target = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  downsamplePreservingLines(source, target);
  assert.ok(target.data[0] < 100); // ordinary averaging would produce 239
  assert.deepEqual([...target.data.slice(0, 3)], [target.data[0], target.data[0], target.data[0]]);
  assert.equal(target.data[3], 255);
});
test('downsampling leaves uniform white and gray regions unchanged', () => {
  for (const level of [255, 128]) {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([level, level, level, 255], i);
    const target = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    downsamplePreservingLines({ data, width: 4, height: 4 }, target);
    assert.deepEqual([...target.data], [level, level, level, 255]);
  }
});
test('image render uses line-preserving downsampling below 100% zoom', () => {
  const sampleData = new Uint8ClampedArray(640 * 512 * 4).fill(255);
  sampleData.set([0, 0, 0, 255], (2 * 640 + 2) * 4);
  const sampleContext = {
    fillRect() {}, save() {}, translate() {}, rotate() {}, drawImage() {}, restore() {},
    getImageData() { return { data: sampleData, width: 640, height: 512 }; }
  };
  const targetContext = {
    createImageData() { return { data: new Uint8ClampedArray(160 * 128 * 4), width: 160, height: 128 }; },
    putImageData(imageData) { this.lastImageData = imageData; }
  };
  const canvas = {
    getContext() { return targetContext; },
    ownerDocument: { createElement() { return { getContext() { return sampleContext; } }; } }
  };
  const frame = renderImage(canvas, { width: 1254, height: 1254 }, 'fit', { zoom: .5 });
  assert.equal(frame.length, 160 * 128 * 2);
  assert.ok(frame[0] < 100);
  assert.equal(frame[2], 255);
  assert.ok(targetContext.lastImageData);
});
