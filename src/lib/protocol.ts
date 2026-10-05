// These UUIDs match the service in the ESP32 firmware.
export const SERVICE_UUID = '8c7a0001-6c3b-4f3d-a8d9-2adbc9f10211';
export const TX_UUID = '8c7a0002-6c3b-4f3d-a8d9-2adbc9f10211';
export const RX_UUID = '8c7a0003-6c3b-4f3d-a8d9-2adbc9f10211';

export type BoardState = {
    revision: number;
    mode: 'CLASSIC' | 'FREESTYLE';
    shots: number;
    remaining: number;
    total: number;
    lastScore: number | null;
    distanceMillimeters: number;
    unit: 'M' | 'FT';
    sensitivity: number;
    page: 'TRAINING' | 'SETTINGS' | 'DEBUGZONE' | 'DEBUG';
    fullscreen: boolean;
    theme: 'DARK' | 'LIGHT';
    view: 'PAYLOAD' | 'HEX' | 'BINARY';
    effect: 'NONE' | 'CONFETTI' | 'ORBIT' | 'BOUNCE' | 'WARP';
    sound: boolean;
    menu: boolean;
    packet: string;
    delivery: 'EXAMPLE' | 'OFFLINE' | 'UNSUBSCRIBED' | 'QUEUED' | 'FAILED';
    regulator33Temperature: number | null;
    regulator5Temperature: number | null;
    sensorRaw: number | null;
    sensorMillivolts: number | null;
    sensorDetected: boolean;
};
export type ShotPacket = { hit: number; score: number; x?: number; y?: number };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// BLE passes text as Base64. Commands only use plain ASCII characters.
export function encodeAscii(text: string) {
    let result = '';
    for (let i = 0; i < text.length; i += 3) {
        const a = text.charCodeAt(i);
        const b = text.charCodeAt(i + 1) || 0;
        const c = text.charCodeAt(i + 2) || 0;
        result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)];
        result += i + 1 < text.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
        result += i + 2 < text.length ? alphabet[c & 63] : '=';
    }
    return result;
}

export function decodeAscii(value: string) {
    let result = '';
    let buffer = 0;
    let bits = 0;
    for (const character of value) {
        if (character === '=') break;
        const digit = alphabet.indexOf(character);
        if (digit < 0) throw new Error('Invalid Bluetooth data.');
        buffer = (buffer << 6) | digit;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result += String.fromCharCode((buffer >> bits) & 255);
        }
    }
    return result;
}

export function parseShot(text: string): ShotPacket | null {
    try {
        const packet = JSON.parse(text);
        if (
            !packet ||
            !Number.isInteger(packet.hit) ||
            packet.hit < 0 ||
            packet.hit > 9 ||
            !Number.isInteger(packet.score) ||
            packet.score < 0 ||
            packet.score > 10
        )
            return null;
        return {
            hit: packet.hit,
            score: packet.score,
            x: Number.isFinite(packet.x) ? packet.x : undefined,
            y: Number.isFinite(packet.y) ? packet.y : undefined,
        };
    } catch {
        return null;
    }
}

function integer(text: string | undefined, min: number, max: number) {
    if (text === undefined || !/^-?\d+$/.test(text)) throw new Error('Missing state field.');
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < min || number > max)
        throw new Error('Invalid state field.');
    return number;
}

function choice<T extends string>(text: string | undefined, options: readonly T[]): T {
    if (!options.includes(text as T)) throw new Error('Invalid state choice.');
    return text as T;
}

// Only publish a snapshot after every field and its matching END arrive.
export class SnapshotReader {
    private revision: number | null = null;
    private fields: Record<string, string> = {};

    reset() {
        this.revision = null;
        this.fields = {};
    }

    push(text: string): BoardState | null {
        if (text.startsWith('BEGIN:')) {
            this.reset();
            try {
                this.revision = integer(text.slice(6), 0, 0xffffffff);
            } catch {
                /* Wait for the next state. */
            }
            return null;
        }
        if (this.revision === null) return null;
        if (!text.startsWith('END:')) {
            const colon = text.indexOf(':');
            if (colon > 0 && /^[A-Z]+$/.test(text.slice(0, colon))) {
                this.fields[text.slice(0, colon)] = text.slice(colon + 1);
            }
            return null;
        }
        try {
            if (integer(text.slice(4), 0, 0xffffffff) !== this.revision) return null;
            const f = this.fields;
            const sensorFields = ['TLOW', 'THIGH', 'ADC', 'MV', 'DETECT'];
            const sensorCount = sensorFields.filter((key) => f[key] !== undefined).length;
            if (sensorCount !== 0 && sensorCount !== sensorFields.length) return null;
            integer(f.PROTO, 2, 2);
            const last = integer(f.LAST, -1, 10);
            const state: BoardState = {
                revision: this.revision,
                mode: choice(f.MODE, ['CLASSIC', 'FREESTYLE']),
                shots: integer(f.SHOTS, 0, 0xffffffff),
                remaining: integer(f.LEFT, 0, 10),
                total: integer(f.TOTAL, 0, 0xffffffff),
                lastScore: last === -1 ? null : last,
                distanceMillimeters: integer(f.DIST, 1000, 100000),
                unit: choice(f.UNIT, ['M', 'FT']),
                sensitivity: integer(f.CAL, 0, 4095),
                page: choice(f.PAGE, ['TRAINING', 'SETTINGS', 'DEBUGZONE', 'DEBUG']),
                fullscreen: integer(f.FULL, 0, 1) === 1,
                theme: choice(f.THEME, ['DARK', 'LIGHT']),
                view: choice(f.VIEW, ['PAYLOAD', 'HEX', 'BINARY']),
                effect: choice(f.FX, ['NONE', 'CONFETTI', 'ORBIT', 'BOUNCE', 'WARP']),
                sound: integer(f.SOUND, 0, 1) === 1,
                menu: integer(f.MENU, 0, 1) === 1,
                packet: (f.PKTA ?? '') + (f.PKTB ?? ''),
                delivery: choice(f.DEL, ['EXAMPLE', 'OFFLINE', 'UNSUBSCRIBED', 'QUEUED', 'FAILED']),
                regulator33Temperature: temperature(f.TLOW),
                regulator5Temperature: temperature(f.THIGH),
                sensorRaw: measurement(f.ADC, 4095),
                sensorMillivolts: measurement(f.MV, 5000),
                sensorDetected: f.DETECT === undefined ? false : integer(f.DETECT, 0, 1) === 1,
            };
            if (!parseShot(state.packet)) return null;
            const expectedLeft = state.mode === 'CLASSIC' ? Math.max(0, 10 - state.shots) : 0;
            if (state.remaining !== expectedLeft || (state.shots === 0) !== (last === -1))
                return null;
            return state;
        } catch {
            return null;
        } finally {
            this.reset();
        }
    }
}

export function formatDistance(state: BoardState) {
    return `${(state.distanceMillimeters / (state.unit === 'M' ? 1000 : 304.8)).toFixed(1)} ${state.unit === 'M' ? 'm' : 'ft'}`;
}

// Older firmware has no sensor fields. Missing or failed readings show a dash.
function temperature(text: string | undefined) {
    if (text === undefined || text === '-9999') return null;
    return integer(text, -400, 1250) / 10;
}

function measurement(text: string | undefined, maximum: number) {
    if (text === undefined || text === '-1') return null;
    return integer(text, 0, maximum);
}
