import type { Adapter, Snapshot } from './adapter.ts';
import type { CatalogCache, Draft, PortalInvoice, SourceInvoice } from '../shared/types.ts';
import { AppError, digest, moneyMinor } from './domain.ts';
const shift = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export class DemoAdapter implements Adapter {
  userId = 'demo-rep';
  submitted = 0;
  completionAttempts = 0;
  faults = new Map<string, 'submit_response_lost' | 'minimum'>();
  snapshot: Snapshot;
  constructor(private delay = 350) {
    const clients = [
      'Cedar & Co.',
      'North Park Market',
      'Willow Collective',
      'Fieldwork Supply',
      'Juniper Trading',
      'Oak Street Market',
    ];
    const brands = [
      { id: 'brand-1', name: 'Golden Hour' },
      { id: 'brand-2', name: 'Wildflower' },
      { id: 'brand-3', name: 'Sunday Goods' },
    ];
    const sources: SourceInvoice[] = Array.from({ length: 24 }, (_, i) => ({
      id: `demo-${i + 1}`,
      invoiceNumber: `DEMO-${1048 + i}`,
      clientId: `client-${i % 6}`,
      clientName: clients[i % 6],
      memo: i === 4 ? 'New seasonal order' : brands[i % 3].name,
      amountMinor: [128000, 45600, 237600, 89600, 163200, 72000, 31200, 218400][i % 8],
      createdDate: shift(-(i % 7)),
      deliveryDate: shift(1 + (i % 4)),
      taskId: `task-${i + 1}`,
      taskComplete: i >= 16,
      inScope: true,
      active: true,
      available: true,
      onHold: i === 14,
      termId: i === 14 ? 'hold-term' : 'net-term',
      termName: i === 14 ? 'ON HOLD' : 'NET 30',
      sourceStatus: 'New',
      taskStatus: i >= 16 ? '4' : '19',
      totalCases: 12,
      routeName: `Sample route ${(i % 3) + 1}`,
      offDayDelivery: false,
      openBalanceMinor: [128000, 45600, 237600, 89600, 163200, 72000, 31200, 218400][i % 8],
      openCreditMinor: 0,
      revision: digest(`demo-${i + 1}`),
    }));
    const portals: PortalInvoice[] = sources
      .filter((_, i) => i >= 16 || i === 8)
      .map((s) => ({
        id: `portal-${s.id}`,
        invoiceNumber: s.invoiceNumber,
        distributorId: 'dist-1',
        storeId: 'store-1',
        brandIds: [brands[sources.indexOf(s) % 3].id],
        deliveryMethod: 'Direct to Store',
        invoiceDate: s.createdDate,
        deliveryDate: s.deliveryDate,
        amountMinor: s.amountMinor,
        status: 'approved',
        submittedBy: this.userId,
        archived: false,
        repEditability: 'available',
        intakeStatus: 'pending',
        waitingOnRep: false,
        creditStatus: null,
        paymentDate: null,
      }));
    this.snapshot = {
      sources,
      portals,
      clients: clients.map((name, i) => ({
        id: `client-${i}`,
        name,
        chainId: 'chain-demo',
        chainName: 'Sample stores',
      })),
      products: brands.map((brand, i) => ({
        id: `product-${i}`,
        name: `${brand.name} sample product`,
        supplierId: `supplier-${i}`,
        supplierName: brand.name,
        sourceBrandId: null,
        sourceBrandName: '',
      })),
      lines: sources.map((s, i) => ({
        id: `line-${s.id}`,
        invoiceId: s.id,
        productId: `product-${i % 3}`,
        quantity: 12,
        amountMinor: s.amountMinor,
        revision: s.revision,
      })),
      userId: this.userId,
      options: {
        distributors: [{ id: 'dist-1', name: 'Demo Distribution' }],
        brands,
        stores: [
          { id: 'store-1', name: 'North Park' },
          { id: 'store-2', name: 'Cedar Heights' },
          { id: 'store-3', name: 'Willow Creek' },
        ],
      },
    };
    this.faults.set('demo-6', 'minimum');
  }
  private wait() {
    return new Promise((r) => setTimeout(r, this.delay));
  }
  async connect() {
    await this.wait();
  }
  async verifyAccount(_draft: Draft) {}
  async discover(cache?: CatalogCache) {
    await this.wait();
    const snapshot = structuredClone(this.snapshot);
    snapshot.lineChecks = snapshot.sources.map((s) => ({
      invoiceId: s.id,
      revision: `lines-v2:${s.revision}`,
    }));
    const reused = snapshot.lineChecks.filter((c) =>
      cache?.lineChecks?.some(
        (before) => before.invoiceId === c.invoiceId && before.revision === c.revision,
      ),
    ).length;
    snapshot.metrics = {
      sourceLookups: 0,
      cachedLookups: snapshot.portals.length,
      lineInvoicesFetched: snapshot.sources.length - reused,
      lineInvoicesReused: reused,
    };
    return snapshot;
  }
  async source(id: string) {
    const s = this.snapshot.sources.find((s) => s.id === id);
    if (!s) throw new AppError('OUT_OF_SCOPE');
    return structuredClone(s);
  }
  async findPortal(number: string, distributorId: string) {
    await this.wait();
    return structuredClone(
      this.snapshot.portals.filter(
        (p) => p.invoiceNumber === number && p.distributorId === distributorId,
      ),
    );
  }
  async portal(id: string) {
    const p = this.snapshot.portals.find((p) => p.id === id);
    if (!p) throw new AppError('VERIFICATION_FAILED');
    return structuredClone(p);
  }
  async duplicate(number: string, distributorId: string) {
    return !!(await this.findPortal(number, distributorId)).length;
  }
  async pdf(id: string) {
    const s = await this.source(id);
    const text = `BT /F1 20 Tf 50 750 Td (DEMO INVOICE) Tj 0 -50 Td /F1 12 Tf (${s.invoiceNumber}) Tj 0 -25 Td (${s.clientName}) Tj 0 -25 Td (Total USD ${(s.amountMinor / 100).toFixed(2)}) Tj 0 -40 Td (Synthetic data - no real invoice will be processed.) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, o] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf);
  }
  async upload(_path: string, _bytes: Buffer) {
    await this.wait();
  }
  async submit(number: string, draft: Draft, _path: string) {
    await this.wait();
    if (await this.duplicate(number, draft.distributorId)) throw new AppError('DUPLICATE_CONFLICT');
    const s = this.snapshot.sources.find((s) => s.invoiceNumber === number)!;
    const id = `portal-${s.id}`;
    this.submitted++;
    this.snapshot.portals.push({
      id,
      invoiceNumber: number,
      distributorId: draft.distributorId,
      storeId: draft.storeId,
      brandIds: draft.brandIds,
      deliveryMethod: draft.deliveryMethod,
      invoiceDate: draft.invoiceDate,
      deliveryDate: draft.deliveryDate,
      amountMinor: moneyMinor(draft.amount),
      status: 'submitted',
      submittedBy: this.userId,
      archived: false,
      attachmentPaths: [_path],
    });
    if (this.faults.get(s.id) === 'submit_response_lost') {
      this.faults.delete(s.id);
      throw new AppError('SUBMIT_UNCERTAIN');
    }
    return id;
  }
  async complete(id: string, taskId: string | null, revision: string) {
    await this.wait();
    this.completionAttempts++;
    if (this.faults.get(id) === 'minimum') throw new AppError('MINIMUM_NOT_MET');
    const s = this.snapshot.sources.find((s) => s.id === id)!;
    if (s.revision !== revision) throw new AppError('SOURCE_CHANGED');
    if (s.taskId !== taskId) throw new AppError('TASK_CHANGED');
    s.taskComplete = true;
    s.taskStatus = '4';
  }
  async close() {}
}
