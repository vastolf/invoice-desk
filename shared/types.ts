export type DeliveryMethod = 'RCP Northside' | 'CK Distribution' | 'Direct to Store';
export type QueueStatus =
  | 'pending'
  | 'review'
  | 'held'
  | 'queued'
  | 'processing'
  | 'attention'
  | 'completed'
  | 'excluded'
  | 'unclassified'
  | 'portal_only';
export type WorkNeeded = 'submit' | 'complete' | 'none' | 'unknown';
export type Stage =
  'idle' | 'validate' | 'duplicate' | 'upload' | 'submit' | 'verify' | 'complete_task' | 'done';
export interface Option {
  id: string;
  name: string;
}
export interface Draft {
  distributorId: string;
  brandIds: string[];
  storeId: string | null;
  deliveryMethod: DeliveryMethod | '';
  invoiceDate: string;
  deliveryDate: string;
  amount: string;
}
export interface SourceInvoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  memo: string;
  amountMinor: number;
  createdDate: string;
  deliveryDate: string;
  taskId: string | null;
  taskComplete: boolean;
  inScope: boolean;
  revision: string;
  pdfLink?: string;
  active?: boolean;
  sourceStatus?: string;
  taskStatus?: string;
  totalCases?: number;
  memoKey?: string;
  available?: boolean;
  onHold?: boolean;
  termId?: string | null;
  termName?: string;
  routeName?: string;
  offDayDelivery?: boolean;
  openBalanceMinor?: number;
  openCreditMinor?: number;
}
export interface SourceClient {
  id: string;
  name: string;
  chainId: string | null;
  chainName: string;
}
export interface SourceProduct {
  id: string;
  name: string;
  supplierId: string | null;
  supplierName: string;
  sourceBrandId: string | null;
  sourceBrandName: string;
}
export interface SourceLine {
  id: string;
  invoiceId: string;
  productId: string;
  quantity: number;
  amountMinor: number;
  revision: string;
}
export interface MappingEvidence {
  field: 'client' | 'delivery' | 'store' | 'brands';
  method:
    | 'invoice_history'
    | 'customer_chain'
    | 'client_name'
    | 'memo_store'
    | 'product_history'
    | 'supplier_history'
    | 'product_label'
    | 'memo_history';
  sourceIds: string[];
  portalIds: string[];
  targetIds: string[];
  count?: number;
}
export interface InvoiceLink {
  sourceId: string;
  portalId: string;
  distributorId: string;
  method: 'invoice_number';
  differences: string[];
}
export interface ClientSummary {
  id: string;
  name: string;
  chainId: string | null;
  chainName: string;
  classification: 'established' | 'same_chain' | 'other_chain' | 'unclassified';
  sourceInvoiceIds: string[];
  portalInvoiceIds: string[];
  evidenceCount: number;
  pendingCount: number;
  completedCount: number;
  stores: Option[];
  deliveryMethods: string[];
}
export interface ReconciliationSummary {
  sourceInvoices: number;
  portalInvoices: number;
  linkedInvoices: number;
  clients: number;
  products: number;
  lineItems: number;
  sourceLookups: number;
  cachedLookups: number;
  lineInvoicesFetched: number;
  lineInvoicesReused: number;
  portalWithoutSource: number;
}
export interface CatalogCache {
  sources: SourceInvoice[];
  lines: SourceLine[];
  products: SourceProduct[];
  lookups: { invoiceNumber: string; checkedAt: string; sourceIds: string[] }[];
  lineChecks?: { invoiceId: string; revision: string }[];
  accountId?: string;
}
export interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  distributorId: string;
  storeId: string | null;
  brandIds: string[];
  deliveryMethod: string;
  invoiceDate: string;
  deliveryDate: string;
  amountMinor: number;
  status: string;
  submittedBy: string;
  archived: boolean;
  attachmentPaths?: string[];
  updatedAt?: string;
  currency?: string;
  repEditability?: 'available' | 'locked';
  intakeStatus?: string | null;
  creditStatus?: string | null;
  waitingOnRep?: boolean | null;
  paymentDate?: string | null;
  acceptedAt?: string | null;
}
export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  clientName: string;
  memo: string;
  amountMinor: number;
  invoiceDate: string;
  deliveryDate: string;
  brands: string[];
  storeName: string;
  draft: Draft;
  revision: string;
  status: QueueStatus;
  stage: Stage;
  portalId: string | null;
  portalStatus: string | null;
  portalVerified: boolean;
  taskComplete: boolean;
  inScope: boolean;
  issues: string[];
  errorCode: string | null;
  updatedAt: string;
  events: JobEvent[];
  clientId?: string;
  workNeeded?: WorkNeeded;
  applicability?: ClientSummary['classification'];
  sourceAvailable?: boolean;
  sourceActive?: boolean;
  pdfAvailable?: boolean;
  sourceStatus?: string;
  taskStatus?: string;
  taskId?: string | null;
  termName?: string;
  routeName?: string;
  offDayDelivery?: boolean;
  totalCases?: number;
  openBalanceMinor?: number;
  openCreditMinor?: number;
  lineCount?: number;
  intakeStatus?: string | null;
  creditStatus?: string | null;
  waitingOnRep?: boolean | null;
  paymentDate?: string | null;
  acceptedAt?: string | null;
  portalArchived?: boolean;
  attachmentCount?: number;
  onHold?: boolean;
  portalEditability?: PortalInvoice['repEditability'];
  canProcess?: boolean;
  mappingEvidence?: MappingEvidence[];
  differences?: string[];
  lines?: { id: string; productId: string; name: string; quantity: number; amountMinor: number }[];
  sourceValues?: { createdDate: string; deliveryDate: string; amountMinor: number };
}
export interface JobEvent {
  stage: Stage;
  outcome: string;
  at: string;
  errorCode?: string;
}
export interface State {
  mode: 'demo' | 'live';
  connected: boolean;
  syncing: boolean;
  lastSync: string | null;
  connectionError: string | null;
  rows: InvoiceRow[];
  options: { distributors: Option[]; brands: Option[]; stores: Option[] };
  worker: {
    running: boolean;
    paused: boolean;
    queued: number;
    activeId: string | null;
    batchTotal: number;
    batchFinished: number;
  };
  csrfToken?: string;
  clients?: ClientSummary[];
  reconciliation?: ReconciliationSummary;
  origins?: { encompass: string; invoiceApprove: string };
}
export interface ProcessItem {
  id: string;
  revision: string;
  draft: Draft;
  action?: 'submit' | 'complete';
}
export const stages: Record<Stage, string> = {
  idle: 'Not started',
  validate: 'Checking invoice',
  duplicate: 'Checking for duplicates',
  upload: 'Uploading invoice PDF',
  submit: 'Submitting to InvoiceApprove',
  verify: 'Verifying submission',
  complete_task: 'Completing Encompass task',
  done: 'Completed',
};
export const errorMessages: Record<string, string> = {
  SOURCE_ON_HOLD:
    'Encompass marks this invoice on hold. Resolve the hold in Encompass, then refresh.',
  NOT_ACTIONABLE:
    'This record does not have an eligible processing action. Check its reconciliation details.',
  DISCOVERY_INCOMPLETE:
    'The source returned an incomplete result set. Refresh did not replace the verified catalog.',
  CONNECTION_FAILED:
    'Could not connect. Check the local credentials and browser setup, then reconnect.',
  AUTH_REQUIRED: 'Your session expired. Reconnect, then retry this invoice.',
  ACCOUNT_CHANGED: 'The signed-in account changed. Reconnect before processing.',
  OUT_OF_SCOPE: 'This invoice is outside the connected rep’s verified scope.',
  SOURCE_CHANGED: 'Encompass changed since this invoice was reviewed. Refresh and review it again.',
  MAPPING_REQUIRED: 'Choose the missing invoice fields before processing.',
  DUPLICATE_CONFLICT:
    'An existing portal invoice has different details. Review the original records.',
  DUPLICATE_UNVERIFIED:
    'The portal reports a duplicate that could not be verified. Review the original record.',
  UPLOAD_UNCERTAIN:
    'The upload could not be verified. Retry will reconcile the intended file first.',
  SUBMIT_UNCERTAIN:
    'Submission outcome is uncertain. Retry will check the portal before submitting again.',
  VERIFICATION_FAILED: 'The portal record did not match the reviewed invoice. Review both systems.',
  MINIMUM_NOT_MET: 'Encompass blocked completion. Check the order minimum in Encompass.',
  TASK_CHANGED: 'The linked Encompass task changed. Refresh and review before continuing.',
  TASK_MISSING: 'No linked sales task was found. Review the invoice in Encompass.',
  TASK_BLOCKED: 'Encompass did not confirm task completion. Review the invoice in Encompass.',
  REMOTE_UNAVAILABLE:
    'The remote application is unavailable. Retry will reconcile completed steps first.',
  INTERRUPTED: 'The worker stopped during processing. Retry will reconcile both systems first.',
};
