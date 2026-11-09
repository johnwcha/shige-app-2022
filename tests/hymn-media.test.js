import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { setTimeout as tick } from 'node:timers/promises';
import { createHymnVideoLink } from '../hymn-video.js';

const require = createRequire(import.meta.url);
const media = require('../functions/hymn-media.js');
const video = 'https://www.youtube.com/watch?v=BLJ0IjLAmOA';
const doc = (id, data) => ({ id, data: () => data });

test('legacy labels distinguish editions and skip ambiguous records', () => {
    for (const label of ['大本 378 何等生命', 'D378 Title', 'd378 Title', '大本诗歌 378']) {
        assert.deepEqual(media.parseHymnLabel(label), { edition: 'ch', hymnNumber: '378' });
    }
    for (const label of ['b913 童女與僕人', '補充本 913', '補充 913', '小本 913']) {
        assert.deepEqual(media.parseHymnLabel(label), { edition: 'ts', hymnNumber: '913' });
    }
    for (const label of ['>71 我們知你已復起', '444 是愛的神', '附1', '大本附五', null]) {
        assert.equal(media.parseHymnLabel(label), null);
    }
});

test('only YouTube video URLs are accepted and tracking is removed', () => {
    for (const value of [video, 'https://youtu.be/BLJ0IjLAmOA?si=tracking',
        'https://m.youtube.com/shorts/BLJ0IjLAmOA', 'https://www.youtube.com/embed/BLJ0IjLAmOA']) {
        assert.equal(media.normalizeYoutubeUrl(value), video);
    }
    assert.equal(media.normalizeYoutubeUrl('https://youtu.be/BLJ0IjLAmOA?t=1m30s'), `${video}&t=1m30s`);
    for (const value of ['javascript:alert(1)', 'http://youtu.be/BLJ0IjLAmOA',
        'https://www.youtube.com.evil.test/watch?v=BLJ0IjLAmOA',
        'https://user:pass@www.youtube.com/watch?v=BLJ0IjLAmOA',
        'https://www.hymnal.net/zh/hymn/ch/1', 'https://youtu.be/bad', {}, null]) {
        assert.equal(media.normalizeYoutubeUrl(value), null);
    }
});

test('duplicate legacy entries choose the newest valid recording', () => {
    const index = media.buildLegacyMediaIndex([
        doc('a', { hymn: 'D378', link: video, updated: { toMillis: () => 1 } }),
        doc('b', { hymn: '大本 378', link: 'https://youtu.be/m0T6rqWPqjA', updated: { toMillis: () => 2 } }),
        doc('c', { hymn: '大本 378', link: 'https://www.hymnal.net/', updated: { toMillis: () => 3 } }),
    ]);
    assert.equal(index.get('ch:378'), 'https://www.youtube.com/watch?v=m0T6rqWPqjA');
});

function backend(records = {}, fail = false) {
    let reads = 0;
    let saved;
    const db = { collection(name) {
        const filters = [];
        return {
            where(field, op, value) { filters.push([field, value]); return this; },
            select() { return this; },
            async get() {
                if (fail) throw new Error('Firestore unavailable');
                if (name === 'hymns') reads++;
                return { docs: (records[name] || []).filter(d => filters.every(([f, v]) => d.data()[f] === v)) };
            },
            doc() { return { async set(data) { saved = data; } }; },
        };
    } };
    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => 'timestamp' };
    const exports = {};
    vm.runInNewContext(readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8'), {
        exports, URL, Date, require(name) {
            if (name === 'firebase-functions/v2/https') return { onRequest: (_, handler) => handler };
            if (name === 'firebase-functions') return { logger: { error() {} } };
            if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'test-token' }) };
            if (name === 'firebase-admin') return { initializeApp() {}, firestore };
            if (name === './hymn-media') return media;
            throw new Error(`Unexpected dependency: ${name}`);
        },
    });
    return { exports, reads: () => reads, saved: () => saved };
}

async function invoke(handler, query = {}, extra = {}) {
    const response = {
        code: 200, status(code) { this.code = code; return this; },
        set() {}, json(body) { this.body = body; return this; },
    };
    await handler({ method: 'GET', query, ...extra }, response);
    return response;
}

test('API preserves padded dynamic IDs and reuses the legacy index', async () => {
    const app = backend({
        dynamicHymns: [doc('ts-001', { hymnID: '001', edition: 'ts', published: true, youtubeUrl: video })],
        hymns: [doc('legacy', { hymn: 'b1 開口讚美', link: 'https://youtu.be/m0T6rqWPqjA' })],
    });
    const get = app.exports.getHymnYoutube;
    const padded = await invoke(get, { hymnNumber: '001', edition: 'ts' });
    assert.equal(padded.body.youtubeUrl, video);
    assert.equal(padded.body.source, 'dynamicHymns');
    assert.equal(app.reads(), 0);
    const bundled = await invoke(get, { hymnNumber: '1', edition: 'ts' });
    assert.equal(bundled.body.source, 'hymns');
    assert.equal(bundled.body.youtubeUrl, 'https://www.youtube.com/watch?v=m0T6rqWPqjA');
    await invoke(get, { hymnNumber: '2', edition: 'ts' });
    assert.equal(app.reads(), 1);
});

test('dynamic lyric overrides without links do not inherit a legacy recording', async () => {
    const app = backend({
        dynamicHymns: [doc('override', { hymnID: '1', edition: 'ch', published: true })],
        hymns: [doc('legacy', { hymn: 'D1', link: video })],
    });
    assert.equal((await invoke(app.exports.getHymnYoutube, { hymnNumber: '1', edition: 'ch' })).body.youtubeUrl, null);
});

test('drafts are excluded; missing videos, bad requests and database failures are handled', async () => {
    const app = backend({ dynamicHymns: [doc('draft', {
        hymnID: '9001', edition: 'user_upload', published: false, youtubeUrl: video,
    })] });
    const get = app.exports.getHymnYoutube;
    assert.equal((await invoke(get, { hymnNumber: '9001', edition: 'user_upload' })).body.youtubeUrl, null);
    for (const query of [{}, { hymnNumber: '../1', edition: 'ch' }, { hymnNumber: ['1'], edition: 'ch' },
        { hymnNumber: '1', edition: 'bad' }]) assert.equal((await invoke(get, query)).code, 400);
    assert.equal((await invoke(get, {}, { method: 'POST' })).code, 405);
    assert.equal((await invoke(backend({}, true).exports.getHymnYoutube, { hymnNumber: '1', edition: 'ch' })).code, 500);
});

test('dynamic read/write APIs preserve and validate YouTube links', async () => {
    const app = backend({ dynamicHymns: [doc('ts-001', {
        hymnID: '001', edition: 'ts', html: '<p>Lyrics</p>', published: true, youtubeUrl: video,
    })] });
    assert.equal((await invoke(app.exports.getDynamicHymns)).body.hymns[0].youtubeUrl, video);
    const body = { hymnID: '001', edition: 'ts', html: '<p>Lyrics</p>', youtubeUrl: video };
    const save = input => invoke(app.exports.createDynamicHymn, {}, {
        method: 'POST', get: () => 'Bearer test-token', body: input,
    });
    assert.equal((await save(body)).code, 201);
    assert.equal(app.saved().youtubeUrl, video);
    assert.equal((await save({ ...body, youtubeUrl: 'https://example.com/' })).code, 400);
    await save({ ...body, youtubeUrl: '' });
    assert.equal(app.saved().youtubeUrl, null);
    const { youtubeUrl, ...withoutLink } = body;
    await save(withoutLink);
    assert.equal(Object.hasOwn(app.saved(), 'youtubeUrl'), false);
});

function fakeLink() {
    const classes = new Set();
    return { classList: { add: v => classes.add(v), remove: v => classes.delete(v) },
        removeAttribute(name) { delete this[name]; }, visible: () => classes.has('show') };
}

test('rapid selections cannot display a stale video; offline clears the link', async () => {
    const link = fakeLink();
    const pending = [];
    let online = true;
    const controller = createHymnVideoLink(link, {
        hostname: 'example.test', isOnline: () => online,
        fetchVideo: url => new Promise(resolve => pending.push({ url, resolve })),
    });
    controller.select('1', 'ch');
    await tick(5);
    controller.select('001', 'ts');
    await tick(5);
    assert.match(pending[1].url, /hymnNumber=001&edition=ts/);
    pending[1].resolve({ ok: true, json: async () => ({ success: true, youtubeUrl: video }) });
    await tick(0);
    assert.equal(link.href, video);
    pending[0].resolve({ ok: true, json: async () => ({ success: true, youtubeUrl: 'https://www.youtube.com/watch?v=m0T6rqWPqjA' }) });
    await tick(0);
    assert.equal(link.href, video);
    online = false;
    controller.refresh();
    assert.equal(link.visible(), false);
    assert.equal(link.href, undefined);
});

test('missing, failed or unsafe video responses keep the button hidden', async () => {
    for (const result of [{ ok: false },
        { ok: true, json: async () => ({ success: true, youtubeUrl: null }) },
        { ok: true, json: async () => ({ success: true, youtubeUrl: 'javascript:alert(1)' }) }]) {
        const link = fakeLink();
        const controller = createHymnVideoLink(link, {
            hostname: 'example.test', isOnline: () => true, fetchVideo: async () => result,
        });
        controller.select('1', 'ch');
        await tick(5);
        assert.equal(link.visible(), false);
    }
});
