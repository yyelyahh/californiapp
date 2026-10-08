# Architecture rules

- Pending purchase edits use one admin-only, RLS-respecting database transaction with a parent-row lock and an updated-at check; this avoids partial item updates, editing received orders, and overwriting stale purchases.
- Purchase creation and editing share the same purchase sheet; this keeps catalog selectors and totals consistent.