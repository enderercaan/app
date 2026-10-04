import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { isBackendConfigured } from './config';

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fingerprint(error: unknown) {
  if (!(error instanceof Error)) return 'unknown';
  // Hash locally. Do not transmit the stack or message because they can accidentally
  // contain user-provided values, URLs, identifiers, or other personal data.
  const normalizedStack = (error.stack ?? '')
    .replace(/\bhttps?:\/\/\S+/gi, '<url>')
    .replace(/\b(?:file:\/\/|\/)[^\s)]+/g, '<path>')
    .replace(/:\d+:\d+/g, ':#:#')
    .slice(0, 12_000);
  const material=`${error.name || 'Error'}|${normalizedStack}`;
  return `${fnv1a(material,0x811c9dc5)}${fnv1a(material,0x9e3779b9)}`;
}

export async function reportReactBoundaryError(error: unknown) {
  if (__DEV__ || !isBackendConfigured) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const errorName = error instanceof Error && error.name ? error.name.slice(0, 80) : 'UnknownError';
    await supabase.rpc('record_client_error', {
      p_error_name: errorName,
      p_fingerprint: fingerprint(error),
      p_app_version: String(Constants.expoConfig?.version ?? 'unknown').slice(0, 32),
      p_platform: Platform.OS
    });
  } catch {
    // Telemetry must never create a second user-facing failure or crash loop.
  }
}
