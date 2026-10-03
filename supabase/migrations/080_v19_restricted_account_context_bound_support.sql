-- v19 R7: context-bound support remains available to paused/suspended accounts.
-- Product-access restrictions must not force users onto a global or wrong-jurisdiction support URL.

create or replace function public.get_restricted_account_legal_support(p_ui_locale text)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_support_url text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(v_locale) not between 2 and 16 then
    return jsonb_build_object('status','blocked_unsupported_ui_locale');
  end if;

  -- Intentionally resolve the exact reviewed legal route without requiring current social/product access.
  -- resolve_current_legal_bundle_id still enforces verified legal country, subnational/applicability review,
  -- age assurance, document-language evidence, immutable manifests and exact UI-locale routing.
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then
    return jsonb_build_object('status','blocked_legal_support_context_unavailable','uiLocale',v_locale);
  end if;

  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select d.document_url into v_support_url
    from public.legal_bundle_documents d
   where d.bundle_id=v_bundle_id and d.document_type='support'
   limit 1;

  if v_support_url is null or not public.legal_document_url_allowed(v_support_url) then
    return jsonb_build_object(
      'status','blocked_legal_support_document_unavailable',
      'bundleId',v_bundle_id,
      'legalCountryCode',v_bundle.legal_country_code,
      'legalSubnationalCode',v_bundle.legal_subnational_code,
      'uiLocale',v_bundle.ui_locale,
      'documentLocale',v_bundle.document_locale
    );
  end if;

  return jsonb_build_object(
    'status','ready',
    'bundleId',v_bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,
    'supportUrl',v_support_url
  );
end $$;
revoke all on function public.get_restricted_account_legal_support(text) from public,anon;
grant execute on function public.get_restricted_account_legal_support(text) to authenticated;
