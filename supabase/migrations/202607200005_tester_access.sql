alter table public.profiles add column if not exists tester_tier text
  check (tester_tier in ('business'));
alter table public.profiles add column if not exists tester_access_starts_at timestamptz;
alter table public.profiles add column if not exists tester_access_expires_at timestamptz;

create table if not exists public.tester_campaigns (
  id text primary key,
  name text not null,
  tier text not null default 'business' check (tier = 'business'),
  duration_days integer not null default 60 check (duration_days between 1 and 365),
  max_redemptions integer not null check (max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  active boolean not null default true,
  redeem_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tester_redemptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.tester_campaigns(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  access_expires_at timestamptz not null,
  unique (user_id)
);
create index if not exists tester_redemptions_campaign_idx on public.tester_redemptions(campaign_id, redeemed_at);

alter table public.tester_campaigns enable row level security;
alter table public.tester_redemptions enable row level security;
revoke all on public.tester_campaigns from anon, authenticated;
revoke all on public.tester_redemptions from anon, authenticated;

insert into public.tester_campaigns(id, name, duration_days, max_redemptions, active, redeem_until)
values ('builders-beta-2026', 'Builders Invoice Beta 2026', 60, 100, true, '2027-01-31 23:59:59+00')
on conflict (id) do nothing;

create or replace function public.redeem_tester_campaign(target_user_id uuid, campaign_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  campaign public.tester_campaigns%rowtype;
  existing public.tester_redemptions%rowtype;
  starts_at timestamptz := now();
  expires_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into existing from public.tester_redemptions where user_id = target_user_id;
  if found then
    return jsonb_build_object('tier', 'business', 'redeemed_at', existing.redeemed_at,
      'expires_at', existing.access_expires_at, 'already_redeemed', true);
  end if;
  select * into campaign from public.tester_campaigns where id = campaign_key for update;
  if not found or not campaign.active then raise exception 'Tester campaign is not active' using errcode = 'P0002'; end if;
  if campaign.redeem_until is not null and now() > campaign.redeem_until then
    raise exception 'Tester campaign has ended' using errcode = 'P0001';
  end if;
  if campaign.redemption_count >= campaign.max_redemptions then
    raise exception 'Tester campaign is full' using errcode = 'P0001';
  end if;
  expires_at := starts_at + make_interval(days => campaign.duration_days);
  insert into public.tester_redemptions(campaign_id, user_id, redeemed_at, access_expires_at)
  values (campaign.id, target_user_id, starts_at, expires_at);
  update public.tester_campaigns set redemption_count = redemption_count + 1 where id = campaign.id;
  update public.profiles set tester_tier = campaign.tier, tester_access_starts_at = starts_at,
    tester_access_expires_at = expires_at, updated_at = now() where id = target_user_id;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('tier', campaign.tier, 'redeemed_at', starts_at,
    'expires_at', expires_at, 'already_redeemed', false);
end;
$$;
revoke all on function public.redeem_tester_campaign(uuid,text) from public, anon, authenticated;
grant execute on function public.redeem_tester_campaign(uuid,text) to service_role;

-- Tester entitlement fields are server-owned alongside billing state.
create or replace function public.protect_profile_security_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.subscription_tier := 'free'; new.stripe_customer_id := null; new.stripe_subscription_id := null;
      new.stripe_account_id := null; new.quotes_this_month := 0;
      new.quota_reset_month := to_char(timezone('utc', now()), 'YYYY-MM');
      new.tester_tier := null; new.tester_access_starts_at := null; new.tester_access_expires_at := null;
    elsif new.subscription_tier is distinct from old.subscription_tier
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_account_id is distinct from old.stripe_account_id
      or new.quotes_this_month is distinct from old.quotes_this_month
      or new.quota_reset_month is distinct from old.quota_reset_month
      or new.tester_tier is distinct from old.tester_tier
      or new.tester_access_starts_at is distinct from old.tester_access_starts_at
      or new.tester_access_expires_at is distinct from old.tester_access_expires_at then
      raise exception 'Billing, tester access, and quota fields are server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_monthly_quote_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_tier text; quote_count integer; reset_month text;
  current_month text := to_char(timezone('utc', now()), 'YYYY-MM'); tester_expires timestamptz;
begin
  if new.user_id is distinct from (select auth.uid()) then raise exception 'Quote owner does not match authenticated user' using errcode='42501'; end if;
  select coalesce(subscription_tier,'free'), coalesce(quotes_this_month,0), quota_reset_month, tester_access_expires_at
    into profile_tier, quote_count, reset_month, tester_expires from public.profiles where id=new.user_id for update;
  if not found then raise exception 'Profile not found' using errcode='23503'; end if;
  if tester_expires > now() then profile_tier := 'business'; end if;
  if profile_tier='free' then
    if reset_month is distinct from current_month then quote_count:=0; update public.profiles set quotes_this_month=0,quota_reset_month=current_month where id=new.user_id; end if;
    if quote_count>=3 then raise exception 'Free plan monthly quote limit reached' using errcode='P0001'; end if;
    update public.profiles set quotes_this_month=quote_count+1,quota_reset_month=current_month where id=new.user_id;
  end if;
  return new;
end;
$$;
