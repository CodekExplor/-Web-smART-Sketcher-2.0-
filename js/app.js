import { DEFAULT_SERVICE_UUID, HEIGHT } from './config.js';
import { SketcherBluetooth, BluetoothFailure } from './bluetooth.js';
import { loadImage, renderImage } from './imageProcessor.js';
import { sendImage } from './protocol.js';

const $ = id => document.getElementById(id);
const ui = {
  support: $('support-message'), connect: $('connect-button'), disconnect: $('disconnect-button'),
  service: $('service-uuid'), device: $('device-name'), status: $('status-text'), pill: $('status-pill'),
  file: $('file-input'), chooseFile: $('choose-file-button'), drop: $('drop-zone'), fileName: $('file-name'), canvas: $('preview'),
  send: $('send-button'), progressArea: $('progress-area'), progress: $('progress-bar'),
  progressText: $('progress-text'), percent: $('progress-percent'), message: $('message')
};
const labels = { disconnected: 'Rozłączono', searching: 'Wyszukiwanie', connecting: 'Łączenie', connected: 'Połączono', sending: 'Wysyłanie', ready: 'Gotowe', error: 'Błąd' };
let image = null;
let frame = null;
let busy = false;
let loading = false;
let state = 'disconnected';
const bluetooth = new SketcherBluetooth({
  onStage: (stage, name) => { if (name) ui.device.textContent = name; setStatus(stage); },
  onDisconnect: () => { setStatus('disconnected'); showMessage('Urządzenie zostało odłączone.', true); },
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
    timeout: 'Projektor nie potwierdził odbioru linii w wyznaczonym czasie.',
    write: 'Błąd zapisu BLE. Spróbuj połączyć urządzenie ponownie.',
    busy: 'Trwa już oczekiwanie na odpowiedź urządzenia.'
  })[error.code] || 'Błąd komunikacji Bluetooth.';
}
function report(error) { console.error(error); setStatus('error'); showMessage(friendlyError(error), true); }
function updateProgress(line) {
  ui.progress.value = line;
  ui.progressText.textContent = `Wysyłanie: ${line} / ${HEIGHT}`;
  ui.percent.textContent = `${Math.round(line / HEIGHT * 100)}%`;
}
async function useFile(file) {
  if (!file || busy) return;
  loading = true; updateButtons(); showMessage('');
  try {
    const loaded = await loadImage(file);
    const nextFrame = renderImage(ui.canvas, loaded, document.querySelector('input[name="mode"]:checked').value);
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
  if (!image || busy) return;
  try { frame = renderImage(ui.canvas, image, radio.value); updateButtons(); }
  catch (error) { report(error); }
});
ui.drop.addEventListener('dragover', event => { event.preventDefault(); ui.drop.classList.add('dragging'); });
ui.drop.addEventListener('dragleave', () => ui.drop.classList.remove('dragging'));
ui.drop.addEventListener('drop', event => { event.preventDefault(); ui.drop.classList.remove('dragging'); useFile(event.dataTransfer.files[0]); });
ui.send.addEventListener('click', async () => {
  if (!frame || !bluetooth.connected || busy) return;
  busy = true; setStatus('sending'); showMessage('');
  ui.progressArea.hidden = false; updateProgress(0);
  try {
    await sendImage(bluetooth, frame, { onProgress: updateProgress });
    setStatus('ready'); showMessage('Obraz wysłany poprawnie');
  } catch (error) { report(error); }
  finally { busy = false; updateButtons(); }
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.error));
}
