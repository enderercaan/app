-- Tailmance v19 R8: response-loss closure for desired-state mutations.
-- A committed mutation whose HTTP/RPC response is lost must be safely retryable without
-- duplicating immutable legal/audit evidence, consuming another rate-limit slot, or losing
-- the intended final state. Serialize same-user/same-entity mutations, detect semantic no-ops,
-- then rate-limit only real state transitions.

create or replace function public.set_marketing_push_consent(
  p_granted boolean,
  p_consent_version text,
  p_locale text default null,
  p_country_code text default null,
  p_presented_consent_document_set_sha256 text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_last public.marketing_consent_events;
  v_preferences jsonb;
  v_user_preferences jsonb;
  v_current_consent_document_set_sha256 text;
  v_current_overlay_document_set_sha256 text;
begin
  perform public.require_active_authenticated_session();
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;

  if p_granted=false then
    -- Withdrawal remains unconditional with respect to the current legal bundle. Serialize on the
    -- account row so concurrent/replayed withdrawals cannot append duplicate immutable evidence.
    select coalesce(u.notification_preferences,'{}'::jsonb)
      into v_user_preferences
      from public.users u
      where u.id=v_user_id
      for update;
    if not found then raise exception 'account_unavailable'; end if;

    select * into v_last
      from public.marketing_consent_events e
      where e.user_id=v_user_id and e.channel='push' and e.purpose='marketing_product_updates'
      order by e.created_at desc,e.id desc
      limit 1;

    if not found or v_last.granted=false then
      if coalesce((v_user_preferences->>'marketing')::boolean,false) then
        update public.users
          set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','false'::jsonb,true),updated_at=now()
          where id=v_user_id
          returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb))
          into v_preferences;
      else
        v_preferences:='{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || v_user_preferences;
      end if;
      return jsonb_build_object('ok',true,'granted',false,'idempotent',true,'channel','push','purpose','marketing_product_updates',
        'consentVersion',case when v_last.id is null then null else v_last.consent_version end,
        'bundleId',case when v_last.id is null then null else v_last.bundle_id end,
        'legalCountryCode',case when v_last.id is null then null else v_last.country_code end,
        'uiLocale',case when v_last.id is null then null else v_last.locale end,
        'documentLocale',case when v_last.id is null then null else v_last.document_locale end,
        'consentDocumentSetSha256',case when v_last.id is null then null else v_last.consent_document_set_sha256 end,
        'notificationPreferences',v_preferences);
    end if;

    perform public.rate_limit('marketing_push_consent',20,3600);
    insert into public.marketing_consent_events(
      user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,
      consent_text_sha256,legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
    ) values(
      v_user_id,'push','marketing_product_updates',v_last.consent_version,false,v_last.locale,v_last.country_code,
      'settings_withdrawal_original_context',v_last.bundle_id,v_last.document_locale,v_last.consent_text_sha256,v_last.legal_subnational_code,
      v_last.applicability_matrix_id,v_last.consent_document_set_sha256
    );
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
      values(v_user_id,'marketing_push_consent_withdrawn','marketing_consent_event',v_last.id::text,
        jsonb_build_object('channel','push','purpose','marketing_product_updates','withdrawnFromEventId',v_last.id,
          'bundleId',v_last.bundle_id,'consentVersion',v_last.consent_version,'consentTextSha256',v_last.consent_text_sha256,
          'consentDocumentSetSha256',v_last.consent_document_set_sha256,'applicabilityMatrixId',v_last.applicability_matrix_id,
          'legalCountry',v_last.country_code,'legalSubnational',v_last.legal_subnational_code,'uiLocale',v_last.locale,'documentLocale',v_last.document_locale));
    update public.users
      set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','false'::jsonb,true),updated_at=now()
      where id=v_user_id
      returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb))
      into v_preferences;
    return jsonb_build_object('ok',true,'granted',false,'idempotent',false,'channel','push','purpose','marketing_product_updates',
      'consentVersion',v_last.consent_version,'bundleId',v_last.bundle_id,'legalCountryCode',v_last.country_code,
      'uiLocale',v_last.locale,'documentLocale',v_last.document_locale,'consentDocumentSetSha256',v_last.consent_document_set_sha256,
      'notificationPreferences',v_preferences);
  end if;

  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;

  -- Match the global legal-runtime lock ordering used by service legal-country mutation paths.
  -- Grant retries serialize here first, then lock the account preference row below.
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id for update;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.current_applicability_matrix_id is null then raise exception 'legal_context_unresolved'; end if;
  if not public.legal_applicability_matrix_satisfied(v_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;
  if p_country_code is not null and upper(trim(p_country_code))<>v_runtime.legal_country_code then raise exception 'client_country_mismatch'; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if not found then raise exception 'legal_bundle_not_current_for_context'; end if;
  if p_consent_version is distinct from v_bundle.marketing_push_consent_version then raise exception 'outdated_marketing_consent_version'; end if;
  v_current_overlay_document_set_sha256:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  if v_current_overlay_document_set_sha256 is null or v_current_overlay_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'legal_overlay_document_set_unavailable'; end if;
  if not exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id
      and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_current_overlay_document_set_sha256) then
    raise exception 'current_legal_acceptance_required';
  end if;
  if not public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id) then raise exception 'current_overlay_legal_actions_required_before_marketing_consent'; end if;
  if not public.marketing_consent_overlay_documents_complete(v_user_id,v_bundle_id) then raise exception 'marketing_consent_overlay_documents_incomplete'; end if;
  v_current_consent_document_set_sha256:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  if v_current_consent_document_set_sha256 is null or v_current_consent_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'marketing_consent_document_set_unavailable'; end if;
  if p_presented_consent_document_set_sha256 is null or p_presented_consent_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'presented_marketing_document_set_hash_required'; end if;
  if p_presented_consent_document_set_sha256<>v_current_consent_document_set_sha256 then raise exception 'marketing_document_set_changed'; end if;

  select coalesce(u.notification_preferences,'{}'::jsonb)
    into v_user_preferences from public.users u where u.id=v_user_id for update;
  if not found then raise exception 'account_unavailable'; end if;

  select * into v_last from public.marketing_consent_events e
    where e.user_id=v_user_id
      and e.bundle_id=v_bundle_id
      and e.applicability_matrix_id=v_runtime.current_applicability_matrix_id
      and e.channel='push'
      and e.purpose='marketing_product_updates'
    order by e.created_at desc,e.id desc limit 1;

  if found and v_last.granted=true
      and v_last.consent_version is not distinct from v_bundle.marketing_push_consent_version
      and v_last.consent_text_sha256 is not distinct from v_bundle.marketing_push_consent_sha256
      and v_last.consent_document_set_sha256 is not distinct from v_current_consent_document_set_sha256
      and v_last.country_code is not distinct from v_bundle.legal_country_code
      and v_last.legal_subnational_code is not distinct from v_bundle.legal_subnational_code
      and v_last.locale is not distinct from v_bundle.ui_locale
      and v_last.document_locale is not distinct from v_bundle.document_locale then
    if not coalesce((v_user_preferences->>'marketing')::boolean,false) then
      update public.users
        set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','true'::jsonb,true),updated_at=now()
        where id=v_user_id
        returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
    else
      v_preferences:='{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || v_user_preferences;
    end if;
    return jsonb_build_object('ok',true,'granted',true,'idempotent',true,'channel','push','purpose','marketing_product_updates',
      'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
      'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentDocumentSetSha256',v_current_consent_document_set_sha256,
      'notificationPreferences',v_preferences);
  end if;

  perform public.rate_limit('marketing_push_consent',20,3600);
  insert into public.marketing_consent_events(
    user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,
    legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
  ) values(
    v_user_id,'push','marketing_product_updates',v_bundle.marketing_push_consent_version,true,v_bundle.ui_locale,v_bundle.legal_country_code,
    'settings_immutable_bundle_exact_document_set',v_bundle.bundle_id,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256,
    v_bundle.legal_subnational_code,v_runtime.current_applicability_matrix_id,v_current_consent_document_set_sha256
  );
  update public.users
    set notification_preferences=jsonb_set(v_user_preferences,'{marketing}','true'::jsonb,true),updated_at=now()
    where id=v_user_id
    returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_user_id,'marketing_push_consent_granted','legal_document_bundle',v_bundle.bundle_id,
      jsonb_build_object('channel','push','purpose','marketing_product_updates','bundleId',v_bundle.bundle_id,
        'consentVersion',v_bundle.marketing_push_consent_version,'consentTextSha256',v_bundle.marketing_push_consent_sha256,
        'consentDocumentSetSha256',v_current_consent_document_set_sha256,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,
        'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
        'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale));
  return jsonb_build_object('ok',true,'granted',true,'idempotent',false,'channel','push','purpose','marketing_product_updates',
    'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentDocumentSetSha256',v_current_consent_document_set_sha256,
    'notificationPreferences',v_preferences);
end $$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text,text) to authenticated;

create or replace function public.submit_meetup_feedback(
  p_request_id uuid,p_reviewer_pet_id uuid,p_met boolean,p_felt_safe boolean default null,
  p_would_meet_again boolean default null,p_issue_category text default null,p_private_note text default null
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_match uuid;
  v_issue text:=nullif(trim(coalesce(p_issue_category,'')),'');
  v_note text:=nullif(trim(coalesce(p_private_note,'')),'');
  v_existing public.meetup_feedback;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_reviewer_pet_id) then raise exception 'forbidden'; end if;
  select match_id into v_match from public.meetup_requests
    where id=p_request_id and status='accepted' and moderation_status='approved' and starts_at<now()
    for update;
  if v_match is null then raise exception 'feedback_not_available'; end if;
  if not exists(select 1 from public.pet_matches m where m.id=v_match and p_reviewer_pet_id in(m.pet_low_id,m.pet_high_id)) then raise exception 'forbidden'; end if;
  if v_note is not null and char_length(v_note)>1000 then raise exception 'feedback_note_too_long'; end if;
  if v_issue is not null and v_issue not in ('safety_concern') then raise exception 'invalid_issue_category'; end if;
  if not p_met then
    p_felt_safe:=null;p_would_meet_again:=null;v_issue:=null;
  elsif p_felt_safe=false and v_issue is null then
    v_issue:='safety_concern';
  end if;

  select * into v_existing from public.meetup_feedback
    where meetup_request_id=p_request_id and reviewer_pet_id=p_reviewer_pet_id;
  if found
      and v_existing.met is not distinct from p_met
      and v_existing.felt_safe is not distinct from p_felt_safe
      and v_existing.would_meet_again is not distinct from p_would_meet_again
      and v_existing.issue_category is not distinct from v_issue
      and v_existing.private_note is not distinct from v_note then
    return;
  end if;

  perform public.rate_limit('meetup_feedback',20,86400);
  insert into public.meetup_feedback(meetup_request_id,reviewer_pet_id,met,felt_safe,would_meet_again,issue_category,private_note)
  values(p_request_id,p_reviewer_pet_id,p_met,p_felt_safe,p_would_meet_again,v_issue,v_note)
  on conflict(meetup_request_id,reviewer_pet_id) do update
  set met=excluded.met,felt_safe=excluded.felt_safe,would_meet_again=excluded.would_meet_again,
      issue_category=excluded.issue_category,private_note=excluded.private_note,created_at=now();
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_reviewer_pet_id,'meetup_feedback','meetup_request',p_request_id);
end $$;
revoke all on function public.submit_meetup_feedback(uuid,uuid,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.submit_meetup_feedback(uuid,uuid,boolean,boolean,boolean,text,text) to authenticated;

create or replace function public.set_account_paused(p_paused boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_paused_at timestamptz;
  v_suspended_at timestamptz;
  v_discoverable boolean;
begin
  perform public.require_active_authenticated_session();
  select u.paused_at,u.suspended_at,u.discoverable
    into v_paused_at,v_suspended_at,v_discoverable
    from public.users u where u.id=auth.uid() for update;
  if not found or v_suspended_at is not null then raise exception 'account_unavailable'; end if;

  if p_paused and v_paused_at is not null and not v_discoverable then
    return jsonb_build_object('paused',true);
  elsif not p_paused and v_paused_at is null then
    return jsonb_build_object('paused',false);
  end if;

  perform public.rate_limit('account_pause',20,3600);
  if p_paused then
    update public.users set paused_at=coalesce(paused_at,now()),discoverable=false,updated_at=now() where id=auth.uid();
  else
    update public.users set paused_at=null,updated_at=now() where id=auth.uid();
  end if;
  insert into public.audit_events(user_id,action,entity_type)
  values(auth.uid(),case when p_paused then 'account_paused' else 'account_resumed' end,'user');
  return jsonb_build_object('paused',p_paused);
end $$;
revoke all on function public.set_account_paused(boolean) from public,anon;
grant execute on function public.set_account_paused(boolean) to authenticated;

create or replace function public.update_privacy_settings(p_discoverable boolean,p_incognito boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_discoverable boolean;
  v_incognito boolean;
  v_tier public.account_tier;
begin
  perform public.require_active_authenticated_session();
  select u.discoverable,u.incognito,u.tier into v_discoverable,v_incognito,v_tier
    from public.users u where u.id=auth.uid() for update;
  if not found then raise exception 'authentication_required'; end if;
  if p_incognito and v_tier<>'premium' then raise exception 'premium_required'; end if;
  if v_discoverable is not distinct from p_discoverable and v_incognito is not distinct from p_incognito then return; end if;
  update public.users set discoverable=p_discoverable,incognito=p_incognito,updated_at=now() where id=auth.uid();
  insert into public.audit_events(user_id,action,entity_type,metadata)
  values(auth.uid(),'privacy_settings_update','user',jsonb_build_object('discoverable',p_discoverable,'incognito',p_incognito));
end $$;
revoke all on function public.update_privacy_settings(boolean,boolean) from public,anon;
grant execute on function public.update_privacy_settings(boolean,boolean) to authenticated;

create or replace function public.update_measurement_system(p_system text)
returns void language plpgsql security definer set search_path='' as $$
declare v_current text;
begin
  perform public.require_active_authenticated_session();
  if p_system not in ('metric','imperial') then raise exception 'invalid_measurement_system'; end if;
  select u.measurement_system into v_current from public.users u where u.id=auth.uid() for update;
  if not found then raise exception 'authentication_required'; end if;
  if v_current is not distinct from p_system then return; end if;
  perform public.rate_limit('measurement_system',30,3600);
  update public.users set measurement_system=p_system,updated_at=now() where id=auth.uid();
end $$;
revoke all on function public.update_measurement_system(text) from public,anon;
grant execute on function public.update_measurement_system(text) to authenticated;

create or replace function public.update_preferred_locale(p_locale text)
returns void language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
  perform public.require_active_authenticated_session();
  if p_locale not in ('en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi') then raise exception 'unsupported_locale'; end if;
  select preferred_locale into v_old from public.users where id=auth.uid() for update;
  if not found then raise exception 'authentication_required'; end if;
  if v_old is not distinct from p_locale then return; end if;
  perform public.rate_limit('preferred_locale',30,3600);
  update public.users set preferred_locale=p_locale,
    legal_version=null,
    notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),
    updated_at=now() where id=auth.uid();
end $$;
revoke all on function public.update_preferred_locale(text) from public,anon;
grant execute on function public.update_preferred_locale(text) to authenticated;

create or replace function public.update_notification_preferences(p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_allowed jsonb;
  v_start integer;
  v_end integer;
  v_timezone text;
  v_marketing boolean:=false;
  v_existing jsonb;
begin
  perform public.require_active_authenticated_session();
  if p_preferences is null or jsonb_typeof(p_preferences)<>'object' then raise exception 'invalid_notification_preferences'; end if;
  begin v_start:=coalesce((p_preferences->>'quietStartMinutes')::integer,1320); exception when others then raise exception 'invalid_quiet_hours'; end;
  begin v_end:=coalesce((p_preferences->>'quietEndMinutes')::integer,480); exception when others then raise exception 'invalid_quiet_hours'; end;
  v_timezone:=coalesce(nullif(trim(p_preferences->>'timeZone'),''),'UTC');
  if char_length(v_timezone)>64 then raise exception 'invalid_timezone'; end if;
  if v_start<0 or v_start>1439 or v_end<0 or v_end>1439 or v_start=v_end then raise exception 'invalid_quiet_hours'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'invalid_timezone'; end if;

  -- Generic notification settings are never an authority for optional marketing consent.
  -- Recompute from the exact current bundle + applicability matrix + document-set digest so a
  -- country/locale/document change cannot resurrect a stale grant that happens to share a version.
  v_marketing:=public.current_marketing_push_consent_granted(auth.uid());

  v_allowed:=jsonb_build_object(
    'matches',coalesce((p_preferences->>'matches')::boolean,true),
    'messages',coalesce((p_preferences->>'messages')::boolean,true),
    'social',coalesce((p_preferences->>'social')::boolean,true),
    'events',coalesce((p_preferences->>'events')::boolean,true),
    'health',coalesce((p_preferences->>'health')::boolean,true),
    'marketing',v_marketing,
    'quietEnabled',coalesce((p_preferences->>'quietEnabled')::boolean,false),
    'quietStartMinutes',v_start,'quietEndMinutes',v_end,'timeZone',v_timezone
  );

  select coalesce(u.notification_preferences,'{}'::jsonb) into v_existing from public.users u where u.id=auth.uid() for update;
  if not found then raise exception 'authentication_required'; end if;
  if v_existing=v_allowed then return v_allowed; end if;
  perform public.rate_limit('notification_preferences',30,3600);
  update public.users set notification_preferences=v_allowed,updated_at=now() where id=auth.uid();
  return v_allowed;
end $$;
revoke all on function public.update_notification_preferences(jsonb) from public,anon;
grant execute on function public.update_notification_preferences(jsonb) to authenticated;

create or replace function public.set_event_attendance(p_event_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_creator_pet uuid;
  v_capacity integer;
  v_going integer;
  v_existing public.event_attendance_status;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('none','going','interested') then raise exception 'invalid_status'; end if;

  select e.creator_pet_id,e.capacity into v_creator_pet,v_capacity
    from public.pet_events e
    where e.id=p_event_id and e.moderation_status='approved' and e.starts_at>now()
    for update;
  if v_creator_pet is null or public.is_blocked(p_pet_id,v_creator_pet) then raise exception 'not_found'; end if;

  select a.status into v_existing from public.event_attendees a where a.event_id=p_event_id and a.pet_id=p_pet_id;
  if p_status='none' then
    if not found then return; end if;
    perform public.rate_limit('event_attendance',100,86400);
    delete from public.event_attendees where event_id=p_event_id and pet_id=p_pet_id;
    return;
  end if;
  if found and v_existing::text=p_status then return; end if;

  if p_status='going' and v_capacity is not null then
    select count(*) into v_going from public.event_attendees
      where event_id=p_event_id and status='going' and pet_id<>p_pet_id;
    if v_going>=v_capacity then raise exception 'event_full'; end if;
  end if;
  perform public.rate_limit('event_attendance',100,86400);
  insert into public.event_attendees(event_id,pet_id,status)
    values(p_event_id,p_pet_id,p_status::public.event_attendance_status)
    on conflict(event_id,pet_id) do update set status=excluded.status;
end $$;
revoke all on function public.set_event_attendance(uuid,uuid,text) from public,anon;
grant execute on function public.set_event_attendance(uuid,uuid,text) to authenticated;

create or replace function public.join_local_waitlist(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p public.pets;
  v_count integer;
  v_user_lock uuid;
  v_exists boolean;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id;
  if p.species<>'dog' or nullif(trim(coalesce(p.neighborhood,'')),'') is null then raise exception 'dog_neighborhood_required'; end if;
  select u.id into v_user_lock from public.users u where u.id=auth.uid() for update;
  if not found then raise exception 'authentication_required'; end if;
  select exists(select 1 from public.community_waitlist w
    where w.user_id=auth.uid() and w.city=p.city and w.district=p.district and w.neighborhood=p.neighborhood) into v_exists;
  if not v_exists then
    perform public.rate_limit('community_waitlist',10,86400);
    insert into public.community_waitlist(user_id,pet_id,city,district,neighborhood)
      values(auth.uid(),p.id,p.city,p.district,p.neighborhood)
      on conflict(user_id,city,district,neighborhood) do nothing;
  end if;
  select count(*) into v_count from public.community_waitlist w
    where public.normalize_search_text(w.city)=public.normalize_search_text(p.city)
      and public.normalize_search_text(w.district)=public.normalize_search_text(p.district)
      and public.normalize_search_text(w.neighborhood)=public.normalize_search_text(p.neighborhood);
  return jsonb_build_object('joined',true,'waitlistCount',v_count);
end $$;
revoke all on function public.join_local_waitlist(uuid) from public,anon;
grant execute on function public.join_local_waitlist(uuid) to authenticated;

create or replace function public.set_travel_mode(p_pet_id uuid,p_zone_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  z public.community_launch_zones;
  v_tier public.account_tier;
  v_current_zone uuid;
  v_current_enabled boolean;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select tier into v_tier from public.users where id=auth.uid() for update;
  if not coalesce(p_enabled,false) then
    select zone_id,enabled into v_current_zone,v_current_enabled from public.user_travel_mode where user_id=auth.uid();
    if not found then return jsonb_build_object('enabled',false); end if;
    delete from public.user_travel_mode where user_id=auth.uid();
    return jsonb_build_object('enabled',false);
  end if;
  if v_tier<>'premium' then raise exception 'premium_required'; end if;
  select * into z from public.community_launch_zones where id=p_zone_id and active and launch_status in ('pilot_open','open');
  if z.id is null then raise exception 'travel_zone_unavailable'; end if;
  select zone_id,enabled into v_current_zone,v_current_enabled from public.user_travel_mode where user_id=auth.uid();
  if found and v_current_enabled=true and v_current_zone=z.id then
    return jsonb_build_object('enabled',true,'zoneId',z.id,'city',z.city,'district',z.district,'neighborhood',z.neighborhood,'pilot',z.launch_status='pilot_open');
  end if;
  perform public.rate_limit('travel_mode_change',20,86400);
  insert into public.user_travel_mode(user_id,zone_id,enabled,updated_at) values(auth.uid(),z.id,true,now())
    on conflict(user_id) do update set zone_id=excluded.zone_id,enabled=true,updated_at=now();
  return jsonb_build_object('enabled',true,'zoneId',z.id,'city',z.city,'district',z.district,'neighborhood',z.neighborhood,'pilot',z.launch_status='pilot_open');
end $$;
revoke all on function public.set_travel_mode(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_travel_mode(uuid,uuid,boolean) to authenticated;

create or replace function public.update_pet_private_location(p_pet_id uuid,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_lat double precision;
  v_lon double precision;
  v_current_lat double precision;
  v_current_lon double precision;
  v_pet_lock uuid;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'invalid_coordinates'; end if;
  v_lat:=round(p_latitude::numeric,3)::double precision;
  v_lon:=round(p_longitude::numeric,3)::double precision;
  select id into v_pet_lock from public.pets where id=p_pet_id for update;
  select latitude,longitude into v_current_lat,v_current_lon from public.pet_private where pet_id=p_pet_id;
  if found and v_current_lat is not distinct from v_lat and v_current_lon is not distinct from v_lon then return; end if;
  perform public.rate_limit('private_location_update',120,86400);
  insert into public.pet_private(pet_id,latitude,longitude) values(p_pet_id,v_lat,v_lon)
    on conflict(pet_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
end $$;
revoke all on function public.update_pet_private_location(uuid,double precision,double precision) from public,anon;
grant execute on function public.update_pet_private_location(uuid,double precision,double precision) to authenticated;
