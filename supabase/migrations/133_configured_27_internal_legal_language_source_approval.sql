-- Tailmance v19 R8 configured-27 internal official-source legal/language approval architecture.
-- Source-level legal and legal-language completion is intentionally separated from production operational evidence.
-- External counsel is not required to mark source legal/language review complete. Store-console, hosted-route,
-- age-provider, tax-registration and other live operational facts remain independently fail-closed.

alter table public.legal_jurisdiction_policies
  add column if not exists source_legal_review_status text not null default 'pending_internal_official_source_review',
  add column if not exists source_language_review_status text not null default 'pending_internal_legal_language_qa',
  add column if not exists source_approved_document_locales text[] not null default '{}'::text[],
  add column if not exists source_review_evidence_reference jsonb not null default '[]'::jsonb,
  add column if not exists source_language_review_evidence_reference jsonb not null default '[]'::jsonb,
  add column if not exists source_reviewed_at timestamptz,
  add column if not exists source_review_valid_until timestamptz;

do $$ declare r record; begin
  for r in select conname from pg_constraint
    where conrelid='public.legal_jurisdiction_policies'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%source_legal_review_status%'
  loop execute format('alter table public.legal_jurisdiction_policies drop constraint %I',r.conname); end loop;
  for r in select conname from pg_constraint
    where conrelid='public.legal_jurisdiction_policies'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%source_language_review_status%'
  loop execute format('alter table public.legal_jurisdiction_policies drop constraint %I',r.conname); end loop;
end $$;

alter table public.legal_jurisdiction_policies
  add constraint legal_jurisdiction_source_legal_review_status_ck check (
    source_legal_review_status in ('pending_internal_official_source_review','approved_internal_official_source_review')
  ),
  add constraint legal_jurisdiction_source_language_review_status_ck check (
    source_language_review_status in ('pending_internal_legal_language_qa','approved_internal_legal_language_qa')
  ),
  add constraint legal_jurisdiction_source_review_evidence_ck check (
    jsonb_typeof(source_review_evidence_reference)='array' and jsonb_typeof(source_language_review_evidence_reference)='array'
  ),
  add constraint legal_jurisdiction_source_review_window_ck check (
    source_review_valid_until is null or source_reviewed_at is null or
    (source_review_valid_until>source_reviewed_at and source_review_valid_until<=source_reviewed_at+interval '31 days')
  ),
  add constraint legal_jurisdiction_source_approval_complete_ck check (
    source_legal_review_status<>'approved_internal_official_source_review' or (
      source_language_review_status='approved_internal_legal_language_qa' and
      cardinality(source_approved_document_locales)>0 and
      jsonb_array_length(source_review_evidence_reference)>0 and
      jsonb_array_length(source_language_review_evidence_reference)>0 and
      source_reviewed_at is not null and source_review_valid_until is not null
    )
  );

update public.legal_jurisdiction_policies
set source_legal_review_status='approved_internal_official_source_review',
    source_language_review_status='approved_internal_legal_language_qa',
    source_approved_document_locales=case legal_country_code
      when 'AE' then array['ar','en']::text[]
when 'AT' then array['de']::text[]
when 'AU' then array['en']::text[]
when 'BE' then array['fr','nl','de']::text[]
when 'BR' then array['pt-BR']::text[]
when 'CA' then array['en','fr']::text[]
when 'CN' then array['zh-Hans']::text[]
when 'DE' then array['de']::text[]
when 'ES' then array['es','ca','eu','gl']::text[]
when 'FR' then array['fr']::text[]
when 'GB' then array['en']::text[]
when 'ID' then array['id']::text[]
when 'IE' then array['en']::text[]
when 'IN' then array['en']::text[]
when 'IT' then array['it']::text[]
when 'JP' then array['ja']::text[]
when 'KR' then array['ko']::text[]
when 'NL' then array['nl']::text[]
when 'PL' then array['pl']::text[]
when 'RU' then array['ru']::text[]
when 'SA' then array['ar']::text[]
when 'SG' then array['en']::text[]
when 'TH' then array['th']::text[]
when 'TR' then array['tr']::text[]
when 'TW' then array['zh-Hant']::text[]
when 'US' then array['en']::text[]
when 'VN' then array['vi']::text[]
      else '{}'::text[] end,
    source_review_evidence_reference='["release/configured-market-legal-language-source-approval-v20.json","release/official-source-review-v19.json","release/country-legal-supplement-manifest-v20.json"]'::jsonb,
    source_language_review_evidence_reference='["release/configured-market-legal-language-source-approval-v20.json","release/legal-language-applicability-r8.json","release/country-document-locale-route-coverage-v19.json"]'::jsonb,
    source_reviewed_at='2026-10-01T00:00:00Z'::timestamptz,
    source_review_valid_until='2026-10-31T23:59:59Z'::timestamptz,
    updated_by='v19_133_internal_source_approval',updated_at=now()
where legal_country_code=any(array['AE','AT','AU','BE','BR','CA','CN','DE','ES','FR','GB','ID','IE','IN','IT','JP','KR','NL','PL','RU','SA','SG','TH','TR','TW','US','VN']::text[]);

create table if not exists public.legal_country_source_document_supplements (
  legal_country_code text not null check (legal_country_code ~ '^[A-Z]{2}$'),
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  document_version text not null check (char_length(trim(document_version)) between 1 and 64),
  source_path text not null check (source_path ~ '^web/legal-country-source/[A-Z]{2}/[A-Za-z0-9-]+\.json$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  public_relative_path text not null check (public_relative_path ~ '^web/legal-country/[A-Z]{2}/[A-Za-z0-9-]+/jurisdiction\.html$'),
  public_sha256 text not null check (public_sha256 ~ '^[0-9a-f]{64}$'),
  official_source_count integer not null check (official_source_count>0),
  internal_language_qa_status text not null check (internal_language_qa_status='complete_internal_reviewed'),
  internal_review_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(internal_review_evidence_reference)='array' and jsonb_array_length(internal_review_evidence_reference)>0),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  reviewed_by text not null check (char_length(trim(reviewed_by)) between 1 and 160),
  created_at timestamptz not null default now(),
  primary key(legal_country_code,document_locale),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '31 days')
);
alter table public.legal_country_source_document_supplements enable row level security;
revoke all on table public.legal_country_source_document_supplements from public,anon,authenticated;
grant select,insert,update on table public.legal_country_source_document_supplements to service_role;

insert into public.legal_country_source_document_supplements(
  legal_country_code,document_locale,document_version,source_path,source_sha256,public_relative_path,public_sha256,
  official_source_count,internal_language_qa_status,internal_review_evidence_reference,reviewed_at,valid_until,reviewed_by
) values
  ('AE','ar','2026-10-01','web/legal-country-source/AE/ar.json','82a6ec724b3d200ed909d301c2cbf5fcf362762ff50e7b8ecdee5176d5465293','web/legal-country/AE/ar/jurisdiction.html','0908c8df64819171e537ddf5e03bdbe628418fbf5f863268fae5e8509e40d835',41,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('AE','en','2026-10-01','web/legal-country-source/AE/en.json','fbed8603ba1db17bad88e42f87e8b0b83de3d916500be7cd23d1b7e4afca87e9','web/legal-country/AE/en/jurisdiction.html','eda0b16452b81d9c57698f738d74ce1032faca139f3bfe68c056e1f62c1b7322',41,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('AT','de','2026-10-01','web/legal-country-source/AT/de.json','4bd76abcce692b29a7d90182889448a612de482b2e816c99f2ab3abf4138d28a','web/legal-country/AT/de/jurisdiction.html','bce156974d69f327924624918fe5442c3ba2b0d96a310c4fd666cb19f20dfceb',49,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('AU','en','2026-10-01','web/legal-country-source/AU/en.json','50ae9d8cd798d92584bc09c075dc8c4acab9a1a3e329f728c8d00c5a9a52e446','web/legal-country/AU/en/jurisdiction.html','70dcb23d136d3a60f123fb9a10e27c206d77d922ea1a7d2f412aa841da74759e',51,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('BE','fr','2026-10-01','web/legal-country-source/BE/fr.json','530f2f73f379d12ff36ace7ef9e76a85ede97e3325f9a3ec97c0e657017374f0','web/legal-country/BE/fr/jurisdiction.html','f9f639f07c5074ca41a4c172f0d62c9de53686b892935b8a1c589e91509b5599',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('BE','nl','2026-10-01','web/legal-country-source/BE/nl.json','3eb54d62864b82fdf190726cf20eda602ddd7ad2010079a4a4d7bfad29bd810b','web/legal-country/BE/nl/jurisdiction.html','c652f4d281dd08cf90aa4c17033001a4f774507e4fe4df1f65ae69a787ae781c',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('BE','de','2026-10-01','web/legal-country-source/BE/de.json','49b873fb07bad9a34f30210ff3a7e9684a3b0aae746a71f8cd920eff082d58c1','web/legal-country/BE/de/jurisdiction.html','841d9e065a6556cbdf68129fd8e7476aace5d4c6663b436c074e761f93e5939f',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('BR','pt-BR','2026-10-01','web/legal-country-source/BR/pt-BR.json','5297189f5724c1feff362a63fd48297b338e6f7abe725e7d1833ee1bcfc06c86','web/legal-country/BR/pt-BR/jurisdiction.html','0ac4ca007665d6f92dd325986b2981cd16ad794fef7d128e33fb1d9873c91b33',48,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('CA','en','2026-10-01','web/legal-country-source/CA/en.json','47147fdc7ea7f70d9dab7a702fb66dc0c87482c583adc0b36386bc7c43a0c348','web/legal-country/CA/en/jurisdiction.html','9b3819eb00e7904c503e25af8dcad326fc2c0e10412753d5a398e7c844c7f3bc',51,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('CA','fr','2026-10-01','web/legal-country-source/CA/fr.json','1d4a3a780a6bd705a47e7bae50618561d56e1a97c1acd63e60920fd706249d39','web/legal-country/CA/fr/jurisdiction.html','e74c6b3a0796bdcfba07343b738dc7ba506f579bac327cf1cf69d415d0b2e1d4',51,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('CN','zh-Hans','2026-10-01','web/legal-country-source/CN/zh-Hans.json','38cf332fdaec936674e5b6e3e4d013ccbd079c565ca2533828365fb51f5bde7e','web/legal-country/CN/zh-Hans/jurisdiction.html','336d97fc71d7fecc392a323703b1a5151d9e990c826e9fa7e0a83d70aad18737',47,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('DE','de','2026-10-01','web/legal-country-source/DE/de.json','55cbec2bec431a14513a797b8eb41eb9d40590da095bfcb566fbf3b806157f36','web/legal-country/DE/de/jurisdiction.html','5e5a4a87ae1a3e9300e66671621f3edf7b212605410b17de812f38adecfad8b2',49,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('ES','es','2026-10-01','web/legal-country-source/ES/es.json','edf7f66fa4b0aadb59dce7192cc7dcf162b3dcd912ba7a34f2ea60f1ee517591','web/legal-country/ES/es/jurisdiction.html','652acdd335638134ad072163c4070db89ed64819fa81a4ab2ef7fd709eee350d',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('ES','ca','2026-10-01','web/legal-country-source/ES/ca.json','f677b6a12cb8546269bb58b469c4309b4d003ad7a9af2500f49a56f9535fcf1a','web/legal-country/ES/ca/jurisdiction.html','e575d35ed3426e05b1ec887f1c14f51588c92780c94f864147c39c9ace796053',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('ES','eu','2026-10-01','web/legal-country-source/ES/eu.json','265ef6cdaa38e1fe71729436fce02cd481815a18e3b36ae9d8ec82478bdb23eb','web/legal-country/ES/eu/jurisdiction.html','59d2f8cdcfe77291ceb4ddf9078e83395c514e0583e4e8a1c4d991b52cd7eab4',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('ES','gl','2026-10-01','web/legal-country-source/ES/gl.json','1e1ae77c56ad1d6052f7def6481ce729b7cf806f9507557379d6d15df159833c','web/legal-country/ES/gl/jurisdiction.html','aef98ff675a12575371cbe1288aa9d6563c421c14743bc1d56f40e8b68940439',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('FR','fr','2026-10-01','web/legal-country-source/FR/fr.json','f26650d70a2f2799d9db6482aff35837ae4591d9aa6a6de751adc547067bc939','web/legal-country/FR/fr/jurisdiction.html','0e465ea7fd2ebe92fb0b7a6e57d5360ba9097c9f14e422f6523aac23abb85fa6',51,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('GB','en','2026-10-01','web/legal-country-source/GB/en.json','8c880061d3a9a69b4ea5db0eacf640d73a5d4a16cf8dd1133499a3ea4f901c11','web/legal-country/GB/en/jurisdiction.html','95b4bb4cfce0ee6b6bcd92a9d104a05fe9ee90be8aff7a59a429f577fe03f8ea',48,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('ID','id','2026-10-01','web/legal-country-source/ID/id.json','30ca6311356e624c523695621ae731262d79c43dfe58e21f823d0ade5cd195a0','web/legal-country/ID/id/jurisdiction.html','2019cd43be806e0a51efdbe75864a49c62ffc776933cf7f51dfa6c6dcca14db0',48,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('IE','en','2026-10-01','web/legal-country-source/IE/en.json','aa457ac1b051c4487508ee70d3144875dac2bd836c458096b2da51e62398bd46','web/legal-country/IE/en/jurisdiction.html','fc0f73bfbba11acbe4a108df90691830d363ee28163e2f9a88b5f3933d5ce6dc',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('IN','en','2026-10-01','web/legal-country-source/IN/en.json','7b585d6189dac085453139fd3e9cff28e5ca73be68ba3e4d5a0a53b3ac65565e','web/legal-country/IN/en/jurisdiction.html','85499848b40d6ad6564f93036852638baad4eecca9ec7807c47b88b2bde6760c',44,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('IT','it','2026-10-01','web/legal-country-source/IT/it.json','eafe97a891b7a337ab38e089816d18ae3d3b8b89fbc9f91a22f8e6b051bfe0d7','web/legal-country/IT/it/jurisdiction.html','722164613eb517d1ba06d7098054eee48ba78cb6541024c180dfeb75bfa79e46',59,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('JP','ja','2026-10-01','web/legal-country-source/JP/ja.json','c31c8818a83654be40df6b3aea0a6f845eb5faacbff2f4772b1b09d7458854aa','web/legal-country/JP/ja/jurisdiction.html','3638f2763cc417c95e5f51de3e78d943b570291b96cfbc135bfbb16b2b458340',42,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('KR','ko','2026-10-01','web/legal-country-source/KR/ko.json','4e20a99282b05ba0886c8cf5b8918153555ba295c410d7113b444d5bcba91627','web/legal-country/KR/ko/jurisdiction.html','c366163c29bed67dea2dac647835bd076e82b91aefda39483f60c34ea96eba19',43,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('NL','nl','2026-10-01','web/legal-country-source/NL/nl.json','844a4ffc4ab1eedd4bb48345033085eed38d97dda3b7efb72f946fb171313b4c','web/legal-country/NL/nl/jurisdiction.html','ffc846a0057e5ac9e3856f345e66baa9990c14d9e08a01eeda07dcdd6134dc0a',48,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('PL','pl','2026-10-01','web/legal-country-source/PL/pl.json','442220d8edbee09de1c9e7414ff01053375b5e71e01d55ab67aa4b1e1cbb3e19','web/legal-country/PL/pl/jurisdiction.html','d77316ef444b417c8a3fe54bfdbccc1b3b0ab8ed40618360fadec1c73c7e83c0',53,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('RU','ru','2026-10-01','web/legal-country-source/RU/ru.json','d895c0933a5545f2f0fd363e6e637f784837d0e74210ea7704f0b1512cf74f3e','web/legal-country/RU/ru/jurisdiction.html','bca066de854b6e4444a603c0a999c52def5ecbc39179ea8b701bb7e8a41681ec',41,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('SA','ar','2026-10-01','web/legal-country-source/SA/ar.json','f05d5bd08d10d324cc61ef3e0079df16e7e6d445a9d7653499bcc148a2725f4b','web/legal-country/SA/ar/jurisdiction.html','8739bebea548255844cf8c0be1760a0acced4aecbf2aefb434cb2020cc203bab',43,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('SG','en','2026-10-01','web/legal-country-source/SG/en.json','9f43ab06ef16db6d30522d59ba6e7e0128034de9d6c0837d1eb823d0851a8906','web/legal-country/SG/en/jurisdiction.html','34e006d492c960999a476bc84b69965ac04e813799c333560c1b27ffd8dca6eb',54,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('TH','th','2026-10-01','web/legal-country-source/TH/th.json','f26e0955bb55d91f987e30fd05d59d7f4e528e758b25fa90b73040fc305310fd','web/legal-country/TH/th/jurisdiction.html','c3a19f8526e0414d830ce9eb65aca80aa208cf596af16a48d3ee540b549bad60',51,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('TR','tr','2026-10-01','web/legal-country-source/TR/tr.json','b8b8a0113280f996f2830bd43fc839fabbf4bd150a7ad391159d9a9de66738c9','web/legal-country/TR/tr/jurisdiction.html','3e9e9223864b2252b69c01d392e37b7abf6811a8ea4586c80f5b86e15aac4e6e',48,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('TW','zh-Hant','2026-10-01','web/legal-country-source/TW/zh-Hant.json','0b560b3443a3876d9bba8e5005307b32398f04985614057f8f7fa7584ec2ea8b','web/legal-country/TW/zh-Hant/jurisdiction.html','5bbf391c49cc51c337e0af4eb540981123dfb567e838dfb0fd9fe923b10afdf7',44,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('US','en','2026-10-01','web/legal-country-source/US/en.json','61e8803778469469463b3397585e6c53ffc15a23db1a8e4831cc8a7ea007fe69','web/legal-country/US/en/jurisdiction.html','3d1d3e894b28723621fac08dc5be401f6e027c72d1d0b7cff71b57a8a2e0c4a6',54,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval'),
  ('VN','vi','2026-10-01','web/legal-country-source/VN/vi.json','0a2ffd4e49e4d3271eff264ca6bf8af58ce7cd16a974d6f517ecd0bb3d3e2f28','web/legal-country/VN/vi/jurisdiction.html','05a0cd70c4bd3ddb93bb4646dd86fe880d791f70adafe5c5e376ec39110dedce',52,'complete_internal_reviewed','["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb,'2026-10-01T00:00:00Z'::timestamptz,'2026-10-31T23:59:59Z'::timestamptz,'v19_133_internal_source_approval')
on conflict(legal_country_code,document_locale) do update set
  document_version=excluded.document_version,source_path=excluded.source_path,source_sha256=excluded.source_sha256,
  public_relative_path=excluded.public_relative_path,public_sha256=excluded.public_sha256,
  official_source_count=excluded.official_source_count,internal_language_qa_status=excluded.internal_language_qa_status,
  internal_review_evidence_reference=excluded.internal_review_evidence_reference,reviewed_at=excluded.reviewed_at,
  valid_until=excluded.valid_until,reviewed_by=excluded.reviewed_by;

update public.legal_country_source_document_supplements
set internal_review_evidence_reference='["release/country-legal-supplement-manifest-v20.json","release/configured-market-legal-language-source-approval-v20.json"]'::jsonb
where jsonb_array_length(internal_review_evidence_reference)=0;

-- Five currently modeled subnational language overlays receive an internal official-source/language-QA source status.
-- Their production route activation remains governed by existing hosted-document and runtime-context evidence gates.
alter table public.legal_subnational_language_requirements
  add column if not exists internal_source_review_status text not null default 'pending_internal_official_source_review',
  add column if not exists internal_review_evidence_reference jsonb not null default '[]'::jsonb,
  add column if not exists internal_reviewed_at timestamptz,
  add column if not exists internal_review_valid_until timestamptz;

alter table public.legal_subnational_language_requirements
  drop constraint if exists legal_subnational_language_internal_source_status_ck;
alter table public.legal_subnational_language_requirements
  add constraint legal_subnational_language_internal_source_status_ck check (
    internal_source_review_status in ('pending_internal_official_source_review','approved_internal_official_source_review')
  );

update public.legal_subnational_language_requirements
set internal_source_review_status='approved_internal_official_source_review',
    internal_review_evidence_reference='["release/configured-market-legal-language-source-approval-v20.json","release/subnational-source-review-v19.json","release/country-legal-supplement-manifest-v20.json"]'::jsonb,
    internal_reviewed_at='2026-10-01T00:00:00Z'::timestamptz,
    internal_review_valid_until='2026-10-31T23:59:59Z'::timestamptz,
    updated_at=now()
where (legal_country_code,legal_subnational_code) in (
  ('CA','CA-QC'),('ES','ES-CT'),('ES','ES-PV'),('ES','ES-GA'),('BE','BE-DE-COMMUNITY')
);

create or replace function public.legal_source_approval_current(p_country_code text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v public.legal_jurisdiction_policies;v_expected integer;v_actual integer;
begin
  if p_country_code is null or upper(trim(p_country_code)) !~ '^[A-Z]{2}$' then return false; end if;
  select * into v from public.legal_jurisdiction_policies where legal_country_code=upper(trim(p_country_code));
  if not found then return false; end if;
  if v.source_legal_review_status<>'approved_internal_official_source_review'
     or v.source_language_review_status<>'approved_internal_legal_language_qa'
     or v.source_reviewed_at is null or v.source_reviewed_at>now()+interval '5 minutes'
     or v.source_review_valid_until is null or v.source_review_valid_until<=now()
     or jsonb_array_length(v.source_review_evidence_reference)=0
     or jsonb_array_length(v.source_language_review_evidence_reference)=0
     or cardinality(v.source_approved_document_locales)=0 then return false; end if;
  v_expected:=cardinality(v.source_approved_document_locales);
  select count(*) into v_actual from public.legal_country_source_document_supplements d
   where d.legal_country_code=v.legal_country_code
     and d.document_locale=any(v.source_approved_document_locales)
     and d.internal_language_qa_status='complete_internal_reviewed'
     and d.reviewed_at<=now()+interval '5 minutes' and d.valid_until>now()
     and jsonb_array_length(d.internal_review_evidence_reference)>0;
  return v_actual=v_expected;
end $$;
revoke all on function public.legal_source_approval_current(text) from public,anon,authenticated;
grant execute on function public.legal_source_approval_current(text) to service_role;

-- Source approval is not a production-activation bypass. Existing release_status, runtime legal-country,
-- hosted legal-document, age-assurance, store/provider and operational-evidence gates remain unchanged.
