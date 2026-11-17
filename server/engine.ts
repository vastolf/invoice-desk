import { randomUUID } from 'node:crypto';
import type { Adapter, Snapshot } from './adapter.ts';
import type {
  ClientSummary,
  InvoiceRow,
  ProcessItem,
  ReconciliationSummary,
  Stage,
  State,
} from '../shared/types.ts';
import {
  AppError,
  digest,
  draftSchema,
  moneyMinor,
  samePortal,
  validateAssignments,
} from './domain.ts';
import { Store } from './store.ts';
import { reconcile } from './reconciliation.ts';
export class Engine {
  rows = new Map<string, InvoiceRow>();
  snapshot?: Snapshot;
  connected = false;
  syncing = false;
  lastSync: string | null = null;
  connectionError: string | null = null;
  queue: ProcessItem[] = [];
  running = false;
  paused = false;
  activeId: string | null = null;
  batchTotal = 0;
  batchFinished = 0;
  closing = false;
  onChange = () => {};
  clients: ClientSummary[] = [];
  reconciliation?: ReconciliationSummary;
  constructor(
    public adapter: Adapter,
    public store: Store,
    public mode: 'demo' | 'live',
  ) {}
  state(): State {
    return {
      mode: this.mode,
      connected: this.connected,
      syncing: this.syncing,
      lastSync: this.lastSync,
      connectionError: this.connectionError,
      rows: [...this.rows.values()],
      options: this.snapshot?.options ?? { distributors: [], brands: [], stores: [] },
      clients: this.clients.map((client) => {
        const records = [...this.rows.values()].filter((r) => r.clientId === client.id);
        return {
          ...client,
          pendingCount: records.filter(
            (r) =>
              r.inScope &&
              ['submit', 'complete'].includes(r.workNeeded ?? '') &&
              r.status !== 'completed',
          ).length,
          completedCount: records.filter((r) => r.inScope && r.status === 'completed').length,
          portalInvoiceIds: [
            ...new Set([
              ...client.portalInvoiceIds,
              ...records.flatMap((r) => (r.portalId ? [r.portalId] : [])),
            ]),
          ],
        };
      }),
      reconciliation: this.reconciliation,
      worker: {
        running: this.running,
        paused: this.paused,
        queued: this.queue.length,
        activeId: this.activeId,
        batchTotal: this.batchTotal,
        batchFinished: this.batchFinished,
      },
    };
  }
  emit() {
    this.onChange();
  }
  async sync(reconnect = false) {
    if (this.syncing || this.running || (this.queue.length && !(reconnect && this.paused)))
      throw new AppError('WORKER_BUSY');
    this.syncing = true;
    this.connectionError = null;
    this.emit();
    try {
      if (reconnect) {
        await this.adapter.close();
        this.connected = false;
      }
      const cache = this.store.catalog();
      const snapshot = await this.adapter.discover(cache);
      if (cache.accountId && cache.accountId !== snapshot.userId)
        throw new AppError('ACCOUNT_CHANGED');
      const previous = this.store.links();
      for (const job of this.store.all())
        if (
          job.portal_id &&
          !previous.some((l) => l.sourceId === job.id && l.portalId === job.portal_id)
        )
          previous.push({
            sourceId: job.id,
            portalId: job.portal_id,
            distributorId: job.distributor_id ?? '',
            method: 'invoice_number',
            differences: [],
          });
      const result = reconcile(snapshot, previous);
      this.store.saveCatalog(snapshot, result.links, result.clients, result.evidence);
      this.snapshot = snapshot;
      this.connected = true;
      this.clients = result.clients;
      const next = new Map<string, InvoiceRow>();
      const portalReferences = new Map<string, number>();
      for (const link of result.links)
        portalReferences.set(link.portalId, (portalReferences.get(link.portalId) ?? 0) + 1);
      const products = new Map((snapshot.products ?? []).map((p) => [p.id, p]));
      for (const item of result.records) {
        const { source, portal, draft, client } = item;
        this.store.ensure(source.id, source.invoiceNumber);
        const before = this.store.get(source.id)!;
        const completed = item.classification === 'completed';
        const status =
          before.status === 'attention' && ['pending', 'review'].includes(item.classification)
            ? 'attention'
            : item.classification;
        const bind = portal && portalReferences.get(portal.id) === 1;
        this.store.patch(source.id, {
          status,
          task_complete: source.taskComplete ? 1 : 0,
          ...(bind
            ? { portal_id: portal.id, portal_verified: 1, distributor_id: portal.distributorId }
            : {}),
          ...(completed ? { stage: 'done', error_code: null } : {}),
          ...(before.error_code === 'SOURCE_ON_HOLD' && !source.onHold ? { error_code: null } : {}),
        });
        const stored = this.store.get(source.id)!;
        const inactive = ['excluded', 'unclassified'].includes(status);
        next.set(source.id, {
          id: source.id,
          invoiceNumber: source.invoiceNumber,
          clientId: source.clientId,
          clientName: client.name,
          memo: source.memo,
          amountMinor: source.amountMinor,
          invoiceDate: draft.invoiceDate,
          deliveryDate: draft.deliveryDate || source.deliveryDate,
          brands: draft.brandIds.map(
            (id) => snapshot.options.brands.find((b) => b.id === id)?.name ?? 'Unavailable brand',
          ),
          storeName:
            snapshot.options.stores.find((s) => s.id === draft.storeId)?.name ??
            (draft.deliveryMethod === 'CK Distribution'
              ? 'Warehouse'
              : inactive
                ? '—'
                : 'Destination unresolved'),
          draft,
          revision: source.revision,
          status,
          stage: completed ? 'done' : stored.stage,
          portalId: portal?.id ?? stored.portal_id,
          portalStatus: portal?.status ?? null,
          portalVerified: !!portal,
          taskComplete: source.taskComplete,
          inScope: source.inScope,
          issues: item.issues,
          errorCode: ['pending', 'review', 'attention'].includes(status) ? stored.error_code : null,
          updatedAt: stored.updated_at,
          events: this.store.events(source.id),
          workNeeded: item.workNeeded,
          applicability: client.classification,
          sourceAvailable: source.available !== false,
          sourceActive: source.active !== false,
          pdfAvailable: !!source.pdfLink || this.mode === 'demo',
          sourceStatus: source.sourceStatus,
          taskStatus: source.taskStatus,
          taskId: source.taskId,
          termName: source.termName,
          routeName: source.routeName,
          offDayDelivery: source.offDayDelivery,
          totalCases: source.totalCases,
          openBalanceMinor: source.openBalanceMinor,
          openCreditMinor: source.openCreditMinor,
          ...(snapshot.lineChecks?.some((c) => c.invoiceId === source.id) ||
          snapshot.lines?.some((l) => l.invoiceId === source.id)
            ? { lineCount: snapshot.lines?.filter((l) => l.invoiceId === source.id).length ?? 0 }
            : {}),
          intakeStatus: portal?.intakeStatus,
          creditStatus: portal?.creditStatus,
          waitingOnRep: portal?.waitingOnRep,
          paymentDate: portal?.paymentDate,
          acceptedAt: portal?.acceptedAt,
          portalArchived: portal?.archived,
          attachmentCount: portal?.attachmentPaths?.length,
          onHold: !!source.onHold,
          portalEditability: portal?.repEditability,
          canProcess: item.canProcess,
          mappingEvidence: item.evidence.map((e) => ({
            ...e,
            count: e.sourceIds.length,
            sourceIds: e.sourceIds.slice(0, 5),
            portalIds: e.portalIds.slice(0, 5),
          })),
          differences: item.differences,
          sourceValues: {
            createdDate: source.createdDate,
            deliveryDate: source.deliveryDate,
            amountMinor: source.amountMinor,
          },
          lines: (snapshot.lines ?? [])
            .filter((l) => l.invoiceId === source.id)
            .map((l) => ({
              ...l,
              name: products.get(l.productId)?.name ?? `Product ${l.productId}`,
            })),
        });
      }
      for (const portal of snapshot.portals)
        if (!result.pairedPortalIds.has(portal.id)) {
          const id = `portal:${portal.id}`;
          next.set(id, {
            id,
            invoiceNumber: portal.invoiceNumber,
            clientName:
              snapshot.options.stores.find((s) => s.id === portal.storeId)?.name ?? 'Warehouse',
            memo: '',
            amountMinor: portal.amountMinor,
            invoiceDate: portal.invoiceDate,
            deliveryDate: portal.deliveryDate,
            brands: portal.brandIds.map(
              (id) => snapshot.options.brands.find((b) => b.id === id)?.name ?? 'Unavailable brand',
            ),
            storeName:
              snapshot.options.stores.find((s) => s.id === portal.storeId)?.name ?? 'Warehouse',
            draft: {
              distributorId: portal.distributorId,
              brandIds: portal.brandIds,
              storeId: portal.storeId,
              deliveryMethod: portal.deliveryMethod as any,
              invoiceDate: portal.invoiceDate,
              deliveryDate: portal.deliveryDate,
              amount: (portal.amountMinor / 100).toFixed(2),
            },
            revision: '',
            status: 'portal_only',
            stage: 'idle',
            portalId: portal.id,
            portalStatus: portal.status,
            portalVerified: true,
            portalEditability: portal.repEditability,
            taskComplete: false,
            inScope: portal.submittedBy === snapshot.userId,
            issues: ['No Encompass record was found for this portal invoice number.'],
            errorCode: null,
            updatedAt: portal.updatedAt ?? new Date().toISOString(),
            events: [],
            workNeeded: 'unknown',
            sourceAvailable: false,
            sourceActive: false,
            pdfAvailable: false,
            intakeStatus: portal.intakeStatus,
            creditStatus: portal.creditStatus,
            waitingOnRep: portal.waitingOnRep,
            paymentDate: portal.paymentDate,
            acceptedAt: portal.acceptedAt,
            portalArchived: portal.archived,
            attachmentCount: portal.attachmentPaths?.length,
            canProcess: false,
          });
        }
      for (const item of this.queue) {
        const row = next.get(item.id);
        if (row) {
          row.status = 'queued';
          row.draft = item.draft;
        }
      }
      this.rows = next;
      this.reconciliation = {
        sourceInvoices: snapshot.sources.length,
        portalInvoices: snapshot.portals.length,
        linkedInvoices: result.links.length,
        clients: result.clients.length,
        products: snapshot.products?.length ?? 0,
        lineItems: snapshot.lines?.length ?? 0,
        portalWithoutSource: snapshot.portals.length - result.pairedPortalIds.size,
        ...(snapshot.metrics ?? {
          sourceLookups: 0,
          cachedLookups: 0,
          lineInvoicesFetched: 0,
          lineInvoicesReused: 0,
        }),
      };
      this.lastSync = new Date().toISOString();
    } catch (error) {
      this.connected = false;
      this.connectionError = error instanceof AppError ? error.code : 'CONNECTION_FAILED';
      throw new AppError(this.connectionError);
    } finally {
      this.syncing = false;
      this.emit();
    }
  }
  enqueue(items: ProcessItem[]) {
    if (!this.connected || !this.snapshot) throw new AppError('AUTH_REQUIRED');
    if (this.syncing) throw new AppError('WORKER_BUSY');
    const ids = new Set<string>();
    for (const item of items) {
      const row = this.rows.get(item.id);
      if (!row || !row.inScope) throw new AppError('OUT_OF_SCOPE');
      if (row.onHold) throw new AppError('SOURCE_ON_HOLD');
      if (row.canProcess === false) throw new AppError('NOT_ACTIONABLE');
      if (row.revision !== item.revision) throw new AppError('SOURCE_CHANGED');
      if (ids.has(item.id) || ['queued', 'processing', 'completed'].includes(row.status))
        throw new AppError('WORKER_BUSY');
      ids.add(item.id);
      const expected = row.workNeeded === 'complete' ? 'complete' : 'submit';
      if (item.action && item.action !== expected) throw new AppError('SOURCE_CHANGED');
      item.action = expected;
      if (expected === 'submit') {
        draftSchema.parse(item.draft);
        validateAssignments(item.draft, this.snapshot.options);
      } else if (!row.portalId) throw new AppError('NOT_ACTIONABLE');
    }
    if (!this.running && !this.queue.length) {
      this.batchTotal = 0;
      this.batchFinished = 0;
    }
    for (const item of items) {
      this.queue.push(structuredClone(item));
      const row = this.rows.get(item.id)!;
      row.status = 'queued';
      row.draft = structuredClone(item.draft);
      row.errorCode = null;
      this.store.patch(item.id, { status: 'queued' });
      this.batchTotal++;
    }
    this.emit();
    void this.drain();
  }
  pause(value: boolean) {
    if (!value && !this.connected) throw new AppError('AUTH_REQUIRED');
    this.paused = value;
    this.emit();
    if (!value) void this.drain();
  }
  cancelQueued() {
    for (const item of this.queue) {
      const r = this.rows.get(item.id)!;
      r.status = 'pending';
      this.store.patch(item.id, { status: 'pending' });
      this.batchTotal--;
    }
    this.queue = [];
    this.emit();
  }
  private stage(id: string, stage: Stage) {
    const row = this.rows.get(id)!;
    row.stage = stage;
    row.status = 'processing';
    row.updatedAt = new Date().toISOString();
    this.store.patch(id, { stage, status: 'processing' });
    this.store.event(id, stage, 'started');
    row.events = this.store.events(id);
    this.emit();
  }
  async drain() {
    if (this.running || this.paused || this.closing) return;
    this.running = true;
    this.emit();
    try {
      while (this.queue.length && !this.paused && !this.closing) {
        const item = this.queue.shift()!;
        this.activeId = item.id;
        await this.run(item);
        this.batchFinished++;
        this.activeId = null;
        this.emit();
      }
    } finally {
      this.running = false;
      this.activeId = null;
      this.emit();
    }
  }
  private async run(item: ProcessItem) {
    const row = this.rows.get(item.id)!;
    try {
      this.stage(item.id, 'validate');
      if (item.action !== 'complete') validateAssignments(item.draft, this.snapshot!.options);
      await this.adapter.verifyAccount(item.draft, item.action !== 'complete');
      const source = await this.adapter.source(item.id);
      if (!source.inScope) throw new AppError('OUT_OF_SCOPE');
      if (source.onHold) throw new AppError('SOURCE_ON_HOLD');
      if (source.available === false || source.active === false)
        throw new AppError('SOURCE_CHANGED');
      if (source.revision !== item.revision) throw new AppError('SOURCE_CHANGED');
      if (!source.taskId && !source.taskComplete) throw new AppError('TASK_MISSING');
      if (source.amountMinor !== moneyMinor(item.draft.amount))
        throw new AppError('VERIFICATION_FAILED');
      this.stage(item.id, 'duplicate');
      const found =
        item.action === 'complete' && row.portalId
          ? [await this.adapter.portal(row.portalId)]
          : await this.adapter.findPortal(source.invoiceNumber, item.draft.distributorId);
      if (found.length > 1) throw new AppError('DUPLICATE_CONFLICT');
      let portalId: string | undefined;
      if (found.length) {
        if (
          found[0].status === 'rejected' ||
          found[0].submittedBy !== this.snapshot!.userId ||
          !samePortal(found[0], item.draft, source.invoiceNumber)
        )
          throw new AppError('DUPLICATE_CONFLICT');
        portalId = found[0].id;
      }
      const stored = this.store.get(item.id)!;
      if (stored.portal_id && !portalId) throw new AppError('VERIFICATION_FAILED');
      if (!portalId) {
        if (item.action === 'complete') throw new AppError('VERIFICATION_FAILED');
        if (!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(source.invoiceNumber))
          throw new AppError('MAPPING_REQUIRED');
        if (await this.adapter.duplicate(source.invoiceNumber, item.draft.distributorId))
          throw new AppError('DUPLICATE_UNVERIFIED');
        this.stage(item.id, 'upload');
        const bytes = await this.adapter.pdf(item.id);
        const attachmentHash = digest(bytes),
          payloadHash = digest({ number: source.invoiceNumber, draft: item.draft });
        const latest = await this.adapter.source(item.id);
        if (latest.onHold) throw new AppError('SOURCE_ON_HOLD');
        if (latest.revision !== item.revision) throw new AppError('SOURCE_CHANGED');
        if (
          stored.payload_hash &&
          stored.payload_hash !== payloadHash &&
          ['SUBMIT_UNCERTAIN', 'INTERRUPTED'].includes(stored.error_code ?? '')
        )
          throw new AppError('SUBMIT_UNCERTAIN');
        const reuse =
          stored.payload_hash === payloadHash && stored.attachment_hash === attachmentHash;
        const path =
          reuse && stored.upload_path
            ? stored.upload_path
            : `${item.draft.distributorId}/${randomUUID()}.pdf`;
        this.store.patch(item.id, {
          upload_path: path,
          attachment_hash: attachmentHash,
          payload_hash: payloadHash,
          distributor_id: item.draft.distributorId,
        });
        await this.adapter.upload(path, bytes);
        this.stage(item.id, 'submit');
        // Mark the uncertain boundary durably before sending a remote write.
        this.store.patch(item.id, { error_code: 'SUBMIT_UNCERTAIN' });
        try {
          portalId = await this.adapter.submit(source.invoiceNumber, item.draft, path);
        } catch (error) {
          const reconciled = await this.adapter
            .findPortal(source.invoiceNumber, item.draft.distributorId)
            .catch(() => []);
          if (
            reconciled.length === 1 &&
            reconciled[0].submittedBy === this.snapshot!.userId &&
            samePortal(reconciled[0], item.draft, source.invoiceNumber)
          )
            portalId = reconciled[0].id;
          else throw error;
        }
      }
      this.stage(item.id, 'verify');
      const verified = await this.adapter.portal(portalId);
      if (
        verified.status === 'rejected' ||
        verified.submittedBy !== this.snapshot!.userId ||
        !samePortal(verified, item.draft, source.invoiceNumber)
      )
        throw new AppError('VERIFICATION_FAILED');
      const intent = this.store.get(item.id)!;
      if (intent.upload_path && !verified.attachmentPaths?.includes(intent.upload_path))
        throw new AppError('VERIFICATION_FAILED');
      this.store.patch(item.id, {
        portal_id: portalId,
        portal_verified: 1,
        error_code: null,
        distributor_id: item.draft.distributorId,
      });
      row.portalId = portalId;
      row.portalVerified = true;
      row.portalStatus = verified.status;
      row.portalEditability = verified.repEditability;
      Object.assign(row, {
        intakeStatus: verified.intakeStatus,
        creditStatus: verified.creditStatus,
        waitingOnRep: verified.waitingOnRep,
        paymentDate: verified.paymentDate,
        acceptedAt: verified.acceptedAt,
        portalArchived: verified.archived,
        attachmentCount: verified.attachmentPaths?.length,
      });
      row.workNeeded = 'complete';
      this.store.recordVerifiedLink(source.id, verified);
      row.invoiceDate = item.draft.invoiceDate;
      row.deliveryDate = item.draft.deliveryDate;
      row.brands = item.draft.brandIds.map(
        (id) => this.snapshot!.options.brands.find((b) => b.id === id)?.name ?? 'Unassigned brand',
      );
      row.storeName =
        this.snapshot!.options.stores.find((s) => s.id === item.draft.storeId)?.name ?? 'Warehouse';
      this.store.event(item.id, 'verify', 'verified');
      this.emit();
      this.stage(item.id, 'complete_task');
      const completing = await this.adapter.source(item.id);
      if (completing.onHold) throw new AppError('SOURCE_ON_HOLD');
      if (completing.revision !== item.revision) throw new AppError('SOURCE_CHANGED');
      if (!completing.taskComplete)
        await this.adapter.complete(item.id, completing.taskId, item.revision);
      const final = await this.adapter.source(item.id);
      if (!final.taskComplete) throw new AppError('TASK_BLOCKED');
      row.taskComplete = true;
      row.status = 'completed';
      row.stage = 'done';
      row.errorCode = null;
      row.issues = [];
      row.workNeeded = 'none';
      row.canProcess = false;
      this.store.patch(item.id, {
        status: 'completed',
        stage: 'done',
        task_complete: 1,
        error_code: null,
      });
      this.store.event(item.id, 'done', 'verified');
      this.store.db
        .prepare('UPDATE source_invoices SET task_complete=1,task_status=? WHERE id=?')
        .run('4', item.id);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'REMOTE_UNAVAILABLE';
      row.status = code === 'SOURCE_ON_HOLD' ? 'held' : 'attention';
      if (code === 'SOURCE_ON_HOLD') {
        row.onHold = true;
        row.canProcess = false;
      }
      row.errorCode = code;
      this.store.patch(item.id, { status: row.status, error_code: code });
      this.store.event(item.id, row.stage, 'failed', code);
      if (['AUTH_REQUIRED', 'ACCOUNT_CHANGED'].includes(code)) {
        this.connected = false;
        this.connectionError = code;
        this.paused = true;
      }
    } finally {
      row.updatedAt = new Date().toISOString();
      row.events = this.store.events(item.id);
      this.emit();
    }
  }
  async close() {
    this.closing = true;
    this.paused = true;
    while (this.running) await new Promise((r) => setTimeout(r, 100));
    await this.adapter.close();
    this.store.close();
  }
}
