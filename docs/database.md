# Database

Apply migrations in filename order.

## Main entities

- `profiles` — business configuration, plan, quota, and Stripe identifiers.
- `clients` — reusable client records.
- `quotes` / `quote_items` — quote snapshot and line items.
- `invoices` / `invoice_items` — invoice snapshot and line items.
- `expenses` — manual job or overhead costs.
- `shared_documents` — immutable-style HTML snapshots referenced by UUID.
- `document_events` — quote and invoice creation/status audit history.

Quotes and invoices retain client snapshot fields for historical accuracy while `client_id` provides normalized grouping.

## Money

New `*_cents` columns are authoritative for calculations and payments. Legacy decimal columns remain temporarily for backward compatibility. New code should populate both until a later migration removes the decimal columns.

## Atomic saves

`save_quote_with_items(document, items)` and `save_invoice_with_items(document, items)` replace the previous delete-and-reinsert sequence. PostgreSQL rolls back the complete function when any parent or line-item write fails.

## Row-level security

Application rows are scoped to `auth.uid()`. Line-item access is inherited through the owning quote or invoice. Billing and quota fields on profiles are server-managed. Public shared documents are retrieved through the exact-UUID server endpoint rather than anonymous table reads.
