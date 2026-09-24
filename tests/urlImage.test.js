import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImageUrl, fetchImageFile } from '../js/imageProcessor.js';

test('image URL validation accepts direct HTTPS links and rejects unsafe schemes', () => {
  assert.equal(parseImageUrl(' https://example.com/photo.png?size=large ', 'https:').href, 'https://example.com/photo.png?size=large');
  assert.throws(() => parseImageUrl('javascript:alert(1)', 'https:'), /https:\/\//);
  assert.throws(() => parseImageUrl('http://example.com/photo.png', 'https:'), /Na stronie HTTPS/);
  assert.throws(() => parseImageUrl('example.com/photo.png', 'https:'), /pełny adres URL/);
});

test('URL loader fetches a supported image without credentials', async () => {
  let requested;
  const file = await fetchImageFile('https://example.com/castle.png?x=1', async (url, options) => {
    requested = { url, options };
    return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } });
  });
  assert.equal(requested.url, 'https://example.com/castle.png?x=1');
  assert.deepEqual(requested.options, { mode: 'cors', credentials: 'omit' });
  assert.equal(file.name, 'castle.png');
  assert.equal(file.type, 'image/png');
  assert.equal(file.size, 4);
});

test('URL loader reports HTTP, non-image and CORS failures', async () => {
  await assert.rejects(fetchImageFile('https://example.com/photo.png', async () => new Response('', { status: 404 })), /HTTP 404/);
  await assert.rejects(fetchImageFile('https://example.com/photo.png', async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })), /nie zwrócił obrazu/);
  await assert.rejects(fetchImageFile('https://example.com/photo.png', async () => { throw new TypeError('Failed to fetch'); }), /CORS/);
});
