import { DEFAULT_SERVICE_UUID, HEIGHT } from './config.js?v=20260924-6';
import { SketcherBluetooth, BluetoothFailure } from './bluetooth.js?v=20260924-6';
import { loadImage, renderImage } from './imageProcessor.js?v=20260924-6';
import { sendImage } from './protocol.js?v=20260924-6';

const $ = id => document.getElementById(id);
const ui = {
  support: $('support-message'), connect: $('connect-button'), disconnect: $('disconnect-button'),
  service: $('service-uuid'), device: $('device-name'), status: $('status-text'), pill: $('status-pill'), notification: $('last-notification'),
  file: $('file-input'), chooseFile: $('choose-file-button'), drop: $('drop-zone'), fileName: $('file-name'), canvas: $('preview'),
  zoom: $('zoom'), zoomValue: $('zoom-value'), preserveLines: $('preserve-lines'), rotationValue: $('rotation-value'), rotateLeft: $('rotate-left'), rotateRight: $('rotate-right'), resetTransform: $('reset-transform'),
  panX: $('pan-x'), panXValue: $('pan-x-value'), panY: $('pan-y'), panYValue: $('pan-y-value'),
  lineThickness: $('line-thickness'), lineThicknessValue: $('line-thickness-value'), contrast: $('contrast'), contrastValue: $('contrast-value'), brightness: $('brightness'), brightnessValue: $('brightness-value'),
  send: $('send-button'), progressArea: $('progress-area'), progress: $('progress-bar'),
  progressText: $('progress-text'), percent: $('progress-percent'), message: $('message')
};
const labels = { disconnected: 'Rozłączono', searching: 'Wyszukiwanie', connecting: 'Łączenie', connected: 'Połączono', sending: 'Wysyłanie', ready: 'Gotowe', error: 'Błąd' };
let image = null;
let frame = null;
let busy = false;
let loading = false;
let state = 'disconnected';
let rotation = 0;
const bluetooth = new SketcherBluetooth({
  onStage: (stage, name) => { if (name) ui.device.textContent = name; setStatus(stage); },
  onDisconnect: () => { setStatus('disconnected'); showMessage('Urządzenie zostało odłączone.', true); },
  onNotification: message => { ui.notification.textContent = message || '(pusta odpowiedź)'; },
});

function setStatus(next) {
  state = next;
  ui.status.textContent = labels[next];
  ui.pill.dataset.state = next;
  updateButtons();
}
function updateButtons() {
  const connecting = ['searching', 'connecting'].includes(state);
  ui.connect.disabled = busy || loading || connecting || !navigator.bluetooth || !window.isSecureContext;
  ui.disconnect.disabled = busy || connecting || !bluetooth.connected;
  ui.send.disabled = busy || loading || !frame || !bluetooth.connected;
  ui.service.disabled = busy || connecting;
  for (const control of [ui.zoom, ui.preserveLines, ui.rotateLeft, ui.rotateRight, ui.resetTransform, ui.panX, ui.panY, ui.lineThickness, ui.contrast, ui.brightness]) control.disabled = busy || loading || !image;
  ui.canvas.classList.toggle('is-draggable', Boolean(image) && !busy && !loading);
  for (const radio of document.querySelectorAll('input[name="mode"]')) radio.disabled = busy || loading;
}
function showMessage(text, isError = false) { ui.message.textContent = text; ui.message.classList.toggle('error', isError); }
function friendlyError(error) {
  if (!(error instanceof BluetoothFailure)) return error?.message || 'Wystąpił nieznany błąd.';
  return ({
    unsupported: 'Ta przeglądarka nie obsługuje Web Bluetooth. Użyj aktualnej wersji Google Chrome lub Microsoft Edge.',
    'invalid-service': 'Wpisz poprawny UUID usługi GATT.',
    'cancelled-or-not-found': 'Nie wybrano urządzenia. Sprawdź, czy projektor i Bluetooth są włączone, a następnie spróbuj ponownie.',
    chooser: 'Nie udało się wyszukać urządzenia. Sprawdź Bluetooth i uprawnienia przeglądarki.',
    service: 'Nie znaleziono usługi GATT. UUID FFE0 jest hipotezą; sprawdź UUID usługi na urządzeniu i wpisz go w ustawieniach połączenia.',
    characteristic: 'Nie znaleziono charakterystyki FFE3 w wybranej usłudze.',
    notifications: 'Nie udało się włączyć powiadomień BLE na charakterystyce.',
    'write-unsupported': 'Charakterystyka nie obsługuje zapisu danych.',
    gatt: 'Błąd połączenia GATT. Sprawdź, czy urządzenie nie jest zajęte przez inną aplikację.',
    disconnected: 'Urządzenie zostało odłączone. Połącz je ponownie.',
    timeout: 'Brak odpowiedzi BLE w trybie diagnostycznym.',
    write: 'Błąd zapisu BLE. Jeśli wystąpił przy 320 B, spróbuj 80 B w ustawieniach transmisji. W razie potrzeby połącz projektor ponownie.',
    busy: 'Trwa już oczekiwanie na odpowiedź urządzenia.'
  })[error.code] || 'Błąd komunikacji Bluetooth.';
}
function report(error) { console.error(error); setStatus('error'); showMessage(friendlyError(error), true); }
function updateProgress(line) {
  ui.progress.value = line;
  ui.progressText.textContent = `Wysyłanie: ${line} / ${HEIGHT}`;
  ui.percent.textContent = `${Math.round(line / HEIGHT * 100)}%`;
}
function imageOptions() {
  return {
    rotation, zoom: Number(ui.zoom.value) / 100, preserveLines: ui.preserveLines.checked,
    panX: Number(ui.panX.value), panY: Number(ui.panY.value), lineThickness: Number(ui.lineThickness.value),
    contrast: Number(ui.contrast.value), brightness: Number(ui.brightness.value)
  };
}
function refreshPreview() {
  if (!image || busy || loading) return;
  frame = renderImage(ui.canvas, image, document.querySelector('input[name="mode"]:checked').value, imageOptions());
  updateButtons();
}
async function useFile(file) {
  if (!file || busy) return;
  loading = true; updateButtons(); showMessage('');
  try {
    const loaded = await loadImage(file);
    const nextFrame = renderImage(ui.canvas, loaded, document.querySelector('input[name="mode"]:checked').value, imageOptions());
    if (image?.close) image.close();
    image = loaded; frame = nextFrame;
    ui.fileName.textContent = file.name;
  } catch (error) { console.error(error); showMessage(error?.message || 'Nie można odczytać obrazu.', true); }
  finally { loading = false; updateButtons(); }
}

ui.service.value = DEFAULT_SERVICE_UUID;
const ctx = ui.canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
if (!window.isSecureContext) { ui.support.hidden = false; ui.support.textContent = 'Web Bluetooth wymaga HTTPS lub localhost. Otwórz aplikację przez bezpieczny adres.'; }
else if (!navigator.bluetooth) { ui.support.hidden = false; ui.support.textContent = 'Ta przeglądarka nie obsługuje Web Bluetooth. Użyj aktualnej wersji Google Chrome lub Microsoft Edge.'; }
updateButtons();

ui.connect.addEventListener('click', async () => {
  showMessage('');
  try { await bluetooth.connect(ui.service.value); }
  catch (error) { report(error); }
});
ui.disconnect.addEventListener('click', () => {
  bluetooth.disconnect(); ui.device.textContent = 'Nie wybrano'; setStatus('disconnected'); showMessage('Rozłączono.');
});
ui.chooseFile.addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => useFile(ui.file.files[0]));
for (const radio of document.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', () => {
  if (!radio.checked) return;
  try { refreshPreview(); }
  catch (error) { report(error); }
});
ui.zoom.addEventListener('input', () => {
  ui.zoomValue.value = `${ui.zoom.value}%`;
  try { refreshPreview(); }
  catch (error) { report(error); }
});
function updateAdjustment(input, output, suffix) {
  output.value = `${input.value}${suffix}`;
  try { refreshPreview(); }
  catch (error) { report(error); }
}
for (const [input, output, suffix] of [
  [ui.panX, ui.panXValue, ' px'], [ui.panY, ui.panYValue, ' px'],
  [ui.lineThickness, ui.lineThicknessValue, '%'], [ui.contrast, ui.contrastValue, '%'], [ui.brightness, ui.brightnessValue, '']
]) input.addEventListener('input', () => updateAdjustment(input, output, suffix));
function setPan(x, y) {
  ui.panX.value = String(Math.max(Number(ui.panX.min), Math.min(Number(ui.panX.max), Math.round(x))));
  ui.panY.value = String(Math.max(Number(ui.panY.min), Math.min(Number(ui.panY.max), Math.round(y))));
  ui.panXValue.value = `${ui.panX.value} px`;
  ui.panYValue.value = `${ui.panY.value} px`;
  try { refreshPreview(); }
  catch (error) { report(error); }
}
let drag = null;
ui.canvas.addEventListener('pointerdown', event => {
  if (!image || busy || loading || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: Number(ui.panX.value), panY: Number(ui.panY.value) };
  ui.canvas.setPointerCapture(event.pointerId);
  ui.canvas.classList.add('is-dragging');
  ui.canvas.focus();
  event.preventDefault();
});
ui.canvas.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId || busy || loading) return;
  const bounds = ui.canvas.getBoundingClientRect();
  setPan(drag.panX + (event.clientX - drag.x) * ui.canvas.width / bounds.width,
    drag.panY + (event.clientY - drag.y) * ui.canvas.height / bounds.height);
});
function endDrag(event) {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  ui.canvas.classList.remove('is-dragging');
}
ui.canvas.addEventListener('pointerup', endDrag);
ui.canvas.addEventListener('pointercancel', endDrag);
ui.canvas.addEventListener('lostpointercapture', endDrag);
ui.canvas.addEventListener('keydown', event => {
  if (!image || busy || loading) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  const step = event.shiftKey ? 5 : 1;
  setPan(Number(ui.panX.value) + move[0] * step, Number(ui.panY.value) + move[1] * step);
});
ui.preserveLines.addEventListener('change', () => {
  try { refreshPreview(); }
  catch (error) { report(error); }
});
function rotateBy(degrees) {
  rotation = (rotation + degrees + 360) % 360;
  ui.rotationValue.value = `${rotation}°`;
  try { refreshPreview(); }
  catch (error) { report(error); }
}
ui.rotateLeft.addEventListener('click', () => rotateBy(-90));
ui.rotateRight.addEventListener('click', () => rotateBy(90));
ui.resetTransform.addEventListener('click', () => {
  rotation = 0;
  ui.zoom.value = '100';
  ui.zoomValue.value = '100%';
  ui.rotationValue.value = '0°';
  ui.preserveLines.checked = true;
  for (const [input, output, value, suffix] of [
    [ui.panX, ui.panXValue, '0', ' px'], [ui.panY, ui.panYValue, '0', ' px'],
    [ui.lineThickness, ui.lineThicknessValue, '0', '%'], [ui.contrast, ui.contrastValue, '100', '%'], [ui.brightness, ui.brightnessValue, '0', '']
  ]) { input.value = value; output.value = `${value}${suffix}`; }
  try { refreshPreview(); }
  catch (error) { report(error); }
});
ui.drop.addEventListener('dragover', event => { event.preventDefault(); ui.drop.classList.add('dragging'); });
ui.drop.addEventListener('dragleave', () => ui.drop.classList.remove('dragging'));
ui.drop.addEventListener('drop', event => { event.preventDefault(); ui.drop.classList.remove('dragging'); useFile(event.dataTransfer.files[0]); });
ui.send.addEventListener('click', async () => {
  if (!frame || !bluetooth.connected || busy) return;
  const chunkSize = Number(document.querySelector('input[name="chunk-size"]:checked').value);
  busy = true; setStatus('sending'); showMessage('');
  ui.progressArea.hidden = false; updateProgress(0);
  try {
    await sendImage(bluetooth, frame, { chunkSize, onProgress: updateProgress });
    setStatus('ready'); showMessage('Transmisja zakończona. Sprawdź obraz na projektorze.');
  } catch (error) { report(error); }
  finally { busy = false; updateButtons(); }
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).catch(console.error));
}
