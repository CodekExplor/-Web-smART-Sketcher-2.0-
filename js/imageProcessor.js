import { WIDTH, HEIGHT } from './config.js?v=20260924-3';

export function placement(sourceWidth, sourceHeight, mode, targetWidth = WIDTH, targetHeight = HEIGHT) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0 || !['fit', 'fill'].includes(mode)) throw new RangeError('Nieprawidłowy rozmiar obrazu lub tryb.');
  const scale = mode === 'fit' ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight) : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
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

export function renderImage(canvas, image, mode) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Nie można przygotować obrazu w tej przeglądarce.');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const box = placement(image.width, image.height, mode);
  ctx.drawImage(image, box.x, box.y, box.width, box.height);
  const pixels = quantizePreview(ctx.getImageData(0, 0, WIDTH, HEIGHT));
  ctx.putImageData(pixels, 0, 0);
  return encodeRgb565(pixels);
}
