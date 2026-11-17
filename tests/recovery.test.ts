import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoAdapter } from '../server/demo-adapter.ts';
import { Engine } from '../server/engine.ts';
import { Store } from '../server/store.ts';
import { AppError } from '../server/domain.ts';
import { acquireWorkspaceLock } from '../server/lock.ts';

async function until(condition: () => boolean) {
  const end = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < end);
    await new Promise((r) => setTimeout(r, 5));
  }
}
test('session expiry pauses waiting work; reconnect preserves the remaining queue', async () => {
  const adapter = new DemoAdapter(0),
    engine = new Engine(adapter, new Store(':memory:'), 'demo');
  await engine.sync();
  const items = ['demo-1', 'demo-2'].map((id) => {
    const r = engine.rows.get(id)!;
    return { id, revision: r.revision, draft: structuredClone(r.draft) };
  });
  let expired = true;
  adapter.verifyAccount = async () => {
    if (expired) throw new AppError('AUTH_REQUIRED');
  };
  try {
    engine.enqueue(items);
    await until(() => !engine.running && engine.paused);
    assert.equal(engine.connected, false);
    assert.equal(engine.queue.length, 1);
    assert.equal(adapter.submitted, 0);
    expired = false;
    await engine.sync(true);
    assert.equal(engine.connected, true);
    assert.equal(engine.queue.length, 1);
    assert.equal(engine.rows.get('demo-2')!.status, 'queued');
    engine.pause(false);
    await until(() => !engine.running && engine.queue.length === 0);
    assert.equal(adapter.submitted, 1);
    assert.equal(engine.rows.get('demo-2')!.status, 'completed');
  } finally {
    engine.cancelQueued();
    await engine.close();
  }
});
test('a restarted database preserves write intent and surfaces interrupted jobs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'invoice-desk-test-')),
    path = join(directory, 'queue.sqlite');
  try {
    let store = new Store(path);
    store.ensure('synthetic-id', 'TEST-1');
    store.patch('synthetic-id', {
      status: 'processing',
      stage: 'submit',
      error_code: 'SUBMIT_UNCERTAIN',
      upload_path: 'dist/uuid.pdf',
      attachment_hash: 'hash',
      payload_hash: 'payload',
    });
    store.close();
    store = new Store(path);
    const job = store.get('synthetic-id')!;
    assert.equal(job.status, 'attention');
    assert.equal(job.error_code, 'INTERRUPTED');
    assert.equal(job.upload_path, 'dist/uuid.pdf');
    assert.equal(job.attachment_hash, 'hash');
    assert.equal(job.payload_hash, 'payload');
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('a second live worker cannot acquire the same workspace', () => {
  const directory = mkdtempSync(join(tmpdir(), 'invoice-desk-lock-')),
    path = join(directory, 'worker.lock');
  try {
    const release = acquireWorkspaceLock(path);
    assert.throws(() => acquireWorkspaceLock(path), /already running/);
    release();
    const releaseAgain = acquireWorkspaceLock(path);
    releaseAgain();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
