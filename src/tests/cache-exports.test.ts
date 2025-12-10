import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import test from 'ava';

import { defaultNamespace, openLevelCache, openLmdbCache, LMDBCache } from '../index.js';

const TMP_ROOT = '.cache/tests-persistence-cache-exports';

function tmpPath(name: string): string {
    const p = join(TMP_ROOT, `${name}-${Date.now()}-${process.pid}`);
    try {
        mkdirSync(TMP_ROOT, { recursive: true });
    } catch {}
    return p;
}

test('wrapper packages re-export persistence cache APIs', async (t) => {
    // @ts-ignore workspace wrapper import for parity validation
    const levelWrapper = await import('@promethean-os/level-cache');
    // @ts-ignore workspace wrapper import for parity validation
    const lmdbWrapper = await import('@promethean-os/lmdb-cache');

    t.is(levelWrapper.openLevelCache, openLevelCache);
    t.is(levelWrapper.defaultNamespace, defaultNamespace);
    t.is(lmdbWrapper.openLmdbCache, openLmdbCache);
    t.is(lmdbWrapper.LMDBCache, LMDBCache);
});

async function assertNamespacedEntries(t: any, label: string, open: (opts: any) => any | Promise<any>) {
    const path = tmpPath(label);
    const cache = await Promise.resolve(open({ path, namespace: 'root' }));
    const child = cache.withNamespace('child');
    await child.set('k', 'v');

    const rows: Array<[string, string]> = [];
    for await (const entry of cache.entries({ namespace: 'root/child' })) {
        rows.push(entry as [string, string]);
    }

    t.deepEqual(rows, [['k', 'v']]);
    await cache.close();
    rmSync(path, { recursive: true, force: true });
}

test('entries supports explicit namespace option across caches', async (t) => {
    await assertNamespacedEntries(t, 'level', openLevelCache);
    await assertNamespacedEntries(t, 'lmdb', openLmdbCache);
});
