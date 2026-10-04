import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const migration=read('supabase/migrations/164_story_reply_message_context_and_idempotency.sql');
const lookupMigration=read('supabase/migrations/165_story_reply_active_match_lookup.sql');
const chat=read('src/screens/ChatScreen.tsx');
const feed=read('src/screens/FeedScreen.tsx');
const api=read('src/services/api.ts');
const offline=read('src/services/offlineMutationQueue.ts');
const types=read('src/types/domain.ts');

assert.match(migration,/add column if not exists reply_to_story_id uuid references public\.stories\(id\) on delete set null/i);
assert.match(migration,/create or replace function public\.send_story_reply_idempotent/i);
assert.match(migration,/perform public\.require_active_authenticated_session\(\)/i);
assert.match(migration,/public\.send_message_idempotent\(/i,'Story replies must inherit the canonical message quota/moderation/idempotency path.');
assert.match(migration,/moderation_status\s*=\s*'approved'/i);
assert.match(migration,/expires_at\s*>\s*now\(\)/i);
assert.match(migration,/not public\.is_blocked\(p_sender_pet_id,v_story_pet_id\)/i);
assert.match(migration,/replyToStoryId/i);
assert.match(migration,/revoke all on function public\.send_story_reply_idempotent.*from public\s*,\s*anon/is);
assert.match(migration,/grant execute on function public\.send_story_reply_idempotent.*to authenticated/is);

assert.match(lookupMigration,/create or replace function public\.get_active_match_with_pet/i);
assert.match(lookupMigration,/public\.owns_pet\(p_pet_id\)/i);
assert.match(lookupMigration,/m\.unmatched_at is null/i);
assert.match(lookupMigration,/not public\.is_blocked\(p_pet_id,p_other_pet_id\)/i);
assert.match(lookupMigration,/other_user\.suspended_at is null/i);
assert.match(lookupMigration,/other_user\.paused_at is null/i);
assert.match(lookupMigration,/revoke all on function public\.get_active_match_with_pet\(uuid,uuid\) from public,anon/i);
assert.match(lookupMigration,/grant execute on function public\.get_active_match_with_pet\(uuid,uuid\) to authenticated/i);
assert.match(api,/getActiveMatchWithPet\(/);
assert.match(api,/get_active_match_with_pet/);
assert.match(api,/sendStoryReply\(/);
assert.match(api,/send_story_reply_idempotent/);
assert.match(types,/replyToStoryId\?: string/);
assert.match(feed,/matches\.find\(match=>match\.otherPet\.id===story\.petId\)/);
assert.match(feed,/getActiveMatchWithPet\(viewer\.id,s\.petId\)/);
assert.match(feed,/storyReplyRequestRef/);
assert.match(feed,/storyReply:\{storyId:currentStory\.id,petName:currentStory\.petName\}/);
assert.match(chat,/getOrCreateDurableClientOperation\(replyContext\?'story-reply':'message'/);
assert.match(chat,/type:'story_reply'/);
assert.match(chat,/sendStoryReply\(/);
assert.match(chat,/chat\.replyingToStory/);
assert.match(chat,/chat\.storyReplyLabel/);
assert.match(offline,/send_story_reply_idempotent/);

for(const locale of ['en','tr','de','es','fr','hi','id','it','ja','ko','nl','pl','pt-BR','ru','th','vi','zh-Hans','zh-Hant','ar']){
  const text=read(`src/i18n/locales/${locale}.ts`);
  for(const key of ['feed.storyReply','chat.replyingToStory','chat.cancelStoryReply','chat.storyReplyLabel']) assert.ok(text.includes(`"${key}"`),`${locale} missing ${key}`);
}

console.log('Story reply checks: PASS');
