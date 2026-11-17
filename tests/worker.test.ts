import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoAdapter } from '../server/demo-adapter.ts';
import { Engine } from '../server/engine.ts';
import { Store } from '../server/store.ts';
import { AppError, draftSchema, moneyMinor } from '../server/domain.ts';
async function setup() {
  const adapter = new DemoAdapter(0),
    store = new Store(':memory:'),
    engine = new Engine(adapter, store, 'demo');
  await engine.sync();
  return { adapter, store, engine };
}
function item(engine: Engine, id = 'demo-1') {
  const row = engine.rows.get(id)!;
  return { id, revision: row.revision, draft: structuredClone(row.draft) };
}
async function settled(engine: Engine) {
  const start = Date.now();
  while (engine.running || engine.queue.length) {
    assert.ok(Date.now() - start < 5000, 'worker did not settle');
    await new Promise((r) => setTimeout(r, 5));
  }
}
test('a batch verifies submission and completes the sales task', async () => {
  const { adapter, engine, store } = await setup();
  try {
    engine.enqueue([item(engine), item(engine, 'demo-2')]);
    await settled(engine);
    assert.equal(adapter.submitted, 2);
    for (const id of ['demo-1', 'demo-2']) {
      assert.equal(engine.rows.get(id)!.status, 'completed');
      assert.equal(store.get(id)!.portal_verified, 1);
      assert.equal(store.get(id)!.task_complete, 1);
    }
  } finally {
    await engine.close();
  }
});
test('lost submit response is reconciled without a second submission', async () => {
  const { adapter, engine } = await setup();
  try {
    adapter.faults.set('demo-1', 'submit_response_lost');
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(adapter.submitted, 1);
    assert.equal(engine.rows.get('demo-1')!.status, 'completed');
  } finally {
    await engine.close();
  }
});
test('completion failure preserves portal result; retry only completes the task', async () => {
  const { adapter, engine, store } = await setup();
  try {
    engine.enqueue([item(engine, 'demo-6')]);
    await settled(engine);
    assert.equal(engine.rows.get('demo-6')!.errorCode, 'MINIMUM_NOT_MET');
    assert.equal(store.get('demo-6')!.portal_verified, 1);
    assert.equal(adapter.submitted, 1);
    adapter.faults.delete('demo-6');
    engine.enqueue([item(engine, 'demo-6')]);
    await settled(engine);
    assert.equal(adapter.submitted, 1);
    assert.equal(engine.rows.get('demo-6')!.status, 'completed');
  } finally {
    await engine.close();
  }
});
test('duplicate selection is rejected atomically; a running invoice cannot be enqueued twice', async () => {
  const { adapter, engine } = await setup();
  try {
    assert.throws(() => engine.enqueue([item(engine), item(engine)]), { code: 'WORKER_BUSY' });
    assert.equal(engine.queue.length, 0);
    engine.enqueue([item(engine)]);
    assert.throws(() => engine.enqueue([item(engine)]), { code: 'WORKER_BUSY' });
    await settled(engine);
    assert.equal(adapter.submitted, 1);
  } finally {
    await engine.close();
  }
});
test('a changed source is stopped before any remote write', async () => {
  const { adapter, engine } = await setup();
  try {
    adapter.snapshot.sources[0].revision = 'changed';
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(engine.rows.get('demo-1')!.errorCode, 'SOURCE_CHANGED');
    assert.equal(adapter.submitted, 0);
    assert.equal(adapter.completionAttempts, 0);
  } finally {
    await engine.close();
  }
});
test('an archived duplicate is reconciled instead of submitted again', async () => {
  const { adapter, engine } = await setup();
  try {
    const source = adapter.snapshot.sources[0],
      draft = item(engine).draft;
    adapter.snapshot.portals.push({
      id: 'archived-existing',
      invoiceNumber: source.invoiceNumber,
      distributorId: draft.distributorId,
      brandIds: draft.brandIds,
      storeId: draft.storeId,
      invoiceDate: draft.invoiceDate,
      deliveryDate: draft.deliveryDate,
      deliveryMethod: draft.deliveryMethod,
      amountMinor: source.amountMinor,
      status: 'paid',
      submittedBy: adapter.userId,
      archived: true,
    });
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(adapter.submitted, 0);
    assert.equal(engine.rows.get(source.id)!.status, 'completed');
  } finally {
    await engine.close();
  }
});
test('a conflicting duplicate or different rep is never changed', async () => {
  const { adapter, engine } = await setup();
  try {
    const s = adapter.snapshot.sources[0],
      d = item(engine).draft;
    adapter.snapshot.portals.push({
      id: 'other-rep',
      invoiceNumber: s.invoiceNumber,
      distributorId: d.distributorId,
      brandIds: d.brandIds,
      storeId: d.storeId,
      invoiceDate: d.invoiceDate,
      deliveryDate: d.deliveryDate,
      deliveryMethod: d.deliveryMethod,
      amountMinor: s.amountMinor,
      status: 'approved',
      submittedBy: 'another-rep',
      archived: false,
    });
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(engine.rows.get(s.id)!.errorCode, 'DUPLICATE_CONFLICT');
    assert.equal(adapter.submitted, 0);
    assert.equal(adapter.completionAttempts, 0);
  } finally {
    await engine.close();
  }
});
test('paused batches can be cleared without executing a remote operation', async () => {
  const { adapter, engine } = await setup();
  try {
    engine.pause(true);
    engine.enqueue([item(engine), item(engine, 'demo-2')]);
    assert.equal(engine.queue.length, 2);
    assert.equal(engine.running, false);
    engine.cancelQueued();
    engine.pause(false);
    await settled(engine);
    assert.equal(adapter.submitted, 0);
    assert.equal(engine.rows.get('demo-1')!.status, 'pending');
  } finally {
    await engine.close();
  }
});
test('upload retry reuses the intended path and retains durable intent', async () => {
  const { adapter, engine, store } = await setup();
  const paths: string[] = [];
  let fail = true;
  adapter.upload = async (path) => {
    paths.push(path);
    if (fail) throw new AppError('UPLOAD_UNCERTAIN');
  };
  try {
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(store.get('demo-1')!.error_code, 'UPLOAD_UNCERTAIN');
    assert.ok(store.get('demo-1')!.attachment_hash);
    fail = false;
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(paths.length, 2);
    assert.equal(paths[0], paths[1]);
    assert.equal(adapter.submitted, 1);
  } finally {
    await engine.close();
  }
});
test('local storage contains IDs/state/hashes, never client names or invoice payloads', async () => {
  const { engine, store } = await setup();
  try {
    engine.enqueue([item(engine)]);
    await settled(engine);
    const serialized =
      JSON.stringify(store.all()) + JSON.stringify(store.db.prepare('SELECT * FROM events').all());
    for (const forbidden of [
      'Cedar & Co.',
      'Golden Hour',
      'clientName',
      'brandIds',
      'invoiceDate',
      'password',
      'pdfLink',
      'authorization',
    ])
      assert.ok(!serialized.includes(forbidden), forbidden);
  } finally {
    await engine.close();
  }
});
test('zero amounts and multi-brand drafts are supported; dates and store rules are enforced', () => {
  const draft = {
    distributorId: 'd',
    brandIds: ['a', 'b'],
    storeId: null,
    deliveryMethod: 'CK Distribution',
    invoiceDate: '2026-11-13',
    deliveryDate: '2026-11-14',
    amount: '0.00',
  };
  assert.equal(draftSchema.safeParse(draft).success, true);
  assert.equal(
    draftSchema.safeParse({ ...draft, deliveryMethod: 'Direct to Store' }).success,
    false,
  );
  assert.equal(draftSchema.safeParse({ ...draft, invoiceDate: '2026-02-30' }).success, false);
  assert.equal(moneyMinor('123.45'), 12345);
  assert.throws(() => moneyMinor('1.999'));
  assert.throws(() => moneyMinor('-2'));
});

test('an unexpected attachment stops completion even when the portal fields match', async () => {
  const { adapter, engine } = await setup();
  const submit = adapter.submit.bind(adapter);
  adapter.submit = async (...args) => {
    const id = await submit(...args);
    adapter.snapshot.portals.find((p) => p.id === id)!.attachmentPaths = ['unexpected.pdf'];
    return id;
  };
  try {
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(engine.rows.get('demo-1')!.errorCode, 'VERIFICATION_FAILED');
    assert.equal(adapter.submitted, 1);
    assert.equal(adapter.completionAttempts, 0);
  } finally {
    await engine.close();
  }
});

test('source changes after submission preserve the portal result and stop task completion', async () => {
  const { adapter, engine, store } = await setup();
  const submit = adapter.submit.bind(adapter);
  adapter.submit = async (...args) => {
    const id = await submit(...args);
    adapter.snapshot.sources[0].revision = 'changed-after-submit';
    return id;
  };
  try {
    engine.enqueue([item(engine)]);
    await settled(engine);
    assert.equal(engine.rows.get('demo-1')!.errorCode, 'SOURCE_CHANGED');
    assert.equal(store.get('demo-1')!.portal_verified, 1);
    assert.equal(adapter.snapshot.sources[0].taskComplete, false);
    assert.equal(adapter.submitted, 1);
  } finally {
    await engine.close();
  }
});
