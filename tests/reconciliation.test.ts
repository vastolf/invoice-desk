import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoAdapter } from '../server/demo-adapter.ts';
import { Engine } from '../server/engine.ts';
import { Store } from '../server/store.ts';
import { reconcile } from '../server/reconciliation.ts';
import { processSchema } from '../server/domain.ts';
import type { SourceInvoice } from '../shared/types.ts';

function fixture() {
  return structuredClone(new DemoAdapter(0).snapshot);
}
const find = (s: ReturnType<typeof fixture>, id = 'demo-1') =>
  reconcile(s).records.find((r) => r.source.id === id)!;
const copySource = (s: SourceInvoice, changes: Partial<SourceInvoice>) => ({ ...s, ...changes });
async function settled(engine: Engine) {
  const end = Date.now() + 5000;
  while (engine.running || engine.queue.length) {
    assert.ok(Date.now() < end);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('full history resolves clients, delivery, and product brands without treating completed history as new work', () => {
  const s = fixture();
  s.sources[0].memo = 'Unrecognized wording';
  const r = reconcile(s);
  const next = r.records.find((r) => r.source.id === 'demo-1')!;
  assert.equal(r.links.length, 9);
  assert.equal(next.classification, 'pending');
  assert.equal(next.workNeeded, 'submit');
  assert.deepEqual(next.draft.brandIds, ['brand-1']);
  assert.equal(next.draft.storeId, 'store-1');
  assert.ok(next.evidence.some((e) => e.field === 'brands' && e.method === 'product_label'));
  assert.ok(next.evidence.some((e) => e.method === 'invoice_history' && e.sourceIds.length));
  assert.equal(r.records.filter((r) => r.classification === 'completed').length, 8);
  assert.equal(r.records.find((r) => r.source.id === 'demo-9')!.workNeeded, 'complete');
});

test('customer chain identifies a new branch while other chains and unknown clients stay out of the actionable queue', () => {
  const s = fixture();
  s.clients!.push(
    { id: 'new-branch', name: 'North Park', chainId: 'chain-demo', chainName: 'Sample stores' },
    { id: 'other', name: 'Unrelated', chainId: 'other-chain', chainName: 'Other chain' },
    { id: 'unknown', name: 'Unclassified', chainId: null, chainName: '' },
  );
  for (const id of ['new-branch', 'other', 'unknown'])
    s.sources.push(
      copySource(s.sources[0], {
        id,
        invoiceNumber: `NEW-${id}`,
        clientId: id,
        clientName: s.clients!.find((c) => c.id === id)!.name,
      }),
    );
  const rows = reconcile(s).records;
  const branch = rows.find((r) => r.source.id === 'new-branch')!;
  assert.equal(branch.client.classification, 'same_chain');
  assert.equal(branch.workNeeded, 'submit');
  assert.equal(branch.draft.storeId, 'store-1');
  assert.equal(rows.find((r) => r.source.id === 'other')!.classification, 'excluded');
  assert.equal(rows.find((r) => r.source.id === 'other')!.workNeeded, 'none');
  assert.equal(rows.find((r) => r.source.id === 'unknown')!.classification, 'unclassified');
  assert.equal(rows.find((r) => r.source.id === 'unknown')!.canProcess, false);
});

test('closed or unavailable source invoices are never proposed as new submissions', () => {
  const s = fixture();
  s.sources[0].active = false;
  assert.equal(find(s).workNeeded, 'unknown');
  assert.equal(find(s).canProcess, false);
  s.sources[0].active = true;
  s.sources[0].available = false;
  assert.equal(find(s).classification, 'unclassified');
});

test('ambiguous delivery history remains a specific exception instead of choosing the most frequent route', () => {
  const s = fixture();
  const history = s.portals.find((p) => p.invoiceNumber === s.sources[18].invoiceNumber)!;
  history.deliveryMethod = 'RCP Northside';
  s.sources.push(copySource(s.sources[18], { id: 'older-direct', invoiceNumber: 'OLDER-1' }));
  s.portals.push({
    ...history,
    id: 'older-direct-portal',
    invoiceNumber: 'OLDER-1',
    deliveryMethod: 'Direct to Store',
  });
  s.sources[0].memo = 'A new order with no delivery instruction';
  const r = find(s);
  assert.equal(r.classification, 'review');
  assert.equal(r.draft.deliveryMethod, '');
  assert.ok(r.issues.some((i) => i.includes('multiple delivery methods')));
});

test('zero quantity and zero value historical lines do not teach an incorrect brand', () => {
  const s = fixture();
  s.products![0].name = 'Unlabeled product';
  s.products![0].supplierName = '';
  s.products![0].supplierId = null;
  const wrong = s.sources[17];
  s.lines!.push({
    id: 'removed-product',
    invoiceId: wrong.id,
    productId: 'product-0',
    quantity: 0,
    amountMinor: 0,
    revision: wrong.revision,
  });
  const r = find(s);
  assert.deepEqual(r.draft.brandIds, ['brand-1']);
  assert.ok(r.evidence.some((e) => e.method === 'product_history'));
  const store = new Store(':memory:');
  try {
    const result = reconcile(s);
    store.saveCatalog(s, result.links, result.clients, result.evidence);
    assert.deepEqual(
      store.db
        .prepare('SELECT portal_brand_id FROM product_brand_mappings WHERE product_id=?')
        .all('product-0')
        .map((r) => r.portal_brand_id),
      ['brand-1'],
    );
  } finally {
    store.close();
  }
});

test('agreeing product and supplier labels resolve inconsistent historical invoice header brands', () => {
  const s = fixture();
  const wrong = s.sources[17];
  s.lines!.push({
    id: 'noisy-header',
    invoiceId: wrong.id,
    productId: 'product-0',
    quantity: 12,
    amountMinor: 1200,
    revision: wrong.revision,
  });
  const r = find(s);
  assert.deepEqual(r.draft.brandIds, ['brand-1']);
  assert.equal(r.classification, 'pending');
  s.products![0].supplierName = 'Unknown supplier';
  s.sources[0].memo = 'No memo match';
  assert.equal(find(s).classification, 'review');
  assert.ok(find(s).issues.some((i) => i.includes('unambiguous portal brand')));
});

test('existing records retain identity after invoice-number changes or a missing remote record', () => {
  const s = fixture();
  const first = reconcile(s),
    old = first.links[0];
  const portal = s.portals.find((p) => p.id === old.portalId)!;
  const source = s.sources.find((i) => i.id === old.sourceId)!;
  source.taskComplete = false;
  portal.invoiceNumber = 'RENAMED-1';
  let r = reconcile(s, first.links).records.find((r) => r.source.id === source.id)!;
  assert.equal(r.portal!.id, old.portalId);
  assert.equal(r.classification, 'review');
  assert.ok(r.differences.includes('invoice_number'));
  assert.equal(r.canProcess, false);
  s.portals = s.portals.filter((p) => p.id !== old.portalId);
  r = reconcile(s, first.links).records.find((r) => r.source.id === source.id)!;
  assert.equal(r.classification, 'review');
  assert.equal(r.workNeeded, 'unknown');
  assert.equal(r.canProcess, false);
});

test('duplicate numbers require review; prefixes are preserved; archived matches remain linked', () => {
  const s = fixture();
  const p = s.portals[0];
  p.archived = true;
  assert.ok(reconcile(s).links.some((l) => l.portalId === p.id));
  s.sources[0].invoiceNumber = p.invoiceNumber.replace('DEMO-', 'Q-');
  assert.equal(find(s).workNeeded, 'submit');
  s.sources[0].invoiceNumber = p.invoiceNumber;
  const r = find(s);
  assert.equal(r.classification, 'review');
  assert.equal(r.canProcess, false);
});

test('completed invoices retain differences as history while unfinished mismatches cannot be completed', () => {
  const s = fixture();
  const p = s.portals[0],
    source = s.sources.find((s) => s.invoiceNumber === p.invoiceNumber)!;
  source.taskComplete = true;
  source.amountMinor += 100;
  let r = reconcile(s).records.find((r) => r.source.id === source.id)!;
  assert.equal(r.classification, 'completed');
  assert.ok(r.differences.includes('amount'));
  source.taskComplete = false;
  r = reconcile(s).records.find((r) => r.source.id === source.id)!;
  assert.equal(r.classification, 'review');
  assert.equal(r.canProcess, false);
  p.amountMinor = source.amountMinor;
  p.submittedBy = 'another-rep';
  assert.equal(reconcile(s).records.find((r) => r.source.id === source.id)!.canProcess, false);
});

test('catalog survives restart with normalized relationships, and refreshed statuses replace old classifications', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'invoice-catalog-'));
  const path = join(directory, 'catalog.sqlite');
  const adapter = new DemoAdapter(0);
  let engine = new Engine(adapter, new Store(path), 'demo');
  try {
    await engine.sync();
    assert.equal(engine.store.catalog().sources.length, 24);
    assert.equal(engine.store.links().length, 9);
    assert.equal(engine.store.db.prepare('SELECT * FROM client_invoice_links').all().length, 9);
    assert.ok(engine.store.db.prepare('SELECT * FROM mapping_evidence').all().length > 0);
    await engine.close();
    engine = new Engine(adapter, new Store(path), 'demo');
    adapter.snapshot.sources[8].taskComplete = true;
    adapter.snapshot.portals[0].status = 'paid';
    await engine.sync();
    assert.equal(engine.reconciliation!.lineInvoicesFetched, 0);
    assert.equal(engine.reconciliation!.lineInvoicesReused, 24);
    assert.equal(engine.rows.get('demo-9')!.status, 'completed');
    assert.equal(engine.rows.get('demo-9')!.portalStatus, 'paid');
    assert.equal(engine.store.links().length, 9);
    assert.equal(engine.clients.length, 6);
  } finally {
    await engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all catalog tables exclude labels, people, memos, documents, sessions and credentials', () => {
  const s = fixture(),
    result = reconcile(s),
    store = new Store(':memory:');
  s.sources[0].memo = 'Private person private@example.test confidential memo';
  s.sources[0].pdfLink = 'https://private.example/document?secret=private-token';
  try {
    store.saveCatalog(s, result.links, result.clients, result.evidence);
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const data = tables
      .map((t) => JSON.stringify(store.db.prepare(`SELECT * FROM "${t.name}"`).all()))
      .join('');
    for (const text of [
      'Cedar & Co.',
      'Golden Hour',
      'Sample stores',
      'Private person',
      'private@example.test',
      'confidential memo',
      'private-token',
      'pdfLink',
      'password',
      'authorization',
    ])
      assert.equal(data.includes(text), false, text);
    assert.equal(store.catalog().sources[0].amountMinor, s.sources[0].amountMinor);
  } finally {
    store.close();
  }
});

test('completion-only resumes legacy portal fields without another upload or submission', async () => {
  const adapter = new DemoAdapter(0),
    engine = new Engine(adapter, new Store(':memory:'), 'demo');
  let uploads = 0;
  adapter.upload = async () => {
    uploads++;
  };
  const portal = adapter.snapshot.portals.find(
    (p) => p.invoiceNumber === adapter.snapshot.sources[8].invoiceNumber,
  )!;
  portal.deliveryDate = '';
  portal.brandIds = [];
  portal.deliveryMethod = '';
  portal.storeId = null;
  try {
    await engine.sync();
    const row = engine.rows.get('demo-9')!;
    const item = {
      id: row.id,
      revision: row.revision,
      draft: row.draft,
      action: 'complete' as const,
    };
    assert.equal(processSchema.safeParse({ items: [item] }).success, true);
    engine.enqueue([item]);
    await settled(engine);
    assert.equal(engine.rows.get(row.id)!.status, 'completed');
    assert.equal(adapter.submitted, 0);
    assert.equal(uploads, 0);
    assert.equal(adapter.completionAttempts, 1);
    assert.ok(engine.store.links().some((l) => l.sourceId === row.id && l.portalId === portal.id));
  } finally {
    await engine.close();
  }
});

test('remote rejection or closed source discovered after selection stops the worker', async () => {
  for (const fault of ['rejected', 'closed']) {
    const adapter = new DemoAdapter(0),
      engine = new Engine(adapter, new Store(':memory:'), 'demo');
    try {
      await engine.sync();
      const r = engine.rows.get('demo-9')!;
      if (fault === 'rejected')
        adapter.snapshot.portals.find((p) => p.id === r.portalId)!.status = 'rejected';
      else adapter.snapshot.sources[8].active = false;
      engine.enqueue([{ id: r.id, revision: r.revision, draft: r.draft }]);
      await settled(engine);
      assert.equal(engine.rows.get(r.id)!.status, 'attention');
      assert.equal(adapter.completionAttempts, 0);
      assert.equal(adapter.submitted, 0);
    } finally {
      await engine.close();
    }
  }
});
