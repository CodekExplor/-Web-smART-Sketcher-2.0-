import { DEVICE_NAME, CHARACTERISTIC_UUID, debug } from './config.js?v=20260924-8';

export class BluetoothFailure extends Error {
  constructor(code, cause) { super(code, { cause }); this.name = 'BluetoothFailure'; this.code = code; }
}

export function normalizeUuid(value) {
  const trimmed = value.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(trimmed)) return `0000${trimmed}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(trimmed)) return `${trimmed}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) return trimmed;
  throw new BluetoothFailure('invalid-service');
}

// The device can bundle two line acknowledgements into one notification ("OKOK").
// A brief hold distinguishes bare "OK" from a fragmented command reply like "OK_01".
export class AckParser {
  constructor(onAck, holdMs = 20) { this.onAck = onAck; this.holdMs = holdMs; this.buffer = ''; this.timer = null; }
  push(value) {
    this.buffer += value.toUpperCase();
    this.process();
  }
  process() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    while (this.buffer) {
      const at = this.buffer.indexOf('OK');
      if (at < 0) { this.buffer = this.buffer.endsWith('O') ? 'O' : ''; break; }
      if (at > 0) this.buffer = this.buffer.slice(at);
      if (this.buffer === 'OK' || this.buffer === 'OK_') break;
      const commandReply = this.buffer.match(/^OK_\d+/);
      if (commandReply) { this.buffer = this.buffer.slice(commandReply[0].length); continue; }
      if (this.buffer.startsWith('OK_')) { this.buffer = this.buffer.slice(3); continue; }
      this.onAck();
      this.buffer = this.buffer.slice(2);
    }
    if (this.buffer === 'OK' || this.buffer === 'OK_') {
      this.timer = setTimeout(() => {
        if (this.buffer === 'OK') this.onAck();
        this.buffer = '';
        this.timer = null;
      }, this.holdMs);
    }
  }
  reset() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.buffer = ''; }
}

export class SketcherBluetooth {
  constructor({ bluetooth = globalThis.navigator?.bluetooth, onStage = () => {}, onDisconnect = () => {}, onNotification = () => {} } = {}) {
    this.bluetooth = bluetooth;
    this.onStage = onStage;
    this.onDisconnect = onDisconnect;
    this.onNotification = onNotification;
    this.device = null;
    this.characteristic = null;
    this.writeChain = Promise.resolve();
    this.ackCredits = 0;
    this.ackWaiter = null;
    this.parser = new AckParser(() => this.acceptAck());
    this.handleNotification = this.handleNotification.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
  }
  get connected() { return Boolean(this.device?.gatt?.connected && this.characteristic); }
  async connect(serviceUuid) {
    if (!this.bluetooth) throw new BluetoothFailure('unsupported');
    const uuid = normalizeUuid(serviceUuid);
    if (this.device) this.disconnect();
    this.onStage('searching');
    let device;
    try {
      device = await this.bluetooth.requestDevice({ filters: [{ name: DEVICE_NAME }], optionalServices: [uuid] });
    } catch (error) { throw new BluetoothFailure(error?.name === 'NotFoundError' ? 'cancelled-or-not-found' : 'chooser', error); }
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    debug('device', device.name);
    this.onStage('connecting', device.name || DEVICE_NAME);
    try {
      const server = await device.gatt.connect();
      let service;
      try { service = await server.getPrimaryService(uuid); }
      catch (error) { throw new BluetoothFailure('service', error); }
      debug('service', service.uuid);
      let characteristic;
      try { characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID); }
      catch (error) { throw new BluetoothFailure('characteristic', error); }
      debug('characteristic', characteristic.uuid, characteristic.properties);
      if (!characteristic.properties?.notify) throw new BluetoothFailure('notifications');
      if (!characteristic.properties?.write && !characteristic.properties?.writeWithoutResponse) throw new BluetoothFailure('write-unsupported');
      characteristic.addEventListener('characteristicvaluechanged', this.handleNotification);
      try { await characteristic.startNotifications(); }
      catch (error) { characteristic.removeEventListener('characteristicvaluechanged', this.handleNotification); throw new BluetoothFailure('notifications', error); }
      this.characteristic = characteristic;
      this.clearAcks();
      this.onStage('connected', device.name || DEVICE_NAME);
      return device;
    } catch (error) {
      debug('connect failed', error);
      this.disconnect();
      throw error instanceof BluetoothFailure ? error : new BluetoothFailure('gatt', error);
    }
  }
  disconnect() {
    this.rejectAck(new BluetoothFailure('disconnected'));
    this.parser.reset();
    this.ackCredits = 0;
    if (this.characteristic) this.characteristic.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.characteristic = null;
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
      if (this.device.gatt?.connected) this.device.gatt.disconnect();
    }
    this.device = null;
    this.writeChain = Promise.resolve();
  }
  handleDisconnect() {
    this.rejectAck(new BluetoothFailure('disconnected'));
    this.parser.reset();
    this.ackCredits = 0;
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.characteristic = null;
    this.device = null;
    this.onDisconnect();
  }
  handleNotification(event) {
    const view = event.target.value;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const message = new TextDecoder('ascii').decode(bytes);
    debug('notification', message);
    this.onNotification(message);
    this.parser.push(message);
  }
  acceptAck() {
    if (this.ackWaiter) {
      const waiter = this.ackWaiter;
      this.ackWaiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve();
    } else this.ackCredits++;
  }
  clearAcks() { this.ackCredits = 0; this.parser.reset(); }
  rejectAck(error) {
    if (!this.ackWaiter) return;
    const waiter = this.ackWaiter;
    this.ackWaiter = null;
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  waitForAck(timeoutMs) {
    if (!this.connected) return Promise.reject(new BluetoothFailure('disconnected'));
    if (this.ackCredits > 0) { this.ackCredits--; return Promise.resolve(); }
    if (this.ackWaiter) return Promise.reject(new BluetoothFailure('busy'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.ackWaiter = null; reject(new BluetoothFailure('timeout')); }, timeoutMs);
      this.ackWaiter = { resolve, reject, timer };
    });
  }
  write(bytes) {
    const operation = this.writeChain.then(async () => {
      const characteristic = this.characteristic;
      if (!this.connected || !characteristic) throw new BluetoothFailure('disconnected');
      debug('write', bytes.length);
      try {
        if (characteristic.properties.write && characteristic.writeValueWithResponse) await characteristic.writeValueWithResponse(bytes);
        else if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(bytes);
        else if (characteristic.writeValue) await characteristic.writeValue(bytes);
        else throw new BluetoothFailure('write-unsupported');
      } catch (error) { throw error instanceof BluetoothFailure ? error : new BluetoothFailure('write', error); }
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }
}
