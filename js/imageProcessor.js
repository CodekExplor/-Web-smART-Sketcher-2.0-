import { WIDTH, HEIGHT } from './config.js?v=20260924-5';

export function placement(sourceWidth, sourceHeight, mode, targetWidth = WIDTH, targetHeight = HEIGHT) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(value => Number.isFinite(value) && value > 0) || !['fit', 'fill'].includes(mode)) throw new RangeError('Nieprawidłowy rozmiar obrazu lub tryb.');
  const scale = mode === 'fit' ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight) : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

export function transformedPlacement(sourceWidth, sourceHeight, mode, rotation = 0, zoom = 1, targetWidth = WIDTH, targetHeight = HEIGHT) {
  if (!Number.isInteger(rotation) || rotation % 90 !== 0 || !Number.isFinite(zoom) || zoom <= 0) throw new RangeError('Nieprawidłowy obrót lub skala.');
  const quarterTurn = Math.abs(rotation / 90) % 2 === 1;
  const box = placement(quarterTurn ? sourceHeight : sourceWidth, quarterTurn ? sourceWidth : sourceHeight, mode, targetWidth, targetHeight);
  return {
    centerX: targetWidth / 2,
    centerY: targetHeight / 2,
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

export async function loadImage(file) {
  if (!file || (!/^image\/(png|jpeg|webp|bmp)$/i.test(file.type) && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name))) throw new Error('Wybierz plik PNG, JPG, WEBP lub BMP.');
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function drawToContext(ctx, image, mode, rotation, zoom, width, height) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const layout = transformedPlacement(image.width, image.height, mode, rotation, zoom, width, height);
  ctx.save();
  ctx.translate(layout.centerX, layout.centerY);
  ctx.rotate(layout.radians);
  ctx.drawImage(image, -layout.drawWidth / 2, -layout.drawHeight / 2, layout.drawWidth, layout.drawHeight);
  ctx.restore();
}

export function renderImage(canvas, image, mode, { rotation = 0, zoom = 1, preserveLines = true } = {}) {
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
    drawToContext(sampleCtx, image, mode, rotation, zoom, sampleCanvas.width, sampleCanvas.height);
    pixels = downsamplePreservingLines(sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height), ctx.createImageData(WIDTH, HEIGHT), factor);
  } else {
    drawToContext(ctx, image, mode, rotation, zoom, WIDTH, HEIGHT);
    pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  }
  quantizePreview(pixels);
  ctx.putImageData(pixels, 0, 0);
  return encodeRgb565(pixels);
}
