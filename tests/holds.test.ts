import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoAdapter } from '../server/demo-adapter.ts';
import { Engine } from '../server/engine.ts';
import { Store } from '../server/store.ts';
import { reconcile } from '../server/reconciliation.ts';
import { repEditAvailable } from '../server/domain.ts';
async function settled(engine: Engine) {
  const end = Date.now() + 5000;
  while (engine.running || engine.queue.length) {
    assert.ok(Date.now() < end);
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function setup() {
  const adapter = new DemoAdapter(0),
    store = new Store(':memory:'),
    engine = new Engine(adapter, store, 'demo');
  await engine.sync();
  return { adapter, store, engine };
}
function selected(engine: Engine) {
  const r = engine.rows.get('demo-1')!;
  return { id: r.id, revision: r.revision, draft: structuredClone(r.draft) };
}

test('a held invoice remains visible with its mappings but cannot be selected for processing', async () => {
  const { adapter, store, engine } = await setup();
  try {
    adapter.snapshot.sources[0].onHold = true;
    adapter.snapshot.sources[0].termId = 'hold-term';
    await engine.sync();
    const row = engine.rows.get('demo-1')!;
    assert.equal(row.status, 'held');
    assert.equal(row.canProcess, false);
    assert.equal(row.workNeeded, 'submit');
    assert.deepEqual(row.draft.brandIds, ['brand-1']);
    assert.throws(() => engine.enqueue([selected(engine)]), { code: 'SOURCE_ON_HOLD' });
    const cached = store.catalog().sources.find((s) => s.id === row.id)!;
    assert.equal(cached.onHold, true);
    assert.equal(cached.termId, 'hold-term');
    adapter.snapshot.sources[0].onHold = false;
    await engine.sync();
    assert.equal(engine.rows.get(row.id)!.status, 'pending');
    assert.equal(engine.rows.get(row.id)!.canProcess, true);
    assert.equal(adapter.submitted, 0);
  } finally {
    await engine.close();
  }
});

test('a hold added after selection stops before PDF upload or submission', async () => {
  const { adapter, engine } = await setup();
  let uploads = 0;
  adapter.upload = async () => {
    uploads++;
  };
  try {
    const item = selected(engine);
    adapter.snapshot.sources[0].onHold = true;
    engine.enqueue([item]);
    await settled(engine);
    assert.equal(engine.rows.get(item.id)!.errorCode, 'SOURCE_ON_HOLD');
    assert.equal(engine.rows.get(item.id)!.status, 'held');
    assert.equal(uploads, 0);
    assert.equal(adapter.submitted, 0);
    assert.equal(adapter.completionAttempts, 0);
    adapter.snapshot.sources[0].onHold = false;
    await engine.sync();
    assert.equal(engine.rows.get(item.id)!.errorCode, null);
  } finally {
    await engine.close();
  }
});

test('a hold appearing during PDF retrieval is rechecked before upload', async () => {
  const { adapter, engine } = await setup();
  const pdf = adapter.pdf.bind(adapter);
  let uploads = 0;
  adapter.upload = async () => {
    uploads++;
  };
  adapter.pdf = async (id) => {
    const bytes = await pdf(id);
    adapter.snapshot.sources[0].onHold = true;
    return bytes;
  };
  try {
    engine.enqueue([selected(engine)]);
    await settled(engine);
    assert.equal(engine.rows.get('demo-1')!.errorCode, 'SOURCE_ON_HOLD');
    assert.equal(uploads, 0);
    assert.equal(adapter.submitted, 0);
  } finally {
    await engine.close();
  }
});

test('a hold after portal submission preserves the portal link and blocks task completion', async () => {
  const { adapter, store, engine } = await setup();
  const submit = adapter.submit.bind(adapter);
  adapter.submit = async (...args) => {
    const id = await submit(...args);
    adapter.snapshot.sources[0].onHold = true;
    return id;
  };
  try {
    engine.enqueue([selected(engine)]);
    await settled(engine);
    assert.equal(adapter.submitted, 1);
    assert.equal(adapter.completionAttempts, 0);
    const row = engine.rows.get('demo-1')!;
    assert.equal(row.status, 'held');
    assert.equal(row.portalVerified, true);
    assert.equal(row.workNeeded, 'complete');
    assert.ok(store.links().some((l) => l.sourceId === row.id && l.portalId === row.portalId));
    await engine.sync();
    assert.equal(engine.rows.get(row.id)!.status, 'held');
    adapter.snapshot.sources[0].onHold = false;
    await engine.sync();
    assert.equal(engine.rows.get(row.id)!.workNeeded, 'complete');
    engine.enqueue([selected(engine)]);
    await settled(engine);
    assert.equal(adapter.submitted, 1);
    assert.equal(adapter.completionAttempts, 1);
  } finally {
    await engine.close();
  }
});

test('an invoice-specific hub destination can differ from the Encompass customer', () => {
  const s = structuredClone(new DemoAdapter(0).snapshot);
  s.sources[0].clientName = 'Distribution hub';
  const historical = {
    ...s.sources[18],
    id: 'hub-example',
    invoiceNumber: 'HUB-1',
    memo: 'Golden Hour - Napa',
  };
  const portal = s.portals.find((p) => p.invoiceNumber === s.sources[18].invoiceNumber)!;
  s.sources.push(historical);
  s.portals.push({
    ...portal,
    id: 'hub-portal',
    invoiceNumber: historical.invoiceNumber,
    deliveryMethod: 'RCP Northside',
    storeId: 'store-2',
  });
  s.sources[0].memo = historical.memo;
  const r = reconcile(s).records.find((r) => r.source.id === 'demo-1')!;
  assert.equal(r.draft.deliveryMethod, 'RCP Northside');
  assert.equal(r.draft.storeId, 'store-2');
  assert.ok(r.evidence.some((e) => e.field === 'store' && e.method === 'memo_history'));
  s.sources[0].memo = 'No final destination';
  const unresolved = reconcile(s).records.find((r) => r.source.id === 'demo-1')!;
  assert.equal(unresolved.classification, 'review');
  assert.equal(unresolved.draft.deliveryMethod, '');
});

test('rep header/file editing follows the observed ownership, status, intake, credit, archive and payment gates', () => {
  const submitted = { status: 'submitted', submitted_by: 'rep' };
  assert.equal(repEditAvailable(submitted, 'rep', true), true);
  assert.equal(repEditAvailable(submitted, 'other', true), false);
  assert.equal(repEditAvailable(submitted, 'rep', false), false);
  const approved = { ...submitted, status: 'approved', intake_status: 'pending' };
  assert.equal(repEditAvailable(approved, 'rep', true), true);
  for (const change of [
    { status: 'paid' },
    { status: 'rejected' },
    { archived_at: '2026-11-13' },
    { payment_date: '2026-11-13' },
    { intake_status: 'approved' },
    { accepted_at: '2026-11-13' },
    { credit_status: 'pending' },
    { waiting_on_rep: true },
  ])
    assert.equal(repEditAvailable({ ...approved, ...change }, 'rep', true), false);
});
