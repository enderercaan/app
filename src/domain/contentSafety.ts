const HIGH_RISK_PATTERNS = [
  /\b(whatsapp|telegram|signal)\b/i,
  /(?:\+?90|0)?5\d{9}/,
  /\b(?:iban|papara|kripto|bitcoin)\b/i
];

// Tailmance is pet-first social matching, never an animal-sales or breeder marketplace.
// Keep these patterns phrase-based to avoid blocking ordinary discussions about prices or pet care.
const PROHIBITED_PET_COMMERCE_PATTERNS = [
  /\b(?:puppy|kitten|dog|cat|pet)\s+(?:for\s+sale|for\s+purchase)\b/i,
  /\b(?:sell|selling)\s+(?:my\s+)?(?:puppy|kitten|dog|cat|pet)\b/i,
  /\b(?:breeder|breeding)\s+(?:service|business|listing|offer)\b/i,
  /\bstud\s+fee\b/i,
  /\b(?:sat\u0131l\u0131k|satilik)\s+(?:yavru|k\u00F6pek|kopek|kedi|pet)\b/i,
  /\b(?:yavru|k\u00F6pek|kopek|kedi)\s+(?:sat\u0131\u015F\u0131|satisi|sat\u0131l\u0131k|satilik)\b/i,
  /\b(?:dam\u0131zl\u0131k|damizlik)\s+(?:\u00FCcret|ucret|ilan|hizmet)\b/i,
  /\b(?:chiot|chaton)\s+à\s+vendre\b/i,
  /\b(?:welpe|kätzchen|katzenbaby)\s+zu\s+verkaufen\b/i,
  /\b(?:cucciolo|gattino)\s+in\s+vendita\b/i,
  /\bпродам\s+(?:щенка|котенка|собаку|кошку)\b/i,
  /(?:出售|售卖|售賣)(?:幼犬|小狗|幼猫|幼貓|猫|貓)/,
  /(?:子犬|子猫).{0,8}(?:販売|売ります)/,
  /(?:강아지|고양이).{0,8}(?:판매|팝니다)/,
  /(?:ขาย).{0,8}(?:ลูกสุนัข|ลูกแมว)/,
  /\b(?:jual)\s+(?:anak\s+anjing|anak\s+kucing)\b/i,
  /\b(?:vendo|vender)\s+(?:filhote|cachorro|gato)\b/i
];

// Tailmance is not an adoption/rehoming marketplace. These are intentionally high-signal,
// pet-context phrases so ordinary discussions of adoption history or rescue advocacy are not blocked.
const PROHIBITED_PET_REHOMING_PATTERNS = [
  /\b(?:dog|cat|pet|puppy|kitten)\s+(?:for\s+adoption|needs?\s+a\s+new\s+home|looking\s+for\s+a\s+new\s+home|to\s+rehome)\b/i,
  /\b(?:rehome|rehoming|re-home|adopt\s+out)\s+(?:my\s+)?(?:dog|cat|pet|puppy|kitten)\b/i,
  /\b(?:dog|cat|pet|puppy|kitten)\s+free\s+to\s+(?:a\s+)?good\s+home\b/i,
  /\b(?:perro|gato|cachorro|mascota).{0,20}(?:en\s+adopci[oó]n|busca\s+hogar|nuevo\s+hogar)\b/i,
  /\b(?:doy|dar)\s+en\s+adopci[oó]n.{0,20}(?:perro|gato|cachorro|mascota)\b/i,
  /\b(?:cachorro|gato|filhote|pet).{0,20}(?:para\s+ado[c\u00E7][aã]o|novo\s+lar|doa[c\u00E7][aã]o)\b/i,
  /\b(?:chien|chat|chiot|chaton).{0,20}(?:[àa]\s+adopter|cherche\s+une\s+famille|nouveau\s+foyer)\b/i,
  /\b(?:hund|katze|welpe|kätzchen).{0,20}(?:zur\s+adoption|zu\s+vermitteln|neues\s+zuhause)\b/i,
  /\b(?:cane|gatto|cucciolo).{0,20}(?:in\s+adozione|cerca\s+casa|nuova\s+casa)\b/i,
  /(?:отдам|пристрою).{0,20}(?:собаку|кошку|щенка|котенка)/i,
  /(?:собака|кошка|щенок|котенок).{0,20}(?:ищет\s+дом|в\s+добрые\s+руки)/i,
  /(?:k\u00F6pek|kopek|k\u00F6pe\u011Fimi|kope\u011Fimi|kopegimi|kedi|kedimi|yavru).{0,24}(?:sahiplendir(?:iyorum|iyoruz|ilecek|mek)?|yuva\s+ar\u0131yor|yuva\s+ariyor|\u00FCcretsiz\s+sahiplendirme|ucretsiz\s+sahiplendirme)/i,
  /(?:sahiplendir(?:iyorum|iyoruz|ilecek)|yeni\s+yuva\s+ar\u0131yorum|yeni\s+yuva\s+ariyorum).{0,24}(?:k\u00F6pek|kopek|k\u00F6pe\u011Fimi|kopegimi|kedi|kedimi|yavru)/i,
  /(?:كلب|قطة|جرو|قط).{0,20}(?:للتبني|للتبنّي|يبحث عن منزل|يبحث عن بيت)/,
  /(?:कुत्ता|कुत्ते|बिल्ली|पिल्ला).{0,20}(?:गोद लेने|गोद देना|नया घर)/,
  /\b(?:anjing|kucing|anak\s+anjing|anak\s+kucing).{0,20}(?:adopsi|cari\s+rumah\s+baru|hibah)\b/i,
  /(?:犬|猫|子犬|子猫).{0,12}(?:里親募集|譲渡|新しい家族)/,
  /(?:강아지|고양이).{0,12}(?:입양|분양|새\s*가족)/,
  /(?:狗|犬|猫|貓|幼犬|幼猫|幼貓).{0,12}(?:领养|領養|送养|送養|找新家)/,
  /\b(?:hond|kat|puppy|kitten).{0,20}(?:ter\s+adoptie|herplaatsen|nieuw\s+thuis)\b/i,
  /\b(?:pies|kot|szczeniak|kociak).{0,20}(?:do\s+adopcji|szuka\s+domu|nowy\s+dom)\b/i,
  /(?:สุนัข|แมว|ลูกสุนัข|ลูกแมว).{0,20}(?:หาบ้าน|รับเลี้ยง|หาคนรับเลี้ยง)/,
  /\b(?:chó|cho|mèo|meo).{0,20}(?:nhận\s+nuôi|nhan\s+nuoi|tìm\s+nhà\s+mới|tim\s+nha\s+moi)\b/i
];

// Explicit human-romance solicitation is blocked. Generic friendship, owner meetups and pet-context
// socializing remain allowed. These intentionally use multi-word phrases to reduce false positives.
const PROHIBITED_HUMAN_DATING_PATTERNS = [
  /\b(?:looking|searching)\s+for\s+(?:a\s+)?(?:girlfriend|boyfriend|romantic\s+partner|date|hookup)\b/i,
  /\bhere\s+to\s+(?:date|hook\s*up)\s+(?:people|humans|owners|men|women)\b/i,
  /\bsingle\s+(?:man|woman|guy|girl)\s+(?:looking|seeking)\s+for\b/i,
  /\b(?:sevgili|fl\u00F6rt|flort)\s+ar\u0131yorum\b/i,
  /\b(?:insan|sahip)\s+(?:date|fl\u00F6rt|flort)\s+(?:ar\u0131yorum|icin|i\u00E7in)\b/i,
  /\bbusco\s+(?:novio|novia|pareja\s+romántica|cita)\b/i,
  /\bprocuro\s+(?:namorado|namorada|parceir[oa]\s+romântic[oa])\b/i,
  /\bje\s+cherche\s+(?:un\s+copain|une\s+copine|un\s+partenaire\s+romantique|une\s+relation)\b/i,
  /\b(?:suche|suche\s+nach)\s+(?:freundin|freund|romantischem\s+partner|date)\b/i,
  /\bcerco\s+(?:fidanzato|fidanzata|partner\s+romantic[oa])\b/i,
  /ищу\s+(?:парня|девушку|романтического\s+партнера|отношения)/i,
  /(?:找男朋友|找女朋友|找对象|找對象|約會對象|约会对象)/,
  /(?:恋人募集|彼氏募集|彼女募集|出会い目的)/,
  /(?:남자친구\s*구해|여자친구\s*구해|연애\s*상대\s*찾)/,
  /(?:أبحث عن حبيب|أبحث عن حبيبة|أبحث عن شريك رومانسي)/,
  /(?:बॉयफ्रेंड ढूंढ|गर्लफ्रेंड ढूंढ|रोमांटिक पार्टनर ढूंढ)/,
  /\bcari\s+(?:pacar|kekasih|pasangan\s+romantis)\b/i,
  /\bik\s+zoek\s+(?:een\s+vriendje|een\s+vriendin|romantische\s+partner)\b/i,
  /\bszukam\s+(?:chłopaka|dziewczyny|partnera\s+romantycznego|partnerki\s+romantycznej)\b/i,
  /(?:หาแฟน|หาคนคุยเชิงรัก|หาคู่รัก)/,
  /\b(?:tìm|tim)\s+(?:bạn\s+trai|ban\s+trai|bạn\s+gái|ban\s+gai|người\s+yêu|nguoi\s+yeu)\b/i
];

type ContentSafetyBlockCode = 'pet_sale_or_commercial_breeding' | 'pet_rehoming' | 'human_dating_profile';

export function contentSafetyBlockCopyKeys(code?:ContentSafetyBlockCode){
  if(code==='human_dating_profile')return {title:'contentSafety.humanDatingBlockedTitle',body:'contentSafety.humanDatingBlockedBody'} as const;
  if(code==='pet_rehoming')return {title:'contentSafety.petRehomingBlockedTitle',body:'contentSafety.petRehomingBlockedBody'} as const;
  return {title:'contentSafety.petCommerceBlockedTitle',body:'contentSafety.petCommerceBlockedBody'} as const;
}

export function preflightUserText(text: string) {
  const normalized = text.trim();
  const commerceFlags = PROHIBITED_PET_COMMERCE_PATTERNS.filter((p) => p.test(normalized)).map((p) => p.source);
  const rehomingFlags = PROHIBITED_PET_REHOMING_PATTERNS.filter((p) => p.test(normalized)).map((p) => p.source);
  const datingFlags = PROHIBITED_HUMAN_DATING_PATTERNS.filter((p) => p.test(normalized)).map((p) => p.source);
  const flags = HIGH_RISK_PATTERNS.filter((p) => p.test(normalized)).map((p) => p.source);
  const blockCode:ContentSafetyBlockCode|undefined=commerceFlags.length?'pet_sale_or_commercial_breeding':rehomingFlags.length?'pet_rehoming':datingFlags.length?'human_dating_profile':undefined;
  return {
    normalized,
    blocked: Boolean(blockCode),
    blockCode,
    blockedFlags:[...commerceFlags,...rehomingFlags,...datingFlags],
    shouldWarn: flags.length > 0,
    flags,
    warningCode: flags.length ? ('contact_or_payment' as const) : undefined
  };
}
