import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Adapter, Snapshot } from './adapter.ts';
import type {
  CatalogCache,
  Draft,
  PortalInvoice,
  SourceClient,
  SourceInvoice,
  SourceLine,
  SourceProduct,
} from '../shared/types.ts';
import {
  AppError,
  digest,
  htmlText,
  normalized,
  sourceMoney,
  moneyMinor,
  repEditAvailable,
} from './domain.ts';

type Raw = Record<string, any>;
// Encompass exposes this as a global lexical binding, not necessarily window.ECP.
declare const ECP: any;
const fields = [
  'InvoiceID',
  'InvoiceNum',
  'InvoiceTotal',
  'TotalCases',
  'TimeCreated',
  'TimeUpdated',
  'CreatedBy',
  'SalesmanActual',
  'CustomerID',
  'SalesTaskID',
  'Memo',
  'Status',
  'TermID',
  'Open Balance',
  'OpenCredit',
  'OffDayDelivery',
  'Public PDF Link',
  'Invoice_LoadSheet^LoadSheet.Date',
  'Invoice_LoadSheet^LoadSheet.LocationID',
  'Invoice_LoadSheet^LoadSheet_Routes^Routes.Route',
  'Invoice_SalesTasks^Tasks.TaskStatusID',
];
const portalSelect =
  'id,invoice_number,distributor_id,store_id,invoice_date,delivery_date,delivery_method,amount,currency,status,submitted_by,archived_at,updated_at,attachment_paths,pdf_path,payment_date,intake_status,accepted_at,credit_status,waiting_on_rep,invoice_brands(brand_id)';
const db = (r: Raw, k: string) => String(r[`${k}_DBValue`] ?? r[k] ?? '');
export class LiveAdapter implements Adapter {
  browser?: Browser;
  context?: BrowserContext;
  enc?: Page;
  ia?: Page;
  backend = '';
  headers: Record<string, string> = {};
  userId = '';
  portalRoles = new Set<string>();
  sourceUserIds = new Set<string>();
  rawCandidates: Raw[] | undefined;
  scope = new Set<string>();
  activeIds = new Set<string>();
  connecting?: Promise<void>;
  pdfCache = new Map<string, { revision: string; bytes: Buffer }>();
  constructor(private env: NodeJS.ProcessEnv) {}
  async connect() {
    if (this.context && this.enc && this.ia && this.userId) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try {
      await this.connecting;
    } catch {
      await this.close();
      throw new AppError('CONNECTION_FAILED');
    } finally {
      this.connecting = undefined;
    }
  }
  private async open() {
    for (const k of [
      'ENCOMPASS_URL',
      'ENCOMPASS_USERNAME',
      'ENCOMPASS_PASSWORD',
      'INVOICE_APPROVE_URL',
      'INVOICE_APPROVE_USERNAME',
      'INVOICE_APPROVE_PASSWORD',
    ])
      if (!this.env[k]) throw new AppError('CONNECTION_FAILED');
    for (const k of ['ENCOMPASS_URL', 'INVOICE_APPROVE_URL'])
      if (new URL(this.env[k]!).protocol !== 'https:') throw new AppError('CONNECTION_FAILED');
    this.browser = await chromium.launch({
      headless: this.env.BROWSER_HEADLESS !== 'false',
      ...(this.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: this.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 } });
    this.context.setDefaultTimeout(15000);
    this.context.setDefaultNavigationTimeout(30000);
    this.enc = await this.context.newPage();
    this.ia = await this.context.newPage();
    this.enc.on('response', async (r) => {
      if (new URL(r.url()).pathname !== '/api' || !r.headers()['content-type']?.includes('json'))
        return;
      try {
        const data = await r.json();
        const table = data.Export?.Table;
        if (
          table?.Name === 'Invoice' &&
          (table.Field ?? []).some((f: Raw) => f.Name === 'Open Balance')
        )
          this.rawCandidates = table.Row ?? [];
      } catch {
        /* response disappeared during navigation */
      }
    });
    this.ia.on('request', (q) => {
      const url = new URL(q.url()),
        h = q.headers();
      if (url.pathname.startsWith('/rest/v1/') && h.authorization && h.apikey) {
        if (this.backend && this.backend !== url.origin) return;
        this.backend = url.origin;
        this.headers = { authorization: h.authorization, apikey: h.apikey };
      }
    });
    await Promise.all([
      this.enc.goto(this.env.ENCOMPASS_URL!, { waitUntil: 'domcontentloaded' }),
      this.ia.goto(this.env.INVOICE_APPROVE_URL!, { waitUntil: 'domcontentloaded' }),
    ]);
    await this.enc.locator('#ews-login-username').fill(this.env.ENCOMPASS_USERNAME!);
    await this.enc.locator('#ews-login-password').fill(this.env.ENCOMPASS_PASSWORD!);
    await this.enc.locator('#ews-login-password').press('Enter', { noWaitAfter: true });
    await this.ia.locator('#email').fill(this.env.INVOICE_APPROVE_USERNAME!);
    await this.ia.locator('#password').fill(this.env.INVOICE_APPROVE_PASSWORD!);
    await this.ia
      .getByRole('button', { name: 'Sign in', exact: true })
      .click({ noWaitAfter: true });
    await this.enc.waitForFunction(
      () =>
        typeof ECP !== 'undefined' &&
        !!ECP.EC_TableView &&
        !document.querySelector('#ews-login-password'),
      undefined,
      { timeout: 45000 },
    );
    await this.ia.waitForURL((u) => u.pathname === '/dashboard', { timeout: 45000 });
    for (let i = 0; i < 100 && (!this.backend || !this.rawCandidates); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (!this.backend || !this.rawCandidates) throw new AppError('CONNECTION_FAILED');
    const user = await this.api('/auth/v1/user');
    this.userId = user.id;
    // Use the same authenticated rep/managed-rep scope report as the dashboard.
    // The login can be an email address rather than the Encompass UserName.
    const scopeIds = await this.enc.evaluate(async () => {
      const request = new ECP.EC_Request('FusionView');
      request.AddRequestVariable('Format', 'JSON');
      request.AddRequestVariable('ReportID', '18914146');
      const records = new ECP.EC_Recordset(await request.Submit());
      return records.EOF ? '' : String(records.Item('ManagerUserIDArr') ?? '');
    });
    this.sourceUserIds = new Set(scopeIds.split(/[,\s^]+/).filter(Boolean));
    if (!this.userId || !this.sourceUserIds.size) throw new AppError('CONNECTION_FAILED');
  }
  private async api(path: string, method = 'GET', body?: unknown): Promise<any> {
    if (!this.context || !this.backend) throw new AppError('AUTH_REQUIRED');
    const response = await this.context.request.fetch(`${this.backend}${path}`, {
      method,
      headers: {
        ...this.headers,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { data: body } : {}),
      timeout: 30000,
    });
    try {
      if ([401, 403].includes(response.status())) throw new AppError('AUTH_REQUIRED');
      if (!response.ok()) throw new AppError('REMOTE_UNAVAILABLE');
      return response.status() === 204 ? null : await response.json();
    } finally {
      await response.dispose();
    }
  }
  private async rest(table: string, params: Record<string, string> = {}) {
    return this.api(`/rest/v1/${table}?${new URLSearchParams(params)}`);
  }
  private async table(
    table: string,
    columns: string[],
    filters: { name: string; value: string }[],
  ): Promise<Raw[]> {
    if (!this.enc) throw new AppError('AUTH_REQUIRED');
    try {
      return await this.enc.evaluate(
        async ({ table, columns, filters }) => {
          const api = ECP;
          const t = new api.EC_TableView(table);
          t.SetMaxRecords(5000);
          t.DisableSingleRecordView = true;
          for (const c of columns) t.AddColumn(c);
          for (const f of filters) t.AddFilter(f.name, f.value);
          const r = new api.EC_Recordset(await t.GetResults()),
            out: Record<string, string>[] = [];
          while (!r.EOF) {
            const o: Record<string, string> = {};
            for (const c of columns) {
              o[c] = r.Item(c);
              o[`${c}_DBValue`] = r.ItemDBValue(c);
            }
            out.push(o);
            r.MoveNext();
          }
          return out;
        },
        { table, columns, filters },
      );
    } catch {
      throw new AppError('AUTH_REQUIRED');
    }
  }
  private async hydrate(raw: Raw[]): Promise<SourceInvoice[]> {
    const taskIds = [...new Set(raw.map((r) => db(r, 'SalesTaskID')).filter(Boolean))];
    const tasks = await this.batchTable(
      'Tasks',
      ['TaskID', 'TaskStatusID', 'AssignToUserID'],
      'TaskID',
      taskIds,
    );
    const termIds = [...new Set(raw.map((r) => db(r, 'TermID')).filter(Boolean))];
    const terms = await this.batchTable('Terms', ['TermID', 'OnHold'], 'TermID', termIds);
    if (termIds.some((id) => !terms.some((r) => db(r, 'TermID') === id)))
      throw new AppError('DISCOVERY_INCOMPLETE');
    const holdTerms = new Set(
      terms.filter((r) => /^(1|true)$/i.test(db(r, 'OnHold'))).map((r) => db(r, 'TermID')),
    );
    return raw.map((r) => {
      const id = db(r, 'InvoiceID'),
        taskId = db(r, 'SalesTaskID') || null,
        task = tasks.find((t) => db(t, 'TaskID') === taskId);
      const owner = task && this.sourceUserIds.has(db(task, 'AssignToUserID'));
      const creator =
        db(r, 'CreatedBy').toLowerCase() === this.env.ENCOMPASS_USERNAME!.toLowerCase();
      const pdfHtml = String(r['Public PDF Link'] ?? '');
      const pdfLink = pdfHtml.match(/href=["']([^"']+)/i)?.[1]?.replaceAll('&amp;', '&');
      return {
        id,
        invoiceNumber: db(r, 'InvoiceNum'),
        clientId: db(r, 'CustomerID'),
        clientName: htmlText(r.CustomerID),
        memo: db(r, 'Memo'),
        memoKey: digest(normalized(db(r, 'Memo'))),
        amountMinor: sourceMoney(db(r, 'InvoiceTotal')),
        createdDate: db(r, 'TimeCreated').slice(0, 10),
        deliveryDate: db(r, 'Invoice_LoadSheet^LoadSheet.Date'),
        taskId,
        taskComplete:
          (task ? db(task, 'TaskStatusID') : db(r, 'Invoice_SalesTasks^Tasks.TaskStatusID')) ===
          '4',
        inScope: this.scope.has(id) && !!(owner || creator),
        active: this.activeIds.has(id) && Number(db(r, 'TotalCases')) > 0,
        sourceStatus: htmlText(r.Status),
        taskStatus: task
          ? db(task, 'TaskStatusID')
          : db(r, 'Invoice_SalesTasks^Tasks.TaskStatusID'),
        totalCases: Number(db(r, 'TotalCases')),
        available: true,
        termId: db(r, 'TermID') || null,
        onHold: holdTerms.has(db(r, 'TermID')),
        termName: htmlText(r.TermID),
        routeName: htmlText(r['Invoice_LoadSheet^LoadSheet_Routes^Routes.Route']),
        ...(db(r, 'OffDayDelivery') !== ''
          ? { offDayDelivery: /^(1|true)$/i.test(db(r, 'OffDayDelivery')) }
          : {}),
        ...(db(r, 'Open Balance') !== '' && Number.isFinite(Number(db(r, 'Open Balance')))
          ? { openBalanceMinor: sourceMoney(db(r, 'Open Balance')) }
          : {}),
        ...(db(r, 'OpenCredit') !== '' && Number.isFinite(Number(db(r, 'OpenCredit')))
          ? { openCreditMinor: sourceMoney(db(r, 'OpenCredit')) }
          : {}),
        revision: digest([
          id,
          db(r, 'InvoiceNum'),
          db(r, 'InvoiceTotal'),
          db(r, 'TimeUpdated'),
          db(r, 'CustomerID'),
          db(r, 'Memo'),
          db(r, 'Invoice_LoadSheet^LoadSheet.Date'),
          taskId,
          htmlText(r.Status),
          db(r, 'TotalCases'),
          db(r, 'TermID'),
          holdTerms.has(db(r, 'TermID')),
        ]),
        pdfLink,
      };
    });
  }
  private parsePortal(r: Raw): PortalInvoice {
    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      distributorId: r.distributor_id,
      storeId: r.store_id ?? null,
      brandIds: (r.invoice_brands ?? []).map((b: Raw) => b.brand_id),
      deliveryMethod: r.delivery_method ?? '',
      invoiceDate: r.invoice_date ?? '',
      deliveryDate: r.delivery_date ?? '',
      amountMinor: sourceMoney(r.amount),
      status: r.status,
      submittedBy: r.submitted_by,
      archived: !!r.archived_at,
      currency: r.currency ?? 'USD',
      updatedAt: r.updated_at,
      intakeStatus: r.intake_status ?? null,
      creditStatus: r.credit_status ?? null,
      waitingOnRep: r.waiting_on_rep ?? null,
      paymentDate: r.payment_date ?? null,
      acceptedAt: r.accepted_at ?? null,
      repEditability: repEditAvailable(r as any, this.userId, this.portalRoles.has('rep'))
        ? 'available'
        : 'locked',
      attachmentPaths: r.attachment_paths?.length
        ? r.attachment_paths
        : r.pdf_path
          ? [r.pdf_path]
          : [],
    };
  }
  private async batchTable(
    table: string,
    columns: string[],
    field: string,
    ids: string[],
    size = 100,
    extra: { name: string; value: string }[] = [],
  ): Promise<Raw[]> {
    const output: Raw[] = [];
    for (let i = 0; i < ids.length; i += size) {
      const part = ids.slice(i, i + size);
      const rows = await this.table(table, columns, [
        { name: field, value: part.join('^') },
        ...extra,
      ]);
      if (rows.length >= 5000) {
        if (part.length === 1) throw new AppError('DISCOVERY_INCOMPLETE');
        output.push(
          ...(await this.batchTable(
            table,
            columns,
            field,
            part,
            Math.max(1, Math.floor(part.length / 2)),
            extra,
          )),
        );
      } else output.push(...rows);
    }
    return output;
  }
  async discover(cache?: CatalogCache): Promise<Snapshot> {
    await this.connect();
    const user = await this.api('/auth/v1/user');
    if (user.id !== this.userId || (cache?.accountId && cache.accountId !== this.userId))
      throw new AppError('ACCOUNT_CHANGED');
    const previous = cache ?? { sources: [], lines: [], products: [], lookups: [], lineChecks: [] };
    const [userDistributors, userBrands, stores, roles] = await Promise.all([
      this.rest('user_distributors', { select: 'distributor_id', user_id: `eq.${this.userId}` }),
      this.rest('user_brands', { select: 'brand_id', user_id: `eq.${this.userId}` }),
      this.rest('stores', { select: 'id,name', is_active: 'eq.true', order: 'name' }),
      this.rest('user_roles', { select: 'role', user_id: `eq.${this.userId}` }),
    ]);
    this.portalRoles = new Set(roles.map((r: Raw) => r.role));
    const distributorIds = userDistributors.map((r: Raw) => r.distributor_id),
      brandIds = userBrands.map((r: Raw) => r.brand_id);
    const [distributors, brands] = await Promise.all([
      distributorIds.length
        ? this.rest('distributors', { select: 'id,name', id: `in.(${distributorIds.join(',')})` })
        : [],
      brandIds.length
        ? this.rest('brands', {
            select: 'id,name',
            id: `in.(${brandIds.join(',')})`,
            order: 'name',
          })
        : [],
    ]);
    const portals: PortalInvoice[] = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const page = await this.rest('invoices', {
        select: portalSelect,
        order: 'id',
        offset: String(offset),
        limit: '500',
      });
      portals.push(...page.map((r: Raw) => this.parsePortal(r)));
      if (page.length < 500) break;
      if (offset === 99500) throw new AppError('DISCOVERY_INCOMPLETE');
    }
    // Explicit account assignment is retained even when date filters change.
    const assignments = await this.batchTable(
      'AssignedUsers',
      ['AssignedUsers_Customers^Customers.CustomerID'],
      'SalesmanUserID',
      [...this.sourceUserIds],
      100,
      [{ name: 'Active', value: '1' }],
    );
    const assignedClients = [
      ...new Set(
        assignments
          .map((r) => db(r, 'AssignedUsers_Customers^Customers.CustomerID'))
          .filter(Boolean),
      ),
    ];
    const current = await this.batchTable('Invoice', fields, 'CustomerID', assignedClients, 20, [
      { name: 'Status', value: '1^2^3' },
    ]);
    this.activeIds = new Set(current.map((r) => db(r, 'InvoiceID')));
    const rawById = new Map(current.map((r) => [db(r, 'InvoiceID'), r]));
    const knownIds = previous.sources.map((s) => s.id).filter((id) => !rawById.has(id));
    for (const row of await this.batchTable('Invoice', fields, 'InvoiceID', knownIds))
      rawById.set(db(row, 'InvoiceID'), row);
    const knownNumbers = new Set([...rawById.values()].map((r) => db(r, 'InvoiceNum')));
    const today = new Date().toISOString().slice(0, 10),
      now = new Date().toISOString();
    const lookupMap = new Map(previous.lookups.map((l) => [l.invoiceNumber, l]));
    const lookupNumbers = [
      ...new Set(
        portals.filter((p) => distributorIds.includes(p.distributorId)).map((p) => p.invoiceNumber),
      ),
    ].filter((n) => !knownNumbers.has(n) && !lookupMap.get(n)?.checkedAt.startsWith(today));
    const history = await this.batchTable('Invoice', fields, 'InvoiceNum', lookupNumbers);
    for (const row of history) rawById.set(db(row, 'InvoiceID'), row);
    const additional = [...rawById.keys()].filter((id) => !this.activeIds.has(id));
    for (const row of await this.batchTable(
      'Invoice',
      ['InvoiceID'],
      'InvoiceID',
      additional,
      100,
      [{ name: 'Status', value: '1^2^3' }],
    ))
      this.activeIds.add(db(row, 'InvoiceID'));
    for (const number of lookupNumbers)
      lookupMap.set(number, {
        invoiceNumber: number,
        sourceIds: history
          .filter((r) => db(r, 'InvoiceNum') === number)
          .map((r) => db(r, 'InvoiceID')),
        checkedAt: now,
      });
    for (const r of rawById.values())
      lookupMap.set(db(r, 'InvoiceNum'), {
        invoiceNumber: db(r, 'InvoiceNum'),
        sourceIds: [db(r, 'InvoiceID')],
        checkedAt: now,
      });
    this.scope = new Set(rawById.keys());
    const fresh = await this.hydrate([...rawById.values()]);
    const sources = [
      ...fresh,
      ...previous.sources
        .filter((s) => !rawById.has(s.id))
        .map((s) => ({ ...s, available: false, active: false, inScope: false })),
    ];
    const clientIds = [...new Set(sources.map((s) => s.clientId))];
    const clientRows = await this.batchTable(
      'Customers',
      ['CustomerID', 'CustomerNumCompany', 'Company', 'ChainID'],
      'CustomerID',
      clientIds,
    );
    const clients: SourceClient[] = clientRows.map((r) => ({
      id: db(r, 'CustomerID'),
      name: htmlText(r.Company) || htmlText(r.CustomerNumCompany),
      chainId: db(r, 'ChainID') || null,
      chainName: htmlText(r.ChainID),
    }));
    const byClient = new Map(clients.map((c) => [c.id, c]));
    for (const s of sources) s.clientName = byClient.get(s.clientId)?.name || s.clientName;
    const portalNumbers = new Set(
      portals.filter((p) => distributorIds.includes(p.distributorId)).map((p) => p.invoiceNumber),
    );
    const paired = sources.filter((s) => portalNumbers.has(s.invoiceNumber));
    const establishedClients = new Set(paired.map((s) => s.clientId));
    const establishedChains = new Set(
      paired.map((s) => byClient.get(s.clientId)?.chainId).filter(Boolean),
    );
    const needed = sources.filter(
      (s) =>
        s.available !== false &&
        (portalNumbers.has(s.invoiceNumber) ||
          (s.active &&
            s.inScope &&
            (establishedClients.has(s.clientId) ||
              establishedChains.has(byClient.get(s.clientId)?.chainId)))),
    );
    const checks = new Map((previous.lineChecks ?? []).map((c) => [c.invoiceId, c.revision]));
    const changed = needed.filter((s) => checks.get(s.id) !== `lines-v2:${s.revision}`);
    const changedIds = new Set(changed.map((s) => s.id));
    const lines: SourceLine[] = previous.lines.filter(
      (l) =>
        !changedIds.has(l.invoiceId) &&
        sources.some((s) => s.id === l.invoiceId && s.revision === l.revision),
    );
    const lineFields = ['InvoiceTransID', 'InvoiceID', 'ProductID', 'NumUnits', 'ExtPrice'];
    const rawLines = await this.batchTable(
      'InvoiceTrans',
      lineFields,
      'InvoiceID',
      changed.map((s) => s.id),
      30,
    );
    // Delivered invoices move their lines out of InvoiceTrans into InvoiceTransHist.
    const presentLineIds = new Set(rawLines.map((r) => db(r, 'InvoiceTransID')));
    const historicalLines = await this.batchTable(
      'InvoiceTransHist',
      lineFields,
      'InvoiceID',
      changed.map((s) => s.id),
      30,
    );
    for (const line of historicalLines)
      if (!presentLineIds.has(db(line, 'InvoiceTransID'))) rawLines.push(line);
    const sourceMap = new Map(sources.map((s) => [s.id, s]));
    for (const r of rawLines) {
      const invoiceId = db(r, 'InvoiceID'),
        productId = db(r, 'ProductID');
      if (!productId || !sourceMap.has(invoiceId)) continue;
      lines.push({
        id: db(r, 'InvoiceTransID'),
        invoiceId,
        productId,
        quantity: Number(db(r, 'NumUnits')) || 0,
        amountMinor: sourceMoney(db(r, 'ExtPrice')),
        revision: sourceMap.get(invoiceId)!.revision,
      });
    }
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const productRows = await this.batchTable(
      'Products',
      ['ProductID', 'ProductName', 'SupplierID', 'BrandID'],
      'ProductID',
      productIds,
      300,
    );
    const products: SourceProduct[] = productRows.map((r) => ({
      id: db(r, 'ProductID'),
      name: htmlText(r.ProductName),
      supplierId: db(r, 'SupplierID') || null,
      supplierName: htmlText(r.SupplierID),
      sourceBrandId: db(r, 'BrandID') || null,
      sourceBrandName: htmlText(r.BrandID),
    }));
    this.pdfCache.clear();
    return {
      sources,
      portals,
      clients,
      products,
      lines,
      options: { distributors, brands, stores },
      userId: this.userId,
      lookups: [...lookupMap.values()],
      lineChecks: needed.map((s) => ({ invoiceId: s.id, revision: `lines-v2:${s.revision}` })),
      metrics: {
        sourceLookups: lookupNumbers.length,
        cachedLookups: portals.length - lookupNumbers.length,
        lineInvoicesFetched: changed.length,
        lineInvoicesReused: needed.length - changed.length,
      },
    };
  }
  async source(id: string) {
    if (!this.scope.has(id)) throw new AppError('OUT_OF_SCOPE');
    const rows = await this.table('Invoice', fields, [{ name: 'InvoiceID', value: id }]);
    if (rows.length !== 1) throw new AppError('SOURCE_CHANGED');
    const open = await this.table(
      'Invoice',
      ['InvoiceID'],
      [
        { name: 'InvoiceID', value: id },
        { name: 'Status', value: '1^2^3' },
      ],
    );
    if (open.length) this.activeIds.add(id);
    else this.activeIds.delete(id);
    return (await this.hydrate(rows))[0];
  }
  async findPortal(number: string, distributorId: string) {
    const rows = await this.rest('invoices', {
      select: portalSelect,
      invoice_number: `eq.${number.trim()}`,
      distributor_id: `eq.${distributorId}`,
      limit: '10',
    });
    return rows.map((r: Raw) => this.parsePortal(r));
  }
  async verifyAccount(draft: Draft, requireAssignments = true) {
    const user = await this.api('/auth/v1/user');
    if (user.id !== this.userId) throw new AppError('ACCOUNT_CHANGED');
    if (!requireAssignments) return;
    const [distributors, brands, linkedBrands] = await Promise.all([
      this.rest('user_distributors', { select: 'distributor_id', user_id: `eq.${this.userId}` }),
      this.rest('user_brands', { select: 'brand_id', user_id: `eq.${this.userId}` }),
      this.rest('distributor_brands', {
        select: 'brand_id',
        distributor_id: `eq.${draft.distributorId}`,
      }),
    ]);
    if (
      !distributors.some((d: Raw) => d.distributor_id === draft.distributorId) ||
      draft.brandIds.some(
        (id) =>
          !brands.some((b: Raw) => b.brand_id === id) ||
          !linkedBrands.some((b: Raw) => b.brand_id === id),
      )
    )
      throw new AppError('MAPPING_REQUIRED');
  }
  async portal(id: string) {
    const rows = await this.rest('invoices', { select: portalSelect, id: `eq.${id}` });
    if (rows.length !== 1) throw new AppError('VERIFICATION_FAILED');
    return this.parsePortal(rows[0]);
  }
  async duplicate(number: string, distributorId: string) {
    return !!(await this.api('/rest/v1/rpc/invoice_number_taken_for', 'POST', {
      _distributor_id: distributorId,
      _invoice_number: number.trim(),
    }));
  }
  async pdf(id: string) {
    const source = await this.source(id);
    const cached = this.pdfCache.get(id);
    if (cached?.revision === source.revision) return cached.bytes;
    if (!source.pdfLink) throw new AppError('VERIFICATION_FAILED');
    const url = new URL(source.pdfLink, this.env.ENCOMPASS_URL);
    if (url.origin !== new URL(this.env.ENCOMPASS_URL!).origin)
      throw new AppError('VERIFICATION_FAILED');
    const response = await this.context!.request.get(url.href, { timeout: 30000 });
    try {
      if (!response.ok() || !response.headers()['content-type']?.includes('pdf'))
        throw new AppError('REMOTE_UNAVAILABLE');
      const bytes = await response.body();
      if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw new AppError('VERIFICATION_FAILED');
      // Cache only the currently previewed PDF, in memory.
      this.pdfCache.clear();
      this.pdfCache.set(id, { revision: source.revision, bytes });
      return bytes;
    } finally {
      await response.dispose();
    }
  }
  async upload(path: string, bytes: Buffer) {
    const url = `${this.backend}/storage/v1/object/invoices/${path}`;
    const existing = await this.context!.request.get(url, {
      headers: this.headers,
      timeout: 30000,
    });
    try {
      if ([401, 403].includes(existing.status())) throw new AppError('AUTH_REQUIRED');
      if (existing.ok()) {
        if (digest(await existing.body()) !== digest(bytes)) throw new AppError('UPLOAD_UNCERTAIN');
        return;
      }
      if (![400, 404].includes(existing.status())) throw new AppError('UPLOAD_UNCERTAIN');
    } finally {
      await existing.dispose();
    }
    try {
      const uploaded = await this.context!.request.post(url, {
        headers: { ...this.headers, 'content-type': 'application/pdf', 'x-upsert': 'false' },
        data: bytes,
        timeout: 45000,
      });
      try {
        if ([401, 403].includes(uploaded.status())) throw new AppError('AUTH_REQUIRED');
        if (!uploaded.ok()) throw new AppError('UPLOAD_UNCERTAIN');
      } finally {
        await uploaded.dispose();
      }
      const verify = await this.context!.request.get(url, {
        headers: this.headers,
        timeout: 30000,
      });
      try {
        if (!verify.ok() || digest(await verify.body()) !== digest(bytes))
          throw new AppError('UPLOAD_UNCERTAIN');
      } finally {
        await verify.dispose();
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'AUTH_REQUIRED') throw error;
      throw new AppError('UPLOAD_UNCERTAIN');
    }
  }
  async submit(number: string, draft: Draft, path: string) {
    await this.verifyAccount(draft);
    try {
      const id = await this.api('/rest/v1/rpc/submit_invoice', 'POST', {
        _distributor_id: draft.distributorId,
        _store_id: draft.storeId,
        _delivery_method: draft.deliveryMethod,
        _invoice_number: number.trim(),
        _invoice_date: draft.invoiceDate,
        _amount: moneyMinor(draft.amount) / 100,
        _submission_notes: null,
        _pdf_path: path,
        _attachment_paths: [path],
        _brand_ids: draft.brandIds,
        _delivery_date: draft.deliveryDate,
        _duplicate_override: false,
        _duplicate_override_reason: null,
      });
      if (typeof id !== 'string' || !id) throw new Error('no id');
      return id;
    } catch {
      throw new AppError('SUBMIT_UNCERTAIN');
    }
  }
  async complete(id: string, taskId: string | null, revision: string) {
    const source = await this.source(id);
    if (source.taskComplete) return;
    if (!source.inScope) throw new AppError('OUT_OF_SCOPE');
    if (source.onHold) throw new AppError('SOURCE_ON_HOLD');
    if (source.revision !== revision) throw new AppError('SOURCE_CHANGED');
    if (!taskId || !source.taskId) throw new AppError('TASK_MISSING');
    if (source.taskId !== taskId) throw new AppError('TASK_CHANGED');
    // Use the application's existing minimum-order and permission checks.
    const control = await this.prepareCompletion(source);
    await control.click();
    for (let i = 0; i < 45; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const text = await this.enc!.locator('body').innerText();
      if (text.includes('Below Order Minimum')) {
        await this.dismissDialog();
        throw new AppError('MINIMUM_NOT_MET');
      }
      if (i % 4 === 0 && (await this.source(id)).taskComplete) return;
    }
    throw new AppError('TASK_BLOCKED');
  }
  private async prepareCompletion(source: SourceInvoice) {
    const selector = `ecp-btn[data-invoiceid="${source.id}"][data-taskid="${source.taskId}"]`;
    let control = this.enc!.locator(selector);
    if ((await control.count()) === 1) return control;
    await this.enc!.goto(new URL('/Home?DashboardID=207235', this.env.ENCOMPASS_URL).href, {
      waitUntil: 'domcontentloaded',
    });
    await this.enc!.getByText('Create Report', { exact: true }).waitFor();
    await this.enc!.evaluate(
      ({ id, date }) => {
        const invoice = document.querySelector('ecp-auto-complete[name="InvoiceNum"]') as any;
        const delivery = document.querySelector('ecp-input[name="DeliveryDate"]') as any;
        if (!invoice || !delivery) throw new Error('Report filters unavailable');
        invoice.value = id;
        const [year, month, day] = date.split('-');
        delivery.value = `${month}/${day}/${year}`;
      },
      { id: source.id, date: source.deliveryDate },
    );
    await this.enc!.getByText('Create Report', { exact: true }).click();
    for (let i = 0; i < 100; i++) {
      control = this.enc!.locator(selector);
      if ((await control.count()) === 1) return control;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new AppError('TASK_BLOCKED');
  }
  private async dismissDialog() {
    try {
      await this.enc!.getByText('Cancel', { exact: true }).last().click({ timeout: 1000 });
    } catch {
      try {
        await this.enc!.getByText('Ok', { exact: true }).last().click({ timeout: 1000 });
      } catch {
        /* operator can inspect blocked state */
      }
    }
  }
  async close() {
    await this.browser?.close();
    this.browser = undefined;
    this.context = undefined;
    this.enc = undefined;
    this.ia = undefined;
    this.headers = {};
    this.backend = '';
    this.userId = '';
    this.portalRoles.clear();
    this.rawCandidates = undefined;
    this.pdfCache.clear();
  }
}
