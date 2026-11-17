-- Proposed local state only. No invoice payloads, names, notes, or PDFs.
-- No processing app currently consumes this schema.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE invoice_jobs (
    id INTEGER PRIMARY KEY,
    encompass_invoice_id TEXT NOT NULL UNIQUE,
    invoice_number TEXT NOT NULL,
    distributor_id TEXT NOT NULL,
    encompass_task_id TEXT,
    invoiceapprove_invoice_id TEXT,
    submission_state TEXT NOT NULL DEFAULT 'discovered' CHECK (
        submission_state IN (
            'discovered', 'needs_review', 'ready', 'submitting',
            'submitted', 'submission_unknown', 'failed', 'skipped'
        )
    ),
    task_state TEXT NOT NULL DEFAULT 'not_requested' CHECK (
        task_state IN ('not_requested', 'pending', 'complete', 'blocked', 'unknown')
    ),
    -- Controlled remote state code, never a human's note.
    portal_status TEXT,
    reviewed_payload_sha256 TEXT,
    attachment_sha256 TEXT,
    source_revision_sha256 TEXT,
    -- UUID-based path only; never a source document filename or signed URL.
    intended_upload_object_path TEXT,
    last_verified_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code TEXT CHECK (
        last_error_code IS NULL OR last_error_code IN (
            'AUTH_REQUIRED', 'ACCOUNT_CHANGED', 'OUT_OF_SCOPE',
            'MAPPING_REQUIRED', 'SOURCE_CHANGED', 'FIELD_MISMATCH',
            'DUPLICATE_FOUND', 'UPLOAD_UNCERTAIN', 'SUBMIT_UNCERTAIN',
            'MINIMUM_NOT_MET', 'TASK_CHANGED', 'TASK_MISSING',
            'REMOTE_UNAVAILABLE', 'VERIFICATION_FAILED'
        )
    ),
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (distributor_id, invoice_number)
);

CREATE TABLE job_events (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES invoice_jobs(id),
    stage TEXT NOT NULL CHECK (
        stage IN ('discover', 'review', 'upload', 'submit', 'reconcile', 'complete_task', 'monitor')
    ),
    outcome TEXT NOT NULL CHECK (
        outcome IN ('started', 'verified', 'blocked', 'uncertain', 'failed', 'skipped')
    ),
    -- Validated code from invoice_jobs.last_error_code's vocabulary; no free text.
    error_code TEXT CHECK (
        error_code IS NULL OR error_code IN (
            'AUTH_REQUIRED', 'ACCOUNT_CHANGED', 'OUT_OF_SCOPE',
            'MAPPING_REQUIRED', 'SOURCE_CHANGED', 'FIELD_MISMATCH',
            'DUPLICATE_FOUND', 'UPLOAD_UNCERTAIN', 'SUBMIT_UNCERTAIN',
            'MINIMUM_NOT_MET', 'TASK_CHANGED', 'TASK_MISSING',
            'REMOTE_UNAVAILABLE', 'VERIFICATION_FAILED'
        )
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX invoice_jobs_state ON invoice_jobs(submission_state, task_state);
CREATE INDEX job_events_job ON job_events(job_id, id);

-- Application responsibilities:
-- 1. Claim leases in a short BEGIN IMMEDIATE transaction before remote work.
-- 2. Require a durable 'started' intent before a remote write.
-- 3. Reconcile expired leases and uncertain outcomes before any retry.
-- 4. Rehydrate payloads after restart and compare reviewed digests.
-- 5. Preserve source invoice prefixes and revalidate server duplicate semantics.
-- 6. Explicitly update updated_at; SQLite does not do this automatically.
