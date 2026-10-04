-- Tailmance v19 legal-jurisdiction signal provenance hardening.
-- UI language, device/current presence, nationality/identity-document provenance and storefront are evidence signals,
-- not interchangeable legal-jurisdiction conclusions. Verified jurisdiction must be based on attributable
-- habitual-residence/service-contract evidence or a documented manual legal review.

alter table public.legal_country_runtime
  add column if not exists habitual_residence_country_code text check (habitual_residence_country_code is null or habitual_residence_country_code ~ '^[A-Z]{2}$'),
  add column if not exists service_contract_country_code text check (service_contract_country_code is null or service_contract_country_code ~ '^[A-Z]{2}$'),
  add column if not exists current_presence_country_code text check (current_presence_country_code is null or current_presence_country_code ~ '^[A-Z]{2}$');

alter table public.legal_country_runtime drop constraint if exists legal_country_runtime_resolution_source_check;
alter table public.legal_country_runtime add constraint legal_country_runtime_resolution_source_check check (
  resolution_source in (
    'unresolved','storefront_verified','service_country_verified','identity_verified','manual_legal_review',
    'habitual_residence_verified','service_contract_country_verified'
  )
);

-- Historical rows verified from identity/storefront/service-country alone are not carried forward as a legal conclusion.
-- They remain auditable but fail closed until re-resolved through the v2 provenance-aware service path.
update public.legal_country_runtime
set resolution_status='blocked',updated_at=now()
where resolution_status='verified'
  and resolution_source in ('identity_verified','storefront_verified','service_country_verified');

create or replace function public.service_set_legal_country_runtime_v2(
  p_user_id uuid,
  p_legal_country_code text,
  p_legal_subnational_code text,
  p_resolution_status text,
  p_resolution_source text,
  p_habitual_residence_country_code text,
  p_service_contract_country_code text,
  p_current_presence_country_code text,
  p_storefront_country_code text,
  p_operational_country_code text,
  p_country_mismatch_reviewed boolean,
  p_evidence_reference jsonb,
  p_resolved_by text,
  p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_legal_country_code,'')));
  v_subnational text:=upper(trim(coalesce(p_legal_subnational_code,'')));
  v_residence text:=upper(trim(coalesce(p_habitual_residence_country_code,'')));
  v_contract text:=upper(trim(coalesce(p_service_contract_country_code,'')));
  v_presence text:=upper(trim(coalesce(p_current_presence_country_code,'')));
  v_storefront text:=upper(trim(coalesce(p_storefront_country_code,'')));
  v_operational text:=upper(trim(coalesce(p_operational_country_code,'')));
  v_previous_country text;
  v_previous_subnational text;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'user_required'; end if;
  if p_resolution_status not in ('pending','verified','blocked') then raise exception 'invalid_resolution_status'; end if;
  if p_resolution_source not in ('unresolved','storefront_verified','service_country_verified','identity_verified','manual_legal_review','habitual_residence_verified','service_contract_country_verified') then raise exception 'invalid_resolution_source'; end if;
  if v_country<>'' and v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country_code'; end if;
  if v_subnational<>'' and v_subnational !~ '^[A-Z0-9-]{1,32}$' then raise exception 'invalid_subnational_code'; end if;
  if v_residence<>'' and v_residence !~ '^[A-Z]{2}$' then raise exception 'invalid_habitual_residence_country'; end if;
  if v_contract<>'' and v_contract !~ '^[A-Z]{2}$' then raise exception 'invalid_service_contract_country'; end if;
  if v_presence<>'' and v_presence !~ '^[A-Z]{2}$' then raise exception 'invalid_current_presence_country'; end if;
  if v_storefront<>'' and v_storefront !~ '^[A-Z]{2}$' then raise exception 'invalid_storefront_country'; end if;
  if v_operational<>'' and v_operational !~ '^[A-Z]{2}$' then raise exception 'invalid_operational_country'; end if;
  if v_country<>'' and not exists(select 1 from public.legal_jurisdiction_policies where legal_country_code=v_country) then raise exception 'unlisted_country_blocked'; end if;

  if p_resolution_status='verified' then
    if v_country='' or p_resolution_source not in ('habitual_residence_verified','service_contract_country_verified','manual_legal_review') then
      raise exception 'verified_jurisdiction_requires_residence_contract_or_manual_legal_review';
    end if;
    if coalesce(jsonb_typeof(p_evidence_reference),'')<>'array' or jsonb_array_length(p_evidence_reference)=0 then raise exception 'verified_country_requires_attributable_evidence'; end if;
    if nullif(trim(coalesce(p_resolved_by,'')),'') is null then raise exception 'verified_country_requires_resolver'; end if;
    if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '90 days' then raise exception 'verified_country_evidence_expired_or_overlong'; end if;
    if p_resolution_source='habitual_residence_verified' and (v_residence='' or v_residence<>v_country) then raise exception 'habitual_residence_must_match_legal_country'; end if;
    if p_resolution_source='service_contract_country_verified' and (v_contract='' or v_contract<>v_country) then raise exception 'service_contract_country_must_match_legal_country'; end if;
    -- Storefront and service-market mismatch are review signals. Current physical presence is deliberately
    -- excluded because travel must never silently switch or block a user's established legal jurisdiction.
    if ((v_storefront<>'' and v_storefront<>v_country) or (v_operational<>'' and v_operational<>v_country) or (v_contract<>'' and v_contract<>v_country) or (v_residence<>'' and v_residence<>v_country))
       and coalesce(p_country_mismatch_reviewed,false) is distinct from true then raise exception 'country_mismatch_review_required'; end if;
  end if;

  select legal_country_code,legal_subnational_code into v_previous_country,v_previous_subnational
  from public.legal_country_runtime where user_id=p_user_id for update;

  insert into public.legal_country_runtime(
    user_id,legal_country_code,legal_subnational_code,resolution_status,resolution_source,
    habitual_residence_country_code,service_contract_country_code,current_presence_country_code,
    storefront_country_code,operational_country_code,country_mismatch_reviewed,evidence_reference,
    resolved_by,resolved_at,expires_at,updated_at
  ) values(
    p_user_id,nullif(v_country,''),nullif(v_subnational,''),p_resolution_status,p_resolution_source,
    nullif(v_residence,''),nullif(v_contract,''),nullif(v_presence,''),nullif(v_storefront,''),nullif(v_operational,''),
    coalesce(p_country_mismatch_reviewed,false),coalesce(p_evidence_reference,'[]'::jsonb),nullif(trim(coalesce(p_resolved_by,'')),''),
    case when p_resolution_status='verified' then now() else null end,p_expires_at,now()
  ) on conflict(user_id) do update set
    legal_country_code=excluded.legal_country_code,legal_subnational_code=excluded.legal_subnational_code,
    resolution_status=excluded.resolution_status,resolution_source=excluded.resolution_source,
    habitual_residence_country_code=excluded.habitual_residence_country_code,
    service_contract_country_code=excluded.service_contract_country_code,current_presence_country_code=excluded.current_presence_country_code,
    storefront_country_code=excluded.storefront_country_code,operational_country_code=excluded.operational_country_code,
    country_mismatch_reviewed=excluded.country_mismatch_reviewed,evidence_reference=excluded.evidence_reference,
    resolved_by=excluded.resolved_by,resolved_at=excluded.resolved_at,expires_at=excluded.expires_at,updated_at=now();

  if v_previous_country is distinct from nullif(v_country,'') or v_previous_subnational is distinct from nullif(v_subnational,'') or p_resolution_status<>'verified' then
    update public.users set legal_version=null,
      notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
    where id=p_user_id;
  end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_jurisdiction_runtime_v2_changed','user',p_user_id,jsonb_build_object(
    'previousCountry',v_previous_country,'previousSubnational',v_previous_subnational,
    'legalCountry',nullif(v_country,''),'legalSubnational',nullif(v_subnational,''),
    'resolutionStatus',p_resolution_status,'resolutionSource',p_resolution_source,
    'habitualResidenceCountry',nullif(v_residence,''),'serviceContractCountry',nullif(v_contract,''),
    'currentPresenceCountry',nullif(v_presence,''),'storefrontCountry',nullif(v_storefront,''),
    'operationalCountry',nullif(v_operational,''),'countryMismatchReviewed',coalesce(p_country_mismatch_reviewed,false)
  ));
  return jsonb_build_object('ok',true,'legalCountryCode',nullif(v_country,''),'legalSubnationalCode',nullif(v_subnational,''),'resolutionStatus',p_resolution_status);
end $$;
revoke all on function public.service_set_legal_country_runtime_v2(uuid,text,text,text,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_set_legal_country_runtime_v2(uuid,text,text,text,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) to service_role;

-- Legacy setter remains for rollback/block/manual-review operations only. It may not establish a new verified
-- jurisdiction from storefront, identity-document or ambiguous service-country signals.
create or replace function public.service_set_legal_country_runtime(
  p_user_id uuid,p_legal_country_code text,p_legal_subnational_code text,p_resolution_status text,p_resolution_source text,
  p_storefront_country_code text,p_operational_country_code text,p_country_mismatch_reviewed boolean,p_evidence_reference jsonb,
  p_resolved_by text,p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_resolution_status='verified' and p_resolution_source<>'manual_legal_review' then
    raise exception 'legacy_legal_country_resolution_source_not_sufficient_use_v2';
  end if;
  return public.service_set_legal_country_runtime_v2(
    p_user_id,p_legal_country_code,p_legal_subnational_code,p_resolution_status,p_resolution_source,
    null,null,null,p_storefront_country_code,p_operational_country_code,p_country_mismatch_reviewed,
    p_evidence_reference,p_resolved_by,p_expires_at
  );
end $$;
revoke all on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) to service_role;

revoke all on table public.legal_country_runtime from public,anon,authenticated;
grant select,insert,update,delete on table public.legal_country_runtime to service_role;
