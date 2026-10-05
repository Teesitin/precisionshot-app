const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');

// Load the pure protocol without needing a phone or React Native.
const source = ts.transpileModule(fs.readFileSync('src/lib/protocol.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module('protocol');
loaded._compile(source, 'protocol.js');
const { SnapshotReader, encodeAscii, decodeAscii, parseShot } = loaded.exports;
const fields = [
    'PROTO:2',
    'MODE:CLASSIC',
    'SHOTS:3',
    'LEFT:7',
    'TOTAL:27',
    'LAST:8',
    'DIST:10000',
    'UNIT:M',
    'CAL:1000',
    'PAGE:TRAINING',
    'FULL:0',
    'THEME:DARK',
    'VIEW:PAYLOAD',
    'FX:NONE',
    'SOUND:0',
    'MENU:0',
    'PKTA:{"hit":3,"',
    'PKTB:score":8}',
    'DEL:QUEUED',
];
function snapshot(reader, data = fields, start = 1, end = start) {
    assert.equal(reader.push(`BEGIN:${start}`), null);
    for (const field of data) assert.equal(reader.push(field), null);
    return reader.push(`END:${end}`);
}

test('ASCII round trips match real Base64 for all command lengths', () => {
    for (const text of ['@1:STATE', '@999:MODE:FREESTYLE', 'TEST', 'AB', 'A', '']) {
        assert.equal(encodeAscii(text), Buffer.from(text).toString('base64'));
        assert.equal(decodeAscii(encodeAscii(text)), text);
    }
});
test('state is published only after a complete matching END', () => {
    const state = snapshot(new SnapshotReader());
    assert.equal(state.shots, 3);
    assert.equal(state.total, 27);
    assert.equal(state.lastScore, 8);
    assert.equal(state.distanceMillimeters, 10000);
    assert.equal(state.packet, '{"hit":3,"score":8}');
});
test('sensor readings include negative temperatures and unavailable values', () => {
    const data = [...fields, 'TLOW:-50', 'THIGH:425', 'ADC:1500', 'MV:1200', 'DETECT:1'];
    const state = snapshot(new SnapshotReader(), data);
    assert.equal(state.regulator33Temperature, -5);
    assert.equal(state.regulator5Temperature, 42.5);
    assert.equal(state.sensorMillivolts, 1200);
    assert.equal(state.sensorDetected, true);
    assert.equal(
        snapshot(new SnapshotReader(), [
            ...fields,
            'TLOW:-9999',
            'THIGH:-9999',
            'ADC:-1',
            'MV:-1',
            'DETECT:0',
        ]).sensorRaw,
        null,
    );
    assert.equal(snapshot(new SnapshotReader(), [...fields, 'ADC:4096']), null);
    assert.equal(snapshot(new SnapshotReader(), [...fields, 'TLOW:1251']), null);
});
test('closing sensor watch clears readings and partial sensor updates are rejected', () => {
    const reader = new SnapshotReader();
    assert.equal(
        snapshot(reader, [...fields, 'TLOW:320', 'THIGH:410', 'ADC:1500', 'MV:1200', 'DETECT:1'])
            .sensorDetected,
        true,
    );
    const closed = snapshot(reader, fields, 2);
    assert.equal(closed.regulator33Temperature, null);
    assert.equal(closed.sensorRaw, null);
    assert.equal(closed.sensorDetected, false);
    assert.equal(snapshot(reader, [...fields, 'TLOW:320'], 3), null);
});
test('missing fields, wrong revision, unsupported version, and bad values are rejected', () => {
    for (const data of [
        fields.slice(1),
        fields.filter((f) => !f.startsWith('PAGE:')),
        fields.map((f) => (f === 'PROTO:2' ? 'PROTO:1' : f)),
        fields.map((f) => (f === 'LAST:8' ? 'LAST:11' : f)),
        fields.map((f) => (f === 'LEFT:7' ? 'LEFT:8' : f)),
        fields.map((f) => (f === 'SHOTS:3' ? 'SHOTS:NaN' : f)),
    ]) {
        assert.equal(snapshot(new SnapshotReader(), data), null);
    }
    assert.equal(snapshot(new SnapshotReader(), fields, 1, 2), null);
});
test('a new BEGIN replaces an incomplete update, and reset clears it on reconnect', () => {
    const reader = new SnapshotReader();
    reader.push('BEGIN:1');
    reader.push('MODE:FREESTYLE');
    assert.equal(snapshot(reader, fields, 2).mode, 'CLASSIC');
    reader.push('BEGIN:3');
    reader.reset();
    for (const field of fields) reader.push(field);
    assert.equal(reader.push('END:3'), null);
});
test('shot events can arrive during a snapshot without creating fake positions', () => {
    const reader = new SnapshotReader();
    reader.push('BEGIN:5');
    for (const field of fields) reader.push(field);
    reader.push('{"hit":3,"score":8}');
    assert.equal(reader.push('END:5').lastScore, 8);
    assert.deepEqual(parseShot('{"hit":3,"score":8}'), {
        hit: 3,
        score: 8,
        x: undefined,
        y: undefined,
    });
    for (const invalid of ['{"hit":1,"score":11}', '{"hit":1,"score":2.5}', '{"pong":1}', 'null']) {
        assert.equal(parseShot(invalid), null);
    }
});
test('empty sessions and full 32-bit totals are represented correctly', () => {
    const empty = fields.map(
        (f) =>
            ({
                'SHOTS:3': 'SHOTS:0',
                'LEFT:7': 'LEFT:10',
                'TOTAL:27': 'TOTAL:0',
                'LAST:8': 'LAST:-1',
            })[f] ?? f,
    );
    assert.equal(snapshot(new SnapshotReader(), empty).lastScore, null);
    const large = fields.map(
        (f) =>
            ({
                'MODE:CLASSIC': 'MODE:FREESTYLE',
                'SHOTS:3': 'SHOTS:4294967295',
                'LEFT:7': 'LEFT:0',
                'TOTAL:27': 'TOTAL:4294967295',
            })[f] ?? f,
    );
    assert.equal(snapshot(new SnapshotReader(), large).total, 0xffffffff);
});
