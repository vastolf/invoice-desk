import type {
  CatalogCache,
  Draft,
  Option,
  PortalInvoice,
  ReconciliationSummary,
  SourceClient,
  SourceInvoice,
  SourceLine,
  SourceProduct,
} from '../shared/types.ts';
export interface Snapshot {
  sources: SourceInvoice[];
  portals: PortalInvoice[];
  options: { distributors: Option[]; brands: Option[]; stores: Option[] };
  userId: string;
  clients?: SourceClient[];
  products?: SourceProduct[];
  lines?: SourceLine[];
  lookups?: CatalogCache['lookups'];
  lineChecks?: CatalogCache['lineChecks'];
  metrics?: Pick<
    ReconciliationSummary,
    'sourceLookups' | 'cachedLookups' | 'lineInvoicesFetched' | 'lineInvoicesReused'
  >;
}
export interface Adapter {
  connect(): Promise<void>;
  discover(cache?: CatalogCache): Promise<Snapshot>;
  source(id: string): Promise<SourceInvoice>;
  verifyAccount(draft: Draft, requireAssignments?: boolean): Promise<void>;
  findPortal(number: string, distributorId: string): Promise<PortalInvoice[]>;
  portal(id: string): Promise<PortalInvoice>;
  duplicate(number: string, distributorId: string): Promise<boolean>;
  pdf(id: string): Promise<Buffer>;
  upload(path: string, bytes: Buffer): Promise<void>;
  submit(number: string, draft: Draft, path: string): Promise<string>;
  complete(id: string, taskId: string | null, revision: string): Promise<void>;
  close(): Promise<void>;
}
