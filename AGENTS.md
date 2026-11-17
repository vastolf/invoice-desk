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

## Distribution-hub invoices

- Katie identified Emerald Sky and Uncle Ernie's packaging as having printed MSRP. Her warehouse applies an overlay sticker before these goods go to a Perfect Union distribution hub. The app cannot verify that physical step; show the specific review note for new submissions involving those brands. Clear a direct-to-store route inferred from history for these invoices so the operator selects the appropriate hub method.
- CK Distribution and RCP Northside are delivery methods in the portal. The portal final store is a separate field and can be named in the Encompass invoice memo even when the source customer/PDF address points to a hub. Check the current invoice memo before reusing a historical final store.
- An invoice-specific, unambiguous memo store may resolve the final store when the delivery method is independently established. A store name or brand alone does not establish the delivery method. If route or store evidence conflicts or is absent, leave the field unresolved for operator review. Respect the portal's method-specific store choices and optional CK store rule.

## Change contract

- Preserve the local React/Node/Playwright/SQLite architecture and the `Adapter` boundary. Keep remote reads and writes in adapters, orchestration and recovery in the engine, deterministic mappings in reconciliation, durable state in the store, and display logic in the frontend.
- Make the smallest change that solves the request. Keep types and validation consistent across frontend, API, worker, and adapter. Check the operator's actual selection and current source/portal state before any live write. A request to change code never authorizes processing additional production invoices.
- Add or update synthetic tests for consequential mapping, authorization, duplicate, hold, and recovery changes. Run `npm test` and `npm run build` before committing. Use `npm run dev:demo` for manual UI checks when needed; never create synthetic production records.
- Keep UI copy factual and concise. Explain unresolved decisions or concrete action consequences in the review screen. Do not add filler text or extra permission gates for each invoice in a selected batch.
- Inspect `git diff --check`, the staged file list, and ignore rules before committing. Keep private files and live examples out of commits. Report any test failures or unpushed work plainly.

## Local setup for Katie or another operator

1. Install Git, GitHub CLI (`gh`), and Node.js 24 or newer. On macOS, `xcode-select --install` provides Git if it is missing; install `gh` through Homebrew (`brew install gh`) or GitHub's official installer. Verify with `git --version`, `gh --version`, and `node --version`.
2. Sign in to GitHub in the browser, then run `gh auth login` and `gh auth setup-git` locally. Use the account that has repository access. Set a local commit identity with `git config user.name "Your Name"` and `git config user.email "your GitHub email"`. Verify remote access with `gh auth status` and `git remote -v`. Let the operator complete browser authentication; never ask for passwords or tokens in chat.
3. Clone the repository or open the existing checkout, run `npm ci` and `npm run setup:browser`, then copy `.env.example` to `.env`. Help the operator fill `ENCOMPASS_URL`, `ENCOMPASS_USERNAME`, `ENCOMPASS_PASSWORD`, `INVOICE_APPROVE_URL`, `INVOICE_APPROVE_USERNAME`, and `INVOICE_APPROVE_PASSWORD` from their own accounts. Keep values quoted, use the actual company Encompass URL, and leave `.env` local and ignored. Do not place GitHub credentials in `.env` or commit it. Use `npm run check:connections` for a read-only connection check, or `npm run dev` to open the app. Connection checks may create normal view/audit events upstream.
4. If access or environment setup fails, identify the missing command, access right, or variable name without displaying its value. Guide the operator through GitHub's browser login and the app's **Connections → Reconnect apps** flow as needed. Keep authenticated browser state local.

## Git sync for every completed change

- Before editing, run `git status --short --branch`, `git remote -v`, and `git fetch origin`. Inspect the remote default branch and new commits. When the worktree is clean, update with `git pull --ff-only` on the tracked branch. If there are local edits, preserve them and integrate upstream safely after committing or in a separate worktree; never reset, overwrite, or discard the operator's work.
- After implementing and verifying, commit the relevant source, tests, and docs. Fetch again, integrate upstream changes with a fast-forward or a reviewed rebase/merge, resolve conflicts and rerun affected checks, then push to the tracked GitHub branch promptly. Never force-push a shared branch. Verify the push and branch status. If authentication, conflict, or policy blocks a push, leave the commit intact and give the operator the exact recovery step.
- For ordinary requested changes, complete the push as part of the task. Do not leave a finished change only in the local worktree. Keep `main`/`master` aligned with its configured remote; use the repository's actual default branch name rather than assuming one.
