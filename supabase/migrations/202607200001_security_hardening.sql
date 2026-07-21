-- Security boundary for browser-accessible application data.
-- Review in a staging project before applying to production.

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.expenses enable row level security;
alter table public.shared_documents enable row level security;

-- Permissive policies combine with OR, so remove legacy policies before installing
-- the complete application policy set below.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles', 'clients', 'quotes', 'quote_items', 'invoices',
        'invoice_items', 'expenses', 'shared_documents'
      ])
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$$;

drop policy if exists "app_profiles_owner" on public.profiles;
drop policy if exists "app_profiles_owner_select" on public.profiles;
drop policy if exists "app_profiles_owner_insert" on public.profiles;
drop policy if exists "app_profiles_owner_update" on public.profiles;
create policy "app_profiles_owner_select" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "app_profiles_owner_insert" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy "app_profiles_owner_update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "app_clients_owner" on public.clients;
create policy "app_clients_owner" on public.clients
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "app_quotes_owner" on public.quotes;
create policy "app_quotes_owner" on public.quotes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "app_quote_items_owner" on public.quote_items;
create policy "app_quote_items_owner" on public.quote_items
  for all to authenticated
  using (exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id and q.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id and q.user_id = (select auth.uid())
  ));

drop policy if exists "app_invoices_owner" on public.invoices;
create policy "app_invoices_owner" on public.invoices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "app_invoice_items_owner" on public.invoice_items;
create policy "app_invoice_items_owner" on public.invoice_items
  for all to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id and i.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id and i.user_id = (select auth.uid())
  ));

drop policy if exists "app_expenses_owner" on public.expenses;
create policy "app_expenses_owner" on public.expenses
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "app_shared_documents_owner_write" on public.shared_documents;
create policy "app_shared_documents_owner_write" on public.shared_documents
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Public documents are fetched by exact UUID through /api/shared-document.
-- Anonymous table access remains disabled to prevent document enumeration.
drop policy if exists "app_shared_documents_public_read" on public.shared_documents;
revoke all on table public.shared_documents from anon;

-- Retire the custom browser-managed password reset table.
alter table if exists public.password_resets enable row level security;
revoke all on table public.password_resets from anon, authenticated;

-- Users may edit ordinary profile fields, but billing and quota state is server-owned.
create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.subscription_tier := 'free';
      new.stripe_customer_id := null;
      new.stripe_subscription_id := null;
      new.stripe_account_id := null;
      new.quotes_this_month := 0;
      new.quota_reset_month := to_char(timezone('utc', now()), 'YYYY-MM');
    elsif
      new.subscription_tier is distinct from old.subscription_tier or
      new.stripe_customer_id is distinct from old.stripe_customer_id or
      new.stripe_subscription_id is distinct from old.stripe_subscription_id or
      new.stripe_account_id is distinct from old.stripe_account_id or
      new.quotes_this_month is distinct from old.quotes_this_month or
      new.quota_reset_month is distinct from old.quota_reset_month
    then
      raise exception 'Billing and quota fields are server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_security_fields() from public;
drop trigger if exists protect_profile_security_fields on public.profiles;
create trigger protect_profile_security_fields
  before insert or update on public.profiles
  for each row execute function public.protect_profile_security_fields();

create or replace function public.enforce_monthly_quote_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_tier text;
  quote_count integer;
  reset_month text;
  current_month text := to_char(timezone('utc', now()), 'YYYY-MM');
begin
  if new.user_id is distinct from (select auth.uid()) then
    raise exception 'Quote owner does not match authenticated user' using errcode = '42501';
  end if;

  select coalesce(subscription_tier, 'free'), coalesce(quotes_this_month, 0), quota_reset_month
    into profile_tier, quote_count, reset_month
  from public.profiles
  where id = new.user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = '23503';
  end if;

  if profile_tier = 'free' then
    if reset_month is distinct from current_month then
      quote_count := 0;
      update public.profiles
      set quotes_this_month = 0, quota_reset_month = current_month
      where id = new.user_id;
    end if;

    if quote_count >= 3 then
      raise exception 'Free plan monthly quote limit reached' using errcode = 'P0001';
    end if;

    update public.profiles
    set quotes_this_month = quote_count + 1, quota_reset_month = current_month
    where id = new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_monthly_quote_quota() from public;

drop trigger if exists enforce_monthly_quote_quota on public.quotes;
create trigger enforce_monthly_quote_quota
  before insert on public.quotes
  for each row execute function public.enforce_monthly_quote_quota();
