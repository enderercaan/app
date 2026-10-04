import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const approval=JSON.parse(fs.readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const releaseGates=JSON.parse(fs.readFileSync('release/country-release-gates.json','utf8'));

const headings={
  ar:['النطاق القانوني','لغة المستندات','المتطلبات القانونية الخاصة بالدولة','الخصوصية والسلامة وحقوق المستخدم','الاشتراكات ومعلومات المستهلك','رفاه الحيوان وعدم التجارة','الاتصال والمصادر الرسمية'],
  ca:['Àmbit jurídic','Llengua dels documents','Requisits jurídics específics del país','Privacitat, seguretat i drets de les persones usuàries','Subscripcions i informació al consumidor','Benestar animal i absència de comerç','Contacte i fonts oficials'],
  de:['Rechtlicher Geltungsbereich','Dokumentsprache','Länderspezifische rechtliche Anforderungen','Datenschutz, Sicherheit und Nutzerrechte','Abonnements und Verbraucherinformationen','Tierwohl und Nicht-Kommerzialisierung','Kontakt und amtliche Quellen'],
  en:['Legal scope','Document language','Country-specific legal requirements','Privacy, safety and user rights','Subscriptions and consumer information','Animal welfare and non-commerce','Contact and official sources'],
  es:['Ámbito jurídico','Idioma de los documentos','Requisitos jurídicos específicos del país','Privacidad, seguridad y derechos de las personas usuarias','Suscripciones e información al consumidor','Bienestar animal y ausencia de comercio','Contacto y fuentes oficiales'],
  eu:['Lege-esparrua','Dokumentuen hizkuntza','Herrialdeko lege-betekizun espezifikoak','Pribatutasuna, segurtasuna eta erabiltzaileen eskubideak','Harpidetzak eta kontsumitzaileentzako informazioa','Animalien ongizatea eta merkataritzarik eza','Kontaktua eta iturri ofizialak'],
  fr:['Champ juridique','Langue des documents','Exigences juridiques propres au pays','Vie privée, sécurité et droits des utilisateurs','Abonnements et information des consommateurs','Bien-être animal et absence de commerce','Contact et sources officielles'],
  gl:['Ámbito xurídico','Lingua dos documentos','Requisitos xurídicos específicos do país','Privacidade, seguridade e dereitos das persoas usuarias','Subscricións e información ao consumidor','Benestar animal e ausencia de comercio','Contacto e fontes oficiais'],
  hi:['कानूनी दायरा','दस्तावेज़ की भाषा','देश-विशिष्ट कानूनी आवश्यकताएँ','गोपनीयता, सुरक्षा और उपयोगकर्ता अधिकार','सदस्यता और उपभोक्ता जानकारी','पशु कल्याण और गैर-वाणिज्यिक उपयोग','संपर्क और आधिकारिक स्रोत'],
  id:['Ruang lingkup hukum','Bahasa dokumen','Persyaratan hukum khusus negara','Privasi, keamanan, dan hak pengguna','Langganan dan informasi konsumen','Kesejahteraan hewan dan non-perdagangan','Kontak dan sumber resmi'],
  it:['Ambito giuridico','Lingua dei documenti','Requisiti legali specifici del Paese','Privacy, sicurezza e diritti degli utenti','Abbonamenti e informazioni ai consumatori','Benessere animale e assenza di commercio','Contatti e fonti ufficiali'],
  ja:['法的適用範囲','文書の言語','国別の法的要件','プライバシー、安全性、利用者の権利','サブスクリプションと消費者情報','動物福祉と非商取引','連絡先と公的資料'],
  ko:['법적 적용 범위','문서 언어','국가별 법적 요건','개인정보, 안전 및 이용자 권리','구독 및 소비자 정보','동물복지 및 비상거래','연락처 및 공식 자료'],
  nl:['Juridische reikwijdte','Documenttaal','Landspecifieke juridische vereisten','Privacy, veiligheid en gebruikersrechten','Abonnementen en consumenteninformatie','Dierenwelzijn en geen handelsplatform','Contact en officiële bronnen'],
  pl:['Zakres prawny','Język dokumentów','Krajowe wymogi prawne','Prywatność, bezpieczeństwo i prawa użytkowników','Subskrypcje i informacje konsumenckie','Dobrostan zwierząt i brak handlu','Kontakt i źródła urzędowe'],
  'pt-BR':['Âmbito jurídico','Idioma dos documentos','Requisitos jurídicos específicos do país','Privacidade, segurança e direitos do usuário','Assinaturas e informações ao consumidor','Bem-estar animal e ausência de comércio','Contato e fontes oficiais'],
  ru:['Юридическая сфера действия','Язык документов','Юридические требования для страны','Конфиденциальность, безопасность и права пользователей','Подписки и информация для потребителей','Благополучие животных и отсутствие торговли','Контакты и официальные источники'],
  th:['ขอบเขตทางกฎหมาย','ภาษาของเอกสาร','ข้อกำหนดทางกฎหมายเฉพาะประเทศ','ความเป็นส่วนตัว ความปลอดภัย และสิทธิของผู้ใช้','การสมัครสมาชิกและข้อมูลผู้บริโภค','สวัสดิภาพสัตว์และการไม่ทำการค้า','การติดต่อและแหล่งข้อมูลทางการ'],
  tr:['Hukuki kapsam','Belge dili','Ülkeye özgü hukuki gereklilikler','Gizlilik, güvenlik ve kullanıcı hakları','Abonelikler ve tüketici bilgileri','Hayvan refahı ve ticari olmayan yapı','İletişim ve resmî kaynaklar'],
  vi:['Phạm vi pháp lý','Ngôn ngữ tài liệu','Yêu cầu pháp lý riêng theo quốc gia','Quyền riêng tư, an toàn và quyền của người dùng','Đăng ký và thông tin người tiêu dùng','Phúc lợi động vật và không thương mại','Liên hệ và nguồn chính thức'],
  'zh-Hans':['法律适用范围','文件语言','国家特定法律要求','隐私、安全与用户权利','订阅与消费者信息','动物福利与非商业交易','联系方式与官方来源'],
  'zh-Hant':['法律適用範圍','文件語言','國家特定法律要求','隱私、安全與使用者權利','訂閱與消費者資訊','動物福利與非商業交易','聯絡方式與官方來源'],
};

const frameworkHeadings={
  ar:'الأطر القانونية التي تمت مراجعتها',ca:'Marcs jurídics revisats',de:'Geprüfte Rechtsrahmen',en:'Reviewed legal frameworks',es:'Marcos jurídicos revisados',eu:'Berrikusitako lege-esparruak',fr:'Cadres juridiques examinés',gl:'Marcos xurídicos revisados',hi:'समीक्षित कानूनी ढाँचे',id:'Kerangka hukum yang ditinjau',it:'Quadri giuridici esaminati',ja:'確認済みの法的枠組み',ko:'검토된 법적 체계',nl:'Beoordeelde juridische kaders',pl:'Zweryfikowane ramy prawne','pt-BR':'Marcos jurídicos revisados',ru:'Проверенные правовые рамки',th:'กรอบกฎหมายที่ผ่านการทบทวน',tr:'İncelenen hukuki çerçeveler',vi:'Khung pháp lý đã được rà soát','zh-Hans':'已审查的法律框架','zh-Hant':'已審查的法律框架'
};

const forbiddenUserFacingJargon={
  en:/\blegal country\b|\broute\b|\bfallback\b|native app store/i,
  de:/Rechtsland|\bRoute\b|Fallback/i,
  fr:/pays juridique|\broute\b|repli silencieux|boutique native/i,
  nl:/juridische land|\broute\b|fallback|native appstore/i,
  'pt-BR':/país jurídico|\brota\b|fallback|loja nativa/i,
  es:/país jurídico|\bruta\b|sustitución silenciosa|tienda nativa/i,
  ca:/país jurídic|\bruta\b|substitució silenciosa|botiga nativa/i,
  eu:/lege-herrialde|ibilbide juridiko|fallback|denda natiboa/i,
  gl:/país xurídico|\bruta\b|substitución silenciosa|tenda nativa/i,
  it:/Paese giuridico|percorso giuridico|fallback|store nativo/i,
  id:/negara hukum|rute hukum|fallback/i,
  ja:/法的な国|法的ルート|フォールバック|ネイティブのアプリストア/,
  ko:/법적 국가|법적 경로|폴백|네이티브 앱 스토어/,
  pl:/krajem prawnym|ścieżka prawna|fallback/i,
  ru:/правов(?:ой|ая) стран|юридическ(?:ий|ого) маршрут|fallback/i,
  tr:/hukuki ülke|hukuki rota|sessiz geri dönüş|yerel uygulama mağazası/i,
  ar:/البلد القانوني|المسار القانوني|تحويل صامت/,
  'zh-Hans':/法律国家|法律路线|静默回退|原生应用商店/,
  'zh-Hant':/法律國家|法律路線|靜默回退|原生應用程式商店/,
  th:/ประเทศตามกฎหมาย|เส้นทางกฎหมาย/,
  hi:/कानूनी देश|कानूनी मार्ग/,
  vi:/quốc gia pháp lý|tuyến pháp lý/i,
};

const semanticHeadings=locale=>[...headings[locale].slice(0,3),frameworkHeadings[locale],...headings[locale].slice(3)];
const expectedLocales=new Set(Object.values(manifest.markets).flatMap(m=>Object.keys(m.routes??{})));
assert.deepEqual([...expectedLocales].sort(),Object.keys(headings).sort(),'semantic QA heading catalog must cover every supported legal-document locale exactly');
assert.deepEqual([...expectedLocales].sort(),Object.keys(frameworkHeadings).sort(),'legal-framework heading catalog must cover every supported legal-document locale exactly');
assert.equal(approval.summary.source_legal_approved_markets,27);
assert.equal(approval.summary.language_source_approved_markets,27);
assert.equal(approval.summary.exact_country_language_routes,594);
assert.equal(approval.summary.binding_country_language_routes,34);
assert.equal(approval.summary.accessibility_translation_routes,560);
assert.equal(approval.summary.all_supported_country_language_routes,594);
assert.equal(approval.summary.source_legal_language_blockers,0);

let checked=0;
for(const [cc,market] of Object.entries(manifest.markets)){
  const approved=approval.markets[cc];
  assert.ok(approved,`${cc}: source approval missing`);
  assert.equal(approved.legal_source_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW',`${cc}: legal source status`);
  assert.equal(approved.language_source_status,'PASS_INTERNAL_LEGAL_LANGUAGE_QA',`${cc}: legal-language source status`);
  for(const [locale,route] of Object.entries(market.routes)){
    const doc=JSON.parse(fs.readFileSync(route.source_file,'utf8'));
    const isBinding=market.required_route_locales.includes(locale);
    assert.equal(route.required_binding_locale,isBinding,`${cc}/${locale}: route binding flag`);
    assert.equal(doc.route_role,isBinding?'required_binding_document_locale':'accessibility_translation_non_controlling',`${cc}/${locale}: source route role`);
    if(!isBinding)assert.ok(doc.sections?.[1]?.paragraphs?.length>=2,`${cc}/${locale}: accessibility translation disclosure`);
    assert.equal(doc.as_of,'2026-10-01',`${cc}/${locale}: source review date`);
    assert.equal(doc.sections?.length,8,`${cc}/${locale}: exact eight-section legal supplement structure`);
    assert.deepEqual(doc.sections.map(s=>s.heading),semanticHeadings(locale),`${cc}/${locale}: localized legal semantic section headings`);
    const expectedFrameworks=releaseGates.markets?.[cc]?.framework??[];
    assert.ok(expectedFrameworks.length>0,`${cc}/${locale}: reviewed legal framework inventory missing`);
    assert.deepEqual(doc.reviewed_legal_frameworks,expectedFrameworks,`${cc}/${locale}: reviewed legal framework metadata drift`);
    assert.deepEqual(doc.sections[3].items,expectedFrameworks,`${cc}/${locale}: reviewed legal framework list drift`);
    assert.ok(doc.sections.every(s=>Array.isArray(s.paragraphs)&&s.paragraphs.length>0&&s.paragraphs.every(p=>typeof p==='string'&&p.trim().length>=35)),`${cc}/${locale}: every legal section needs substantive localized copy`);
    assert.equal(doc.sections[7].official_sources?.length,doc.official_source_count,`${cc}/${locale}: official source count parity`);
    assert.ok(doc.official_source_count>=8,`${cc}/${locale}: expected materially attributable official-source set`);
    assert.ok(doc.sections[7].paragraphs.join(' ').includes('yektaozel@icloud.com'),`${cc}/${locale}: privacy/legal contact must be present`);
    assert.equal(doc.official_topic_families,22,`${cc}/${locale}: official topic family coverage`);
    assert.equal(doc.no_silent_fallback,true,`${cc}/${locale}: legal-language fallback must fail closed`);
    const serialized=JSON.stringify(doc);
    assert.ok(!forbiddenUserFacingJargon[locale].test(doc.sections.flatMap(s=>s.paragraphs??[]).join(' ')),`${cc}/${locale}: user-facing legal copy contains internal engineering jargon or literal legal-country calque`);
    assert.ok(!/(?:TODO|FIXME|TBD|PLACEHOLDER|\{\{[^}]+\}\}|\[\[[^\]]+\]\])/i.test(serialized),`${cc}/${locale}: unresolved draft/template marker`);
    if(cc!=='TR') assert.ok(!/(?:\bKVKK\b|6698 sayılı|Kişisel Verilerin Korunması Kanunu)/i.test(serialized),`${cc}/${locale}: Turkey-specific KVKK leakage`);
    const html=fs.readFileSync(route.public_file,'utf8');
    const expectedDir=locale==='ar'?'rtl':'ltr';
    assert.ok(html.includes(`<html lang="${locale}" dir="${expectedDir}"`),`${cc}/${locale}: html lang/dir semantics`);
    for(const h of headings[locale]) assert.ok(html.includes(`>${h}</h2>`),`${cc}/${locale}: rendered localized heading missing: ${h}`);
    assert.ok(html.includes('yektaozel@icloud.com'),`${cc}/${locale}: rendered legal contact missing`);
    checked++;
  }
}
assert.equal(checked,594,'configured legal semantic QA must cover all 594 country-language routes');
const migration133=fs.readFileSync('supabase/migrations/133_configured_27_internal_legal_language_source_approval.sql','utf8');
const seedPattern=/\('([A-Z]{2})','([^']+)','2026-10-01','([^']+)','([0-9a-f]{64})','([^']+)','([0-9a-f]{64})',(\d+),'complete_internal_reviewed'/g;
const bindingSeeds=new Map([...migration133.matchAll(seedPattern)].map(m=>[`${m[1]}/${m[2]}`,{source_file:m[3],source_sha256:m[4],public_file:m[5],public_sha256:m[6],official_source_count:Number(m[7])}]));
assert.equal(bindingSeeds.size,34,'migration 133 must preserve the 34 required binding country-language seed rows');
const migration140=fs.readFileSync('supabase/migrations/140_configured_27_current_law_language_hash_sync.sql','utf8');
const allSeedPattern=/\('([A-Z]{2})','([^']+)','2026-10-01','([^']+)','([0-9a-f]{64})','([^']+)','([0-9a-f]{64})',(\d+),'complete_internal_reviewed','([^']+)',(true|false)/g;
const allSeeds=new Map([...migration140.matchAll(allSeedPattern)].map(m=>[`${m[1]}/${m[2]}`,{source_file:m[3],source_sha256:m[4],public_file:m[5],public_sha256:m[6],official_source_count:Number(m[7]),route_role:m[8],required_binding_locale:m[9]==='true'}]));
assert.equal(allSeeds.size,594,'latest migration 140 must synchronize all 594 country-language supplement rows');
for(const [cc,market] of Object.entries(manifest.markets)) for(const [locale,route] of Object.entries(market.routes)){
  assert.deepEqual(allSeeds.get(`${cc}/${locale}`),{source_file:route.source_file,source_sha256:route.source_sha256,public_file:route.public_file,public_sha256:route.public_sha256,official_source_count:route.official_source_count,route_role:route.route_role,required_binding_locale:route.required_binding_locale},`${cc}/${locale}: runtime all-language seed must equal frozen supplement manifest`);
}
console.log(`configured-legal-language-semantic-qa-v20: PASS ${checked}/594 country-language routes; 22/22 legal-document locales; eight-section semantics + reviewed-framework inventory, binding-vs-accessibility disclosure, directionality, official-source/contact integrity and country-leak guards`);
