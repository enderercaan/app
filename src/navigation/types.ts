import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Pet } from '../types/domain';

// Compatibility IDs are intentionally kept stable. Unicode escapes preserve the exact
// historical runtime route names without treating them as user-facing copy.
export const TAB_ROUTES = {
  feed: 'Ak\u0131\u015f',
  discover: 'Ke\u015ffet',
  matches: 'E\u015fle\u015fmeler',
  messages: 'Mesajlar',
  profile: 'Profil'
} as const;

export type MainTabParamList = {
  'Ak\u0131\u015f': { storyId?: string; linkNonce?: number } | undefined;
  'Ke\u015ffet': undefined;
  'E\u015fle\u015fmeler': undefined;
  Mesajlar: undefined;
  Profil: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  PetProfile: { pet: Pet; ownPetId: string };
  Chat: { conversationId: string; otherPet: Pet; matchId?: string; ownPetId: string; storyReply?: { storyId:string; petName:string } };
  Call: { callId:string; ownPetId:string; otherPet:Pet; callType:'audio'|'video'; role:'caller'|'callee' };
  Premium: undefined;
  Reels: { reelId?: string; linkNonce?: number } | undefined;
  Notifications: undefined;
  Settings: undefined;
  LegalPrivacy: undefined;
  ModerationAppeals: undefined;
  MfaSettings: undefined;
  SafetyCenter: undefined;
  VerificationCenter: { petId: string };
  BlockedPets: { petId: string };
  ReportHistory: undefined;
  PetEditor: { petId?: string } | undefined;
  Health: { petId: string };
  Events: { petId: string };
  LostPetAlerts: { petId: string };
  Places: { petId: string };
  LikesYou: { petId: string };
  Favorites: { petId: string };
  Meetups: { matchId: string; otherPet: Pet; ownPetId: string };
};
