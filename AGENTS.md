# Project context

This project automates copying invoice details and attachments from Encompass into InvoiceApprove, and the related Encompass sales-task completion step.

## Interface copy

- Use direct labels for invoice data, actions, and actual status. The user explicitly rejects slogans, marketing language, motivational prompts, and filler descriptions.
- Do not add taglines, idle encouragement, fake workspace/profile controls, or captions that repeat a card's label. Keep necessary validation, error messages, and action consequences specific and concise.

## Current state

- Read `README.md` and `docs/IMPLEMENTATION_PLAN.md` before implementation. Private `docs/RECONNAISSANCE.md` notes may exist locally; read them if present, but never commit them or copy their live record examples into public files.
- Reconnaissance was performed on November 13, 2026. The observed private interfaces can change; recheck them against the current authenticated application.
- The repository contains a Vite/React/Material UI app, a local Node API, an in-memory Playwright integration, a serialized worker, and SQLite state. Read the current README before running it.
- Reconnaissance did not create, submit, approve, reject, pay, sign, or complete invoices. Normal application view/audit events occurred while browsing.
- The user subsequently authorized building a combined batch action: submit selected invoices to InvoiceApprove, then complete their Encompass sales tasks. This action runs only when the operator starts a selected batch. Do not add another per-invoice permission gate.
- Live read-only integration was checked during development, and one operator-selected live submission/task-completion batch was verified. This is not authorization for additional live writes. Do not submit synthetic test records to production.

## Table preferences

- The user requested selectable/reorderable columns, sorting and filtering across metadata, and saved preferences. Keep the default table compact, with quick PDF and source/portal record links.
- Browser storage may contain whitelisted column IDs/order/visibility, sort settings, and page size only. Do not persist invoice/filter values, selections, client names, signed links, or credentials in preferences.
- Preserve the distinction between source gross, portal gross, balances, and credits. Unknown metadata must remain unknown, not zero or false.

## Data handling

- Never print credentials, authentication headers, cookies, access/refresh tokens, or Encompass PDF link tokens.
- Do not commit or package `.env`, authenticated browser state, HARs, traces, PDFs, screenshots of real records, raw API responses, or databases.
- The user explicitly requested a durable catalog of clients, invoices, line items, and cross-system mappings. Persist IDs/relationships, invoice numbers, amounts, dates, quantities, controlled state/error codes, timestamps, and hashes. Hydrate client/company labels, product/supplier names, people’s names/emails, notes, and PDFs into memory. Do not persist raw replies or credentials.
- Do not log upstream exception text without redaction. It may contain names, email addresses, notes, URLs, or invoice contents.
- Keep browser credentials and authenticated sessions local. Use synthetic records in tests.
- The user will share source through GitHub and explicitly requested deleting the ZIP. Do not recreate ZIP packaging. Keep `.env`, `data/`, logs, screenshots of real records, and browser state out of Git.

## Workflow constraints

- A portal record visible to this account can belong to a different rep. Apply explicit ownership/scope checks.
- Encompass optional filters can widen the account/rep scope. Revalidate scope after any filter change.
- Refresh all known source IDs and full visible portal history. Discover new portal invoice numbers once, cache missing matches daily, and reload lines when source revision changes. Keep completed/history/other-chain/unclassified/portal-only records separate from actionable work.
- Historical delivered invoice lines are in `InvoiceTransHist`; current lines are in `InvoiceTrans`. Zero-quantity, zero-value historical lines must not teach brand mappings.
- Encompass `Status_DBValue` can be a load-sheet reference rather than the invoice-status enum. Determine active status from an explicit `Status=1^2^3` query and positive cases.
- Encompass `Date_DBValue` can contain a load-sheet ID. Use the explicitly joined load-sheet date for delivery; do not parse the raw `Date` foreign key as a date.
- Source creation date is only a candidate for portal invoice date. Historical examples contradict a universal mapping.
- Never replace gross invoice amount with open balance or net after credit.
- Check archived and paid portal invoices when detecting duplicates. Do not infer absence from a recent/default screen.
- Keep submission and sales-task completion as separate durable states behind the combined user action. Purchasing approval and payment remain separate external workflow steps.
- Read Encompass holds via invoice `TermID` → `Terms.OnHold`, independently of New/Locked/task status. Keep held invoices visible and block the combined action. Recheck before upload and task completion; retain a verified portal result if a hold appears between stages.
- Source customer/PDF address, delivery route, and portal final store are separate. Identical source customer PDF addresses and brands can occur under multiple delivery methods. Do not use either alone as a route rule.
- The portal has conditional Rep header/file editing despite its submission-page warning. Availability can close after intake, acceptance, credit, manager, archive, or payment actions. An edit form is not proof of a guaranteed future save or undo.
- Preserve Encompass order-minimum checks and task linking. Do not implement the final step as an unconditional `UpdateTaskStatus` call.
- Do not blindly retry a timed-out write. Reconcile the remote invoice/task before retrying.
