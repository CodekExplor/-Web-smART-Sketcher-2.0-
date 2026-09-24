import { WIDTH, HEIGHT } from './config.js?v=20260924-8';
import { downsamplePreservingLines, adjustLineThickness, adjustTone, quantizePreview, encodeRgb565 } from './imageProcessor.js?v=20260924-8';

const FACTOR = 4;
const MARGIN = 8;
const MIN_SIZE = 6;

export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      if (measure(word) <= maxWidth) { line = word; continue; }
      let part = '';
      for (const character of Array.from(word)) {
        if (part && measure(part + character) > maxWidth) { lines.push(part); part = ''; }
        part += character;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines;
}

export function fitText(text, maxSize, lineSpacing, measure, width = WIDTH - MARGIN * 2, height = HEIGHT - MARGIN * 2) {
  if (!text.trim()) throw new Error('Wpisz napis przed wysłaniem.');
  if (!Number.isFinite(maxSize) || maxSize < MIN_SIZE || maxSize > 72 || !Number.isFinite(lineSpacing) || lineSpacing < .8 || lineSpacing > 1.8) throw new RangeError('Nieprawidłowy rozmiar lub odstęp wierszy.');
  for (let size = Math.floor(maxSize); size >= MIN_SIZE; size--) {
    const lines = wrapText(text, width, value => measure(value, size));
    if (lines.length * size * lineSpacing <= height && lines.every(line => measure(line, size) <= width)) return { lines, size };
  }
  throw new Error('Napis jest zbyt długi dla kadru 160 × 128. Skróć tekst lub usuń część podziałów wierszy.');
}

function luminance(hex) {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}

export function renderText(canvas, {
  text, font, maxSize = 32, lineSpacing = 1.2, align = 'center', color = '#000000', background = '#ffffff',
  panX = 0, panY = 0, lineThickness = 0, contrast = 100, brightness = 0
}) {
  if (!['left', 'center', 'right'].includes(align) || !/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(background) || !Number.isFinite(panX) || !Number.isFinite(panY)) throw new RangeError('Nieprawidłowe ustawienia napisu.');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Nie można przygotować napisu w tej przeglądarce.');
  const sampleCanvas = canvas.ownerDocument.createElement('canvas');
  sampleCanvas.width = WIDTH * FACTOR;
  sampleCanvas.height = HEIGHT * FACTOR;
  const sample = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sample) throw new Error('Nie można przygotować napisu w tej przeglądarce.');
  const layout = fitText(text, maxSize, lineSpacing, (value, size) => {
    sample.font = `${size * FACTOR}px ${font}`;
    return sample.measureText(value).width / FACTOR;
  });
  sample.fillStyle = background;
  sample.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
  sample.fillStyle = color;
  sample.font = `${layout.size * FACTOR}px ${font}`;
  sample.textAlign = align;
  sample.textBaseline = 'middle';
  const x = (align === 'left' ? MARGIN : align === 'right' ? WIDTH - MARGIN : WIDTH / 2) + panX;
  const lineHeight = layout.size * lineSpacing;
  const top = HEIGHT / 2 + panY - (layout.lines.length - 1) * lineHeight / 2;
  layout.lines.forEach((line, index) => sample.fillText(line, x * FACTOR, (top + index * lineHeight) * FACTOR));
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  let pixels;
  if (luminance(color) < luminance(background)) {
    pixels = downsamplePreservingLines(sample.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height), ctx.createImageData(WIDTH, HEIGHT), FACTOR);
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sampleCanvas, 0, 0, WIDTH, HEIGHT);
    pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  }
  adjustLineThickness(pixels, lineThickness);
  adjustTone(pixels, { contrast, brightness });
  quantizePreview(pixels);
  ctx.putImageData(pixels, 0, 0);
  return encodeRgb565(pixels);
}
