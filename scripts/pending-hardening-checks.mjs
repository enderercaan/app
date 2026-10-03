import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
const patch=globSync('supabase/migrations/{011,012,013,014,015,016,017,018,019,020,021,022,023,024}_*.sql').sort().map(p=>readFileSync(p,'utf8')).join('\n');
const checks=[]; const check=(name,fn)=>{fn();checks.push(name)};
check('blocked chat direct read is closed',()=>assert.match(patch,/messages_participant_read[\s\S]*unmatched_at is null[\s\S]*not public\.is_blocked/));
check('paged chat requires active unblocked match',()=>assert.match(patch,/get_conversation_messages_page[\s\S]*m\.unmatched_at is null[\s\S]*not public\.is_blocked/));
check('comment mutation cannot bypass blocks',()=>assert.match(patch,/create_comment[\s\S]*public\.is_blocked/));
check('post like and save cannot bypass blocks',()=>{assert.match(patch,/toggle_post_like[\s\S]*public\.is_blocked/);assert.match(patch,/toggle_save_post[\s\S]*public\.is_blocked/)});
check('story view cannot bypass visibility or blocks',()=>assert.match(patch,/mark_story_seen[\s\S]*public\.is_blocked[\s\S]*public\.follows/));
check('event attendance checks visibility block and capacity',()=>assert.match(patch,/set_event_attendance[\s\S]*moderation_status='approved'[\s\S]*public\.is_blocked[\s\S]*event_full/));
check('message report requires conversation participation',()=>assert.match(patch,/p_target_type='message'[\s\S]*p_reporter_pet_id in\(m\.pet_low_id,m\.pet_high_id\)/));
check('pass and favorite respect blocks',()=>{assert.match(patch,/pass_pet[\s\S]*public\.is_blocked/);assert.match(patch,/toggle_favorite_pet[\s\S]*public\.is_blocked/)});
check('block semantics prevent alternate-pet bypass',()=>assert.match(patch,/Treat a safety block as owner-to-owner[\s\S]*create or replace function public\.is_blocked[\s\S]*owner_id/));
check('signed media reads respect blocks',()=>assert.match(patch,/can_read_storage_object[\s\S]*public\.is_blocked/));
check('block severs cross-owner social relationships and meetups',()=>assert.match(patch,/Blocking severs active social relationships[\s\S]*meetup_requests[\s\S]*delete from public\.follows[\s\S]*delete from public\.pet_likes[\s\S]*delete from public\.pet_favorites/));
check('meetup reads require active unblocked match',()=>assert.match(patch,/get_meetup_requests[\s\S]*m\.unmatched_at is null[\s\S]*not public\.is_blocked/));
check('upload-intent consume is concurrency safe',()=>assert.match(patch,/consume_upload_intent[\s\S]*update public\.upload_intents[\s\S]*consumed_at is null[\s\S]*cancelled_at is null[\s\S]*returning id into v_id/));
check('external deletion queue survives local user deletion',()=>{assert.match(patch,/create table if not exists public\.external_deletion_queue/);assert.doesNotMatch(patch,/external_deletion_queue[\s\S]{0,500}references auth\.users/) });

check('read receipts require active unblocked match',()=>assert.match(patch,/mark_conversation_read[\s\S]*unmatched_at is null[\s\S]*not public\.is_blocked[\s\S]*active_match_required/));
check('post comment reads hide blocked authors',()=>assert.match(patch,/get_post_comments[\s\S]*not public\.is_blocked\(p_pet_id,po\.pet_id\)[\s\S]*not public\.is_blocked\(p_pet_id,c\.pet_id\)/));
check('undo pass cannot restore blocked target',()=>assert.match(patch,/undo_last_pass[\s\S]*public\.is_blocked\(p_pet_id,v_target\)/));
check('block clears pass relationships across owners',()=>assert.match(patch,/delete from public\.pet_passes[\s\S]*owner_id=v_blocker_owner/));

check('push registration is bounded and rate limited',()=>{assert.match(patch,/register_push_token[\s\S]*push_token_register[\s\S]*limit 10/);assert.match(patch,/invalid_push_token/)});
check('upload intents are bounded against storage abuse',()=>assert.match(patch,/create_upload_intent[\s\S]*upload_intent',40,3600[\s\S]*v_active>=12[\s\S]*too_many_active_uploads/));
check('upload extensions are derived from MIME type',()=>assert.match(patch,/v_ext:=case p_mime_type[\s\S]*application\/pdf[\s\S]*then 'pdf'/));
check('private location writes are rate limited',()=>assert.match(patch,/update_pet_private_location[\s\S]*private_location_update/));
check('meetup response transition is locked and state checked',()=>{assert.match(patch,/respond_meetup_request[\s\S]*for update/);assert.match(patch,/respond_meetup_request[\s\S]*request_not_pending/);assert.match(patch,/respond_meetup_request[\s\S]*meetup_response/)});
check('matches are hidden behind effective block state',()=>assert.match(patch,/get_matches[\s\S]*not public\.is_blocked\(m\.pet_low_id,m\.pet_high_id\)/));
check('legacy blocked relationships are reconciled',()=>assert.match(patch,/Reconcile relationships[\s\S]*update public\.pet_matches[\s\S]*delete from public\.follows[\s\S]*delete from public\.pet_likes/));
check('reverse safety and ownership indexes are prepared',()=>{for(const idx of ['idx_blocks_blocked_pet','idx_follows_to','idx_reports_reporter_created','idx_post_likes_pet_created','idx_saved_posts_pet_created','idx_story_views_viewer_created'])assert.match(patch,new RegExp(idx))});


check('moderation queue has bounded retry metadata',()=>{assert.match(patch,/alter table public\.moderation_items add column if not exists attempts/);assert.match(patch,/manual_review_required/);assert.match(patch,/idx_moderation_retry_queue/)});

check('push worker query paths have matching indexes',()=>{assert.match(patch,/idx_notifications_push_pending_due/);assert.match(patch,/idx_push_tokens_user_enabled_seen/);assert.match(patch,/idx_push_receipts_notification_status/)});
check('pending SQL does not contain duplicated get_matches select header',()=>assert.doesNotMatch(patch,/get_matches[\s\S]{0,200}select coalesce\(jsonb_agg\(jsonb_build_object\([\s\S]{0,40}select coalesce\(jsonb_agg\(jsonb_build_object\(/));
check('profile payload bounds temperament neighborhood and purposes',()=>{
  assert.match(patch,/pets_neighborhood_length_check[\s\S]*validate_pet_payload/);
  assert.match(patch,/jsonb_array_length\(v_tags\)>12[\s\S]*invalid_temperament_tags/);
  assert.match(patch,/invalid_purposes[\s\S]*socialize[\s\S]*playmate[\s\S]*mating[\s\S]*walk/);
});
check('five-pet cap is serialized against concurrent creates',()=>{
  assert.match(patch,/upsert_pet_profile[\s\S]*suspended_at is null and paused_at is null for update[\s\S]*v_count>=5[\s\S]*pet_limit_reached/);
});
check('discovery filters are bounded against query amplification',()=>{
  assert.match(patch,/validate_discovery_filters[\s\S]*octet_length\(v::text\)>12000[\s\S]*breeds[\s\S]*temperamentTags/);
});
check('discovery preserves incognito and strict distance semantics',()=>{
  assert.match(patch,/discover_pets[\s\S]*not u\.incognito or exists[\s\S]*v_max_distance[\s\S]*v_private\.latitude is not null and v_private\.longitude is not null and pp\.latitude is not null and pp\.longitude is not null/);
});
check('discovery ranks before limiting candidates',()=>{
  assert.match(patch,/ranked as \([\s\S]*order by compatibility_score desc,fairness_key[\s\S]*limit 100[\s\S]*jsonb_agg/);
});
check('mating discovery is fail closed while launch safety dependencies remain unresolved',()=>{
  assert.match(patch,/v_purposes \? 'mating'[\s\S]*mating_feature_disabled/);
  assert.match(patch,/coalesce\(v->'purposes','\[\]'::jsonb\) \? 'mating'[\s\S]*mating_feature_disabled/);
  assert.doesNotMatch(patch,/v_mating\s*:=/);
});
check('event capacity check is serialized',()=>{
  assert.match(patch,/set_event_attendance[\s\S]*for update[\s\S]*v_going>=v_capacity[\s\S]*event_full/);
});
check('private coordinates are rounded server side',()=>{
  assert.match(patch,/update_pet_private_location[\s\S]*round\(p_latitude::numeric,3\)[\s\S]*round\(p_longitude::numeric,3\)/);
});
check('suspended accounts cannot own active mutation identity',()=>{
  assert.match(patch,/create or replace function public\.owns_pet[\s\S]*suspended_at is null/);
});
check('direct UUID likes respect discoverability and incognito',()=>{
  assert.match(patch,/like_pet[\s\S]*u\.discoverable[\s\S]*not u\.incognito or exists[\s\S]*target_unavailable/);
});
check('follow cannot bypass hidden or incognito target',()=>{
  assert.match(patch,/toggle_follow_pet[\s\S]*u\.discoverable[\s\S]*not u\.incognito or exists[\s\S]*target_unavailable/);
});
check('legacy report RPC delegates to canonical report validation',()=>{
  assert.match(patch,/report_pet[\s\S]*return public\.report_content\(p_reporter_pet_id,'pet',p_reported_pet_id,p_reason,p_details\)/);
});
check('discovery suggestions exclude hidden suspended incognito and blocked profiles',()=>{
  assert.match(patch,/get_discovery_suggestions[\s\S]*u\.suspended_at is null[\s\S]*u\.discoverable[\s\S]*not u\.incognito[\s\S]*public\.is_blocked/);
});
check('incoming likes suppress suspended or hidden source accounts',()=>{
  assert.match(patch,/get_incoming_likes[\s\S]*source_user\.suspended_at is null and source_user\.paused_at is null and source_user\.discoverable/);
});
check('pet health self-claims are rate limited and audited',()=>{
  assert.match(patch,/update_pet_health_claims[\s\S]*pet_health_claim_update[\s\S]*audit_events/);
});
check('message send serializes against match closure',()=>{
  assert.match(patch,/send_message[\s\S]*for share of m[\s\S]*active_match_required/);
});
check('meetup creation serializes against block or unmatch',()=>{
  assert.match(patch,/create_meetup_request[\s\S]*from public\.pet_matches[\s\S]*for share[\s\S]*active_match_required/);
});
check('meetup response uses match-before-request lock order',()=>{
  assert.match(patch,/respond_meetup_request[\s\S]*select match_id into v_match_id[\s\S]*for share[\s\S]*for update/);
});
check('unmatch cancels meetup data and clears mutual likes',()=>{
  assert.match(patch,/unmatch_pet[\s\S]*for update[\s\S]*meetup_requests set status='cancelled'[\s\S]*delete from public\.pet_likes/);
});
check('block locks matches before teardown and cancels meetups after closure',()=>{
  assert.match(patch,/block_pet[\s\S]*for update of m[\s\S]*update public\.pet_matches[\s\S]*update public\.meetup_requests/);
});
check('stale pet verification is cancelled and media queued on identity changes',()=>{
  assert.match(patch,/cancel_pending_pet_verification[\s\S]*storage_gc_queue[\s\S]*status='cancelled'/);
  assert.match(patch,/revoke_pet_verification_on_identity_change[\s\S]*cancel_pending_pet_verification\(old\.id,'pet_identity_changed'\)/);
});
check('profile photo changes cancel pending pet verification',()=>{
  assert.match(patch,/attach_pet_photo[\s\S]*for update[\s\S]*cancel_pending_pet_verification\(p_pet_id,'profile_photo_changed'\)/);
});
check('pet verification submissions are serialized and single-pending',()=>{
  assert.match(patch,/pet_verification_one_pending_per_pet[\s\S]*where status='pending'/);
  assert.match(patch,/submit_pet_verification[\s\S]*from public\.pets where id=p_pet_id for update[\s\S]*superseded_by_new_request/);
});
check('pre-hardening pending pet verifications are invalidated safely',()=>{
  assert.match(patch,/Existing pending requests predate identity\/photo serialization[\s\S]*storage_gc_queue[\s\S]*pre_hardening_reverification_required/);
  assert.match(patch,/update public\.pet_verification_requests[\s\S]*status='cancelled'[\s\S]*where status='pending'/);
});
check('pet verification review uses pet-before-request lock order',()=>{
  assert.match(patch,/review_pet_verification[\s\S]*select pet_id into v_pet_id[\s\S]*from public\.pets where id=v_pet_id for update[\s\S]*pet_verification_requests[\s\S]*for update/);
});
check('storage reads reject deleted posts and suspended or rejected authors',()=>{
  assert.match(patch,/can_read_storage_object[\s\S]*po\.deleted_at is null[\s\S]*po\.moderation_status='approved'[\s\S]*u\.suspended_at is null/);
  assert.match(patch,/pet-photos[\s\S]*p\.moderation_status='approved'[\s\S]*u\.suspended_at is null/);
});
check('story storage reads require follow visibility',()=>{
  assert.match(patch,/social-media[\s\S]*s\.expires_at>now\(\)[\s\S]*public\.follows/);
});
check('stories and events suppress suspended creators',()=>{
  assert.match(patch,/get_active_stories[\s\S]*u\.suspended_at is null/);
  assert.match(patch,/get_pet_events[\s\S]*u\.suspended_at is null/);
});

check('pet prompt keys are server whitelisted before destructive replacement',()=>{
  assert.match(patch,/upsert_pet_prompts[\s\S]*v_allowed constant text\[\][\s\S]*Validate the complete payload before deleting existing prompts[\s\S]*invalid_prompt_key/);
  assert.match(patch,/duplicate_prompt_key/);
});
check('meetup UGC is queued for moderation and hidden from the recipient until approved',()=>{
  assert.match(patch,/meetup_text[\s\S]*create_meetup_request[\s\S]*moderation_status\)[\s\S]*'pending'[\s\S]*moderation_items/);
  assert.match(patch,/get_meetup_requests[\s\S]*r\.moderation_status<>'rejected'[\s\S]*r\.proposed_by_pet_id=p_pet_id or r\.moderation_status='approved'/);
  assert.match(patch,/respond_meetup_request[\s\S]*meetup_not_approved/);
});
check('meetup reports require match participation and cannot target own proposal',()=>{
  assert.match(patch,/report_content[\s\S]*p_target_type='meetup'[\s\S]*p_reporter_pet_id in\(m\.pet_low_id,m\.pet_high_id\)[\s\S]*r\.proposed_by_pet_id<>p_reporter_pet_id/);
});

check('posts and comments reject oversize text instead of silently truncating',()=>{
  assert.match(patch,/create_post[\s\S]*caption_too_long[\s\S]*values\(p_pet_id,v_caption,'pending'\)/);
  assert.match(patch,/create_comment[\s\S]*comment_too_long[\s\S]*values\(p_post_id,p_pet_id,v_body,'pending'\)/);
});
check('event input bounds are enforced explicitly',()=>{
  assert.match(patch,/create_pet_event[\s\S]*invalid_title[\s\S]*description_too_long[\s\S]*invalid_location[\s\S]*invalid_end_time[\s\S]*invalid_capacity/);
  assert.match(patch,/pet_events_city_length_check[\s\S]*pet_events_district_length_check[\s\S]*pet_events_neighborhood_length_check/);
});
check('meetup feedback is bounded rate-limited and logically normalized',()=>{
  assert.match(patch,/submit_meetup_feedback[\s\S]*meetup_feedback',20,86400[\s\S]*moderation_status='approved'[\s\S]*invalid_issue_category[\s\S]*if not p_met then[\s\S]*p_felt_safe:=null/);
});

check('posts reject oversize or duplicate media instead of silently truncating',()=>{
  assert.match(patch,/create_post[\s\S]*caption_too_long[\s\S]*too_many_media[\s\S]*duplicate_media_path/);
  assert.match(patch,/create_post[\s\S]*consume_upload_intent[\s\S]*post_created/);
});
check('comments reject oversize bodies and audit creation',()=>{
  assert.match(patch,/create_comment[\s\S]*invalid_comment_length[\s\S]*comment_created/);
});
check('saved-post mutations are bounded and block-aware',()=>{
  assert.match(patch,/toggle_save_post[\s\S]*public\.is_blocked[\s\S]*post_save',300,86400/);
});

check('pet profile deletion queues private media and clears orphan moderation rows',()=>{
  assert.match(patch,/delete_pet_profile[\s\S]*pet-verification[\s\S]*upload_intents[\s\S]*moderation_items[\s\S]*pet_profile_deleted[\s\S]*delete from public\.pets/);
});

check('identity verification result is atomic terminal-state safe and service-role only',()=>{
  assert.match(patch,/apply_owner_verification_result[\s\S]*service_role_required[\s\S]*for update[\s\S]*v_session\.status<>'pending'[\s\S]*identity_verified=true[\s\S]*owner_identity_verified/);
});
check('report admin status and audit write are atomic',()=>{
  assert.match(patch,/admin_update_report_status[\s\S]*service_role_required[\s\S]*update public\.reports[\s\S]*insert into public\.audit_events/);
});

check('owned-content deletion is explicit auditable and storage-clean',()=>{
  assert.match(patch,/delete_owned_content[\s\S]*content_not_found[\s\S]*delete from public\.post_media[\s\S]*owned_content_deleted/);
});
check('vaccination dates respect pet birth and deletion is audited',()=>{
  assert.match(patch,/upsert_vaccination[\s\S]*dose_date_before_birth[\s\S]*invalid_due_date/);
  assert.match(patch,/delete_vaccination[\s\S]*vaccination_not_found[\s\S]*vaccination_deleted/);
});
check('event creation rejects invalid or truncated payloads',()=>{
  assert.match(patch,/create_pet_event[\s\S]*invalid_event_title[\s\S]*event_description_too_long[\s\S]*invalid_event_location[\s\S]*invalid_capacity/);
});
check('meetup creation rejects oversize notes and audits requests',()=>{
  assert.match(patch,/create_meetup_request[\s\S]*meetup_note_too_long[\s\S]*for share[\s\S]*meetup_requested/);
});

check('service-role subscription sync has explicit-user atomic rate limiting',()=>{
  assert.match(patch,/service_rate_limit_user[\s\S]*service_role_required[\s\S]*rate_limits[\s\S]*rate_limit_exceeded/);
});

check('high-volume unread and privacy cleanup queries have supporting indexes',()=>{
  assert.match(patch,/idx_messages_unread_conversation_sender[\s\S]*messages\(conversation_id,sender_pet_id\)[\s\S]*read_at is null/);
  assert.match(patch,/idx_audit_events_user_created[\s\S]*audit_events\(user_id,created_at desc\)/);
  assert.match(patch,/idx_audit_events_pet_created[\s\S]*audit_events\(pet_id,created_at desc\)/);
  assert.match(patch,/idx_billing_webhook_events_user_ids_gin[\s\S]*using gin\(user_ids\)/);
});


check('discovery tie exposure rotates without changing compatibility score',()=>{
  assert.match(patch,/ranked as[\s\S]*md5\(p_active_pet_id::text[\s\S]*current_date::text\) as fairness_key[\s\S]*order by compatibility_score desc,fairness_key/);
});

check('discovery defers display-distance math and bounds exact distance filtering',()=>{
  assert.match(patch,/v_max_distance:=nullif\(p_filters->>'maxDistanceKm',''\)::double precision/);
  assert.match(patch,/v_lat_delta:=least\(180\.0,v_max_distance\/111\.32\)[\s\S]*v_lon_delta:=case/);
  assert.match(patch,/pp\.latitude between greatest\(-90\.0[\s\S]*public\.haversine_km[\s\S]*<=v_max_distance/);
  assert.match(patch,/'approximateDistanceKm',case when v_private\.latitude is null or r\.candidate_latitude is null then null else round\(public\.haversine_km/);
});

check('Realtime publication wiring is source-controlled for subscribed tables',()=>{
  assert.match(patch,/pg_publication[\s\S]*supabase_realtime/);
  assert.match(patch,/alter publication supabase_realtime add table public\.messages/);
  assert.match(patch,/alter publication supabase_realtime add table public\.notifications/);
});

check('optimized get_matches avoids duplicate last-message subqueries',()=>{
  assert.match(patch,/M\/E performance hardening:[\s\S]*get_matches[\s\S]*left join lateral[\s\S]*select msg\.body,msg\.created_at[\s\S]*unread_count/);
  assert.match(patch,/'lastMessage',lm\.body[\s\S]*'lastMessageAt',lm\.created_at/);
});

check('match lists use bounded keyset pagination without breaking unread totals or deep links',()=>{
  assert.match(patch,/get_matches_page[\s\S]*p_before_matched_at[\s\S]*\(activity_at,id\)<[\s\S]*limit least\(greatest\(p_limit,1\),50\)/);
  assert.match(patch,/idx_pet_matches_low_active_page[\s\S]*idx_pet_matches_high_active_page/);
  assert.match(patch,/get_unread_match_message_count[\s\S]*msg\.read_at is null/);
  assert.match(patch,/get_match_by_conversation[\s\S]*c\.id=p_conversation_id[\s\S]*public\.owns_pet\(p_pet_id\)[\s\S]*not public\.is_blocked/);
});

check('stories and events use bounded keyset page RPCs',()=>{
  assert.match(patch,/get_active_stories_page[\s\S]*p_before_created_at[\s\S]*\(s\.created_at,s\.id\)<[\s\S]*limit least\(greatest\(p_limit,1\),80\)/);
  assert.match(patch,/get_pet_events_page[\s\S]*p_after_starts_at[\s\S]*\(e\.starts_at,e\.id\)>[\s\S]*limit least\(greatest\(p_limit,1\),50\)/);
  assert.match(patch,/idx_stories_active_page[\s\S]*idx_events_upcoming_page/);
});

check('match pagination is ordered by conversation activity',()=>{
  assert.match(patch,/get_matches_page[\s\S]*coalesce\(lm\.created_at,m\.matched_at\) as activity_at[\s\S]*\(activity_at,id\)<[\s\S]*order by activity_at desc,id desc/);
});

check('incoming likes use bounded keyset pages',()=>{
  assert.match(patch,/idx_pet_likes_to_created_from[\s\S]*get_incoming_likes_page[\s\S]*p_before_created_at[\s\S]*p_before_from_pet_id[\s\S]*limit least\(greatest\(p_limit,1\),80\)/);
});

check('blocked pets and report history use bounded keyset pages',()=>{
  assert.match(patch,/idx_blocks_blocker_created_page[\s\S]*get_blocked_pets_page[\s\S]*p_before_blocked_pet_id[\s\S]*limit least\(greatest\(p_limit,1\),80\)/);
  assert.match(patch,/idx_reports_reporter_created_page[\s\S]*get_my_reports_page[\s\S]*p_before_id[\s\S]*limit least\(greatest\(p_limit,1\),100\)/);
});

check('vaccination reminders drain all due rows without a fixed first-page starvation loop',()=>{
  assert.match(patch,/idx_vaccinations_due_reminder[\s\S]*enqueue_vaccination_reminders\(\)[\s\S]*not exists[\s\S]*notifications[\s\S]*on conflict \(dedupe_key\)[\s\S]*do nothing/);
});

check('comment history uses bounded newest-first keyset pages',()=>{
  assert.match(patch,/idx_comments_post_visible_page[\s\S]*get_post_comments_page[\s\S]*p_before_created_at[\s\S]*order by c\.created_at desc,c\.id desc[\s\S]*limit least\(greatest\(p_limit,1\),100\)/);
  assert.match(patch,/get_post_comments_page[\s\S]*not public\.is_blocked\(p_pet_id,po\.pet_id\)[\s\S]*not public\.is_blocked\(p_pet_id,c\.pet_id\)/);
});

check('worker liveness and operational queue health are source-controlled without PII payloads',()=>{
  assert.match(patch,/create table if not exists public\.worker_heartbeats[\s\S]*push-dispatch[\s\S]*vaccination-reminders/);
  assert.match(patch,/get_ops_health_snapshot[\s\S]*service_role_required[\s\S]*pushFailed[\s\S]*storageGcExhausted[\s\S]*moderationManualReview[\s\S]*billingStuckProcessing/);
  assert.match(patch,/grant execute on function public\.get_ops_health_snapshot\(\) to service_role/);
});

check('runtime minimum versions are platform-specific and maintenance copy can be locale-aware',()=>{
  assert.match(patch,/minimum_supported_version_ios[\s\S]*minimum_supported_version_android[\s\S]*latest_version_ios[\s\S]*latest_version_android/);
  assert.match(patch,/get_runtime_config[\s\S]*minimumSupportedVersions[\s\S]*latestVersions[\s\S]*'messages',messages/);
  assert.match(patch,/app_runtime_config_platform_versions_check[\s\S]*app_runtime_config_messages_check/);
});

check('preferred application locale is server-persisted for localized push delivery',()=>{
  assert.match(patch,/preferred_locale[\s\S]*users_preferred_locale_check[\s\S]*update_preferred_locale[\s\S]*preferredLocale/);
});

check('dynamic notification data is separated from localized copy',()=>{
  assert.match(patch,/notifications add column if not exists template_key[\s\S]*template_params[\s\S]*notifications_template_params_object_check/);
  assert.match(patch,/enqueue_vaccination_reminders[\s\S]*'vaccination_due'[\s\S]*jsonb_build_object\('petName'[\s\S]*'daysUntil'/);
  assert.match(patch,/get_notifications_page[\s\S]*'templateKey',n\.template_key[\s\S]*'templateParams',n\.template_params/);
});

check('notification unread badge is an account-wide aggregate independent of page size',()=>{
  assert.match(patch,/get_unread_notification_count\(\)[\s\S]*count\(\*\)::bigint[\s\S]*user_id=auth\.uid\(\)[\s\S]*read_at is null/);
  assert.match(patch,/revoke all on function public\.get_unread_notification_count\(\) from public,anon[\s\S]*grant execute on function public\.get_unread_notification_count\(\) to authenticated/);
});

check('exact duplicate pet photos are private moderation signals',()=>{
  assert.match(patch,/create table if not exists public\.pet_photo_fingerprints[\s\S]*sha256[\s\S]*enable row level security[\s\S]*revoke all on public\.pet_photo_fingerprints/);
});


check('every pending SECURITY DEFINER function has an explicit privilege decision',()=>{
  const definerNames=[...patch.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)\s*\([\s\S]*?security\s+definer/gi)].map(m=>m[1]);
  const unique=[...new Set(definerNames)];
  const missing=unique.filter(name=>!new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\(`,'i').test(patch));
  assert.deepEqual(missing,[],`SECURITY DEFINER functions without explicit REVOKE: ${missing.join(', ')}`);
});

check('internal SECURITY DEFINER block helper is not client executable',()=>{
  assert.match(patch,/is_blocked\(p_pet_a uuid,p_pet_b uuid\)[\s\S]*revoke all on function public\.is_blocked\(uuid,uuid\) from public,anon,authenticated/);
});

check('user pause is separate from suspension and enforced at server boundaries',()=>{
  assert.match(patch,/users add column if not exists paused_at[\s\S]*set_account_paused[\s\S]*discoverable=false[\s\S]*account_paused[\s\S]*account_resumed/);
  assert.match(patch,/owns_pet[\s\S]*u\.suspended_at is null and u\.paused_at is null/);
  assert.match(patch,/pass_pet[\s\S]*target_user\.suspended_at is null and target_user\.paused_at is null[\s\S]*target_unavailable/,'Known pet UUIDs must not allow pass mutations against paused/suspended targets');
  assert.match(patch,/toggle_favorite_pet[\s\S]*existing favorite[\s\S]*target_user\.suspended_at is null and target_user\.paused_at is null[\s\S]*target_unavailable/,'Favorites may be removed after pause but new favorites must not target paused/suspended accounts');
  assert.match(patch,/undo_last_pass[\s\S]*target_user\.suspended_at is null and target_user\.paused_at is null[\s\S]*restored',false/,'Undo-pass must not resurrect paused/suspended targets');
  assert.match(patch,/toggle_save_post[\s\S]*Cleanup remains available[\s\S]*au\.suspended_at is null and au\.paused_at is null/,'Saved posts may be removed after pause but paused/suspended authors must not accept new saves by known post ID');
  assert.match(patch,/send_message[\s\S]*recipient_unavailable/);
  assert.match(patch,/get_feed_page[\s\S]*au\.suspended_at is null and au\.paused_at is null/);
  assert.match(patch,/backward-compatible read RPCs[\s\S]*get_feed\(p_pet_id[\s\S]*au\.suspended_at is null and au\.paused_at is null/,'Legacy feed RPC must not reveal paused/suspended authors');
  assert.match(patch,/backward-compatible read RPCs[\s\S]*get_matches\(p_pet_id[\s\S]*ou\.suspended_at is null and ou\.paused_at is null/,'Legacy match RPC must hide paused/suspended counterparts');
  assert.match(patch,/backward-compatible read RPCs[\s\S]*get_unread_match_message_count[\s\S]*ou\.suspended_at is null and ou\.paused_at is null/,'Unread aggregate must not count hidden paused/suspended conversations');
  assert.match(patch,/get_post_comments_page[\s\S]*comment_user\.suspended_at is null and comment_user\.paused_at is null[\s\S]*post_user\.suspended_at is null and post_user\.paused_at is null/,'Paginated comments must hide paused/suspended authors and posts even when a known post ID is supplied');
  assert.match(patch,/get_matches_page[\s\S]*ou\.suspended_at is null and ou\.paused_at is null/);
  assert.match(patch,/get_account_settings[\s\S]*'paused',u\.paused_at is not null[\s\S]*'suspended',u\.suspended_at is not null/);
});


check('health documents enter manual review immediately instead of retrying an unsupported generic provider',()=>{assert.match(patch,/create or replace function public\.attach_health_document[\s\S]*'health_document',v_id,'pending',true,null,'manual_health_review_required'[\s\S]*manual_review_required=true/);assert.match(patch,/revoke all on function public\.attach_health_document\(uuid,text,text\) from public,anon/)});


check('quiet-hours preference is validated with a real timezone and client-scoped',()=>{
  assert.match(patch,/update_notification_preferences[\s\S]*quietStartMinutes[\s\S]*quietEndMinutes[\s\S]*pg_catalog\.pg_timezone_names[\s\S]*invalid_timezone/);
  assert.match(patch,/update_notification_preferences[\s\S]*quietEnabled[\s\S]*timeZone[\s\S]*revoke all on function public\.update_notification_preferences\(jsonb\) from public,anon[\s\S]*grant execute on function public\.update_notification_preferences\(jsonb\) to authenticated/);
});

check('measurement-system preference is canonical validated and client-scoped',()=>{
  assert.match(patch,/measurement_system text not null default 'metric'/);
  assert.match(patch,/users_measurement_system_check[\s\S]*measurement_system in \('metric','imperial'\)/);
  assert.match(patch,/update_measurement_system[\s\S]*p_system not in \('metric','imperial'\)[\s\S]*rate_limit\('measurement_system',30,3600\)[\s\S]*revoke all on function public\.update_measurement_system\(text\) from public,anon[\s\S]*grant execute on function public\.update_measurement_system\(text\) to authenticated/);
  assert.match(patch,/get_account_settings[\s\S]*'measurementSystem',u\.measurement_system/);
});


check('first-party React error telemetry is private minimized and rate limited',()=>{
  assert.match(patch,/create table if not exists public\.client_error_events[\s\S]*enable row level security[\s\S]*revoke all on table public\.client_error_events from public,anon,authenticated/);
  assert.match(patch,/record_client_error[\s\S]*rate_limit\('client_error_telemetry',20,3600\)[\s\S]*grant execute on function public\.record_client_error\(text,text,text,text\) to authenticated/);
  assert.doesNotMatch(patch,/create table if not exists public\.client_error_events[\s\S]{0,1000}\b(?:user_id|message|stack)\s+/i);
  assert.match(patch,/fingerprint text not null check \(fingerprint ~ '\^\[0-9a-f\]\{16\}\$'/);
});


check('meetup history uses bounded keyset pages and legacy list is capped',()=>{
  assert.match(patch,/idx_meetup_requests_match_created_page[\s\S]*get_meetup_requests_page[\s\S]*p_before_created_at[\s\S]*\(r\.created_at,r\.id\)<[\s\S]*limit least\(greatest\(p_limit,1\),50\)/);
  assert.match(patch,/create or replace function public\.get_meetup_requests\(p_pet_id uuid,p_match_id uuid default null\)[\s\S]*select public\.get_meetup_requests_page\(p_pet_id,p_match_id,50,null,null\)/);
});
check('legacy long-lived list RPCs delegate to bounded page implementations',()=>{
  assert.match(patch,/create or replace function public\.get_matches\(p_pet_id uuid\)[\s\S]*select public\.get_matches_page\(p_pet_id,100,null,null\)/);
  assert.match(patch,/create or replace function public\.get_incoming_likes\(p_pet_id uuid\)[\s\S]*select public\.get_incoming_likes_page\(p_pet_id,80,null,null\)/);
  assert.match(patch,/create or replace function public\.get_active_stories\(p_pet_id uuid\)[\s\S]*select public\.get_active_stories_page\(p_pet_id,80,null,null\)/);
  assert.match(patch,/create or replace function public\.get_pet_events\(p_pet_id uuid\)[\s\S]*select public\.get_pet_events_page\(p_pet_id,50,null,null\)/);
});
check('mating stays fail closed until launch safety dependencies exist',()=>{
  assert.match(patch,/v_purposes \? 'mating'[\s\S]*mating_feature_disabled/);
  assert.match(patch,/coalesce\(v->'purposes','\[\]'::jsonb\) \? 'mating'[\s\S]*mating_feature_disabled/);
  assert.match(patch,/p_active_pet_id[\s\S]*purpose<>'mating'[\s\S]*profile_purpose_unavailable/);
  assert.match(patch,/enabled_purpose\.purpose<>'mating'/);
  assert.match(patch,/p_from_pet_id[\s\S]*own_profile_purpose_unavailable[\s\S]*p_to_pet_id[\s\S]*target_unavailable/);
});


check('user and admin supplied text is rejected when oversized instead of silently truncated',()=>{
  assert.match(patch,/review_pet_verification[\s\S]*verification_reason_too_long[\s\S]*reason=p_reason/);
  assert.match(patch,/attach_health_document[\s\S]*invalid_document_type[\s\S]*values\(p_pet_id,trim\(p_document_type\)/);
  assert.match(patch,/update_notification_preferences[\s\S]*char_length\(v_timezone\)>64[\s\S]*invalid_timezone/);
  assert.doesNotMatch(patch,/reason=left\(p_reason,500\)/);
  assert.doesNotMatch(patch,/values\(p_pet_id,left\(trim\(p_document_type\),80\)/);
  assert.doesNotMatch(patch,/v_timezone:=coalesce\(nullif\(left\(p_preferences->>'timeZone',64\)/);
});


check('disabled mating purpose cannot affect ranking common-purpose payloads or direct pet JSON',()=>{
  const start=patch.lastIndexOf('create or replace function public.discover_pets');
  const next=patch.indexOf('create or replace function public.',start+1);
  const finalDiscover=patch.slice(start,next<0?patch.length:next);
  assert.match(finalDiscover,/count\(\*\)\*7[\s\S]*a\.purpose<>'mating'/);
  assert.doesNotMatch(finalDiscover,/\bv_mating\b|matingOnlyNonNeutered/);
  const petJsonStart=patch.lastIndexOf('create or replace function public.pet_json');
  const petJsonEnd=patch.indexOf('revoke all on function public.pet_json',petJsonStart);
  const finalPetJson=patch.slice(petJsonStart,petJsonEnd);
  assert.match(finalPetJson,/pp\.purpose<>'mating'/);
  assert.match(patch,/commonPurposes[\s\S]*a\.purpose<>'mating'/);
  assert.match(patch,/revoke all on function public\.pet_json\(uuid,uuid\) from public,anon,authenticated/);
});


check('push dispatch uses an atomic service-role claim lease with stale recovery',()=>{
  assert.match(patch,/notifications add column if not exists push_claimed_at/);
  assert.match(patch,/push_status in \('pending','processing','sent','failed','skipped'\)/);
  assert.match(patch,/claim_pending_notifications[\s\S]*for update skip locked[\s\S]*push_status='processing'[\s\S]*push_claimed_at=now\(\)/);
  assert.match(patch,/push_status='processing'[\s\S]*push_claimed_at<now\(\)-interval '5 minutes'[\s\S]*push_attempts=least\(n\.push_attempts\+1,32767\)/);
  assert.match(patch,/revoke all on function public\.claim_pending_notifications\(integer\) from public,anon,authenticated[\s\S]*grant execute on function public\.claim_pending_notifications\(integer\) to service_role/);
  assert.match(patch,/pushStuckProcessing/);
});


check('moderation worker claims due items atomically with a crash-expiring lease',()=>{
  assert.match(patch,/claim_moderation_items[\s\S]*status='pending'[\s\S]*next_attempt_at is null or mi\.next_attempt_at<=now\(\)[\s\S]*for update skip locked[\s\S]*next_attempt_at=now\(\)\+interval '10 minutes'/);
  assert.match(patch,/revoke all on function public\.claim_moderation_items\(integer\) from public,anon,authenticated[\s\S]*grant execute on function public\.claim_moderation_items\(integer\) to service_role/);
});


check('storage and external deletion workers use atomic service-role claim leases',()=>{
  assert.match(patch,/claim_storage_gc_items[\s\S]*for update skip locked[\s\S]*not_before=now\(\)\+interval '10 minutes'[\s\S]*grant execute on function public\.claim_storage_gc_items\(integer\) to service_role/);
  assert.match(patch,/claim_external_deletion_items[\s\S]*for update skip locked[\s\S]*not_before=now\(\)\+interval '10 minutes'[\s\S]*grant execute on function public\.claim_external_deletion_items\(integer\) to service_role/);
  assert.match(patch,/revoke all on function public\.claim_storage_gc_items\(integer\) from public,anon,authenticated/);
  assert.match(patch,/revoke all on function public\.claim_external_deletion_items\(integer\) from public,anon,authenticated/);
});

console.log(`pending-hardening-checks: ${checks.length}/${checks.length} passed`);
