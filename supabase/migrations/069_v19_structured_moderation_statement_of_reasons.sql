-- Tailmance v19 structured moderation statement-of-reasons capability.
-- This source model supports attributable, user-facing moderation explanations and future jurisdiction-specific
-- regulatory reporting. It does NOT self-classify Tailmance under the DSA or prove any live regulator submission.

create table if not exists public.moderation_statement_of_reasons (
  id uuid primary key default gen_random_uuid(),
  moderation_decision_id uuid not null unique references public.moderation_decisions(id) on delete restrict,
  affected_user_id uuid references auth.users(id) on delete set null,
  basis_type text not null check (basis_type in ('illegal_content','terms_violation','both','other')),
  legal_ground_reference text check (legal_ground_reference is null or char_length(trim(legal_ground_reference)) between 3 and 1000),
  terms_ground_reference text check (terms_ground_reference is null or char_length(trim(terms_ground_reference)) between 3 and 1000),
  facts_summary text not null check (char_length(trim(facts_summary)) between 3 and 4000),
  territorial_scope text[] not null default '{}'::text[],
  automated_detection_used boolean not null default false,
  automated_decision_used boolean not null default false,
  redress_available boolean not null default true,
  redress_deadline timestamptz,
  created_at timestamptz not null default now(),
  check (basis_type not in ('illegal_content','both') or legal_ground_reference is not null),
  check (basis_type not in ('terms_violation','both') or terms_ground_reference is not null),
  check (not redress_available or redress_deadline is not null)
);
create index if not exists moderation_statement_affected_idx on public.moderation_statement_of_reasons(affected_user_id,created_at desc);
alter table public.moderation_statement_of_reasons enable row level security;
revoke all on table public.moderation_statement_of_reasons from public,anon,authenticated;
grant select,insert on table public.moderation_statement_of_reasons to service_role;

create or replace function public.prevent_moderation_statement_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'moderation_statement_of_reasons_is_append_only';
end $$;
revoke all on function public.prevent_moderation_statement_mutation() from public,anon,authenticated;
drop trigger if exists trg_moderation_statement_append_only on public.moderation_statement_of_reasons;
create trigger trg_moderation_statement_append_only
before update or delete on public.moderation_statement_of_reasons
for each row execute function public.prevent_moderation_statement_mutation();

create or replace function public.record_moderation_statement_of_reasons(
  p_decision_id uuid,
  p_basis_type text,
  p_legal_ground_reference text,
  p_terms_ground_reference text,
  p_facts_summary text,
  p_territorial_scope text[],
  p_automated_detection_used boolean,
  p_automated_decision_used boolean
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_decision public.moderation_decisions;v_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_decision_id is null then raise exception 'decision_required'; end if;
  select * into v_decision from public.moderation_decisions where id=p_decision_id;
  if not found then raise exception 'decision_not_found'; end if;
  select id into v_id from public.moderation_statement_of_reasons where moderation_decision_id=p_decision_id;
  if v_id is not null then return v_id; end if;
  if p_basis_type not in ('illegal_content','terms_violation','both','other') then raise exception 'invalid_statement_basis'; end if;
  if p_facts_summary is null or char_length(trim(p_facts_summary)) not between 3 and 4000 then raise exception 'statement_facts_required'; end if;
  if p_basis_type in ('illegal_content','both') and nullif(trim(coalesce(p_legal_ground_reference,'')),'') is null then raise exception 'legal_ground_reference_required'; end if;
  if p_basis_type in ('terms_violation','both') and nullif(trim(coalesce(p_terms_ground_reference,'')),'') is null then raise exception 'terms_ground_reference_required'; end if;
  if v_decision.action='account_restricted' and coalesce(p_automated_decision_used,false) then raise exception 'account_restriction_cannot_be_solely_automated'; end if;
  insert into public.moderation_statement_of_reasons(
    moderation_decision_id,affected_user_id,basis_type,legal_ground_reference,terms_ground_reference,facts_summary,
    territorial_scope,automated_detection_used,automated_decision_used,redress_available,redress_deadline
  ) values(
    v_decision.id,v_decision.affected_user_id,p_basis_type,nullif(trim(coalesce(p_legal_ground_reference,'')),''),
    nullif(trim(coalesce(p_terms_ground_reference,'')),''),trim(p_facts_summary),coalesce(p_territorial_scope,'{}'::text[]),
    coalesce(p_automated_detection_used,false),coalesce(p_automated_decision_used,false),true,v_decision.decided_at+interval '6 months'
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_moderation_statement_of_reasons(uuid,text,text,text,text,text[],boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_moderation_statement_of_reasons(uuid,text,text,text,text,text[],boolean,boolean) to service_role;

-- Enrich the user's decision ledger with structured grounds while keeping private operational/regulatory evidence hidden.
create or replace function public.get_my_moderation_decisions()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'targetType',d.target_type,'targetId',d.target_id,'action',d.action,'source',d.source,
    'reason',d.user_visible_reason,'status',d.status,'decidedAt',d.decided_at,
    'appealDeadline',d.decided_at+interval '6 months',
    'basisType',s.basis_type,'legalGroundReference',s.legal_ground_reference,'termsGroundReference',s.terms_ground_reference,
    'factsSummary',s.facts_summary,'territorialScope',s.territorial_scope,
    'automatedDetectionUsed',s.automated_detection_used,'automatedDecisionUsed',s.automated_decision_used,
    'redressAvailable',s.redress_available,'redressDeadline',s.redress_deadline,
    'appeal',(select jsonb_build_object('id',a.id,'role',a.appellant_role,'statement',a.statement,'status',a.status,'submittedAt',a.submitted_at,'decidedAt',a.decided_at,'outcomeExplanation',a.outcome_explanation)
      from public.moderation_appeals a where a.decision_id=d.id and a.appellant_user_id=auth.uid())
  ) order by d.decided_at desc),'[]'::jsonb) else '[]'::jsonb end
  from public.moderation_decisions d
  left join public.moderation_statement_of_reasons s on s.moderation_decision_id=d.id
  where d.affected_user_id=auth.uid() or d.reporter_user_id=auth.uid();
$$;
revoke all on function public.get_my_moderation_decisions() from public,anon;
grant execute on function public.get_my_moderation_decisions() to authenticated;
