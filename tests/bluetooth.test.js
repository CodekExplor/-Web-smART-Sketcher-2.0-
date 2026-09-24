import test from 'node:test';
import assert from 'node:assert/strict';
import { AckParser, SketcherBluetooth, normalizeUuid } from '../js/bluetooth.js';
import { CHARACTERISTIC_UUID, DEVICE_NAME } from '../js/config.js';
import { sendImage } from '../js/protocol.js';

test('service UUID input accepts a 16-bit UUID and rejects invalid input', () => {
  assert.equal(normalizeUuid(' FFE0 '), '0000ffe0-0000-1000-8000-00805f9b34fb');
  assert.throws(() => normalizeUuid('xyz'));
});
test('notification parser counts OKOK and ignores command replies', async () => {
  let count = 0;
  const parser = new AckParser(() => count++, 5);
  parser.push('OK_01');
  parser.push('OKOK');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(count, 2);
  parser.push('O'); parser.push('K');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(count, 3);
  parser.reset();
});
test('mock BLE connection filters by name, requests service, enables notifications and serializes writes', async () => {
  const writes = [];
  const characteristic = new EventTarget();
  characteristic.uuid = CHARACTERISTIC_UUID;
  characteristic.properties = { notify: true, write: true };
  characteristic.startNotifications = async () => characteristic;
  characteristic.writeValueWithResponse = async bytes => { writes.push([...bytes]); await new Promise(resolve => setTimeout(resolve, 1)); };
  const service = { uuid: '0000ffe0-0000-1000-8000-00805f9b34fb', async getCharacteristic(uuid) { assert.equal(uuid, CHARACTERISTIC_UUID); return characteristic; } };
  const gatt = { connected: false, async connect() { this.connected = true; return this; }, async getPrimaryService(uuid) { assert.equal(uuid, service.uuid); return service; }, disconnect() { this.connected = false; } };
  const device = new EventTarget(); device.name = DEVICE_NAME; device.gatt = gatt;
  const bluetooth = { async requestDevice(options) { assert.deepEqual(options, { filters: [{ name: DEVICE_NAME }], optionalServices: [service.uuid] }); return device; } };
  const transport = new SketcherBluetooth({ bluetooth });
  await transport.connect(service.uuid);
  assert.equal(transport.connected, true);
  await Promise.all([transport.write(Uint8Array.of(1)), transport.write(Uint8Array.of(2))]);
  assert.deepEqual(writes, [[1], [2]]);
  const ack = transport.waitForAck(100);
  characteristic.value = new DataView(Uint8Array.of(79, 75).buffer);
  characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  await ack;
  transport.disconnect();
  assert.equal(transport.connected, false);
});
test('mock BLE completes two lines from split and bundled OK notifications', async () => {
  const writes = [];
  const characteristic = new EventTarget();
  characteristic.uuid = CHARACTERISTIC_UUID;
  characteristic.properties = { notify: true, write: true };
  characteristic.startNotifications = async () => characteristic;
  const service = { async getCharacteristic() { return characteristic; } };
  const gatt = { connected: false, async connect() { this.connected = true; return this; }, async getPrimaryService() { return service; }, disconnect() { this.connected = false; } };
  const device = new EventTarget(); device.name = DEVICE_NAME; device.gatt = gatt;
  const transport = new SketcherBluetooth({ bluetooth: { async requestDevice() { return device; } } });
  await transport.connect('ffe0');
  // First reply arrives split; the second packet contains two bundled acknowledgements.
  characteristic.writeValueWithResponse = async bytes => {
    writes.push([...bytes]);
    if (writes.length === 3) {
      for (const part of [[79], [75]]) {
        characteristic.value = new DataView(Uint8Array.from(part).buffer);
        characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    }
    if (writes.length === 5) {
      characteristic.value = new DataView(Uint8Array.from([79, 75, 79, 75]).buffer);
      characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  };
  const progress = [];
  await sendImage(transport, Uint8Array.from({ length: 16 }, (_, i) => i), { width: 4, height: 2, chunkSize: 4, waitForAck: true, lineGapMs: 0, chunkGapMs: 0, ackTimeoutMs: 100, pause: async () => {}, onProgress: line => progress.push(line) });
  assert.deepEqual(progress, [1, 2]);
  assert.equal(writes.length, 5);
  transport.disconnect();
});
