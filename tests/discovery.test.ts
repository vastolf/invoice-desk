import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveAdapter } from '../server/live-adapter.ts';
import { Store } from '../server/store.ts';
import { reconcile } from '../server/reconciliation.ts';

// Fake authenticated table transports exercise the real discovery/cache logic.
function upstream() {
  const adapter = new LiveAdapter({ ENCOMPASS_USERNAME: 'rep' });
  adapter.userId = 'portal-rep';
  adapter.sourceUserIds = new Set(['source-rep']);
  adapter.connect = async () => {};
  const invoice = (id: string, number: string) => ({
    InvoiceID: id,
    InvoiceNum: number,
    InvoiceTotal: '100.00',
    TotalCases: '1',
    TimeCreated: '2026-11-01',
    TimeUpdated: 'v1',
    CustomerID: 'customer-1',
    CreatedBy: 'rep',
    SalesTaskID: `task-${id}`,
    Memo: 'Alpha',
    TermID: 'net-term',
    // The database value is a load-sheet reference, not the invoice-status enum.
    Status: id === 'old' ? 'Delivered' : 'Entered',
    Status_DBValue: '99001',
    'Invoice_LoadSheet^LoadSheet.Date': '2026-11-14',
  });
  const current = invoice('new', 'X-NEW'),
    historical = invoice('old', 'X-OLD');
  const portal = (number: string, id: string) => ({
    id,
    invoice_number: number,
    distributor_id: 'dist',
    store_id: 'store',
    invoice_date: '2026-11-01',
    delivery_date: '2026-11-14',
    delivery_method: 'Direct to Store',
    amount: '100.00',
    status: 'approved',
    submitted_by: 'portal-rep',
    invoice_brands: [{ brand_id: 'alpha' }],
  });
  const calls: { table: string; filters: { name: string; value: string }[] }[] = [];
  const internal = adapter as any;
  internal.api = async () => ({ id: 'portal-rep' });
  internal.rest = async (name: string) => {
    switch (name) {
      case 'user_distributors':
        return [{ distributor_id: 'dist' }];
      case 'user_brands':
        return [{ brand_id: 'alpha' }];
      case 'user_roles':
        return [{ role: 'rep' }];
      case 'distributors':
        return [{ id: 'dist', name: 'Distribution' }];
      case 'brands':
        return [{ id: 'alpha', name: 'Alpha' }];
      case 'stores':
        return [{ id: 'store', name: 'Store' }];
      case 'invoices':
        return [portal('X-OLD', 'p-old'), portal('X-MISSING', 'p-missing')];
      default:
        throw new Error(name);
    }
  };
  internal.table = async (
    table: string,
    _columns: string[],
    filters: { name: string; value: string }[],
  ) => {
    calls.push({ table, filters });
    const get = (name: string) => filters.find((f) => f.name === name)?.value.split('^') ?? [];
    switch (table) {
      case 'AssignedUsers':
        return [{ 'AssignedUsers_Customers^Customers.CustomerID': 'customer-1' }];
      case 'Invoice': {
        if (get('CustomerID').length) {
          assert.deepEqual(get('Status'), ['1', '2', '3']);
          return [current];
        }
        const matches = [current, historical].filter(
          (r) => get('InvoiceID').includes(r.InvoiceID) || get('InvoiceNum').includes(r.InvoiceNum),
        );
        return get('Status').length ? matches.filter((r) => r.InvoiceID === 'new') : matches;
      }
      case 'Tasks':
        return get('TaskID').map((id) => ({
          TaskID: id,
          TaskStatusID: id === 'task-old' ? '4' : '19',
          AssignToUserID: 'source-rep',
        }));
      case 'Terms':
        return get('TermID')
          .filter((id) => ['net-term', 'hold-term'].includes(id))
          .map((id) => ({ TermID: id, OnHold: id === 'hold-term' ? '1' : '0' }));
      case 'Customers':
        return [{ CustomerID: 'customer-1', Company: 'Source client', ChainID: 'chain-1' }];
      case 'InvoiceTrans':
        return get('InvoiceID').includes('new')
          ? [
              {
                InvoiceTransID: 'line-new',
                InvoiceID: 'new',
                ProductID: 'product-1',
                NumUnits: '12',
                ExtPrice: current.InvoiceTotal,
              },
            ]
          : [];
      case 'InvoiceTransHist':
        return get('InvoiceID').includes('old')
          ? [
              {
                InvoiceTransID: 'line-old',
                InvoiceID: 'old',
                ProductID: 'product-1',
                NumUnits: '12',
                ExtPrice: '100.00',
              },
            ]
          : [];
      case 'Products':
        return [
          {
            ProductID: 'product-1',
            ProductName: 'Alpha product',
            SupplierID: 'Alpha',
            BrandID: 'Flower',
          },
        ];
      default:
        throw new Error(table);
    }
  };
  return { adapter, current, calls };
}

test('refresh reuses known number links and unchanged lines, reads historical lines, and updates source status', async () => {
  const { adapter, current, calls } = upstream(),
    store = new Store(':memory:');
  try {
    const first = await adapter.discover(store.catalog());
    assert.equal(first.metrics!.sourceLookups, 2);
    assert.equal(first.metrics!.lineInvoicesFetched, 2);
    assert.equal(first.lines!.length, 2);
    assert.equal(first.sources.find((s) => s.id === 'old')!.active, false);
    assert.equal(first.sources.find((s) => s.id === 'new')!.active, true);
    let r = reconcile(first);
    store.saveCatalog(first, r.links, r.clients, r.evidence);
    calls.length = 0;
    const second = await adapter.discover(store.catalog());
    assert.equal(second.metrics!.sourceLookups, 0);
    assert.equal(second.metrics!.lineInvoicesFetched, 0);
    assert.equal(second.metrics!.lineInvoicesReused, 2);
    assert.equal(second.lines!.length, 2);
    assert.equal(
      calls.some((c) => c.filters.some((f) => f.name === 'InvoiceNum')),
      false,
    );
    assert.equal(
      calls.some((c) => c.table === 'InvoiceTrans' || c.table === 'InvoiceTransHist'),
      false,
    );
    r = reconcile(second, store.links());
    store.saveCatalog(second, r.links, r.clients, r.evidence);
    current.TimeUpdated = 'v2';
    current.InvoiceTotal = '125.00';
    const third = await adapter.discover(store.catalog());
    assert.equal(third.metrics!.lineInvoicesFetched, 1);
    assert.equal(third.metrics!.lineInvoicesReused, 1);
    assert.equal(third.lines!.find((l) => l.invoiceId === 'new')!.amountMinor, 12500);
    assert.equal(third.sources.find((s) => s.id === 'new')!.amountMinor, 12500);
  } finally {
    await adapter.close();
    store.close();
  }
});

test('negative invoice lookups expire while successful source IDs remain reusable', async () => {
  const { adapter, calls } = upstream(),
    store = new Store(':memory:');
  try {
    const s = await adapter.discover(),
      r = reconcile(s);
    store.saveCatalog(s, r.links, r.clients, r.evidence);
    store.db
      .prepare(
        "UPDATE source_lookups SET checked_at='2020-01-01T00:00:00Z' WHERE invoice_number='X-MISSING'",
      )
      .run();
    calls.length = 0;
    const second = await adapter.discover(store.catalog());
    assert.equal(second.metrics!.sourceLookups, 1);
    assert.deepEqual(
      calls
        .filter((c) => c.table === 'Invoice')
        .flatMap((c) => c.filters.filter((f) => f.name === 'InvoiceNum').map((f) => f.value)),
      ['X-MISSING'],
    );
  } finally {
    await adapter.close();
    store.close();
  }
});

test('a changed account cannot merge its catalog with another account', async () => {
  const { adapter } = upstream();
  const cache = { sources: [], lines: [], products: [], lookups: [], accountId: 'different-rep' };
  await assert.rejects(adapter.discover(cache), { code: 'ACCOUNT_CHANGED' });
});

test('source query limits split batches and fail explicitly if one record is still truncated', async () => {
  const { adapter } = upstream(),
    internal = adapter as any;
  internal.table = async (
    _table: string,
    _columns: string[],
    filters: { name: string; value: string }[],
  ) => (filters[0].value.includes('^') ? Array(5000).fill({}) : [{ id: filters[0].value }]);
  assert.deepEqual(await internal.batchTable('Invoice', ['InvoiceID'], 'InvoiceID', ['a', 'b']), [
    { id: 'a' },
    { id: 'b' },
  ]);
  internal.table = async () => Array(5000).fill({});
  await assert.rejects(internal.batchTable('Invoice', ['InvoiceID'], 'InvoiceID', ['a']), {
    code: 'DISCOVERY_INCOMPLETE',
  });
});

test('payment-term holds are read separately from invoice status and rechecked on source reads', async () => {
  const { adapter, current } = upstream();
  try {
    await adapter.discover();
    current.TermID = 'hold-term';
    const held = await adapter.source('new');
    assert.equal(held.onHold, true);
    assert.equal(held.sourceStatus, 'Entered');
    assert.equal(held.termId, 'hold-term');
    current.TermID = 'net-term';
    const released = await adapter.source('new');
    assert.equal(released.onHold, false);
    assert.notEqual(released.revision, held.revision);
    current.TermID = 'unknown-term';
    await assert.rejects(adapter.source('new'), { code: 'DISCOVERY_INCOMPLETE' });
  } finally {
    await adapter.close();
  }
});
