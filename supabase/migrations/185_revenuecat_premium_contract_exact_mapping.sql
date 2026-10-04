-- Tailmance v19 R8: pin the Premium client contract to one explicit RevenueCat entitlement/package pair.
-- Historical subscription rows keep the entitlement identifier observed when they were written.
-- New writes must always pass the provider entitlement explicitly; a stale schema default must never
-- silently relabel an event after a RevenueCat configuration change.

alter table public.subscriptions alter column entitlement_id drop default;

comment on column public.subscriptions.entitlement_id is
  'Exact RevenueCat entitlement identifier observed for this subscription record. Production release contract: tailmance_premium; no database default is permitted.';
