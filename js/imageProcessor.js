import { WIDTH, HEIGHT } from './config.js?v=20260924-7';

export function placement(sourceWidth, sourceHeight, mode, targetWidth = WIDTH, targetHeight = HEIGHT) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(value => Number.isFinite(value) && value > 0) || !['fit', 'fill'].includes(mode)) throw new RangeError('Nieprawidłowy rozmiar obrazu lub tryb.');
  const scale = mode === 'fit' ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight) : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

export function transformedPlacement(sourceWidth, sourceHeight, mode, rotation = 0, zoom = 1, targetWidth = WIDTH, targetHeight = HEIGHT, panX = 0, panY = 0) {
  if (!Number.isInteger(rotation) || rotation % 90 !== 0 || !Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(panX) || !Number.isFinite(panY)) throw new RangeError('Nieprawidłowy obrót, skala lub przesunięcie.');
  const quarterTurn = Math.abs(rotation / 90) % 2 === 1;
  const box = placement(quarterTurn ? sourceHeight : sourceWidth, quarterTurn ? sourceWidth : sourceHeight, mode, targetWidth, targetHeight);
  return {
    centerX: targetWidth / 2 + panX * targetWidth / WIDTH,
    centerY: targetHeight / 2 + panY * targetHeight / HEIGHT,
    drawWidth: (quarterTurn ? box.height : box.width) * zoom,
    drawHeight: (quarterTurn ? box.width : box.height) * zoom,
    radians: rotation * Math.PI / 180
  };
}

export function rgbTo565(r, g, b) { return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3); }
export function encodeRgb565(imageData) {
  const { data, width, height } = imageData;
  if (!data || data.length !== width * height * 4) throw new RangeError('Nieprawidłowe dane obrazu.');
  const bytes = new Uint8Array(width * height * 2);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 2) {
    const value = rgbTo565(data[i], data[i + 1], data[i + 2]);
    bytes[j] = value >> 8; // Upstream sends the high byte first.
    bytes[j + 1] = value & 0xff;
  }
  return bytes;
}

export function quantizePreview(imageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = rgbTo565(data[i], data[i + 1], data[i + 2]);
    const r = (value >> 11) & 31, g = (value >> 5) & 63, b = value & 31;
    data[i] = (r << 3) | (r >> 2);
    data[i + 1] = (g << 2) | (g >> 4);
    data[i + 2] = (b << 3) | (b >> 2);
    data[i + 3] = 255;
  }
  return imageData;
}

export function downsamplePreservingLines(source, target, factor = 4) {
  if (!Number.isInteger(factor) || factor < 2 || source.width !== target.width * factor || source.height !== target.height * factor) throw new RangeError('Nieprawidłowe dane skalowania.');
  const input = source.data;
  const output = target.data;
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      let red = 0, green = 0, blue = 0;
      let darkest = 255, darkIndex = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const index = ((y * factor + sy) * source.width + x * factor + sx) * 4;
          const r = input[index], g = input[index + 1], b = input[index + 2];
          red += r; green += g; blue += b;
          const luminance = .2126 * r + .7152 * g + .0722 * b;
          if (luminance < darkest) { darkest = luminance; darkIndex = index; }
        }
      }
      const samples = factor * factor;
      red /= samples; green /= samples; blue /= samples;
      const averageLuminance = .2126 * red + .7152 * green + .0722 * blue;
      // A thin dark stroke can cover only a fraction of a final pixel. Preserve
      // its darkest subpixel on nearly neutral drawings without touching white.
      const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 28;
      const keepStroke = neutral && darkest < 210 && averageLuminance - darkest > 24;
      const blend = keepStroke ? .7 : 0;
      const dest = (y * target.width + x) * 4;
      output[dest] = Math.round(red * (1 - blend) + input[darkIndex] * blend);
      output[dest + 1] = Math.round(green * (1 - blend) + input[darkIndex + 1] * blend);
      output[dest + 2] = Math.round(blue * (1 - blend) + input[darkIndex + 2] * blend);
      output[dest + 3] = 255;
    }
  }
  return target;
}

function neighborhoodPass(data, width, height, darken) {
  const result = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dest = (y * width + x) * 4;
      let best = dest;
      let bestLuminance = darken ? Infinity : -Infinity;
      for (let sy = Math.max(0, y - 1); sy <= Math.min(height - 1, y + 1); sy++) {
        for (let sx = Math.max(0, x - 1); sx <= Math.min(width - 1, x + 1); sx++) {
          const index = (sy * width + sx) * 4;
          const luminance = .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2];
          if (darken ? luminance < bestLuminance : luminance > bestLuminance) {
            bestLuminance = luminance;
            best = index;
          }
        }
      }
      result.set(data.subarray(best, best + 3), dest);
      result[dest + 3] = 255;
    }
  }
  return result;
}

export function adjustLineThickness(imageData, amount = 0) {
  if (!Number.isFinite(amount) || amount < -100 || amount > 200) throw new RangeError('Nieprawidłowa grubość linii.');
  if (amount === 0) return imageData;
  const { data, width, height } = imageData;
  let current = new Uint8ClampedArray(data);
  let remaining = Math.abs(amount) / 100;
  while (remaining > 0) {
    const next = neighborhoodPass(current, width, height, amount > 0);
    const blend = Math.min(1, remaining);
    for (let i = 0; i < current.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) current[i + channel] = Math.round(current[i + channel] * (1 - blend) + next[i + channel] * blend);
      current[i + 3] = 255;
    }
    remaining -= blend;
  }
  data.set(current);
  return imageData;
}

export function adjustTone(imageData, { contrast = 100, brightness = 0 } = {}) {
  if (!Number.isFinite(contrast) || contrast < 50 || contrast > 200 || !Number.isFinite(brightness) || brightness < -80 || brightness > 80) throw new RangeError('Nieprawidłowy kontrast lub jasność.');
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round((data[i + channel] - 128) * contrast / 100 + 128 + brightness);
    data[i + 3] = 255;
  }
  return imageData;
}

export async function loadImage(file) {
  if (!file || (!/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/i.test(file.type) && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name))) throw new Error('Wybierz plik PNG, JPG, WEBP lub BMP.');
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export function parseImageUrl(value, pageProtocol = globalThis.location?.protocol) {
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Wpisz pełny adres URL obrazu, zaczynający się od https://.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Adres obrazu musi zaczynać się od https:// lub http://.');
  if (pageProtocol === 'https:' && url.protocol !== 'https:') throw new Error('Na stronie HTTPS użyj adresu obrazu zaczynającego się od https://.');
  return url;
}

export async function fetchImageFile(value, fetcher = fetch) {
  const url = parseImageUrl(value);
  let response;
  try { response = await fetcher(url.href, { mode: 'cors', credentials: 'omit' }); }
  catch { throw new Error('Nie można pobrać obrazu. Sprawdź adres i czy strona źródłowa zezwala na użycie obrazu w innych witrynach (CORS).'); }
  if (!response.ok) throw new Error(`Nie można pobrać obrazu (HTTP ${response.status}).`);
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (type && type !== 'application/octet-stream' && !/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/.test(type)) throw new Error('Podany adres nie zwrócił obrazu PNG, JPG, WEBP ani BMP.');
  const blob = await response.blob();
  const name = decodeURIComponent(url.pathname.split('/').pop() || 'obraz');
  if (!/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/.test(blob.type) && !/\.(png|jpe?g|webp|bmp)$/i.test(name)) throw new Error('Nie rozpoznano formatu obrazu. Użyj PNG, JPG, WEBP lub BMP.');
  return new File([blob], name, { type: blob.type });
}

export async function loadImageFromUrl(value) {
  return loadImage(await fetchImageFile(value));
}

function drawToContext(ctx, image, mode, rotation, zoom, panX, panY, width, height) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const layout = transformedPlacement(image.width, image.height, mode, rotation, zoom, width, height, panX, panY);
  ctx.save();
  ctx.translate(layout.centerX, layout.centerY);
  ctx.rotate(layout.radians);
  ctx.drawImage(image, -layout.drawWidth / 2, -layout.drawHeight / 2, layout.drawWidth, layout.drawHeight);
  ctx.restore();
}

export function renderImage(canvas, image, mode, { rotation = 0, zoom = 1, panX = 0, panY = 0, preserveLines = true, lineThickness = 0, contrast = 100, brightness = 0 } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Nie można przygotować obrazu w tej przeglądarce.');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  let pixels;
  if (preserveLines && zoom < 1) {
    const factor = 4;
    const sampleCanvas = canvas.ownerDocument.createElement('canvas');
    sampleCanvas.width = WIDTH * factor;
    sampleCanvas.height = HEIGHT * factor;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) throw new Error('Nie można przygotować obrazu w tej przeglądarce.');
    drawToContext(sampleCtx, image, mode, rotation, zoom, panX, panY, sampleCanvas.width, sampleCanvas.height);
    pixels = downsamplePreservingLines(sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height), ctx.createImageData(WIDTH, HEIGHT), factor);
  } else {
    drawToContext(ctx, image, mode, rotation, zoom, panX, panY, WIDTH, HEIGHT);
    pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  }
  adjustLineThickness(pixels, lineThickness);
  adjustTone(pixels, { contrast, brightness });
  quantizePreview(pixels);
  ctx.putImageData(pixels, 0, 0);
  return encodeRgb565(pixels);
}
