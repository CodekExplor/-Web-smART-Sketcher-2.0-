export const DEVICE_NAME = 'smART_sketcher2.0';
// Hypothesis only: the upstream project identifies FFE3 but does not name its parent service.
export const DEFAULT_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const CHARACTERISTIC_UUID = '0000ffe3-0000-1000-8000-00805f9b34fb';
export const WIDTH = 160;
export const HEIGHT = 128;
export const CHUNK_BYTES = 20; // Experimental fallback; default transfer writes a complete 320-byte line.
export const LINE_GAP_MS = 50;
export const CHUNK_GAP_MS = 5;
export const ACK_TIMEOUT_MS = 5000;
export const DEBUG = false;
export function debug(...args) { if (DEBUG) console.debug('[Smart Sketcher]', ...args); }
