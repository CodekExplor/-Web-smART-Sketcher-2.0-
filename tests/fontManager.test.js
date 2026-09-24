import test from 'node:test';
import assert from 'node:assert/strict';
import { listLocalFonts, loadFont, validateFontFile } from '../js/fontManager.js';

test('installed fonts are sorted and unsupported entries are excluded', async () => {
  const fonts = await listLocalFonts(async () => [
    { fullName: 'Zulu', postscriptName: 'Zulu', style: 'Regular', blob() {} },
    { fullName: 'Broken', postscriptName: '', style: 'Regular', blob() {} },
    { fullName: 'Arial', postscriptName: 'Arial', style: 'Regular', blob() {} }
  ]);
  assert.deepEqual(fonts.map(font => font.fullName), ['Arial', 'Zulu']);
  await assert.rejects(listLocalFonts(), /nie udostępnia/);
  await assert.rejects(listLocalFonts(async () => { throw new Error('denied'); }), /Nie uzyskano dostępu/);
});

test('font loading registers a selected local face and reports invalid data', async () => {
  const registered = [];
  class FakeFontFace {
    constructor(family, bytes) { this.family = family; this.bytes = bytes; }
    async load() { return this; }
  }
  const source = { async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } };
  const result = await loadFont(source, { FontFaceClass: FakeFontFace, fontSet: { add(face) { registered.push(face); } } });
  assert.equal(registered.length, 1);
  assert.match(result.css, /^"SketcherUserFont\d+", sans-serif$/);
  assert.deepEqual([...new Uint8Array(result.face.bytes)], [1, 2, 3]);
  class BrokenFontFace extends FakeFontFace { async load() { throw new Error('invalid'); } }
  await assert.rejects(loadFont(source, { FontFaceClass: BrokenFontFace, fontSet: { add() {} } }), /Nie można wczytać/);
});

test('font file selection accepts supported formats within the size limit', () => {
  const font = { name: 'Moja.ttf', size: 1024 };
  assert.equal(validateFontFile(font), font);
  assert.throws(() => validateFontFile({ name: 'font.exe', size: 100 }), /TTF/);
  assert.throws(() => validateFontFile({ name: 'font.woff2', size: 21 * 1024 * 1024 }), /20 MB/);
});
