\set ON_ERROR_STOP 0
\pset tuples_only on
begin;
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values('11111111-1111-4111-8111-111111111111','smoke@example.test',now());
insert into public.users(id) values('11111111-1111-4111-8111-111111111111');
set local session_replication_role=origin;
insert into public.billing_webhook_events(event_id,event_type,user_ids,status,claim_token,claimed_at)
values('rc_evt_smoke_1','NON_RENEWING_PURCHASE',array['11111111-1111-4111-8111-111111111111']::uuid[],'processing','22222222-2222-4222-8222-222222222222',now());
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select 'GRANT_RESULT', public.apply_consumable_billing_webhook_event('rc_evt_smoke_1','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','boost_pack_5','boost',5,'txn-smoke-1','app_smoke','SANDBOX');
select 'BALANCE', boost_credits, super_like_credits from public.consumable_balances where user_id='11111111-1111-4111-8111-111111111111';
select 'EVENT_STATUS', status from public.billing_webhook_events where event_id='rc_evt_smoke_1';
select 'AUDIT', action, entity_id is null, metadata->>'billingEventId' from public.audit_events where action='consumable_credit_granted';
rollback;
begin;
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values('33333333-3333-4333-8333-333333333333','smoke2@example.test',now());
insert into public.users(id) values('33333333-3333-4333-8333-333333333333');
insert into auth.sessions(id,user_id,aal) values('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','aal1');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333","session_id":"44444444-4444-4444-8444-444444444444","aal":"aal1","iat":'||extract(epoch from now())::bigint||'}',true);
select 'FEATURE_POLICY_ARGS_OK', (public.get_product_feature_policy() ? 'catsInDiscovery');
rollback;
select 'JSONB_KEYS_EXPR', (select count(*) from jsonb_object_keys('{"a":1,"b":2}'::jsonb));
