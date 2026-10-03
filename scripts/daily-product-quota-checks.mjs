import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const migration=read('supabase/migrations/196_daily_swipe_conversation_quota_and_premium_naming_alignment.sql');
const remote=read('supabase/migrations/197_remote_configurable_daily_product_quota_windows.sql');
const domain=read('src/types/domain.ts');
const chat=read('src/screens/ChatScreen.tsx');
const discover=read('src/screens/DiscoverScreen.tsx');
const settings=read('src/screens/SettingsScreen.tsx');
const errors=read('src/services/errors.ts');
const checks=[];
const check=(name,fn)=>{fn();checks.push(name)};

check('Standard quota defaults are 50 swipes and 3 new conversations, with bounded server-side remote configuration',()=>{
  assert.match(migration,/swipes_used integer[^\n]*between 0 and 50/);
  assert.match(migration,/conversations_started integer[^\n]*between 0 and 3/);
  assert.match(remote,/standard_daily_swipe_limit integer not null default 50/);
  assert.match(remote,/standard_daily_new_conversation_limit integer not null default 3/);
  assert.match(remote,/standard_daily_swipe_limit between 1 and 500/);
  assert.match(remote,/standard_daily_new_conversation_limit between 1 and 50/);
  assert.match(remote,/productLimits[\s\S]*standardDailySwipeLimit[\s\S]*standardDailyNewConversationLimit/);
});
check('Premium has no product quota but remains subject to abuse controls',()=>{
  assert.match(remote,/if v_tier='premium' then[\s\S]*'swipesRemaining',null[\s\S]*'newConversationsRemaining',null/);
  assert.match(migration,/rate_limit\('message',60,60\)/);
  assert.match(migration,/rate_limit\('pass_abuse_guard',5000,86400\)/);
  assert.match(migration,/rate_limit\('like_abuse_guard',5000,86400\)/);
});
check('quota timezone and configured limits are frozen for the active reset window',()=>{
  assert.match(migration,/user_id uuid primary key/);
  assert.match(migration,/reset_at timestamptz not null/);
  assert.match(migration,/v_existing\.reset_at>now\(\)[\s\S]*v_timezone:=v_existing\.time_zone/);
  assert.match(migration,/changing preferences cannot create an early quota reset/);
  assert.match(remote,/swipe_limit integer not null default 50/);
  assert.match(remote,/conversation_limit integer not null default 3/);
  assert.match(remote,/v_existing\.reset_at>now\(\)[\s\S]*v_swipe_limit:=v_existing\.swipe_limit[\s\S]*v_conversation_limit:=v_existing\.conversation_limit/);
  assert.match(remote,/Operator changes apply on the next local-day window/);
});
check('quota rows are private and only server functions consume them',()=>{
  assert.match(migration,/alter table public\.daily_product_quotas enable row level security/);
  assert.match(migration,/revoke all on public\.daily_product_quotas from public,anon,authenticated/);
  assert.match(migration,/revoke all on function public\.consume_standard_daily_product_quota\(text\) from public,anon,authenticated/);
  assert.match(migration,/perform public\.require_active_authenticated_session\(\)/);
});
check('first message atomically establishes conversation initiation and Premium unlock',()=>{
  assert.match(migration,/select \* into v_conversation from public\.conversations c where c\.id=p_conversation_id for update/);
  assert.match(migration,/if v_conversation\.initiated_at is null then[\s\S]*consume_standard_daily_product_quota\('conversation'\)/);
  assert.match(migration,/is_unlocked=\(v_tier='premium'\)/);
  assert.match(migration,/unlocked_by=case when v_tier='premium' then v_uid else null end/);
});
check('existing conversation replies never consume another new-conversation slot',()=>{
  const block=migration.slice(migration.indexOf('create or replace function public.send_message('),migration.indexOf('create or replace function public.pass_pet('));
  assert.match(block,/if v_conversation\.initiated_at is null then/);
  assert.equal((block.match(/consume_standard_daily_product_quota\('conversation'\)/g)||[]).length,1);
});
check('swipe quota counts new Standard pass/like actions while retry-safe public wrappers remain authoritative',()=>{
  assert.match(migration,/pass_pet[\s\S]*consume_standard_daily_product_quota\('swipe'\)/);
  assert.match(migration,/like_pet[\s\S]*if not v_had_like and v_tier='standard' then perform public\.consume_standard_daily_product_quota\('swipe'\)/);
  for(const fn of ['like_pet_idempotent','pass_pet_idempotent','send_message_idempotent']) assert.match(migration,new RegExp(`grant execute on function public\\.${fn}`));
  assert.doesNotMatch(migration,/grant execute on function public\.send_message\(uuid,uuid,text\) to authenticated/);
});
check('client domain contract exposes only the new daily quota model',()=>{
  assert.match(domain,/DailyProductQuotaStatus = \{ tier: AccountTier; swipeLimit:number\|null; newConversationLimit:number\|null; swipesRemaining: number\|null; newConversationsRemaining: number\|null/);
  assert.doesNotMatch(domain,/freeMessagesSent/);
  assert.match(chat,/newConversationsRemaining/);
  assert.match(discover,/dailySwipeQuotaTitle/);
  assert.match(settings,/dailySwipeRemaining/);
});
check('quota-specific errors are not collapsed into generic rate-limit copy',()=>{
  assert.match(errors,/daily_swipe_quota_reached[\s\S]*error\.swipeQuota/);
  assert.match(errors,/daily_new_conversation_quota_reached[\s\S]*error\.conversationQuota/);
});
check('all 19 runtime locales contain the quota copy and no historical Plus or two-message product copy',()=>{
  const files=readdirSync('src/i18n/locales').filter(f=>f.endsWith('.ts')).sort();
  assert.equal(files.length,19);
  for(const file of files){
    const text=read(`src/i18n/locales/${file}`);
    for(const key of ['chat.remaining','chat.quotaDone','chat.replyCourtesy','settings.standardBody','error.swipeQuota','error.conversationQuota','discover.dailySwipeQuotaTitle','discover.dailySwipeQuota','discover.dailySwipeQuotaDone']) assert.match(text,new RegExp(`"${key.replaceAll('.','\\.')}"`),`${file}: missing ${key}`);
    assert.doesNotMatch(text,/Tailmance Plus|Tailmance-Plus|Plus限定|\b2 outgoing messages\b|2 free outgoing|free outgoing-message allowance|verified health\/trust/i,`${file}: legacy product copy`);
  }
});
check('account settings projects one server-authoritative quota snapshot and not the legacy message counter',()=>{
  const account=migration.slice(migration.indexOf('create or replace function public.get_account_settings()'));
  assert.match(account,/cross join lateral \(select public\.current_user_daily_product_quota_status\(\) as status\) q/);
  assert.doesNotMatch(account,/'freeMessagesSent'/);
  assert.match(account,/Legacy pre-v196 counter retained only for migration compatibility/);
});

console.log(`Daily product quota checks: ${checks.length}/${checks.length} PASS`);
for(const name of checks) console.log(`- ${name}`);
