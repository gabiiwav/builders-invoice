-- Durable, idempotent invoice payment state for direct Stripe charges.

create table if not exists public.invoice_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_account_id text not null,
  amount_cents bigint not null check (amount_cents >= 50),
  invoice_updated_at timestamptz not null,
  stripe_session_id text unique,
  checkout_url text,
  payment_intent_id text,
  charge_id text,
  refunded_amount_cents bigint not null default 0 check (refunded_amount_cents >= 0),
  status text not null default 'creating'
    check (status in ('creating','open','paid','expired','failed','refunded')),
  expires_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_active_invoice_payment_attempt
  on public.invoice_payment_attempts(invoice_id)
  where status in ('creating','open');

create index if not exists invoice_payment_attempts_reconcile_idx
  on public.invoice_payment_attempts(status, expires_at)
  where status in ('creating','open');

alter table public.invoice_payment_attempts enable row level security;
revoke all on public.invoice_payment_attempts from public, anon, authenticated;

create or replace function public.lock_invoice_with_active_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.total_cents is distinct from old.total_cents
     or new.total is distinct from old.total then
    if exists (
      select 1 from public.invoice_payment_attempts
      where invoice_id = old.id
        and status in ('creating','open')
        and (expires_at is null or expires_at > now())
    ) then
      raise exception 'Invoice amount is locked while a card payment is active';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_invoice_amount_during_payment on public.invoices;
create trigger lock_invoice_amount_during_payment
before update on public.invoices
for each row execute function public.lock_invoice_with_active_payment();

create or replace function public.complete_invoice_payment(
  attempt_id uuid,
  session_id text,
  connected_account_id text,
  paid_amount_cents bigint,
  payment_intent text,
  charge text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt public.invoice_payment_attempts%rowtype;
  invoice_row public.invoices%rowtype;
begin
  select * into attempt from public.invoice_payment_attempts
    where id = attempt_id for update;
  if not found then raise exception 'Payment attempt not found'; end if;

  if attempt.status = 'paid' then return true; end if;
  if attempt.status <> 'open' then raise exception 'Payment attempt is not open'; end if;
  if attempt.stripe_session_id <> session_id
     or attempt.stripe_account_id <> connected_account_id
     or attempt.amount_cents <> paid_amount_cents then
    raise exception 'Payment attempt verification failed';
  end if;

  select * into invoice_row from public.invoices
    where id = attempt.invoice_id and user_id = attempt.user_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if coalesce(invoice_row.total_cents, round(invoice_row.total * 100)::bigint)
     <> attempt.amount_cents then
    raise exception 'Invoice amount changed after payment was authorized';
  end if;

  update public.invoice_payment_attempts
    set status = 'paid', payment_intent_id = payment_intent,
        charge_id = charge, updated_at = now()
    where id = attempt.id;
  update public.invoices set status = 'Paid'
    where id = attempt.invoice_id and user_id = attempt.user_id;
  return true;
end;
$$;

create or replace function public.record_invoice_refund(
  refunded_charge_id text,
  connected_account_id text,
  refund_amount_cents bigint,
  fully_refunded boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt public.invoice_payment_attempts%rowtype;
begin
  select * into attempt from public.invoice_payment_attempts
    where charge_id = refunded_charge_id
      and stripe_account_id = connected_account_id
      and status = 'paid'
    for update;
  if not found then return false; end if;

  update public.invoice_payment_attempts
    set status = case when fully_refunded then 'refunded' else 'paid' end,
        refunded_amount_cents = greatest(0, refund_amount_cents),
        updated_at = now()
    where id = attempt.id;
  update public.invoices
    set status = case when fully_refunded then 'Refunded' else 'Partially Refunded' end
    where id = attempt.invoice_id and user_id = attempt.user_id
      and status in ('Paid', 'Partially Refunded');
  return true;
end;
$$;

revoke all on function public.complete_invoice_payment(uuid,text,text,bigint,text,text)
  from public, anon, authenticated;
revoke all on function public.record_invoice_refund(text,text,bigint,boolean)
  from public, anon, authenticated;
grant execute on function public.complete_invoice_payment(uuid,text,text,bigint,text,text)
  to service_role;
grant execute on function public.record_invoice_refund(text,text,bigint,boolean)
  to service_role;
