import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CatalogCache,
  ClientSummary,
  InvoiceLink,
  JobEvent,
  MappingEvidence,
  PortalInvoice,
  SourceInvoice,
  SourceLine,
  SourceProduct,
  Stage,
} from '../shared/types.ts';
import type { Snapshot } from './adapter.ts';
export interface StoredJob {
  id: string;
  invoice_number: string;
  portal_id: string | null;
  distributor_id: string | null;
  status: string;
  stage: Stage;
  portal_verified: number;
  task_complete: number;
  error_code: string | null;
  upload_path: string | null;
  attachment_hash: string | null;
  payload_hash: string | null;
  updated_at: string;
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, invoice_number TEXT NOT NULL, portal_id TEXT, distributor_id TEXT,
      status TEXT NOT NULL DEFAULT 'review', stage TEXT NOT NULL DEFAULT 'idle', portal_verified INTEGER NOT NULL DEFAULT 0,
      task_complete INTEGER NOT NULL DEFAULT 0, error_code TEXT, upload_path TEXT, attachment_hash TEXT, payload_hash TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), stage TEXT NOT NULL, outcome TEXT NOT NULL, error_code TEXT, at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS unique_portal ON jobs(portal_id) WHERE portal_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_invoices (
        id TEXT PRIMARY KEY, invoice_number TEXT NOT NULL, client_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL, created_date TEXT, delivery_date TEXT, task_id TEXT,
        task_status TEXT, task_complete INTEGER NOT NULL, source_status TEXT, total_cases REAL,
        active INTEGER NOT NULL, in_scope INTEGER NOT NULL, available INTEGER NOT NULL,
        revision TEXT NOT NULL, memo_key TEXT, checked_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_client ON source_invoices(client_id);
      CREATE INDEX IF NOT EXISTS source_number ON source_invoices(invoice_number);
      CREATE TABLE IF NOT EXISTS portal_invoices (
        id TEXT PRIMARY KEY, invoice_number TEXT NOT NULL, distributor_id TEXT NOT NULL,
        store_id TEXT, brand_ids TEXT NOT NULL, invoice_date TEXT, delivery_date TEXT,
        delivery_method TEXT, amount_minor INTEGER NOT NULL, currency TEXT,
        status TEXT NOT NULL, submitted_by TEXT, archived INTEGER NOT NULL,
        remote_updated_at TEXT, available INTEGER NOT NULL, checked_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS portal_number ON portal_invoices(distributor_id,invoice_number);
      CREATE TABLE IF NOT EXISTS source_clients (id TEXT PRIMARY KEY, chain_id TEXT, classification TEXT, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_products (id TEXT PRIMARY KEY, supplier_id TEXT, source_brand_id TEXT, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoice_lines (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, product_id TEXT NOT NULL,
        quantity REAL NOT NULL, amount_minor INTEGER NOT NULL, revision TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS lines_invoice ON invoice_lines(invoice_id);
      CREATE TABLE IF NOT EXISTS line_checks (invoice_id TEXT PRIMARY KEY, revision TEXT NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_lookups (invoice_number TEXT PRIMARY KEY, source_ids TEXT NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoice_links (
        source_id TEXT NOT NULL, portal_id TEXT NOT NULL, distributor_id TEXT NOT NULL,
        method TEXT NOT NULL, differences TEXT NOT NULL, available INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(source_id,portal_id));
      CREATE TABLE IF NOT EXISTS mapping_evidence (
        owner_id TEXT NOT NULL, field TEXT NOT NULL, method TEXT NOT NULL,
        source_ids TEXT NOT NULL, portal_ids TEXT NOT NULL, target_ids TEXT NOT NULL,
        checked_at TEXT NOT NULL, PRIMARY KEY(owner_id,field,method,target_ids));
      CREATE VIEW IF NOT EXISTS client_invoice_links AS
        SELECT s.client_id,s.id AS source_invoice_id,l.portal_id,p.distributor_id,p.store_id,p.delivery_method,p.status,p.archived,l.available
        FROM source_invoices s JOIN invoice_links l ON l.source_id=s.id JOIN portal_invoices p ON p.id=l.portal_id;
      CREATE VIEW IF NOT EXISTS client_destination_mappings AS
        SELECT client_id,distributor_id,store_id,delivery_method,COUNT(DISTINCT portal_id) AS evidence_count
        FROM client_invoice_links WHERE available=1 AND status IN ('approved','paid')
        GROUP BY client_id,distributor_id,store_id,delivery_method;
      DROP VIEW IF EXISTS product_brand_mappings;
      CREATE VIEW product_brand_mappings AS
        SELECT lines.product_id,brands.value AS portal_brand_id,COUNT(DISTINCT p.id) AS evidence_count
        FROM invoice_lines lines JOIN invoice_links links ON links.source_id=lines.invoice_id
        JOIN portal_invoices p ON p.id=links.portal_id JOIN json_each(p.brand_ids) brands
        WHERE links.available=1 AND p.status IN ('approved','paid') AND json_array_length(p.brand_ids)=1
          AND (lines.quantity>0 OR lines.amount_minor>0)
        GROUP BY lines.product_id,brands.value;`);
    const sourceColumns = new Set(
      this.db
        .prepare('PRAGMA table_info(source_invoices)')
        .all()
        .map((r) => r.name),
    );
    if (!sourceColumns.has('on_hold'))
      this.db.exec('ALTER TABLE source_invoices ADD COLUMN on_hold INTEGER NOT NULL DEFAULT 0');
    if (!sourceColumns.has('term_id'))
      this.db.exec('ALTER TABLE source_invoices ADD COLUMN term_id TEXT');
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db
      .prepare(
        "UPDATE jobs SET status='attention', error_code='INTERRUPTED' WHERE status IN ('queued','processing')",
      )
      .run();
  }
  get(id: string) {
    return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as unknown as
      StoredJob | undefined;
  }
  all() {
    return this.db.prepare('SELECT * FROM jobs').all() as unknown as StoredJob[];
  }
  ensure(id: string, number: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO jobs(id,invoice_number,updated_at) VALUES(?,?,?)')
      .run(id, number, new Date().toISOString());
  }
  patch(id: string, values: Partial<Omit<StoredJob, 'id' | 'invoice_number'>>) {
    const allowed = new Set([
      'portal_id',
      'distributor_id',
      'status',
      'stage',
      'portal_verified',
      'task_complete',
      'error_code',
      'upload_path',
      'attachment_hash',
      'payload_hash',
    ]);
    const entries = Object.entries(values).filter(([key]) => allowed.has(key));
    if (!entries.length) return;
    this.db
      .prepare(
        `UPDATE jobs SET ${entries.map(([k]) => `${k}=?`).join(',')},updated_at=? WHERE id=?`,
      )
      .run(...entries.map(([, v]) => v ?? null), new Date().toISOString(), id);
  }
  event(id: string, stage: Stage, outcome: string, errorCode?: string) {
    this.db
      .prepare('INSERT INTO events(job_id,stage,outcome,error_code,at) VALUES(?,?,?,?,?)')
      .run(id, stage, outcome, errorCode ?? null, new Date().toISOString());
  }
  events(id: string): JobEvent[] {
    return (
      this.db
        .prepare(
          'SELECT stage,outcome,error_code,at FROM events WHERE job_id=? ORDER BY id DESC LIMIT 15',
        )
        .all(id) as { stage: Stage; outcome: string; error_code: string | null; at: string }[]
    ).map((r) => ({
      stage: r.stage,
      outcome: r.outcome,
      at: r.at,
      ...(r.error_code ? { errorCode: r.error_code } : {}),
    }));
  }
  catalog(): CatalogCache & {
    accountId?: string;
    lineChecks: { invoiceId: string; revision: string }[];
  } {
    const sourceRows = this.db.prepare('SELECT * FROM source_invoices').all() as Record<
      string,
      any
    >[];
    const sources: SourceInvoice[] = sourceRows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      clientId: r.client_id,
      clientName: `Client ${r.client_id}`,
      memo: '',
      memoKey: r.memo_key ?? '',
      amountMinor: r.amount_minor,
      createdDate: r.created_date ?? '',
      deliveryDate: r.delivery_date ?? '',
      taskId: r.task_id,
      taskStatus: r.task_status ?? '',
      taskComplete: !!r.task_complete,
      sourceStatus: r.source_status ?? '',
      totalCases: r.total_cases ?? undefined,
      active: !!r.active,
      inScope: !!r.in_scope,
      available: !!r.available,
      onHold: !!r.on_hold,
      termId: r.term_id ?? null,
      revision: r.revision,
    }));
    const lines = (
      this.db.prepare('SELECT * FROM invoice_lines').all() as Record<string, any>[]
    ).map((r) => ({
      id: r.id,
      invoiceId: r.invoice_id,
      productId: r.product_id,
      quantity: r.quantity,
      amountMinor: r.amount_minor,
      revision: r.revision,
    }));
    const products: SourceProduct[] = (
      this.db.prepare('SELECT * FROM source_products').all() as Record<string, any>[]
    ).map((r) => ({
      id: r.id,
      name: '',
      supplierId: r.supplier_id,
      supplierName: '',
      sourceBrandId: r.source_brand_id,
      sourceBrandName: '',
    }));
    const lookups = (
      this.db.prepare('SELECT * FROM source_lookups').all() as Record<string, any>[]
    ).map((r) => ({
      invoiceNumber: r.invoice_number,
      sourceIds: JSON.parse(r.source_ids),
      checkedAt: r.checked_at,
    }));
    const lineChecks = (
      this.db.prepare('SELECT * FROM line_checks').all() as Record<string, any>[]
    ).map((r) => ({ invoiceId: r.invoice_id, revision: r.revision }));
    const account = this.db
      .prepare("SELECT value FROM catalog_meta WHERE key='account_id'")
      .get() as { value: string } | undefined;
    return { sources, lines, products, lookups, lineChecks, accountId: account?.value };
  }
  links(): InvoiceLink[] {
    return (this.db.prepare('SELECT * FROM invoice_links').all() as Record<string, any>[]).map(
      (r) => ({
        sourceId: r.source_id,
        portalId: r.portal_id,
        distributorId: r.distributor_id,
        method: 'invoice_number',
        differences: JSON.parse(r.differences),
      }),
    );
  }
  recordVerifiedLink(sourceId: string, p: PortalInvoice) {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO portal_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        p.id,
        p.invoiceNumber,
        p.distributorId,
        p.storeId,
        JSON.stringify(p.brandIds),
        p.invoiceDate,
        p.deliveryDate,
        p.deliveryMethod,
        p.amountMinor,
        p.currency ?? 'USD',
        p.status,
        p.submittedBy,
        p.archived ? 1 : 0,
        p.updatedAt ?? null,
        1,
        now,
      );
    this.db
      .prepare(
        `INSERT INTO invoice_links VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,portal_id) DO UPDATE SET available=1,differences='[]',checked_at=excluded.checked_at`,
      )
      .run(sourceId, p.id, p.distributorId, 'invoice_number', '[]', 1, now, now);
  }
  saveCatalog(
    snapshot: Snapshot,
    links: InvoiceLink[],
    clients: ClientSummary[],
    evidence: Map<string, MappingEvidence[]>,
  ) {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          "INSERT INTO catalog_meta(key,value) VALUES('account_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(snapshot.userId);
      this.db
        .prepare(
          "INSERT INTO catalog_meta(key,value) VALUES('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(now);
      const putSource = this.db.prepare(
        `INSERT OR REPLACE INTO source_invoices(id,invoice_number,client_id,amount_minor,created_date,delivery_date,task_id,task_status,task_complete,source_status,total_cases,active,in_scope,available,revision,memo_key,checked_at,on_hold,term_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const s of snapshot.sources)
        putSource.run(
          s.id,
          s.invoiceNumber,
          s.clientId,
          s.amountMinor,
          s.createdDate,
          s.deliveryDate,
          s.taskId,
          s.taskStatus ?? null,
          s.taskComplete ? 1 : 0,
          s.sourceStatus ?? null,
          s.totalCases ?? null,
          s.active === false ? 0 : 1,
          s.inScope ? 1 : 0,
          s.available === false ? 0 : 1,
          s.revision,
          s.memoKey ?? null,
          now,
          s.onHold ? 1 : 0,
          s.termId ?? null,
        );
      this.db.prepare('UPDATE portal_invoices SET available=0').run();
      const putPortal = this.db.prepare(
        'INSERT OR REPLACE INTO portal_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      for (const p of snapshot.portals)
        putPortal.run(
          p.id,
          p.invoiceNumber,
          p.distributorId,
          p.storeId,
          JSON.stringify(p.brandIds),
          p.invoiceDate,
          p.deliveryDate,
          p.deliveryMethod,
          p.amountMinor,
          p.currency ?? 'USD',
          p.status,
          p.submittedBy,
          p.archived ? 1 : 0,
          p.updatedAt ?? null,
          1,
          now,
        );
      const putClient = this.db.prepare('INSERT OR REPLACE INTO source_clients VALUES(?,?,?,?)');
      for (const c of clients) putClient.run(c.id, c.chainId, c.classification, now);
      const putProduct = this.db.prepare('INSERT OR REPLACE INTO source_products VALUES(?,?,?,?)');
      for (const p of snapshot.products ?? [])
        putProduct.run(p.id, p.supplierId, p.sourceBrandId, now);
      const putLine = this.db.prepare('INSERT OR REPLACE INTO invoice_lines VALUES(?,?,?,?,?,?)');
      const checkedSources = new Set(
        (
          snapshot.lineChecks ??
          snapshot.lines?.map((l) => ({ invoiceId: l.invoiceId, revision: l.revision })) ??
          []
        ).map((l) => l.invoiceId),
      );
      for (const id of checkedSources)
        this.db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(id);
      for (const l of snapshot.lines ?? [])
        putLine.run(l.id, l.invoiceId, l.productId, l.quantity, l.amountMinor, l.revision);
      const putCheck = this.db.prepare('INSERT OR REPLACE INTO line_checks VALUES(?,?,?)');
      for (const id of checkedSources) {
        const s = snapshot.sources.find((s) => s.id === id);
        const check = snapshot.lineChecks?.find((c) => c.invoiceId === id);
        if (s) putCheck.run(id, check?.revision ?? s.revision, now);
      }
      const putLookup = this.db.prepare('INSERT OR REPLACE INTO source_lookups VALUES(?,?,?)');
      for (const l of snapshot.lookups ?? [])
        putLookup.run(l.invoiceNumber, JSON.stringify(l.sourceIds), l.checkedAt);
      this.db.prepare('UPDATE invoice_links SET available=0').run();
      const putLink = this.db.prepare(
        `INSERT INTO invoice_links VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,portal_id) DO UPDATE SET distributor_id=excluded.distributor_id,differences=excluded.differences,available=1,checked_at=excluded.checked_at`,
      );
      for (const l of links)
        putLink.run(
          l.sourceId,
          l.portalId,
          l.distributorId,
          l.method,
          JSON.stringify(l.differences),
          1,
          now,
          now,
        );
      const putEvidence = this.db.prepare(
        'INSERT OR REPLACE INTO mapping_evidence VALUES(?,?,?,?,?,?,?)',
      );
      this.db.prepare('DELETE FROM mapping_evidence').run();
      for (const [id, rows] of evidence)
        for (const e of rows)
          putEvidence.run(
            id,
            e.field,
            e.method,
            JSON.stringify(e.sourceIds),
            JSON.stringify(e.portalIds),
            JSON.stringify(e.targetIds),
            now,
          );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
