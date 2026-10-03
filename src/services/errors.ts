import { getRuntimeLocale, translate } from '../i18n';

export function userMessage(error: unknown, fallback?: string) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.toLowerCase();
  const t=(key:string)=>translate(getRuntimeLocale(),key);
  if (message.includes('daily_swipe_quota_reached')) return t('error.swipeQuota');
  if (message.includes('daily_new_conversation_quota_reached') || message.includes('free_message_limit_reached')) return t('error.conversationQuota');
  if (message.includes('premium_required')) return t('error.premium');
  if (message.includes('recipient_unavailable') || message.includes('participant_unavailable') || message.includes('target_unavailable')) return t('error.temporarilyUnavailable');
  if (message.includes('account_unavailable')) return t('error.accountUnavailable');
  if (message.includes('durable_operation_storage_')) return t('error.temporarilyUnavailable');
  if (message.includes('offline_queue_')) return t('error.temporarilyUnavailable');
  if (message.includes('edge_ai_local_safety_blocked')) return t('edgeAi.photoBlocked');
  if (message.includes('purchase_identity_')) return t('error.session');
  if (message.includes('rate') || message.includes('too_many') || message.includes('limit')) return t('error.rate');
  if (message.includes('forbidden') || message.includes('not allowed') || message.includes('permission')) return t('error.forbidden');
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) return t('error.network');
  if (message.includes('location_permission_denied')) return t('error.locationPermission');
  if (message.includes('location_mocked')) return t('error.locationMocked');
  if (message.includes('valid_upload_intent_required')) return t('error.uploadExpired');
  if (message.includes('verification_already_in_progress')) return t('error.verificationInProgress');
  if (message.includes('email_verification_required')) return t('error.emailVerification');
  if (message.includes('birth_date_required') || message.includes('required_profile_fields_missing') || message.includes('purpose_required')) return t('error.profileRequired');
  if (message.includes('invalid_birth_date')) return t('error.invalidBirthDate');
  if (message.includes('authentication') || message.includes('jwt')) return t('error.session');
  return fallback ?? t('error.generic');
}
