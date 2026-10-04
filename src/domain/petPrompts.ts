export const PET_PROMPT_IDS=['favoriteGame','firstMeet','happyThing','atPark','likeInPets','threeWords'] as const;
type PetPromptId=typeof PET_PROMPT_IDS[number];

const LEGACY_TO_ID:Record<string,PetPromptId>={
  'En sevdi\u011fim oyun':'favoriteGame',
  '\u0130lk tan\u0131\u015fmada ben':'firstMeet',
  'Beni mutlu eden \u015fey':'happyThing',
  'Parkta beni bulursan':'atPark',
  'Di\u011fer petlerde sevdi\u011fim \u015fey':'likeInPets',
  'Beni en iyi anlatan \u00fc\u00e7 kelime':'threeWords'
};

export function canonicalPetPromptKey(key:string):string{
  return LEGACY_TO_ID[key]??key;
}

export function petPromptTranslationKey(key:string):string|null{
  const canonical=canonicalPetPromptKey(key);
  return (PET_PROMPT_IDS as readonly string[]).includes(canonical)?`petEditor.prompt.${canonical}`:null;
}
