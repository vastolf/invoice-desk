import type {
  ClientSummary,
  Draft,
  InvoiceLink,
  MappingEvidence,
  PortalInvoice,
  SourceClient,
  SourceInvoice,
  SourceLine,
  SourceProduct,
  WorkNeeded,
} from '../shared/types.ts';
import type { Snapshot } from './adapter.ts';
import { digest, draftSchema, normalized } from './domain.ts';

export interface ReconciledInvoice {
  source: SourceInvoice;
  portal?: PortalInvoice;
  links: InvoiceLink[];
  client: ClientSummary;
  draft: Draft;
  issues: string[];
  differences: string[];
  evidence: MappingEvidence[];
  classification: 'pending' | 'review' | 'held' | 'completed' | 'excluded' | 'unclassified';
  workNeeded: WorkNeeded;
  canProcess: boolean;
}
type Pair = { s: SourceInvoice; p: PortalInvoice };
const numberKey = (n: string) => n.trim().toUpperCase();
const memoKey = (s: SourceInvoice) => s.memoKey || digest(normalized(s.memo));
const unique = <T>(values: T[]) => [...new Set(values)];
const evidence = (
  field: MappingEvidence['field'],
  method: MappingEvidence['method'],
  pairs: Pair[],
  targetIds: string[],
): MappingEvidence => ({
  field,
  method,
  sourceIds: unique(pairs.map((p) => p.s.id)),
  portalIds: unique(pairs.map((p) => p.p.id)),
  targetIds,
});
function difference(s: SourceInvoice, p: PortalInvoice) {
  const fields: string[] = [];
  if (numberKey(s.invoiceNumber) !== numberKey(p.invoiceNumber)) fields.push('invoice_number');
  if (s.amountMinor !== p.amountMinor) fields.push('amount');
  if (s.deliveryDate && p.deliveryDate && s.deliveryDate !== p.deliveryDate)
    fields.push('delivery_date');
  if (s.createdDate && p.invoiceDate && s.createdDate !== p.invoiceDate)
    fields.push('invoice_date');
  return fields;
}
function storeMatches(text: string, stores: { id: string; name: string }[]) {
  const compact = normalized(text);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  return stores.filter((store) => {
    if (compact.includes(normalized(store.name))) return true;
    const tokens = store.name.toLowerCase().split(/\s+/);
    return (
      tokens.length === 2 &&
      ['sac', 'wellness', 'lake', 'bay'].includes(tokens[1]) &&
      tokens[0].length >= 5 &&
      words.includes(tokens[0])
    );
  });
}
function labelBrand(label: string, brands: { id: string; name: string }[]) {
  const text = normalized(label);
  if (!text) return undefined;
  const exact = brands.filter((b) => normalized(b.name) === text);
  if (exact.length === 1) return exact[0].id;
  const prefix = brands
    .filter((b) => text.startsWith(normalized(b.name)))
    .sort((a, b) => normalized(b.name).length - normalized(a.name).length);
  if (!prefix.length) return undefined;
  return prefix.length === 1 ||
    normalized(prefix[0].name).length > normalized(prefix[1].name).length
    ? prefix[0].id
    : undefined;
}

export function reconcile(snapshot: Snapshot, previousLinks: InvoiceLink[] = []) {
  const sourceById = new Map(snapshot.sources.map((s) => [s.id, s]));
  const portalById = new Map(snapshot.portals.map((p) => [p.id, p]));
  const allowed = new Set(snapshot.options.distributors.map((d) => d.id));
  const portals = snapshot.portals.filter((p) => allowed.has(p.distributorId));
  const sourceClients = new Map((snapshot.clients ?? []).map((c) => [c.id, c]));
  for (const source of snapshot.sources)
    if (!sourceClients.has(source.clientId))
      sourceClients.set(source.clientId, {
        id: source.clientId,
        name: source.clientName,
        chainId: null,
        chainName: '',
      });
  const sourceNumbers = new Map<string, SourceInvoice[]>();
  for (const source of snapshot.sources) {
    const key = numberKey(source.invoiceNumber);
    sourceNumbers.set(key, [...(sourceNumbers.get(key) ?? []), source]);
  }
  const portalNumbers = new Map<string, PortalInvoice[]>();
  for (const p of portals) {
    const key = numberKey(p.invoiceNumber);
    portalNumbers.set(key, [...(portalNumbers.get(key) ?? []), p]);
  }
  const linkMap = new Map<string, InvoiceLink[]>();
  const links: InvoiceLink[] = [];
  const pairs: Pair[] = [];
  for (const s of snapshot.sources) {
    const byNumber = portalNumbers.get(numberKey(s.invoiceNumber)) ?? [];
    const byId = previousLinks
      .filter((l) => l.sourceId === s.id)
      .map((l) => portalById.get(l.portalId))
      .filter((p): p is PortalInvoice => !!p && allowed.has(p.distributorId));
    const candidates = [...new Map([...byNumber, ...byId].map((p) => [p.id, p])).values()];
    const result = candidates.map((p) => ({
      sourceId: s.id,
      portalId: p.id,
      distributorId: p.distributorId,
      method: 'invoice_number' as const,
      differences: difference(s, p),
    }));
    linkMap.set(s.id, result);
    links.push(...result);
    if (
      candidates.length === 1 &&
      (sourceNumbers.get(numberKey(s.invoiceNumber))?.length ?? 0) === 1 &&
      numberKey(candidates[0].invoiceNumber) === numberKey(s.invoiceNumber)
    )
      pairs.push({ s, p: candidates[0] });
  }
  const training = pairs.filter((x) => ['approved', 'paid'].includes(x.p.status));
  const clientPairs = new Map<string, Pair[]>();
  for (const pair of pairs)
    clientPairs.set(pair.s.clientId, [...(clientPairs.get(pair.s.clientId) ?? []), pair]);
  const chainEvidence = new Map<string, Pair[]>();
  for (const pair of training) {
    const chain = sourceClients.get(pair.s.clientId)?.chainId;
    if (chain) chainEvidence.set(chain, [...(chainEvidence.get(chain) ?? []), pair]);
  }
  const targetChains = new Set(
    [...chainEvidence].filter(([, p]) => p.length >= 2).map(([id]) => id),
  );
  const linesByInvoice = new Map<string, SourceLine[]>();
  for (const line of snapshot.lines ?? [])
    linesByInvoice.set(line.invoiceId, [...(linesByInvoice.get(line.invoiceId) ?? []), line]);
  const productById = new Map((snapshot.products ?? []).map((p) => [p.id, p]));
  const productFacts = new Map<string, Pair[]>(),
    supplierFacts = new Map<string, Pair[]>();
  for (const pair of training) {
    if (pair.p.brandIds.length !== 1) continue;
    for (const line of linesByInvoice.get(pair.s.id) ?? []) {
      if (line.quantity <= 0 && line.amountMinor <= 0) continue;
      productFacts.set(line.productId, [...(productFacts.get(line.productId) ?? []), pair]);
      const supplier = productById.get(line.productId)?.supplierId;
      if (supplier) supplierFacts.set(supplier, [...(supplierFacts.get(supplier) ?? []), pair]);
    }
  }
  const summaries: ClientSummary[] = [...sourceClients.values()].map((c) => {
    const clientSources = snapshot.sources.filter((s) => s.clientId === c.id),
      history = clientPairs.get(c.id) ?? [];
    const classification: ClientSummary['classification'] = history.length
      ? 'established'
      : c.chainId && targetChains.has(c.chainId)
        ? 'same_chain'
        : c.chainId && targetChains.size
          ? 'other_chain'
          : 'unclassified';
    const ids = unique(history.flatMap((x) => (x.p.storeId ? [x.p.storeId] : [])));
    return {
      id: c.id,
      name: c.name,
      chainId: c.chainId,
      chainName: c.chainName,
      classification,
      sourceInvoiceIds: clientSources.map((s) => s.id),
      portalInvoiceIds: unique(history.map((x) => x.p.id)),
      evidenceCount: history.length,
      pendingCount: 0,
      completedCount: 0,
      stores: snapshot.options.stores.filter((s) => ids.includes(s.id)),
      deliveryMethods: unique(history.map((x) => x.p.deliveryMethod)),
    };
  });
  const summaryById = new Map(summaries.map((c) => [c.id, c]));
  const records: ReconciledInvoice[] = [];
  const allEvidence = new Map<string, MappingEvidence[]>();
  for (const source of snapshot.sources) {
    const client = summaryById.get(source.clientId)!,
      history = clientPairs.get(source.clientId) ?? [];
    const sourceLinks = linkMap.get(source.id) ?? [],
      portal = sourceLinks.length === 1 ? portalById.get(sourceLinks[0].portalId) : undefined;
    const differences = portal ? difference(source, portal) : [];
    const e: MappingEvidence[] = [];
    const issues: string[] = [];
    if (history.length) e.push(evidence('client', 'invoice_history', history, [source.clientId]));
    else if (client.classification === 'same_chain')
      e.push(
        evidence('client', 'customer_chain', chainEvidence.get(client.chainId!) ?? [], [
          client.chainId!,
        ]),
      );
    const trusted = history.filter((x) => x.p.status !== 'rejected');
    const distributors = unique(trusted.map((x) => x.p.distributorId));
    const distributorId =
      distributors.length === 1
        ? distributors[0]
        : snapshot.options.distributors.length === 1
          ? snapshot.options.distributors[0].id
          : '';
    const methods = unique(trusted.map((x) => x.p.deliveryMethod).filter(Boolean));
    let deliveryMethod = methods.length === 1 ? (methods[0] as Draft['deliveryMethod']) : '';
    let storeId: string | null = null;
    const exactMemo = training.filter(
      (x) => x.s.clientId === source.clientId && memoKey(x.s) === memoKey(source),
    );
    const destinations = unique(trusted.map((x) => `${x.p.deliveryMethod}/${x.p.storeId ?? ''}`));
    const memoDestinations = unique(
      exactMemo.map((x) => `${x.p.deliveryMethod}/${x.p.storeId ?? ''}`),
    );
    if (destinations.length === 1) {
      deliveryMethod = trusted[0].p.deliveryMethod as Draft['deliveryMethod'];
      storeId = trusted[0].p.storeId;
      e.push(evidence('delivery', 'invoice_history', trusted, [deliveryMethod]));
      e.push(evidence('store', 'invoice_history', trusted, storeId ? [storeId] : []));
    } else if (memoDestinations.length === 1) {
      deliveryMethod = exactMemo[0].p.deliveryMethod as Draft['deliveryMethod'];
      storeId = exactMemo[0].p.storeId;
      e.push(evidence('delivery', 'memo_history', exactMemo, [deliveryMethod]));
      e.push(evidence('store', 'memo_history', exactMemo, storeId ? [storeId] : []));
    } else {
      if (deliveryMethod)
        e.push(evidence('delivery', 'invoice_history', trusted, [deliveryMethod]));
      const fromClient = storeMatches(source.clientName, snapshot.options.stores);
      if (!deliveryMethod && client.classification === 'same_chain' && fromClient.length === 1)
        deliveryMethod = 'Direct to Store';
      if (deliveryMethod === 'Direct to Store' && fromClient.length === 1) {
        storeId = fromClient[0].id;
        e.push(evidence('store', 'client_name', [], [storeId]));
      } else if (deliveryMethod) {
        const fromMemo = storeMatches(source.memo, snapshot.options.stores);
        if (fromMemo.length === 1) {
          storeId = fromMemo[0].id;
          e.push(evidence('store', 'memo_store', [], [storeId]));
        }
      }
    }
    const resolvedBrands = new Set<string>();
    let unknownProducts = 0;
    const goods = (linesByInvoice.get(source.id) ?? []).filter(
      (l) => l.quantity > 0 || l.amountMinor > 0,
    );
    for (const line of goods) {
      const product = productById.get(line.productId);
      let id: string | undefined;
      const direct = productFacts.get(line.productId) ?? [],
        directBrands = unique(direct.flatMap((x) => x.p.brandIds));
      const productLabel = product && labelBrand(product.name, snapshot.options.brands);
      const supplierLabel = product && labelBrand(product.supplierName, snapshot.options.brands);
      if (productLabel && productLabel === supplierLabel) {
        id = productLabel;
        e.push(
          evidence(
            'brands',
            'product_label',
            direct.filter((x) => x.p.brandIds.includes(id!)),
            [id],
          ),
        );
      } else if (directBrands.length === 1) {
        id = directBrands[0];
        e.push(evidence('brands', 'product_history', direct, [id]));
      } else if (directBrands.length === 0) {
        const supplier = product?.supplierId ? (supplierFacts.get(product.supplierId) ?? []) : [],
          supplierBrands = unique(supplier.flatMap((x) => x.p.brandIds));
        if (supplierBrands.length === 1) {
          id = supplierBrands[0];
          e.push(evidence('brands', 'supplier_history', supplier, [id]));
        } else if (product) {
          id =
            labelBrand(product.name, snapshot.options.brands) ??
            labelBrand(product.sourceBrandName, snapshot.options.brands) ??
            labelBrand(product.supplierName, snapshot.options.brands);
          if (id) e.push(evidence('brands', 'product_label', [], [id]));
        }
      }
      if (id && snapshot.options.brands.some((b) => b.id === id)) resolvedBrands.add(id);
      else unknownProducts++;
    }
    const memoHistory = training.filter((x) => memoKey(x.s) === memoKey(source));
    const memoSets = unique(memoHistory.map((x) => [...x.p.brandIds].sort().join(',')));
    if ((!goods.length || unknownProducts > 0) && memoSets.length === 1 && memoSets[0]) {
      const ids = memoHistory[0].p.brandIds;
      if ([...resolvedBrands].every((id) => ids.includes(id))) {
        ids.forEach((id) => resolvedBrands.add(id));
        unknownProducts = 0;
        e.push(evidence('brands', 'memo_history', memoHistory, ids));
      }
    }
    if (!goods.length && !resolvedBrands.size) {
      const id = labelBrand(source.memo, snapshot.options.brands);
      if (id) {
        resolvedBrands.add(id);
        e.push(evidence('brands', 'product_label', [], [id]));
      }
    }
    let draft: Draft = {
      distributorId,
      brandIds: [...resolvedBrands].sort(),
      storeId,
      deliveryMethod,
      invoiceDate: source.createdDate,
      deliveryDate: source.deliveryDate,
      amount: (source.amountMinor / 100).toFixed(2),
    };
    if (portal)
      draft = {
        distributorId: portal.distributorId,
        brandIds: portal.brandIds,
        storeId: portal.storeId,
        deliveryMethod: portal.deliveryMethod as Draft['deliveryMethod'],
        invoiceDate: portal.invoiceDate,
        deliveryDate: portal.deliveryDate,
        amount: (portal.amountMinor / 100).toFixed(2),
      };
    let classification: ReconciledInvoice['classification'];
    let workNeeded: WorkNeeded = 'unknown';
    let canProcess = false;
    if (
      sourceLinks.length > 1 ||
      (sourceNumbers.get(numberKey(source.invoiceNumber))?.length ?? 0) > 1
    ) {
      classification = 'review';
      issues.push('Multiple records share this invoice number.');
    } else if (portal) {
      workNeeded = source.taskComplete ? 'none' : 'complete';
      if (portal.status === 'rejected') {
        classification = 'review';
        issues.push('InvoiceApprove rejected this invoice.');
      } else if (source.taskComplete) {
        classification = 'completed';
      } else if (source.available === false) {
        classification = 'review';
        issues.push('The linked Encompass invoice is no longer available.');
      } else if (portal.submittedBy !== snapshot.userId) {
        classification = 'review';
        issues.push('The portal invoice belongs to another rep.');
      } else if (differences.includes('amount') || differences.includes('invoice_number')) {
        classification = 'review';
        issues.push('The linked invoice has changed. Compare the records before completion.');
      } else if (!source.inScope) {
        classification = 'review';
        issues.push('The sales task is assigned outside this account.');
      } else if (!source.taskId || source.active === false) {
        classification = 'review';
        issues.push(
          !source.taskId
            ? 'No Encompass sales task is linked.'
            : 'Encompass has closed or delivered this invoice, but its sales task is still open.',
        );
      } else {
        classification = 'pending';
        canProcess = true;
      }
    } else if (previousLinks.some((l) => l.sourceId === source.id)) {
      classification = 'review';
      issues.push('A previously linked portal record is missing from the current account.');
    } else if (client.classification === 'other_chain') {
      classification = 'excluded';
      workNeeded = 'none';
      issues.push('This customer chain has no established InvoiceApprove relationship.');
    } else if (client.classification === 'unclassified') {
      classification = 'unclassified';
      issues.push('No invoice history or customer-chain evidence establishes applicability.');
    } else if (source.active === false || source.available === false) {
      classification = 'unclassified';
      issues.push('No portal match was found for this closed or unavailable Encompass invoice.');
    } else {
      workNeeded = 'submit';
      if (!distributorId) issues.push('Distributor could not be resolved.');
      if (!deliveryMethod)
        issues.push(
          methods.length > 1
            ? `Client history has multiple delivery methods: ${methods.join(', ')}.`
            : 'Delivery method could not be resolved from client history.',
        );
      if (deliveryMethod && deliveryMethod !== 'CK Distribution' && !storeId)
        issues.push('The invoice destination could not be resolved.');
      if (!draft.brandIds.length || unknownProducts)
        issues.push(
          unknownProducts
            ? `${unknownProducts} product(s) have no unambiguous portal brand.`
            : 'No portal brand could be resolved.',
        );
      if (!source.taskId) issues.push('No Encompass sales task is linked.');
      if (!source.inScope) issues.push('The sales task is assigned outside this account.');
      if (!draftSchema.safeParse(draft).success && !issues.length)
        issues.push('A required invoice field is missing or invalid.');
      classification = issues.length ? 'review' : 'pending';
      canProcess = source.inScope && !!source.taskId;
    }
    if (source.onHold && ['submit', 'complete'].includes(workNeeded)) {
      classification = 'held';
      canProcess = false;
      issues.unshift('Encompass marks this invoice on hold through its payment terms.');
    }
    // Collapse identical evidence without discarding its invoice references.
    const combined = new Map<string, MappingEvidence>();
    for (const item of e) {
      const key = `${item.field}/${item.method}/${[...item.targetIds].sort().join(',')}`;
      const before = combined.get(key);
      combined.set(
        key,
        before
          ? {
              ...item,
              sourceIds: unique([...before.sourceIds, ...item.sourceIds]),
              portalIds: unique([...before.portalIds, ...item.portalIds]),
            }
          : item,
      );
    }
    const finalEvidence = [...combined.values()];
    allEvidence.set(source.id, finalEvidence);
    if (workNeeded === 'submit' || workNeeded === 'complete') client.pendingCount++;
    if (classification === 'completed') client.completedCount++;
    records.push({
      source,
      portal,
      links: sourceLinks,
      client,
      draft,
      issues,
      differences,
      evidence: finalEvidence,
      classification,
      workNeeded,
      canProcess,
    });
  }
  return {
    records,
    links,
    clients: summaries,
    evidence: allEvidence,
    pairedPortalIds: new Set(links.map((l) => l.portalId)),
  };
}
