# Architecture rules

- Pending purchase edits use one admin-only, RLS-respecting database transaction with a parent-row lock and an updated-at check; this avoids partial item updates, editing received orders, and overwriting stale purchases.
- Purchase creation and editing share the same purchase sheet; this keeps catalog selectors and totals consistent.
- Preserve StoreContext identity through Vite hot data during Fast Refresh; mounted providers and updated consumers must reference the same context instead of blanking the preview.