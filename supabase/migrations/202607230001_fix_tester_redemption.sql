-- SECURITY DEFINER changes current_user to the function owner, so caller checks
-- must be enforced with EXECUTE privileges rather than current_user.
create or replace function public.redeem_tester_campaign(target_user_id uuid, campaign_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  campaign public.tester_campaigns%rowtype;
  existing public.tester_redemptions%rowtype;
  starts_at timestamptz := now();
  expires_at timestamptz;
begin
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
