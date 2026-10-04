import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const applicability=JSON.parse(fs.readFileSync(path.join(root,'release','legal-language-applicability-r8.json'),'utf8'));
const sourceReview=JSON.parse(fs.readFileSync(path.join(root,'release','official-source-review-v19.json'),'utf8'));
const releaseGates=JSON.parse(fs.readFileSync(path.join(root,'release','country-release-gates.json'),'utf8'));
const outSource=path.join(root,'web','legal-country-source');
const outWeb=path.join(root,'web','legal-country');
const outManifest=path.join(root,'release','country-legal-supplement-manifest-v20.json');
const asOf='2026-10-01';
const rtl=new Set(['ar']);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const allLegalLocales=['ar','ca','de','en','es','eu','fr','gl','hi','id','it','ja','ko','nl','pl','pt-BR','ru','th','tr','vi','zh-Hans','zh-Hant'];
const bindingLocaleSetFor=market=>new Set([...(market.configured_document_locales??[]),...(market.minimum_document_locales_for_current_product_configuration??[])]);
const displayFor=(country,locale,bindingLocales)=>{
  const exact=routeDisplay[`${country}:${locale}`];
  const countryName=exact?.country??new Intl.DisplayNames([locale],{type:'region'}).of(country)??country;
  const langNames=bindingLocales.map(code=>new Intl.DisplayNames([locale],{type:'language'}).of(code)??code);
  const languages=exact?.languages??new Intl.ListFormat([locale],{style:'long',type:'conjunction'}).format(langNames);
  const displayLanguage=new Intl.DisplayNames([locale],{type:'language'}).of(locale)??locale;
  return {country:countryName,languages,displayLanguage};
};
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const routeDisplay={
  'AE:ar':{country:'الإمارات العربية المتحدة',languages:'العربية والإنجليزية'},
  'AE:en':{country:'United Arab Emirates',languages:'Arabic and English'},
  'AT:de':{country:'Österreich',languages:'Deutsch'},
  'AU:en':{country:'Australia',languages:'English'},
  'BE:fr':{country:'Belgique',languages:'français, néerlandais et allemand'},
  'BE:nl':{country:'België',languages:'Frans, Nederlands en Duits'},
  'BE:de':{country:'Belgien',languages:'Französisch, Niederländisch und Deutsch'},
  'BR:pt-BR':{country:'Brasil',languages:'português (Brasil)'},
  'CA:en':{country:'Canada',languages:'English and French'},
  'CA:fr':{country:'Canada',languages:'anglais et français'},
  'CN:zh-Hans':{country:'中国',languages:'简体中文'},
  'DE:de':{country:'Deutschland',languages:'Deutsch'},
  'ES:es':{country:'España',languages:'español, catalán, euskera y gallego'},
  'ES:ca':{country:'Espanya',languages:'castellà, català, euskera i gallec'},
  'ES:eu':{country:'Espainia',languages:'gaztelania, katalana, euskara eta galegoa'},
  'ES:gl':{country:'España',languages:'castelán, catalán, éuscaro e galego'},
  'FR:fr':{country:'France',languages:'français'},
  'GB:en':{country:'United Kingdom',languages:'English'},
  'ID:id':{country:'Indonesia',languages:'Bahasa Indonesia'},
  'IE:en':{country:'Ireland',languages:'English'},
  'IN:en':{country:'India',languages:'English'},
  'IT:it':{country:'Italia',languages:'italiano'},
  'JP:ja':{country:'日本',languages:'日本語'},
  'KR:ko':{country:'대한민국',languages:'한국어'},
  'NL:nl':{country:'Nederland',languages:'Nederlands'},
  'PL:pl':{country:'Polska',languages:'polski'},
  'RU:ru':{country:'Россия',languages:'русский'},
  'SA:ar':{country:'المملكة العربية السعودية',languages:'العربية'},
  'SG:en':{country:'Singapore',languages:'English'},
  'TH:th':{country:'ประเทศไทย',languages:'ไทย'},
  'TR:tr':{country:'Türkiye',languages:'Türkçe'},
  'TW:zh-Hant':{country:'臺灣',languages:'繁體中文'},
  'US:en':{country:'United States',languages:'English'},
  'VN:vi':{country:'Việt Nam',languages:'tiếng Việt'}
};
const localized={
  "en": {
    "title": "Jurisdiction-Specific Legal Supplement",
    "lead": "This supplement applies when Tailmance determines that {CC} is the country whose law applies to your account. It supplements the Terms, Privacy Notice, Community Guidelines, subscription notice and other legal documents; it does not replace them.",
    "scopeH": "Legal scope",
    "scope": "Tailmance applies legal obligations according to that verified country and, where required, the applicable regional or local legal context. Changing the app language, travelling, or changing a store region does not by itself change that legal context.",
    "langH": "Document language",
    "lang": "The binding legal documents for this legal configuration are maintained in the required language(s): {LOCALES}. When a specific legal-document language is required, Tailmance does not automatically substitute another language without notice.",
    "controlsH": "Country-specific legal requirements",
    "controls": "Twenty-two areas of legal requirements are reviewed against attributable official sources for the applicable country. Current law and effective dates are separated from proposals, consultations and future measures; a proposal is never treated as current law.",
    "privacyH": "Privacy, safety and user rights",
    "privacy": "Privacy rights, data requests, account and data deletion, international transfers, age assurance, electronic marketing, security and breach duties are applied through the exact legal context. Use the in-app Legal Center for notices, export and deletion routes.",
    "healthAi": "AI-assisted health document checks. Tailmance may use AI-assisted text recognition to review the health record that you upload for your pet. The check only reads what the document says: it does not identify a pet’s breed, does not examine or diagnose the animal, and is not a veterinary certification. If the document is complete and consistent (it shows a microchip number, the vaccinations and the internal and external parasite treatments, with no errors or conflicting details), the check may mark it as verified. Incomplete, unclear or inconsistent documents are not verified automatically and may be reviewed by a person. AI can make mistakes and may miss errors or misread a document, so please check important information yourself. A verified label is not a guarantee of an animal’s health or vaccination status and is not a final, binding or legally valid decision. Rely on a licensed veterinarian for health decisions and do not delay care because of a result shown in the app.",
    "consumerH": "Subscriptions and consumer information",
    "consumer": "The app store through which the purchase is made is authoritative for the displayed subscription price, currency and applicable tax treatment. Renewal, cancellation and required pre-contract information are presented before purchase. Tailmance does not sell pets or physical products and does not process peer-to-peer payments for animal sales.",
    "welfareH": "Animal welfare and non-commerce",
    "welfare": "Commercial animal sales and commercial-breeding marketplace activity are prohibited. Owner-arranged mating is available only when the applicable country-specific animal-welfare, breeding, health, kinship and eligibility requirements are met; otherwise the feature remains unavailable.",
    "contactH": "Contact and official sources",
    "contact": "Questions about these notices or privacy requests may be sent to yektaozel@icloud.com. The official-source references used for this legal-country review are listed below.",
    "future": "Source review date: 1 October 2026. Future, draft or consultation-stage measures are tracked separately and are not represented as current law."
  },
  "de": {
    "title": "Rechtsordnungsspezifische rechtliche Ergänzung",
    "lead": "Diese Ergänzung gilt, wenn Tailmance feststellt, dass {CC} das für Ihr Konto maßgebliche Land ist. Sie ergänzt die Nutzungsbedingungen, Datenschutzhinweise, Community-Richtlinien, Abonnementhinweise und weitere rechtliche Dokumente; sie ersetzt diese nicht.",
    "scopeH": "Rechtlicher Geltungsbereich",
    "scope": "Tailmance richtet rechtliche Pflichten nach diesem verifizierten Land und, soweit erforderlich, nach dem einschlägigen regionalen oder lokalen Rechtsrahmen aus. Eine Änderung der App-Sprache, eine Reise oder ein Wechsel der Store-Region ändert diesen Rechtsrahmen nicht automatisch.",
    "langH": "Dokumentsprache",
    "lang": "Die verbindlichen rechtlichen Dokumente für diese rechtliche Konfiguration werden in den erforderlichen Sprachen bereitgehalten: {LOCALES}. Ist eine bestimmte Dokumentensprache vorgeschrieben, wird nicht ohne Hinweis automatisch eine andere Sprache verwendet.",
    "controlsH": "Länderspezifische rechtliche Anforderungen",
    "controls": "Für das maßgebliche Land werden zweiundzwanzig Bereiche rechtlicher Anforderungen anhand zuordenbarer amtlicher Quellen geprüft. Geltendes Recht und Wirksamkeitsdaten werden von Entwürfen, Konsultationen und künftigen Maßnahmen getrennt; ein Vorschlag wird nie als geltendes Recht behandelt.",
    "privacyH": "Datenschutz, Sicherheit und Nutzerrechte",
    "privacy": "Datenschutzrechte, Auskunfts- und Löschanträge, internationale Übermittlungen, Altersprüfung, elektronische Werbung sowie Sicherheits- und Meldepflichten werden im exakten Rechtskontext angewendet. Hinweise, Export- und Löschwege finden Sie im Legal Center der App.",
    "healthAi": "KI-gestützte Prüfung von Gesundheitsdokumenten. Tailmance kann KI-gestützte Texterkennung einsetzen, um den Gesundheitsnachweis zu prüfen, den du für dein Tier hochlädst. Die Prüfung liest nur, was im Dokument steht: Sie bestimmt nicht die Rasse eines Tieres, untersucht oder diagnostiziert das Tier nicht und ist keine tierärztliche Bescheinigung. Ist das Dokument vollständig und stimmig (es enthält eine Mikrochip-Nummer, die Impfungen sowie die Behandlungen gegen innere und äußere Parasiten, ohne Fehler oder widersprüchliche Angaben), kann die Prüfung es als verifiziert markieren. Unvollständige, unklare oder widersprüchliche Dokumente werden nicht automatisch verifiziert und können von einer Person geprüft werden. KI kann Fehler machen, Fehler übersehen oder ein Dokument falsch lesen. Bitte prüfe wichtige Informationen daher selbst. Eine Verifizierung ist keine Garantie für den Gesundheits- oder Impfstatus eines Tieres und keine endgültige, verbindliche oder rechtlich wirksame Entscheidung. Verlasse dich bei Gesundheitsentscheidungen auf eine Tierärztin oder einen Tierarzt und verzögere keine Behandlung wegen eines in der App angezeigten Ergebnisses.",
    "consumerH": "Abonnements und Verbraucherinformationen",
    "consumer": "Der App-Store, über den der Kauf erfolgt, ist für den angezeigten Abonnementpreis, die Währung und die anwendbare steuerliche Darstellung maßgeblich. Verlängerung, Kündigung und erforderliche vorvertragliche Informationen werden vor dem Kauf angezeigt. Tailmance verkauft weder Tiere noch physische Waren und wickelt keine Zahlungen zwischen Nutzern für Tierverkäufe ab.",
    "welfareH": "Tierwohl und Nicht-Kommerzialisierung",
    "welfare": "Kommerzielle Tierverkäufe und Marktplätze für gewerbliche Zucht sind verboten. Von Haltern organisierte Verpaarungen sind nur verfügbar, wenn die einschlägigen länderspezifischen Anforderungen an Tierwohl, Zucht, Gesundheit, Verwandtschaft und Eignung erfüllt sind; andernfalls bleibt die Funktion gesperrt.",
    "contactH": "Kontakt und amtliche Quellen",
    "contact": "Fragen zu diesen Hinweisen oder Datenschutzanfragen können an yektaozel@icloud.com gesendet werden. Die für diese Rechtsprüfung verwendeten amtlichen Quellen sind nachstehend aufgeführt.",
    "future": "Stand der Quellenprüfung: 1. Oktober 2026. Künftige, im Entwurf befindliche oder konsultierte Maßnahmen werden getrennt verfolgt und nicht als geltendes Recht dargestellt."
  },
  "fr": {
    "title": "Supplément juridique propre à la juridiction",
    "lead": "Ce supplément s’applique lorsque Tailmance détermine que {CC} est le pays dont le droit s’applique à votre compte. Il complète les Conditions d’utilisation, l’Avis de confidentialité, les Règles de la communauté, l’avis relatif à l’abonnement et les autres documents juridiques, sans les remplacer.",
    "scopeH": "Champ juridique",
    "scope": "Tailmance applique les obligations juridiques en fonction de ce pays vérifié et, lorsque cela est requis, du cadre juridique régional ou local applicable. Changer la langue de l’application, voyager ou modifier la région de la boutique ne change pas, à lui seul, ce cadre juridique.",
    "langH": "Langue des documents",
    "lang": "Les documents juridiques contraignants correspondant à cette configuration juridique sont tenus dans la ou les langues requises : {LOCALES}. Lorsqu’une langue déterminée est exigée, Tailmance ne la remplace pas automatiquement et sans avertissement par une autre langue.",
    "controlsH": "Exigences juridiques propres au pays",
    "controls": "Vingt-deux domaines d’exigences juridiques sont examinés pour le pays applicable à partir de sources officielles attribuables. Le droit en vigueur et ses dates d’effet sont distingués des projets, consultations et mesures futures ; une proposition n’est jamais présentée comme du droit en vigueur.",
    "privacyH": "Vie privée, sécurité et droits des utilisateurs",
    "privacy": "Les droits en matière de protection des données, les demandes d’accès et de suppression, les transferts internationaux, l’assurance de l’âge, le marketing électronique ainsi que les obligations de sécurité et de notification sont appliqués selon le contexte juridique exact. Le Centre juridique de l’application donne accès aux avis, à l’exportation et à la suppression.",
    "healthAi": "Contrôles de documents de santé assistés par IA. Tailmance peut utiliser une reconnaissance de texte assistée par IA pour examiner le carnet de santé que vous téléversez pour votre animal. Le contrôle lit uniquement ce que dit le document : il n’identifie pas la race d’un animal, n’examine ni ne diagnostique l’animal et ne constitue pas une certification vétérinaire. Si le document est complet et cohérent (il mentionne un numéro de puce électronique, les vaccinations ainsi que les traitements antiparasitaires internes et externes, sans erreur ni information contradictoire), le contrôle peut le marquer comme vérifié. Les documents incomplets, peu clairs ou incohérents ne sont pas vérifiés automatiquement et peuvent être examinés par une personne. L’IA peut se tromper, laisser passer des erreurs ou mal lire un document : vérifiez donc vous-même les informations importantes. La mention « vérifié » ne garantit ni l’état de santé ni l’état vaccinal d’un animal et n’est pas une décision définitive, contraignante ou juridiquement valable. Fiez-vous à un vétérinaire diplômé pour les décisions de santé et ne retardez pas les soins à cause d’un résultat affiché dans l’application.",
    "consumerH": "Abonnements et information des consommateurs",
    "consumer": "La boutique d’applications par laquelle l’achat est effectué fait foi pour le prix d’abonnement affiché, la devise et le traitement fiscal applicable. Les informations requises sur le renouvellement, l’annulation et la phase précontractuelle sont présentées avant l’achat. Tailmance ne vend ni animaux ni biens physiques et ne traite pas de paiements entre utilisateurs pour la vente d’animaux.",
    "welfareH": "Bien-être animal et absence de commerce",
    "welfare": "La vente commerciale d’animaux et les places de marché consacrées à l’élevage commercial sont interdites. Les accouplements organisés par les propriétaires ne sont disponibles que si les exigences applicables du pays en matière de bien-être animal, reproduction, santé, parenté et admissibilité sont remplies ; sinon la fonctionnalité reste indisponible.",
    "contactH": "Contact et sources officielles",
    "contact": "Les questions concernant ces avis ou les demandes relatives à la vie privée peuvent être envoyées à yektaozel@icloud.com. Les références officielles utilisées pour cette analyse juridique figurent ci-dessous.",
    "future": "Date de revue des sources : 1er octobre 2026. Les mesures futures, les projets et les consultations sont suivis séparément et ne sont pas présentés comme du droit en vigueur."
  },
  "nl": {
    "title": "Jurisdictiespecifieke juridische aanvulling",
    "lead": "Deze aanvulling geldt wanneer Tailmance vaststelt dat {CC} het land is waarvan het recht op uw account van toepassing is. Zij vult de Gebruiksvoorwaarden, Privacyverklaring, Communityrichtlijnen, abonnementsinformatie en andere juridische documenten aan en vervangt die niet.",
    "scopeH": "Juridische reikwijdte",
    "scope": "Tailmance past juridische verplichtingen toe op basis van dat geverifieerde land en, waar vereist, het toepasselijke regionale of lokale rechtskader. Een wijziging van de app-taal, reizen of een wijziging van de store-regio verandert dat rechtskader niet automatisch.",
    "langH": "Documenttaal",
    "lang": "De bindende juridische documenten voor deze juridische configuratie worden beschikbaar gehouden in de vereiste taal of talen: {LOCALES}. Wanneer een bepaalde documenttaal verplicht is, wordt die niet zonder kennisgeving automatisch door een andere taal vervangen.",
    "controlsH": "Landspecifieke juridische vereisten",
    "controls": "Voor het toepasselijke land worden tweeëntwintig gebieden van juridische vereisten getoetst aan herleidbare officiële bronnen. Geldend recht en ingangsdata worden gescheiden van voorstellen, consultaties en toekomstige maatregelen; een voorstel wordt nooit als geldend recht behandeld.",
    "privacyH": "Privacy, veiligheid en gebruikersrechten",
    "privacy": "Privacyrechten, gegevensverzoeken, account- en gegevensverwijdering, internationale doorgiften, leeftijdscontrole, elektronische marketing en verplichtingen rond beveiliging en datalekken worden toegepast binnen de exacte juridische context. Gebruik het Juridisch Centrum in de app voor kennisgevingen, export en verwijdering.",
    "healthAi": "AI-ondersteunde controle van gezondheidsdocumenten. Tailmance kan AI-ondersteunde tekstherkenning gebruiken om het gezondheidsdocument te beoordelen dat je voor je huisdier uploadt. De controle leest alleen wat er in het document staat: ze bepaalt niet het ras van een dier, onderzoekt of diagnosticeert het dier niet en is geen diergeneeskundige certificering. Als het document volledig en consistent is (met een chipnummer, de vaccinaties en de behandelingen tegen inwendige en uitwendige parasieten, zonder fouten of tegenstrijdige gegevens), kan de controle het als geverifieerd markeren. Onvolledige, onduidelijke of inconsistente documenten worden niet automatisch geverifieerd en kunnen door een persoon worden beoordeeld. AI kan fouten maken, fouten over het hoofd zien of een document verkeerd lezen. Controleer belangrijke informatie daarom zelf. Het label geverifieerd is geen garantie voor de gezondheids- of vaccinatiestatus van een dier en geen definitieve, bindende of rechtsgeldige beslissing. Vertrouw bij gezondheidsbeslissingen op een bevoegde dierenarts en stel zorg niet uit vanwege een resultaat in de app.",
    "consumerH": "Abonnementen en consumenteninformatie",
    "consumer": "De appwinkel waarmee de aankoop wordt gedaan, is leidend voor de weergegeven abonnementsprijs, valuta en toepasselijke belastingweergave. Verlenging, opzegging en vereiste precontractuele informatie worden vóór aankoop getoond. Tailmance verkoopt geen dieren of fysieke producten en verwerkt geen betalingen tussen gebruikers voor de verkoop van dieren.",
    "welfareH": "Dierenwelzijn en geen handelsplatform",
    "welfare": "Commerciële dierenverkoop en marktplaatsen voor commerciële fokkerij zijn verboden. Door eigenaren georganiseerde paringen zijn alleen beschikbaar wanneer aan de toepasselijke landspecifieke eisen voor dierenwelzijn, fokkerij, gezondheid, verwantschap en geschiktheid is voldaan; anders blijft de functie geblokkeerd.",
    "contactH": "Contact en officiële bronnen",
    "contact": "Vragen over deze kennisgevingen of privacyverzoeken kunnen worden gestuurd naar yektaozel@icloud.com. De officiële bronnen die voor deze juridische beoordeling zijn gebruikt, staan hieronder.",
    "future": "Datum bronbeoordeling: 1 oktober 2026. Toekomstige maatregelen, ontwerpen en consultaties worden afzonderlijk gevolgd en niet als geldend recht weergegeven."
  },
  "pt-BR": {
    "title": "Suplemento jurídico específico da jurisdição",
    "lead": "Este suplemento se aplica quando a Tailmance determina que {CC} é o país cuja legislação se aplica à sua conta. Ele complementa os Termos de Uso, o Aviso de Privacidade, as Diretrizes da Comunidade, o aviso de assinatura e outros documentos jurídicos, sem substituí-los.",
    "scopeH": "Âmbito jurídico",
    "scope": "A Tailmance aplica as obrigações jurídicas conforme esse país verificado e, quando necessário, o marco jurídico regional ou local aplicável. Alterar o idioma do app, viajar ou mudar a região da loja não altera, por si só, esse contexto jurídico.",
    "langH": "Idioma dos documentos",
    "lang": "Os documentos jurídicos vinculantes desta configuração são mantidos nos idiomas exigidos: {LOCALES}. Quando um idioma específico é obrigatório, a Tailmance não o substitui automaticamente por outro idioma sem aviso.",
    "controlsH": "Requisitos jurídicos específicos do país",
    "controls": "Vinte e duas áreas de requisitos jurídicos são revisadas para o país aplicável com base em fontes oficiais identificáveis. A legislação vigente e suas datas de eficácia são separadas de propostas, consultas e medidas futuras; uma proposta nunca é tratada como lei vigente.",
    "privacyH": "Privacidade, segurança e direitos do usuário",
    "privacy": "Direitos de privacidade, solicitações de dados, exclusão de conta e dados, transferências internacionais, verificação de idade, marketing eletrônico e obrigações de segurança e incidentes são aplicados no contexto jurídico exato. Use a Central Jurídica do app para avisos, exportação e exclusão.",
    "healthAi": "Verificação de documentos de saúde assistida por IA. O Tailmance pode usar reconhecimento de texto assistido por IA para analisar a carteira de saúde que você envia do seu pet. A verificação apenas lê o que o documento diz: não identifica a raça do animal, não examina nem diagnostica o animal e não é uma certificação veterinária. Se o documento estiver completo e consistente (com número do microchip, vacinas e tratamentos antiparasitários internos e externos, sem erros nem informações conflitantes), a verificação pode marcá-lo como verificado. Documentos incompletos, pouco claros ou inconsistentes não são verificados automaticamente e podem ser analisados por uma pessoa. A IA pode cometer erros, deixar passar falhas ou ler um documento de forma incorreta; por isso, confira você mesmo as informações importantes. O selo de verificado não é garantia do estado de saúde ou de vacinação de um animal e não é uma decisão final, vinculante ou juridicamente válida. Para decisões de saúde, confie em um médico-veterinário habilitado e não adie o atendimento por causa de um resultado exibido no app.",
    "consumerH": "Assinaturas e informações ao consumidor",
    "consumer": "A loja de aplicativos pela qual a compra é realizada é a referência para o preço de assinatura exibido, a moeda e o tratamento tributário aplicável. Renovação, cancelamento e informações pré-contratuais obrigatórias são apresentados antes da compra. A Tailmance não vende animais nem produtos físicos e não processa pagamentos entre usuários para venda de animais.",
    "welfareH": "Bem-estar animal e ausência de comércio",
    "welfare": "São proibidas vendas comerciais de animais e marketplaces destinados à reprodução comercial. Acasalamentos organizados pelos tutores só ficam disponíveis quando são atendidos os requisitos aplicáveis do país sobre bem-estar animal, reprodução, saúde, parentesco e elegibilidade; caso contrário, a funcionalidade permanece bloqueada.",
    "contactH": "Contato e fontes oficiais",
    "contact": "Dúvidas sobre estes avisos ou solicitações de privacidade podem ser enviadas para yektaozel@icloud.com. As fontes oficiais usadas nesta revisão jurídica estão listadas abaixo.",
    "future": "Data da revisão das fontes: 1º de outubro de 2026. Medidas futuras, projetos e consultas são acompanhados separadamente e não são apresentados como legislação vigente."
  },
  "es": {
    "title": "Suplemento jurídico específico de la jurisdicción",
    "lead": "Este suplemento se aplica cuando Tailmance determina que {CC} es el país cuya legislación se aplica a tu cuenta. Complementa los Términos de uso, el Aviso de privacidad, las Normas de la comunidad, el aviso de suscripción y otros documentos jurídicos, sin sustituirlos.",
    "scopeH": "Ámbito jurídico",
    "scope": "Tailmance aplica las obligaciones jurídicas conforme a ese país verificado y, cuando corresponda, al marco jurídico regional o local aplicable. Cambiar el idioma de la aplicación, viajar o cambiar la región de la tienda no modifica por sí solo ese marco jurídico.",
    "langH": "Idioma de los documentos",
    "lang": "Los documentos jurídicos vinculantes de esta configuración se mantienen en los idiomas exigidos: {LOCALES}. Cuando se exige un idioma determinado, Tailmance no lo sustituye automáticamente y sin aviso por otro idioma.",
    "controlsH": "Requisitos jurídicos específicos del país",
    "controls": "Se revisan veintidós ámbitos de requisitos jurídicos para el país aplicable utilizando fuentes oficiales identificables. El derecho vigente y sus fechas de aplicación se separan de propuestas, consultas y medidas futuras; una propuesta nunca se trata como derecho vigente.",
    "privacyH": "Privacidad, seguridad y derechos de las personas usuarias",
    "privacy": "Los derechos de privacidad, las solicitudes sobre datos, la eliminación de la cuenta y de datos, las transferencias internacionales, la verificación de edad, el marketing electrónico y las obligaciones de seguridad y notificación se aplican dentro del contexto jurídico exacto. Utiliza el Centro jurídico de la aplicación para avisos, exportación y eliminación.",
    "healthAi": "Comprobación de documentos de salud asistida por IA. Tailmance puede usar reconocimiento de texto asistido por IA para revisar la cartilla de salud que subes de tu mascota. La comprobación solo lee lo que dice el documento: no identifica la raza de un animal, no lo examina ni lo diagnostica y no es una certificación veterinaria. Si el documento está completo y es coherente (consta el número de microchip, las vacunas y los tratamientos antiparasitarios internos y externos, sin errores ni datos contradictorios), la comprobación puede marcarlo como verificado. Los documentos incompletos, poco claros o incoherentes no se verifican automáticamente y pueden ser revisados por una persona. La IA puede cometer errores, pasar por alto fallos o leer mal un documento, así que comprueba tú mismo la información importante. La etiqueta de verificado no garantiza el estado de salud ni de vacunación de un animal y no es una decisión definitiva, vinculante ni jurídicamente válida. Confía en un veterinario colegiado para las decisiones de salud y no retrases la atención por un resultado mostrado en la app.",
    "consumerH": "Suscripciones e información al consumidor",
    "consumer": "La tienda de aplicaciones a través de la cual se realiza la compra es la referencia para el precio de suscripción mostrado, la moneda y el tratamiento fiscal aplicable. La renovación, la cancelación y la información precontractual exigida se presentan antes de la compra. Tailmance no vende animales ni productos físicos y no procesa pagos entre usuarios por ventas de animales.",
    "welfareH": "Bienestar animal y ausencia de comercio",
    "welfare": "Se prohíben las ventas comerciales de animales y los mercados destinados a la cría comercial. Los apareamientos organizados por los propietarios solo están disponibles cuando se cumplen los requisitos aplicables del país en materia de bienestar animal, cría, salud, parentesco e idoneidad; de lo contrario, la función permanece bloqueada.",
    "contactH": "Contacto y fuentes oficiales",
    "contact": "Las consultas sobre estos avisos o las solicitudes de privacidad pueden enviarse a yektaozel@icloud.com. A continuación se enumeran las fuentes oficiales utilizadas para esta revisión jurídica.",
    "future": "Fecha de revisión de las fuentes: 1 de octubre de 2026. Las medidas futuras, los proyectos y las consultas se siguen por separado y no se presentan como derecho vigente."
  },
  "ca": {
    "title": "Suplement jurídic específic de la jurisdicció",
    "lead": "Aquest suplement s’aplica quan Tailmance determina que {CC} és el país la legislació del qual s’aplica al teu compte. Complementa les Condicions d’ús, l’Avís de privacitat, les Normes de la comunitat, l’avís de subscripció i altres documents jurídics, sense substituir-los.",
    "scopeH": "Àmbit jurídic",
    "scope": "Tailmance aplica les obligacions jurídiques d’acord amb aquest país verificat i, quan cal, amb el marc jurídic regional o local aplicable. Canviar l’idioma de l’aplicació, viatjar o canviar la regió de la botiga no modifica per si sol aquest marc jurídic.",
    "langH": "Llengua dels documents",
    "lang": "Els documents jurídics vinculants d’aquesta configuració es mantenen en les llengües exigides: {LOCALES}. Quan s’exigeix una llengua determinada, Tailmance no la substitueix automàticament i sense avís per una altra llengua.",
    "controlsH": "Requisits jurídics específics del país",
    "controls": "Es revisen vint-i-dues àrees de requisits jurídics per al país aplicable a partir de fonts oficials identificables. El dret vigent i les dates d’efecte se separen de propostes, consultes i mesures futures; una proposta mai no es tracta com a dret vigent.",
    "privacyH": "Privacitat, seguretat i drets de les persones usuàries",
    "privacy": "Els drets de privacitat, les sol·licituds sobre dades, la supressió del compte i de les dades, les transferències internacionals, la verificació d’edat, el màrqueting electrònic i les obligacions de seguretat i notificació s’apliquen dins del context jurídic exacte. Fes servir el Centre jurídic de l’aplicació per als avisos, l’exportació i la supressió.",
    "healthAi": "Comprovació de documents de salut assistida per IA. Tailmance pot fer servir reconeixement de text assistit per IA per revisar la cartilla de salut que puges de la teva mascota. La comprovació només llegeix el que diu el document: no identifica la raça d’un animal, no l’examina ni el diagnostica i no és una certificació veterinària. Si el document és complet i coherent (hi consta el número del microxip, les vacunes i els tractaments antiparasitaris interns i externs, sense errors ni dades contradictòries), la comprovació el pot marcar com a verificat. Els documents incomplets, poc clars o incoherents no es verifiquen automàticament i els pot revisar una persona. La IA pot cometre errors, passar per alt fallades o llegir malament un document, així que comprova tu mateix la informació important. L’etiqueta de verificat no garanteix l’estat de salut ni de vacunació d’un animal i no és una decisió definitiva, vinculant ni jurídicament vàlida. Confia en un veterinari col·legiat per a les decisions de salut i no endarrereixis l’atenció per un resultat mostrat a l’aplicació.",
    "consumerH": "Subscripcions i informació al consumidor",
    "consumer": "La botiga d’aplicacions a través de la qual es fa la compra és la referència per al preu de subscripció mostrat, la moneda i el tractament fiscal aplicable. La renovació, la cancel·lació i la informació precontractual exigida es presenten abans de la compra. Tailmance no ven animals ni productes físics i no processa pagaments entre usuaris per vendes d’animals.",
    "welfareH": "Benestar animal i absència de comerç",
    "welfare": "Es prohibeixen les vendes comercials d’animals i els mercats destinats a la cria comercial. Els aparellaments organitzats pels propietaris només estan disponibles quan es compleixen els requisits aplicables del país sobre benestar animal, cria, salut, parentiu i idoneïtat; en cas contrari, la funció roman bloquejada.",
    "contactH": "Contacte i fonts oficials",
    "contact": "Les consultes sobre aquests avisos o les sol·licituds de privacitat es poden enviar a yektaozel@icloud.com. A continuació s’enumeren les fonts oficials utilitzades en aquesta revisió jurídica.",
    "future": "Data de revisió de les fonts: 1 d’octubre de 2026. Les mesures futures, els projectes i les consultes es controlen per separat i no es presenten com a dret vigent."
  },
  "eu": {
    "title": "Jurisdikzioari dagokion lege-osagarria",
    "lead": "Osagarri hau aplikatzen da Tailmancek {CC} zure kontuari aplikatzen zaion zuzenbidearen herrialdea dela zehazten duenean. Erabilera-baldintzak, Pribatutasun-oharra, Komunitatearen arauak, harpidetza-oharra eta gainerako lege-dokumentuak osatzen ditu, baina ez ditu ordezten.",
    "scopeH": "Lege-esparrua",
    "scope": "Tailmancek betebehar juridikoak egiaztatutako herrialde horren eta, behar denean, aplikatu beharreko eskualdeko edo tokiko lege-esparruaren arabera aplikatzen ditu. Aplikazioaren hizkuntza aldatzeak, bidaiatzeak edo dendaren eskualdea aldatzeak ez du berez lege-esparru hori aldatzen.",
    "langH": "Dokumentuen hizkuntza",
    "lang": "Konfigurazio juridiko honetako dokumentu lotesleak beharrezko hizkuntzetan mantentzen dira: {LOCALES}. Hizkuntza jakin bat nahitaezkoa denean, Tailmancek ez du beste hizkuntza batekin automatikoki eta ohartarazi gabe ordezten.",
    "controlsH": "Herrialdeko lege-betekizun espezifikoak",
    "controls": "Aplikatu beharreko herrialderako hogeita bi lege-betekizun arlo berrikusten dira iturri ofizial identifikagarrien arabera. Indarreko zuzenbidea eta haren eragin-datak bereizten dira proposamen, kontsulta eta etorkizuneko neurrietatik; proposamen bat ez da inoiz indarreko zuzenbidetzat hartzen.",
    "privacyH": "Pribatutasuna, segurtasuna eta erabiltzaileen eskubideak",
    "privacy": "Pribatutasun-eskubideak, datu-eskaerak, kontuaren eta datuen ezabaketa, nazioarteko transferentziak, adin-egiaztapena, marketin elektronikoa eta segurtasun zein jakinarazpen betebeharrak lege-testuinguru zehatzean aplikatzen dira. Erabili aplikazioko Lege Zentroa oharrak, esportazioa eta ezabaketa kudeatzeko.",
    "healthAi": "IAk lagundutako osasun-dokumentuen egiaztapena. Tailmancek IAk lagundutako testu-ezagutza erabil dezake zure maskotarentzat igotzen duzun osasun-kartilla aztertzeko. Egiaztapenak dokumentuan idatzita dagoena baino ez du irakurtzen: ez du animaliaren arraza zehazten, ez du animalia aztertzen edo diagnostikatzen eta ez da albaitaritza-ziurtagiria. Dokumentua osoa eta koherentea bada (mikrotxip zenbakia, txertoak eta barruko zein kanpoko parasitoen tratamenduak agertzen dira, akatsik edo datu kontraesankorrik gabe), egiaztapenak egiaztatuta gisa marka dezake. Dokumentu osatugabeak, argitasun gabeak edo koherenterik gabeak ez dira automatikoki egiaztatzen eta pertsona batek berrikus ditzake. IAk akatsak egin ditzake, akatsak ikusi gabe utzi edo dokumentua gaizki irakurri, beraz egiaztatu zuk zeuk informazio garrantzitsua. Egiaztatuta etiketak ez du animalia baten osasun- edo txertaketa-egoeraren bermerik ematen eta ez da behin betiko, loteslea edo juridikoki baliozkoa den erabakia. Osasun-erabakietarako, fidatu lizentziadun albaitari batengan eta ez atzeratu zaintza aplikazioan ageri den emaitza batengatik.",
    "consumerH": "Harpidetzak eta kontsumitzaileentzako informazioa",
    "consumer": "Erosketa egiten den aplikazio-denda da bistaratutako harpidetza-prezioaren, monetaren eta aplikatu beharreko zerga-tratamenduaren erreferentzia. Berritzea, ezeztatzea eta beharrezko kontratu-aurreko informazioa erosketa baino lehen erakusten dira. Tailmancek ez du animaliarik edo produktu fisikorik saltzen, eta ez du erabiltzaileen arteko animalien salmenta-ordainketarik prozesatzen.",
    "welfareH": "Animalien ongizatea eta merkataritzarik eza",
    "welfare": "Animalien salmenta komertzialak eta hazkuntza komertzialerako merkatuak debekatuta daude. Jabeek antolatutako estalketak herrialdean aplikatu beharreko animalien ongizate, hazkuntza, osasun, ahaidetasun eta egokitasun baldintzak betetzen direnean bakarrik daude erabilgarri; bestela funtzioak blokeatuta jarraitzen du.",
    "contactH": "Kontaktua eta iturri ofizialak",
    "contact": "Ohar hauei buruzko galderak edo pribatutasun-eskaerak yektaozel@icloud.com helbidera bidal daitezke. Lege-berrikuspen honetarako erabilitako iturri ofizialak behean zerrendatzen dira.",
    "future": "Iturrien berrikuspen-data: 2026ko urriaren 1a. Etorkizuneko neurriak, zirriborroak eta kontsultak bereizita jarraitzen dira, eta ez dira indarreko zuzenbidetzat aurkezten."
  },
  "gl": {
    "title": "Suplemento xurídico específico da xurisdición",
    "lead": "Este suplemento aplícase cando Tailmance determina que {CC} é o país cuxa lexislación se aplica á túa conta. Complementa as Condicións de uso, o Aviso de privacidade, as Normas da comunidade, o aviso de subscrición e outros documentos xurídicos, sen substituílos.",
    "scopeH": "Ámbito xurídico",
    "scope": "Tailmance aplica as obrigas xurídicas conforme a ese país verificado e, cando sexa necesario, ao marco xurídico rexional ou local aplicable. Cambiar o idioma da aplicación, viaxar ou cambiar a rexión da tenda non modifica por si só ese marco xurídico.",
    "langH": "Lingua dos documentos",
    "lang": "Os documentos xurídicos vinculantes desta configuración mantéñense nas linguas esixidas: {LOCALES}. Cando se esixe unha lingua determinada, Tailmance non a substitúe automaticamente e sen aviso por outra lingua.",
    "controlsH": "Requisitos xurídicos específicos do país",
    "controls": "Revísanse vinte e dúas áreas de requisitos xurídicos para o país aplicable mediante fontes oficiais identificables. O dereito vixente e as súas datas de efecto sepáranse de propostas, consultas e medidas futuras; unha proposta nunca se trata como dereito vixente.",
    "privacyH": "Privacidade, seguridade e dereitos das persoas usuarias",
    "privacy": "Os dereitos de privacidade, as solicitudes sobre datos, a eliminación da conta e dos datos, as transferencias internacionais, a verificación de idade, o márketing electrónico e as obrigas de seguridade e notificación aplícanse dentro do contexto xurídico exacto. Usa o Centro xurídico da aplicación para avisos, exportación e eliminación.",
    "healthAi": "Comprobación de documentos de saúde asistida por IA. Tailmance pode usar recoñecemento de texto asistido por IA para revisar a cartilla de saúde que subes da túa mascota. A comprobación só le o que di o documento: non identifica a raza dun animal, non o examina nin o diagnostica e non é unha certificación veterinaria. Se o documento está completo e é coherente (consta o número do microchip, as vacinas e os tratamentos antiparasitarios internos e externos, sen erros nin datos contraditorios), a comprobación pode marcalo como verificado. Os documentos incompletos, pouco claros ou incoherentes non se verifican automaticamente e pode revisalos unha persoa. A IA pode cometer erros, pasar por alto fallos ou ler mal un documento, así que comproba ti mesmo a información importante. A etiqueta de verificado non garante o estado de saúde nin de vacinación dun animal e non é unha decisión definitiva, vinculante nin xuridicamente válida. Confía nun veterinario colexiado para as decisións de saúde e non atrases a atención por un resultado mostrado na aplicación.",
    "consumerH": "Subscricións e información ao consumidor",
    "consumer": "A tenda de aplicacións a través da cal se realiza a compra é a referencia para o prezo de subscrición mostrado, a moeda e o tratamento fiscal aplicable. A renovación, a cancelación e a información precontractual esixida preséntanse antes da compra. Tailmance non vende animais nin produtos físicos e non procesa pagamentos entre usuarios por vendas de animais.",
    "welfareH": "Benestar animal e ausencia de comercio",
    "welfare": "Prohíbense as vendas comerciais de animais e os mercados destinados á cría comercial. Os apareamentos organizados polos propietarios só están dispoñibles cando se cumpren os requisitos aplicables do país sobre benestar animal, cría, saúde, parentesco e idoneidade; en caso contrario, a función permanece bloqueada.",
    "contactH": "Contacto e fontes oficiais",
    "contact": "As consultas sobre estes avisos ou as solicitudes de privacidade poden enviarse a yektaozel@icloud.com. A continuación enuméranse as fontes oficiais utilizadas nesta revisión xurídica.",
    "future": "Data de revisión das fontes: 1 de outubro de 2026. As medidas futuras, os proxectos e as consultas contrólanse por separado e non se presentan como dereito vixente."
  },
  "it": {
    "title": "Supplemento giuridico specifico della giurisdizione",
    "lead": "Questo supplemento si applica quando Tailmance determina che {CC} è il Paese la cui legge si applica al tuo account. Integra i Termini d’uso, l’Informativa sulla privacy, le Regole della community, l’informativa sull’abbonamento e gli altri documenti legali, senza sostituirli.",
    "scopeH": "Ambito giuridico",
    "scope": "Tailmance applica gli obblighi legali in base a tale Paese verificato e, quando necessario, al quadro giuridico regionale o locale pertinente. Cambiare la lingua dell’app, viaggiare o cambiare la regione dello store non modifica di per sé tale quadro giuridico.",
    "langH": "Lingua dei documenti",
    "lang": "I documenti legali vincolanti per questa configurazione sono mantenuti nelle lingue richieste: {LOCALES}. Quando è richiesta una lingua specifica, Tailmance non la sostituisce automaticamente e senza avviso con un’altra lingua.",
    "controlsH": "Requisiti legali specifici del Paese",
    "controls": "Per il Paese applicabile vengono riesaminate ventidue aree di requisiti legali sulla base di fonti ufficiali identificabili. Il diritto vigente e le relative date di efficacia sono tenuti distinti da proposte, consultazioni e misure future; una proposta non viene mai trattata come diritto vigente.",
    "privacyH": "Privacy, sicurezza e diritti degli utenti",
    "privacy": "I diritti in materia di privacy, le richieste sui dati, la cancellazione dell’account e dei dati, i trasferimenti internazionali, la verifica dell’età, il marketing elettronico e gli obblighi di sicurezza e notifica sono applicati nel contesto giuridico esatto. Utilizza il Centro legale dell’app per informative, esportazione e cancellazione.",
    "healthAi": "Controlli dei documenti sanitari assistiti dall’IA. Tailmance può usare il riconoscimento del testo assistito dall’IA per esaminare il libretto sanitario che carichi per il tuo animale. Il controllo legge solo ciò che dice il documento: non identifica la razza di un animale, non visita né diagnostica l’animale e non è una certificazione veterinaria. Se il documento è completo e coerente (riporta il numero del microchip, le vaccinazioni e i trattamenti antiparassitari interni ed esterni, senza errori né dati contrastanti), il controllo può contrassegnarlo come verificato. I documenti incompleti, poco chiari o incoerenti non vengono verificati automaticamente e possono essere esaminati da una persona. L’IA può commettere errori, non rilevare difetti o leggere male un documento: controlla quindi tu stesso le informazioni importanti. L’etichetta «verificato» non garantisce lo stato di salute o vaccinale di un animale e non è una decisione definitiva, vincolante o giuridicamente valida. Per le decisioni sulla salute affidati a un medico veterinario abilitato e non ritardare le cure a causa di un risultato mostrato nell’app.",
    "consumerH": "Abbonamenti e informazioni ai consumatori",
    "consumer": "Lo store tramite il quale viene effettuato l’acquisto è la fonte di riferimento per il prezzo dell’abbonamento visualizzato, la valuta e il trattamento fiscale applicabile. Rinnovo, cancellazione e informazioni precontrattuali richieste sono presentati prima dell’acquisto. Tailmance non vende animali o prodotti fisici e non elabora pagamenti tra utenti per la vendita di animali.",
    "welfareH": "Benessere animale e assenza di commercio",
    "welfare": "Sono vietate le vendite commerciali di animali e i marketplace destinati all’allevamento commerciale. Gli accoppiamenti organizzati dai proprietari sono disponibili solo quando sono soddisfatti i requisiti applicabili del Paese in materia di benessere animale, allevamento, salute, parentela e idoneità; altrimenti la funzione resta bloccata.",
    "contactH": "Contatti e fonti ufficiali",
    "contact": "Le domande su queste informative o le richieste relative alla privacy possono essere inviate a yektaozel@icloud.com. Le fonti ufficiali utilizzate per questa revisione giuridica sono elencate di seguito.",
    "future": "Data della revisione delle fonti: 1 ottobre 2026. Le misure future, le bozze e le consultazioni sono monitorate separatamente e non sono presentate come diritto vigente."
  },
  "id": {
    "title": "Suplemen hukum khusus yurisdiksi",
    "lead": "Suplemen ini berlaku ketika Tailmance menetapkan bahwa {CC} adalah negara yang hukumnya berlaku untuk akun Anda. Dokumen ini melengkapi Ketentuan Penggunaan, Pemberitahuan Privasi, Pedoman Komunitas, pemberitahuan langganan, dan dokumen hukum lainnya; dokumen ini tidak menggantikannya.",
    "scopeH": "Ruang lingkup hukum",
    "scope": "Tailmance menerapkan kewajiban hukum berdasarkan negara terverifikasi tersebut dan, jika diperlukan, kerangka hukum regional atau lokal yang berlaku. Mengubah bahasa aplikasi, bepergian, atau mengubah wilayah toko tidak dengan sendirinya mengubah kerangka hukum tersebut.",
    "langH": "Bahasa dokumen",
    "lang": "Dokumen hukum yang mengikat untuk konfigurasi hukum ini tersedia dalam bahasa yang diwajibkan: {LOCALES}. Jika bahasa tertentu diwajibkan, Tailmance tidak menggantinya secara otomatis dan tanpa pemberitahuan dengan bahasa lain.",
    "controlsH": "Persyaratan hukum khusus negara",
    "controls": "Dua puluh dua bidang persyaratan hukum ditinjau untuk negara yang berlaku berdasarkan sumber resmi yang dapat diidentifikasi. Hukum yang berlaku dan tanggal berlakunya dipisahkan dari usulan, konsultasi, dan langkah masa depan; usulan tidak pernah diperlakukan sebagai hukum yang berlaku.",
    "privacyH": "Privasi, keamanan, dan hak pengguna",
    "privacy": "Hak privasi, permintaan data, penghapusan akun dan data, transfer internasional, verifikasi usia, pemasaran elektronik, serta kewajiban keamanan dan pelaporan diterapkan dalam konteks hukum yang tepat. Gunakan Pusat Hukum dalam aplikasi untuk pemberitahuan, ekspor, dan penghapusan.",
    "healthAi": "Pemeriksaan dokumen kesehatan berbantuan AI. Tailmance dapat menggunakan pengenalan teks berbantuan AI untuk meninjau catatan kesehatan yang Anda unggah untuk hewan peliharaan Anda. Pemeriksaan ini hanya membaca isi dokumen: tidak menentukan ras hewan, tidak memeriksa atau mendiagnosis hewan, dan bukan sertifikasi dokter hewan. Jika dokumen lengkap dan konsisten (memuat nomor microchip, vaksinasi, serta perawatan parasit dalam dan luar, tanpa kesalahan atau data yang saling bertentangan), pemeriksaan dapat menandainya sebagai terverifikasi. Dokumen yang tidak lengkap, tidak jelas, atau tidak konsisten tidak diverifikasi secara otomatis dan dapat ditinjau oleh seseorang. AI dapat membuat kesalahan, melewatkan kekeliruan, atau salah membaca dokumen, jadi mohon periksa sendiri informasi penting. Label terverifikasi bukan jaminan status kesehatan atau vaksinasi hewan dan bukan keputusan akhir, mengikat, atau sah secara hukum. Andalkan dokter hewan berlisensi untuk keputusan kesehatan dan jangan menunda perawatan karena hasil yang tampil di aplikasi.",
    "consumerH": "Langganan dan informasi konsumen",
    "consumer": "Toko aplikasi tempat pembelian dilakukan menjadi rujukan untuk harga langganan yang ditampilkan, mata uang, dan perlakuan pajak yang berlaku. Informasi mengenai perpanjangan, pembatalan, dan informasi prakontrak yang diwajibkan ditampilkan sebelum pembelian. Tailmance tidak menjual hewan atau barang fisik dan tidak memproses pembayaran antar pengguna untuk penjualan hewan.",
    "welfareH": "Kesejahteraan hewan dan non-perdagangan",
    "welfare": "Penjualan hewan secara komersial dan marketplace untuk pembiakan komersial dilarang. Perkawinan yang diatur oleh pemilik hanya tersedia apabila persyaratan negara yang berlaku terkait kesejahteraan hewan, pembiakan, kesehatan, kekerabatan, dan kelayakan terpenuhi; jika tidak, fitur tetap diblokir.",
    "contactH": "Kontak dan sumber resmi",
    "contact": "Pertanyaan tentang pemberitahuan ini atau permintaan privasi dapat dikirim ke yektaozel@icloud.com. Referensi sumber resmi yang digunakan untuk tinjauan hukum ini tercantum di bawah.",
    "future": "Tanggal tinjauan sumber: 1 Oktober 2026. Langkah masa depan, rancangan, dan konsultasi dipantau secara terpisah dan tidak ditampilkan sebagai hukum yang berlaku."
  },
  "ja": {
    "title": "法域別リーガル補足",
    "lead": "この補足文書は、Tailmance が {CC} をお客様のアカウントに適用される法令上の国として判定した場合に適用されます。利用規約、プライバシー通知、コミュニティガイドライン、サブスクリプション通知その他の法的文書を補完するものであり、これらに代わるものではありません。",
    "scopeH": "法的適用範囲",
    "scope": "Tailmance は、その確認済みの国と、必要な場合には該当する地域または地方の法的枠組みに基づいて法的義務を適用します。アプリの言語変更、旅行、ストア地域の変更だけで適用される法的枠組みが自動的に変わることはありません。",
    "langH": "文書の言語",
    "lang": "この法的設定に関する拘束力のある文書は、必要な言語で提供されます：{LOCALES}。特定の言語が必要な場合、Tailmance が通知なく別の言語に自動的に置き換えることはありません。",
    "controlsH": "国別の法的要件",
    "controls": "適用国について、22分野の法的要件を出所が確認できる公的資料に基づいて確認しています。現行法と施行日は、提案、意見募集、将来の措置と区別され、提案を現行法として扱うことはありません。",
    "privacyH": "プライバシー、安全性、利用者の権利",
    "privacy": "プライバシー権、データ請求、アカウントおよびデータの削除、国際移転、年齢確認、電子マーケティング、セキュリティおよび侵害通知の義務は、正確な法的状況に基づいて適用されます。通知、エクスポート、削除にはアプリ内のリーガルセンターを利用してください。",
    "healthAi": "AI支援による健康書類のチェック。 Tailmanceは、ペットのためにアップロードされた健康記録を確認する際に、AI支援の文字認識を使用することがあります。このチェックは書類に書かれている内容を読み取るだけで、動物の品種を判定したり、動物を診察・診断したりするものではなく、獣医師による証明でもありません。 書類が完全で一貫している場合(マイクロチップ番号、予防接種、内部寄生虫および外部寄生虫の駆除記録が記載され、誤りや矛盾する情報がない場合)、このチェックは書類を「確認済み」としてマークすることがあります。不完全、不明瞭、または一貫性のない書類は自動的には確認されず、担当者が確認することがあります。 AIは間違えることがあり、誤りを見逃したり書類を誤って読み取ったりする可能性があるため、重要な情報はご自身でも確認してください。「確認済み」の表示は、動物の健康状態や予防接種状況の保証ではなく、最終的、拘束力のある、または法的に有効な判断でもありません。健康に関する判断は免許を持つ獣医師にご相談のうえ、アプリに表示された結果を理由にケアを遅らせないでください。",
    "consumerH": "サブスクリプションと消費者情報",
    "consumer": "購入に利用するアプリストアが、表示されるサブスクリプション価格、通貨および適用される税の表示に関する基準となります。更新、解約および必要な契約前情報は購入前に提示されます。Tailmance は動物や物理商品を販売せず、動物売買に関する利用者間の支払いを処理しません。",
    "welfareH": "動物福祉と非商取引",
    "welfare": "商業的な動物販売および商業繁殖を目的とするマーケットプレイスは禁止されています。飼い主同士で手配する交配は、その国で適用される動物福祉、繁殖、健康、血縁および適格性の要件を満たす場合にのみ利用でき、それ以外は機能が利用できません。",
    "contactH": "連絡先と公的資料",
    "contact": "本通知に関する質問やプライバシー請求は yektaozel@icloud.com まで送付できます。この法的レビューで使用した公的資料は以下に記載しています。",
    "future": "資料レビュー日: 2026年10月1日。将来の措置、草案、意見募集は別途追跡し、現行法として表示しません。"
  },
  "ko": {
    "title": "관할권별 법률 보충문서",
    "lead": "이 보충문서는 Tailmance가 {CC}를 귀하의 계정에 적용되는 법률의 국가로 판단한 경우 적용됩니다. 이용약관, 개인정보 처리 안내, 커뮤니티 가이드라인, 구독 안내 및 기타 법률 문서를 보완하며 이를 대체하지 않습니다.",
    "scopeH": "법적 적용 범위",
    "scope": "Tailmance는 해당 확인된 국가와 필요한 경우 적용되는 지역 또는 지방의 법적 체계에 따라 법적 의무를 적용합니다. 앱 언어 변경, 여행 또는 스토어 지역 변경만으로 적용 법률이 자동으로 변경되지는 않습니다.",
    "langH": "문서 언어",
    "lang": "이 법적 설정에 관한 구속력 있는 문서는 필요한 언어로 제공됩니다: {LOCALES}. 특정 언어가 필요한 경우 Tailmance가 별도 안내 없이 다른 언어로 자동 대체하지 않습니다.",
    "controlsH": "국가별 법적 요건",
    "controls": "적용 국가에 대해 22개 분야의 법적 요건을 출처가 확인 가능한 공식 자료에 따라 검토합니다. 현행 법률과 시행일은 제안, 의견수렴 및 미래 조치와 구분되며, 제안을 현행 법률로 취급하지 않습니다.",
    "privacyH": "개인정보, 안전 및 이용자 권리",
    "privacy": "개인정보 권리, 데이터 요청, 계정 및 데이터 삭제, 국제 이전, 연령 확인, 전자 마케팅, 보안 및 침해 통지 의무는 정확한 법적 맥락에 따라 적용됩니다. 안내, 내보내기 및 삭제는 앱 내 법률 센터를 이용하세요.",
    "healthAi": "AI 지원 건강 문서 확인. Tailmance는 반려동물을 위해 업로드하신 건강 기록을 검토할 때 AI 지원 문자 인식을 사용할 수 있습니다. 이 확인은 문서에 적힌 내용만 읽으며, 동물의 품종을 판별하거나 동물을 진찰·진단하지 않고 수의학적 인증도 아닙니다. 문서가 완전하고 일관된 경우(마이크로칩 번호, 예방접종, 내부 및 외부 기생충 처치가 기재되어 있고 오류나 상충하는 정보가 없는 경우), 확인 결과 문서가 ‘확인됨’으로 표시될 수 있습니다. 불완전하거나 불명확하거나 일관성이 없는 문서는 자동으로 확인되지 않으며 담당자가 검토할 수 있습니다. AI는 실수를 할 수 있고 오류를 놓치거나 문서를 잘못 읽을 수 있으므로 중요한 정보는 직접 확인해 주세요. ‘확인됨’ 표시는 동물의 건강 또는 예방접종 상태를 보증하지 않으며 최종적이거나 구속력 있거나 법적으로 유효한 결정이 아닙니다. 건강 관련 결정은 면허가 있는 수의사에게 의지하고, 앱에 표시된 결과 때문에 진료를 미루지 마세요.",
    "consumerH": "구독 및 소비자 정보",
    "consumer": "구매에 사용되는 앱 스토어가 표시되는 구독 가격, 통화 및 적용 세금 표시의 기준입니다. 갱신, 취소 및 필요한 계약 전 정보는 구매 전에 제공됩니다. Tailmance는 동물이나 실물 상품을 판매하지 않으며 동물 판매에 대한 사용자 간 결제를 처리하지 않습니다.",
    "welfareH": "동물복지 및 비상거래",
    "welfare": "상업적 동물 판매와 상업적 번식을 위한 마켓플레이스는 금지됩니다. 보호자가 직접 조정하는 교배는 해당 국가에서 적용되는 동물복지, 번식, 건강, 혈연 및 적격성 요건을 충족한 경우에만 이용할 수 있으며, 그렇지 않으면 기능이 차단됩니다.",
    "contactH": "연락처 및 공식 자료",
    "contact": "이 안내 또는 개인정보 요청에 관한 문의는 yektaozel@icloud.com으로 보낼 수 있습니다. 이 법률 검토에 사용된 공식 자료는 아래에 기재되어 있습니다.",
    "future": "자료 검토일: 2026년 10월 1일. 미래 조치, 초안 및 의견수렴은 별도로 추적하며 현행 법률로 표시하지 않습니다."
  },
  "pl": {
    "title": "Uzupełnienie prawne właściwe dla jurysdykcji",
    "lead": "Niniejsze uzupełnienie ma zastosowanie, gdy Tailmance ustali, że {CC} jest państwem, którego prawo ma zastosowanie do Twojego konta. Uzupełnia Warunki korzystania, Informację o prywatności, Zasady społeczności, informację o subskrypcji i inne dokumenty prawne, ale ich nie zastępuje.",
    "scopeH": "Zakres prawny",
    "scope": "Tailmance stosuje obowiązki prawne zgodnie z tym zweryfikowanym państwem oraz, gdy jest to wymagane, z właściwymi regionalnymi lub lokalnymi ramami prawnymi. Sama zmiana języka aplikacji, podróż lub zmiana regionu sklepu nie zmienia automatycznie tych ram prawnych.",
    "langH": "Język dokumentów",
    "lang": "Wiążące dokumenty prawne dla tej konfiguracji są udostępniane w wymaganym języku lub językach: {LOCALES}. Jeżeli wymagany jest określony język, Tailmance nie zastępuje go automatycznie i bez powiadomienia innym językiem.",
    "controlsH": "Krajowe wymogi prawne",
    "controls": "Dla właściwego państwa weryfikowane są dwadzieścia dwa obszary wymogów prawnych na podstawie możliwych do zidentyfikowania źródeł urzędowych. Obowiązujące prawo i daty jego wejścia w życie są oddzielane od projektów, konsultacji i przyszłych środków; projekt nigdy nie jest traktowany jako obowiązujące prawo.",
    "privacyH": "Prywatność, bezpieczeństwo i prawa użytkowników",
    "privacy": "Prawa dotyczące prywatności, wnioski o dane, usuwanie konta i danych, transfery międzynarodowe, weryfikacja wieku, marketing elektroniczny oraz obowiązki w zakresie bezpieczeństwa i zgłaszania naruszeń są stosowane w dokładnym kontekście prawnym. Skorzystaj z Centrum prawnego w aplikacji, aby uzyskać informacje, eksportować dane lub złożyć wniosek o usunięcie.",
    "healthAi": "Kontrole dokumentów zdrowotnych wspierane przez AI. Tailmance może używać rozpoznawania tekstu wspieranego przez AI, aby przejrzeć książeczkę zdrowia, którą przesyłasz dla swojego zwierzęcia. Kontrola odczytuje wyłącznie to, co jest w dokumencie: nie określa rasy zwierzęcia, nie bada go ani nie stawia diagnozy i nie jest poświadczeniem weterynaryjnym. Jeśli dokument jest kompletny i spójny (zawiera numer mikroczipa, szczepienia oraz zabiegi przeciw pasożytom wewnętrznym i zewnętrznym, bez błędów i sprzecznych danych), kontrola może oznaczyć go jako zweryfikowany. Dokumenty niekompletne, niejasne lub niespójne nie są weryfikowane automatycznie i mogą zostać sprawdzone przez człowieka. AI może popełniać błędy, pomijać nieprawidłowości lub błędnie odczytać dokument, dlatego sprawdzaj ważne informacje również samodzielnie. Oznaczenie „zweryfikowany” nie gwarantuje stanu zdrowia ani szczepień zwierzęcia i nie jest decyzją ostateczną, wiążącą ani prawnie skuteczną. W sprawach zdrowia polegaj na lekarzu weterynarii i nie zwlekaj z opieką z powodu wyniku widocznego w aplikacji.",
    "consumerH": "Subskrypcje i informacje konsumenckie",
    "consumer": "Sklep z aplikacjami, za pośrednictwem którego dokonywany jest zakup, jest źródłem odniesienia dla wyświetlanej ceny subskrypcji, waluty i właściwego sposobu prezentacji podatków. Informacje o odnowieniu, anulowaniu i wymagane informacje przedkontraktowe są przedstawiane przed zakupem. Tailmance nie sprzedaje zwierząt ani towarów fizycznych i nie obsługuje płatności między użytkownikami za sprzedaż zwierząt.",
    "welfareH": "Dobrostan zwierząt i brak handlu",
    "welfare": "Komercyjna sprzedaż zwierząt i platformy przeznaczone do komercyjnej hodowli są zabronione. Krycie organizowane przez właścicieli jest dostępne tylko wtedy, gdy spełnione są właściwe dla danego państwa wymogi dotyczące dobrostanu, hodowli, zdrowia, pokrewieństwa i kwalifikowalności; w przeciwnym razie funkcja pozostaje zablokowana.",
    "contactH": "Kontakt i źródła urzędowe",
    "contact": "Pytania dotyczące tych informacji lub wnioski związane z prywatnością można kierować na adres yektaozel@icloud.com. Poniżej wymieniono źródła urzędowe wykorzystane w tym przeglądzie prawnym.",
    "future": "Data przeglądu źródeł: 1 października 2026 r. Przyszłe środki, projekty i konsultacje są śledzone oddzielnie i nie są przedstawiane jako obowiązujące prawo."
  },
  "ru": {
    "title": "Юридическое дополнение для конкретной юрисдикции",
    "lead": "Это дополнение применяется, когда Tailmance определяет, что {CC} является страной, право которой применяется к вашей учетной записи. Оно дополняет Условия использования, Уведомление о конфиденциальности, Правила сообщества, уведомление о подписке и другие юридические документы, но не заменяет их.",
    "scopeH": "Юридическая сфера действия",
    "scope": "Tailmance применяет юридические обязанности в соответствии с этой подтвержденной страной и, при необходимости, с применимой региональной или местной правовой системой. Изменение языка приложения, поездка или изменение региона магазина сами по себе не меняют применимое право.",
    "langH": "Язык документов",
    "lang": "Обязательные юридические документы для этой правовой конфигурации предоставляются на требуемом языке или языках: {LOCALES}. Если требуется определенный язык, Tailmance не заменяет его автоматически и без уведомления другим языком.",
    "controlsH": "Юридические требования для страны",
    "controls": "Для применимой страны по идентифицируемым официальным источникам проверяются двадцать две области юридических требований. Действующее право и даты вступления в силу отделяются от проектов, консультаций и будущих мер; предложение никогда не рассматривается как действующее право.",
    "privacyH": "Конфиденциальность, безопасность и права пользователей",
    "privacy": "Права в области конфиденциальности, запросы о данных, удаление аккаунта и данных, международные передачи, подтверждение возраста, электронный маркетинг, а также обязанности по безопасности и уведомлению применяются в точном юридическом контексте. Для уведомлений, экспорта и удаления используйте Юридический центр в приложении.",
    "healthAi": "Проверка медицинских документов с поддержкой ИИ. Tailmance может использовать распознавание текста с поддержкой ИИ, чтобы проверить ветеринарный паспорт, который вы загружаете для питомца. Проверка лишь считывает то, что написано в документе: она не определяет породу животного, не осматривает и не диагностирует его и не является ветеринарным заключением. Если документ полный и непротиворечивый (в нём указаны номер микрочипа, прививки, а также обработки от внутренних и внешних паразитов, нет ошибок и противоречивых сведений), проверка может отметить его как подтверждённый. Неполные, нечёткие или противоречивые документы автоматически не подтверждаются и могут быть проверены человеком. ИИ может ошибаться, пропускать недочёты или неверно считывать документ, поэтому важную информацию, пожалуйста, проверяйте сами. Отметка «подтверждено» не гарантирует состояние здоровья или прививок животного и не является окончательным, обязательным или юридически действительным решением. По вопросам здоровья полагайтесь на ветеринарного врача с лицензией и не откладывайте лечение из-за результата, показанного в приложении.",
    "consumerH": "Подписки и информация для потребителей",
    "consumer": "Магазин приложений, через который совершается покупка, является источником данных об отображаемой цене подписки, валюте и применимом налоговом представлении. Сведения о продлении, отмене и обязательная преддоговорная информация предоставляются до покупки. Tailmance не продает животных или физические товары и не обрабатывает платежи между пользователями за продажу животных.",
    "welfareH": "Благополучие животных и отсутствие торговли",
    "welfare": "Коммерческая продажа животных и площадки для коммерческого разведения запрещены. Организованная владельцами вязка доступна только при выполнении применимых в соответствующей стране требований к благополучию животных, разведению, здоровью, родству и допустимости; иначе функция остается заблокированной.",
    "contactH": "Контакты и официальные источники",
    "contact": "Вопросы по этим уведомлениям или запросы о конфиденциальности можно направлять на yektaozel@icloud.com. Официальные источники, использованные для этого юридического анализа, перечислены ниже.",
    "future": "Дата проверки источников: 1 октября 2026 г. Будущие меры, проекты и консультации отслеживаются отдельно и не представляются как действующее право."
  },
  "tr": {
    "title": "Ülkeye Özgü Hukuki Ek",
    "lead": "Bu ek, Tailmance {CC} ülkesinin hesabınıza uygulanacak hukukun ülkesi olduğunu belirlediğinde uygulanır. Kullanım Koşulları, Gizlilik Bildirimi, Topluluk Kuralları, abonelik bildirimi ve diğer hukuki belgeleri tamamlar; bunların yerine geçmez.",
    "scopeH": "Hukuki kapsam",
    "scope": "Tailmance hukuki yükümlülükleri bu doğrulanmış ülkeye ve gerektiğinde uygulanabilir bölgesel veya yerel hukuk çerçevesine göre uygular. Uygulama dilini değiştirmek, seyahat etmek veya mağaza bölgesini değiştirmek tek başına uygulanacak hukuku değiştirmez.",
    "langH": "Belge dili",
    "lang": "Bu hukuki yapılandırma için bağlayıcı belgeler gerekli dil veya dillerde sunulur: {LOCALES}. Belirli bir dil zorunluysa Tailmance başka bir dili bildirim yapmadan otomatik olarak onun yerine kullanmaz.",
    "controlsH": "Ülkeye özgü hukuki gereklilikler",
    "controls": "Uygulanacak ülke için yirmi iki hukuki gereklilik alanı, kaynağı belirli resmî kaynaklara göre incelenir. Yürürlükteki hukuk ve yürürlük tarihleri; teklifler, istişareler ve gelecekteki düzenlemelerden ayrı tutulur; bir teklif hiçbir zaman yürürlükteki hukuk olarak uygulanmaz.",
    "privacyH": "Gizlilik, güvenlik ve kullanıcı hakları",
    "privacy": "Gizlilik hakları, veri talepleri, hesap ve veri silme, uluslararası aktarımlar, yaş doğrulaması, elektronik pazarlama ile güvenlik ve ihlal bildirim yükümlülükleri tam hukuki bağlam üzerinden uygulanır. Bildirimler, dışa aktarma ve silme işlemleri için uygulamadaki Hukuk Merkezi’ni kullanabilirsiniz.",
    "healthAi": "Yapay zekâ destekli sağlık belgesi kontrolleri. Tailmance, evcil hayvanınız için yüklediğiniz sağlık karnesini incelemek üzere yapay zekâ destekli metin tanıma kullanabilir. Kontrol yalnızca belgede yazanı okur: hayvanın ırkını belirlemez, hayvanı muayene etmez veya teşhis koymaz ve veteriner belgelendirmesi değildir. Belge eksiksiz ve tutarlıysa (mikroçip numarası, aşılar ile iç ve dış parazit uygulamaları yer alıyor, hata veya birbiriyle çelişen bilgi yok), kontrol belgeyi doğrulanmış olarak işaretleyebilir. Eksik, belirsiz veya tutarsız belgeler otomatik olarak doğrulanmaz ve bir kişi tarafından incelenebilir. Yapay zekâ hata yapabilir; hataları gözden kaçırabilir veya belgeyi yanlış okuyabilir. Bu nedenle önemli bilgileri lütfen kendiniz de kontrol edin. Doğrulanmış etiketi, bir hayvanın sağlık veya aşı durumunun güvencesi değildir; nihai, bağlayıcı veya hukuken geçerli bir karar da değildir. Sağlıkla ilgili kararlar için ruhsatlı bir veteriner hekime başvurun ve uygulamada görünen bir sonuç nedeniyle bakımı geciktirmeyin.",
    "consumerH": "Abonelikler ve tüketici bilgileri",
    "consumer": "Satın almanın yapıldığı uygulama mağazası, gösterilen abonelik fiyatı, para birimi ve uygulanabilir vergi gösterimi için esas kaynaktır. Yenileme, iptal ve gerekli sözleşme öncesi bilgiler satın alma öncesinde gösterilir. Tailmance hayvan veya fiziksel ürün satmaz ve kullanıcılar arası hayvan satışı ödemelerini işlemez.",
    "welfareH": "Hayvan refahı ve ticari olmayan yapı",
    "welfare": "Ticari hayvan satışı ve ticari yetiştiriciliğe yönelik pazaryeri faaliyeti yasaktır. Sahiplerin kendi aralarında düzenlediği çiftleştirme yalnızca ilgili ülkede geçerli hayvan refahı, yetiştiricilik, sağlık, akrabalık ve uygunluk şartları karşılandığında kullanılabilir; aksi halde özellik kapalı kalır.",
    "contactH": "İletişim ve resmî kaynaklar",
    "contact": "Bu bildirimlerle ilgili sorular veya gizlilik talepleri yektaozel@icloud.com adresine gönderilebilir. Bu hukuki incelemede kullanılan resmî kaynaklar aşağıda listelenmiştir.",
    "future": "Kaynak inceleme tarihi: 1 Ekim 2026. Gelecekteki düzenlemeler, taslaklar ve istişareler ayrı izlenir ve yürürlükteki hukuk olarak sunulmaz."
  },
  "ar": {
    "title": "ملحق قانوني خاص بالولاية القضائية",
    "lead": "ينطبق هذا الملحق عندما تحدد Tailmance أن {CC} هي الدولة التي يسري قانونها على حسابك. وهو يكمل شروط الاستخدام وإشعار الخصوصية وإرشادات المجتمع وإشعار الاشتراك وسائر المستندات القانونية ولا يحل محلها.",
    "scopeH": "النطاق القانوني",
    "scope": "تطبق Tailmance الالتزامات القانونية وفقًا لتلك الدولة المتحقق منها، وعند الاقتضاء وفقًا للإطار القانوني الإقليمي أو المحلي المعمول به. لا يؤدي تغيير لغة التطبيق أو السفر أو تغيير منطقة المتجر بمفرده إلى تغيير القانون المطبق.",
    "langH": "لغة المستندات",
    "lang": "تُتاح المستندات القانونية الملزمة لهذه التهيئة القانونية باللغة أو اللغات المطلوبة: {LOCALES}. وإذا كانت لغة معينة إلزامية، فلا تستبدلها Tailmance تلقائيًا وبدون إشعار بلغة أخرى.",
    "controlsH": "المتطلبات القانونية الخاصة بالدولة",
    "controls": "تتم مراجعة اثنتين وعشرين فئة من المتطلبات القانونية للدولة المطبقة استنادًا إلى مصادر رسمية محددة المصدر. ويجري الفصل بين القانون النافذ وتواريخ سريانه وبين المقترحات والمشاورات والتدابير المستقبلية؛ ولا يُعامل أي مقترح على أنه قانون نافذ.",
    "privacyH": "الخصوصية والسلامة وحقوق المستخدم",
    "privacy": "تُطبق حقوق الخصوصية وطلبات البيانات وحذف الحساب والبيانات وعمليات النقل الدولي والتحقق من العمر والتسويق الإلكتروني والتزامات الأمن والإخطار ضمن السياق القانوني الدقيق. استخدم المركز القانوني داخل التطبيق للاطلاع على الإشعارات والتصدير والحذف.",
    "healthAi": "فحص الوثائق الصحية بمساعدة الذكاء الاصطناعي. قد تستخدم Tailmance التعرّف على النصوص بمساعدة الذكاء الاصطناعي لمراجعة السجل الصحي الذي ترفعه لحيوانك الأليف. يقرأ الفحص ما هو مكتوب في الوثيقة فقط: فهو لا يحدد سلالة الحيوان، ولا يفحصه ولا يشخّص حالته، وليس شهادة بيطرية. إذا كانت الوثيقة مكتملة ومتسقة (تتضمن رقم الشريحة الإلكترونية والتطعيمات وعلاجات الطفيليات الداخلية والخارجية، دون أخطاء أو بيانات متعارضة)، فقد يضع الفحص عليها علامة «موثّقة». أما الوثائق الناقصة أو غير الواضحة أو غير المتسقة فلا تُوثَّق تلقائيًا وقد يراجعها شخص. قد يخطئ الذكاء الاصطناعي وقد يفوته خطأ أو يقرأ وثيقة قراءة غير صحيحة، لذا يُرجى التحقق بنفسك من المعلومات المهمة. علامة «موثّقة» ليست ضمانًا للحالة الصحية للحيوان أو لحالة تطعيمه، وليست قرارًا نهائيًا أو ملزمًا أو نافذًا قانونًا. اعتمد على طبيب بيطري مرخّص في القرارات الصحية ولا تؤخر الرعاية بسبب نتيجة تظهر في التطبيق.",
    "consumerH": "الاشتراكات ومعلومات المستهلك",
    "consumer": "يُعد متجر التطبيقات الذي تتم من خلاله عملية الشراء المرجع للسعر المعروض للاشتراك والعملة وطريقة عرض الضرائب المطبقة. وتُعرض معلومات التجديد والإلغاء والمعلومات السابقة للتعاقد المطلوبة قبل الشراء. لا تبيع Tailmance الحيوانات أو المنتجات المادية ولا تعالج مدفوعات بين المستخدمين لبيع الحيوانات.",
    "welfareH": "رفاه الحيوان وعدم التجارة",
    "welfare": "يُحظر البيع التجاري للحيوانات والأسواق المخصصة للتربية التجارية. ولا تتاح عمليات التزاوج التي يرتبها المالكون إلا عند استيفاء المتطلبات المطبقة في الدولة بشأن رفاه الحيوان والتربية والصحة والقرابة والأهلية؛ وإلا تظل الخاصية محجوبة.",
    "contactH": "الاتصال والمصادر الرسمية",
    "contact": "يمكن إرسال الأسئلة المتعلقة بهذه الإشعارات أو طلبات الخصوصية إلى yektaozel@icloud.com. وترد أدناه المصادر الرسمية المستخدمة في هذه المراجعة القانونية.",
    "future": "تاريخ مراجعة المصادر: 1 أكتوبر 2026. تتم متابعة التدابير المستقبلية والمسودات والمشاورات بصورة منفصلة ولا تُعرض باعتبارها قانونًا نافذًا."
  },
  "zh-Hans": {
    "title": "司法辖区专属法律补充说明",
    "lead": "当 Tailmance 确定 {CC} 是其法律适用于您账户的国家时，本补充说明适用。它用于补充《使用条款》《隐私通知》《社区准则》《订阅通知》及其他法律文件，并不取代这些文件。",
    "scopeH": "法律适用范围",
    "scope": "Tailmance 根据该已核实国家以及必要时适用的地区或地方性法律框架履行法律义务。仅更改应用语言、旅行或更改商店地区，不会自行改变适用法律。",
    "langH": "文件语言",
    "lang": "本法律配置下具有约束力的文件以所需语言提供：{LOCALES}。如必须使用特定语言，Tailmance 不会在未告知您的情况下自动改用其他语言。",
    "controlsH": "国家特定法律要求",
    "controls": "针对适用国家，Tailmance 根据来源明确的官方资料审查二十二类法律要求。现行法律及其生效日期与提案、征求意见稿和未来措施严格区分；提案绝不会被当作现行法律执行。",
    "privacyH": "隐私、安全与用户权利",
    "privacy": "隐私权、数据请求、账户与数据删除、国际传输、年龄核验、电子营销以及安全与数据泄露通知义务均按精确法律环境执行。请使用应用内“法律中心”查看通知、导出和删除路径。",
    "healthAi": "AI 辅助的健康文件检查。 Tailmance 可能使用 AI 辅助的文字识别来审核您为宠物上传的健康记录。该检查只读取文件上写明的内容：它不会判断宠物的品种，不会检查或诊断动物，也不是兽医认证。 如果文件完整且前后一致（包含芯片号码、疫苗接种以及体内和体外驱虫记录，且没有错误或相互矛盾的信息），检查可能会将其标记为“已验证”。不完整、不清晰或前后不一致的文件不会被自动验证，并可能由人工审核。 AI 可能出错，可能遗漏问题或误读文件，因此请您自行核对重要信息。“已验证”标记不是对动物健康或疫苗接种状态的保证，也不是最终的、具有约束力的或具有法律效力的决定。健康方面的决定请依靠持证兽医，并且不要因应用中显示的结果而延误护理。",
    "consumerH": "订阅与消费者信息",
    "consumer": "完成购买所使用的应用商店是所显示订阅价格、货币及适用税费显示方式的依据。续订、取消及所需的合同前信息会在购买前展示。Tailmance 不销售动物或实体商品，也不处理用户之间的动物买卖付款。",
    "welfareH": "动物福利与非商业交易",
    "welfare": "禁止商业性动物销售及用于商业繁育的市场活动。只有在满足适用国家关于动物福利、繁育、健康、亲缘关系和资格的要求时，才可使用由宠物主人自行安排的配对；否则该功能保持关闭。",
    "contactH": "联系方式与官方来源",
    "contact": "有关这些通知的问题或隐私请求可发送至 yektaozel@icloud.com。下方列出了本次法律审查使用的官方来源。",
    "future": "来源审查日期：2026年10月1日。未来措施、草案和征求意见事项单独跟踪，不会被表述为现行法律。"
  },
  "zh-Hant": {
    "title": "司法管轄區專屬法律補充說明",
    "lead": "當 Tailmance 確定 {CC} 是其法律適用於您帳戶的國家時，本補充說明適用。它用於補充《使用條款》《隱私權通知》《社群準則》《訂閱通知》及其他法律文件，並不取代這些文件。",
    "scopeH": "法律適用範圍",
    "scope": "Tailmance 依據該已驗證國家以及必要時適用的地區或地方性法律架構履行法律義務。僅變更應用程式語言、旅行或變更商店地區，不會自行改變適用法律。",
    "langH": "文件語言",
    "lang": "本法律設定下具有約束力的文件以所需語言提供：{LOCALES}。如必須使用特定語言，Tailmance 不會在未告知您的情況下自動改用其他語言。",
    "controlsH": "國家特定法律要求",
    "controls": "針對適用國家，Tailmance 依據來源明確的官方資料審查二十二類法律要求。現行法律及其生效日期與提案、諮詢及未來措施嚴格區分；提案絕不會被當作現行法律執行。",
    "privacyH": "隱私、安全與使用者權利",
    "privacy": "隱私權、資料請求、帳戶與資料刪除、國際傳輸、年齡驗證、電子行銷以及安全與資料外洩通知義務，均依精確法律環境執行。請使用應用程式內的「法律中心」查看通知、匯出與刪除途徑。",
    "healthAi": "AI 輔助的健康文件檢查。 Tailmance 可能使用 AI 輔助的文字辨識來審核您為寵物上傳的健康紀錄。該檢查只讀取文件上寫明的內容：不會判斷寵物的品種，不會檢查或診斷動物，也不是獸醫認證。 如果文件完整且前後一致（包含晶片號碼、疫苗接種以及體內和體外驅蟲紀錄，且沒有錯誤或互相矛盾的資訊），檢查可能會將其標記為「已驗證」。不完整、不清楚或前後不一致的文件不會被自動驗證，並可能由人工審核。 AI 可能出錯，可能遺漏問題或誤讀文件，因此請您自行核對重要資訊。「已驗證」標記不是對動物健康或疫苗接種狀態的保證，也不是最終的、具約束力的或具法律效力的決定。健康方面的決定請依靠有執照的獸醫，並且不要因應用程式中顯示的結果而延誤照護。",
    "consumerH": "訂閱與消費者資訊",
    "consumer": "完成購買所使用的應用程式商店是顯示之訂閱價格、貨幣及適用稅費呈現方式的依據。續訂、取消及必要的締約前資訊會在購買前顯示。Tailmance 不銷售動物或實體商品，也不處理使用者之間的動物買賣付款。",
    "welfareH": "動物福利與非商業交易",
    "welfare": "禁止商業性動物銷售及用於商業繁育的市場活動。只有在符合適用國家關於動物福利、繁育、健康、親緣關係及資格的要求時，才可使用由飼主自行安排的配對；否則功能維持關閉。",
    "contactH": "聯絡方式與官方來源",
    "contact": "如對這些通知有疑問或提出隱私請求，可寄送至 yektaozel@icloud.com。下方列出本次法律審查使用的官方來源。",
    "future": "來源審查日期：2026年10月1日。未來措施、草案與諮詢事項會分開追蹤，不會被表述為現行法律。"
  },
  "th": {
    "title": "ภาคผนวกกฎหมายเฉพาะเขตอำนาจ",
    "lead": "ภาคผนวกนี้ใช้เมื่อ Tailmance ระบุว่า {CC} เป็นประเทศที่กฎหมายใช้บังคับกับบัญชีของคุณ โดยเป็นเอกสารเสริมข้อกำหนดการใช้งาน ประกาศความเป็นส่วนตัว แนวทางชุมชน ประกาศการสมัครสมาชิก และเอกสารทางกฎหมายอื่น ๆ ไม่ใช่เอกสารที่ใช้แทนเอกสารเหล่านั้น",
    "scopeH": "ขอบเขตทางกฎหมาย",
    "scope": "Tailmance ใช้หน้าที่ทางกฎหมายตามประเทศที่ได้รับการยืนยันดังกล่าว และเมื่อจำเป็นตามกรอบกฎหมายระดับภูมิภาคหรือท้องถิ่นที่เกี่ยวข้อง การเปลี่ยนภาษาของแอป การเดินทาง หรือการเปลี่ยนภูมิภาคของสโตร์ไม่ได้เปลี่ยนกฎหมายที่ใช้บังคับโดยอัตโนมัติ",
    "langH": "ภาษาของเอกสาร",
    "lang": "เอกสารทางกฎหมายที่มีผลผูกพันสำหรับการกำหนดทางกฎหมายนี้จัดทำในภาษาที่กำหนด: {LOCALES} หากต้องใช้ภาษาใดเป็นการเฉพาะ Tailmance จะไม่เปลี่ยนไปใช้ภาษาอื่นโดยอัตโนมัติและไม่แจ้งให้ทราบ",
    "controlsH": "ข้อกำหนดทางกฎหมายเฉพาะประเทศ",
    "controls": "มีการทบทวนข้อกำหนดทางกฎหมาย 22 หมวดสำหรับประเทศที่ใช้บังคับโดยอ้างอิงแหล่งข้อมูลทางการที่ระบุที่มาได้ กฎหมายที่มีผลใช้บังคับและวันที่มีผลจะถูกแยกออกจากข้อเสนอ การรับฟังความคิดเห็น และมาตรการในอนาคต โดยจะไม่ถือว่าข้อเสนอเป็นกฎหมายที่มีผลใช้บังคับ",
    "privacyH": "ความเป็นส่วนตัว ความปลอดภัย และสิทธิของผู้ใช้",
    "privacy": "สิทธิด้านความเป็นส่วนตัว คำขอเกี่ยวกับข้อมูล การลบบัญชีและข้อมูล การโอนข้อมูลระหว่างประเทศ การยืนยันอายุ การตลาดอิเล็กทรอนิกส์ และหน้าที่ด้านความปลอดภัยและการแจ้งเหตุ ถูกนำไปใช้ตามบริบททางกฎหมายที่ถูกต้อง ใช้ศูนย์กฎหมายในแอปเพื่อดูประกาศ การส่งออก และการลบข้อมูล",
    "healthAi": "การตรวจเอกสารสุขภาพที่ใช้ AI ช่วย Tailmance อาจใช้การรู้จำข้อความที่ใช้ AI ช่วยเพื่อตรวจสมุดสุขภาพที่คุณอัปโหลดสำหรับสัตว์เลี้ยงของคุณ การตรวจนี้อ่านเฉพาะสิ่งที่เขียนไว้ในเอกสาร ไม่ระบุสายพันธุ์ของสัตว์ ไม่ตรวจร่างกายหรือวินิจฉัยสัตว์ และไม่ใช่การรับรองจากสัตวแพทย์ หากเอกสารครบถ้วนและสอดคล้องกัน (มีหมายเลขไมโครชิป วัคซีน และการให้ยากำจัดปรสิตภายในและภายนอก โดยไม่มีข้อผิดพลาดหรือข้อมูลที่ขัดแย้งกัน) การตรวจอาจทำเครื่องหมายเอกสารว่า ยืนยันแล้ว เอกสารที่ไม่ครบถ้วน ไม่ชัดเจน หรือไม่สอดคล้องกันจะไม่ถูกยืนยันโดยอัตโนมัติ และอาจมีบุคคลตรวจสอบ AI อาจผิดพลาด อาจมองข้ามข้อผิดพลาดหรืออ่านเอกสารผิด โปรดตรวจสอบข้อมูลสำคัญด้วยตนเอง ป้าย ยืนยันแล้ว ไม่ใช่การรับประกันสถานะสุขภาพหรือการฉีดวัคซีนของสัตว์ และไม่ใช่คำตัดสินสุดท้าย ผูกมัด หรือมีผลทางกฎหมาย โปรดพึ่งพาสัตวแพทย์ที่ได้รับใบอนุญาตสำหรับการตัดสินใจด้านสุขภาพ และอย่าเลื่อนการดูแลเพราะผลที่แสดงในแอป",
    "consumerH": "การสมัครสมาชิกและข้อมูลผู้บริโภค",
    "consumer": "ร้านค้าแอปที่ใช้ในการซื้อเป็นแหล่งอ้างอิงสำหรับราคาสมัครสมาชิกที่แสดง สกุลเงิน และการแสดงภาษีที่ใช้บังคับ ข้อมูลเกี่ยวกับการต่ออายุ การยกเลิก และข้อมูลก่อนทำสัญญาที่จำเป็นจะแสดงก่อนการซื้อ Tailmance ไม่ขายสัตว์หรือสินค้าที่จับต้องได้ และไม่ประมวลผลการชำระเงินระหว่างผู้ใช้สำหรับการขายสัตว์",
    "welfareH": "สวัสดิภาพสัตว์และการไม่ทำการค้า",
    "welfare": "ห้ามการขายสัตว์เชิงพาณิชย์และตลาดที่มีไว้เพื่อการเพาะพันธุ์เชิงพาณิชย์ การผสมพันธุ์ที่เจ้าของจัดการกันเองจะใช้ได้เฉพาะเมื่อเป็นไปตามข้อกำหนดของประเทศที่เกี่ยวข้องด้านสวัสดิภาพสัตว์ การเพาะพันธุ์ สุขภาพ ความสัมพันธ์ทางสายเลือด และคุณสมบัติ มิฉะนั้นฟังก์ชันจะยังคงถูกปิดกั้น",
    "contactH": "การติดต่อและแหล่งข้อมูลทางการ",
    "contact": "คำถามเกี่ยวกับประกาศเหล่านี้หรือคำขอด้านความเป็นส่วนตัวสามารถส่งไปที่ yektaozel@icloud.com แหล่งข้อมูลทางการที่ใช้ในการทบทวนกฎหมายนี้แสดงไว้ด้านล่าง",
    "future": "วันที่ทบทวนแหล่งข้อมูล: 1 ตุลาคม 2026 มาตรการในอนาคต ร่าง และการรับฟังความคิดเห็นจะถูกติดตามแยกต่างหากและไม่นำเสนอว่าเป็นกฎหมายที่มีผลใช้บังคับ"
  },
  "hi": {
    "title": "अधिकार-क्षेत्र विशिष्ट कानूनी परिशिष्ट",
    "lead": "यह परिशिष्ट तब लागू होता है जब Tailmance यह निर्धारित करता है कि {CC} वह देश है जिसका कानून आपके खाते पर लागू होता है। यह उपयोग की शर्तों, गोपनीयता सूचना, समुदाय दिशानिर्देशों, सदस्यता सूचना और अन्य कानूनी दस्तावेज़ों का पूरक है; उनका स्थान नहीं लेता।",
    "scopeH": "कानूनी दायरा",
    "scope": "Tailmance कानूनी दायित्वों को उस सत्यापित देश और, जहाँ आवश्यक हो, लागू क्षेत्रीय या स्थानीय कानूनी ढाँचे के अनुसार लागू करता है। ऐप की भाषा बदलना, यात्रा करना या स्टोर क्षेत्र बदलना अपने-आप लागू कानून को नहीं बदलता।",
    "langH": "दस्तावेज़ की भाषा",
    "lang": "इस कानूनी व्यवस्था के बाध्यकारी दस्तावेज़ आवश्यक भाषा या भाषाओं में उपलब्ध कराए जाते हैं: {LOCALES}। जहाँ किसी विशिष्ट भाषा की आवश्यकता हो, Tailmance बिना सूचना दिए उसे किसी दूसरी भाषा से स्वतः नहीं बदलता।",
    "controlsH": "देश-विशिष्ट कानूनी आवश्यकताएँ",
    "controls": "लागू देश के लिए बाईस कानूनी आवश्यकता क्षेत्रों की समीक्षा स्पष्ट रूप से पहचाने जा सकने वाले आधिकारिक स्रोतों के आधार पर की जाती है। लागू कानून और उनकी प्रभावी तिथियाँ प्रस्तावों, परामर्शों और भविष्य की व्यवस्थाओं से अलग रखी जाती हैं; किसी प्रस्ताव को लागू कानून नहीं माना जाता।",
    "privacyH": "गोपनीयता, सुरक्षा और उपयोगकर्ता अधिकार",
    "privacy": "गोपनीयता अधिकार, डेटा अनुरोध, खाता और डेटा हटाना, अंतरराष्ट्रीय अंतरण, आयु आश्वासन, इलेक्ट्रॉनिक विपणन तथा सुरक्षा और उल्लंघन-सूचना दायित्व सटीक कानूनी संदर्भ के अनुसार लागू किए जाते हैं। सूचनाओं, निर्यात और हटाने के मार्गों के लिए ऐप के कानूनी केंद्र का उपयोग करें।",
    "healthAi": "एआई-सहायता प्राप्त स्वास्थ्य दस्तावेज़ जाँच। Tailmance आपके पालतू जानवर के लिए आपके द्वारा अपलोड किए गए स्वास्थ्य रिकॉर्ड की समीक्षा के लिए एआई-सहायता प्राप्त टेक्स्ट पहचान का उपयोग कर सकता है। यह जाँच केवल वही पढ़ती है जो दस्तावेज़ में लिखा है: यह जानवर की नस्ल की पहचान नहीं करती, जानवर की जाँच या निदान नहीं करती और पशु-चिकित्सा प्रमाणन नहीं है। यदि दस्तावेज़ पूर्ण और सुसंगत है (उसमें माइक्रोचिप नंबर, टीके और आंतरिक तथा बाहरी परजीवी उपचार दर्ज हैं, और कोई त्रुटि या परस्पर विरोधी जानकारी नहीं है), तो जाँच उसे सत्यापित के रूप में चिह्नित कर सकती है। अधूरे, अस्पष्ट या असंगत दस्तावेज़ अपने-आप सत्यापित नहीं होते और किसी व्यक्ति द्वारा देखे जा सकते हैं। एआई गलतियाँ कर सकता है, त्रुटियाँ छूट सकती हैं या दस्तावेज़ को गलत पढ़ सकता है, इसलिए कृपया महत्वपूर्ण जानकारी स्वयं भी जाँचें। सत्यापित लेबल किसी जानवर के स्वास्थ्य या टीकाकरण की स्थिति की गारंटी नहीं है और यह अंतिम, बाध्यकारी या कानूनी रूप से मान्य निर्णय नहीं है। स्वास्थ्य संबंधी निर्णयों के लिए लाइसेंस प्राप्त पशु-चिकित्सक पर भरोसा करें और ऐप में दिखे किसी परिणाम के कारण देखभाल में देरी न करें।",
    "consumerH": "सदस्यता और उपभोक्ता जानकारी",
    "consumer": "जिस ऐप स्टोर के माध्यम से खरीद की जाती है, वही दिखाई गई सदस्यता कीमत, मुद्रा और लागू कर प्रस्तुति का प्रामाणिक स्रोत है। नवीनीकरण, रद्दीकरण और आवश्यक पूर्व-संविदात्मक जानकारी खरीद से पहले दिखाई जाती है। Tailmance पशु या भौतिक वस्तुएँ नहीं बेचता और उपयोगकर्ताओं के बीच पशु बिक्री के भुगतान संसाधित नहीं करता।",
    "welfareH": "पशु कल्याण और गैर-वाणिज्यिक उपयोग",
    "welfare": "व्यावसायिक पशु बिक्री और व्यावसायिक प्रजनन के लिए बाज़ार गतिविधि निषिद्ध है। मालिकों द्वारा आयोजित प्रजनन केवल तभी उपलब्ध होता है जब लागू देश की पशु कल्याण, प्रजनन, स्वास्थ्य, संबंध और पात्रता संबंधी आवश्यकताएँ पूरी हों; अन्यथा सुविधा अवरुद्ध रहती है।",
    "contactH": "संपर्क और आधिकारिक स्रोत",
    "contact": "इन सूचनाओं से संबंधित प्रश्न या गोपनीयता अनुरोध yektaozel@icloud.com पर भेजे जा सकते हैं। इस कानूनी समीक्षा में उपयोग किए गए आधिकारिक स्रोत नीचे सूचीबद्ध हैं।",
    "future": "स्रोत समीक्षा की तिथि: 1 अक्टूबर 2026। भविष्य की व्यवस्थाएँ, मसौदे और परामर्श अलग से ट्रैक किए जाते हैं और उन्हें लागू कानून के रूप में प्रस्तुत नहीं किया जाता।"
  },
  "vi": {
    "title": "Phụ lục pháp lý riêng theo khu vực tài phán",
    "lead": "Phụ lục này áp dụng khi Tailmance xác định {CC} là quốc gia có pháp luật áp dụng cho tài khoản của bạn. Tài liệu này bổ sung cho Điều khoản sử dụng, Thông báo quyền riêng tư, Nguyên tắc cộng đồng, thông báo đăng ký và các tài liệu pháp lý khác, chứ không thay thế các tài liệu đó.",
    "scopeH": "Phạm vi pháp lý",
    "scope": "Tailmance áp dụng các nghĩa vụ pháp lý theo quốc gia đã được xác minh đó và, khi cần, theo khuôn khổ pháp lý cấp vùng hoặc địa phương có liên quan. Việc đổi ngôn ngữ ứng dụng, đi du lịch hoặc đổi khu vực cửa hàng không tự động thay đổi pháp luật áp dụng.",
    "langH": "Ngôn ngữ tài liệu",
    "lang": "Các tài liệu pháp lý có tính ràng buộc cho cấu hình pháp lý này được cung cấp bằng các ngôn ngữ bắt buộc: {LOCALES}. Khi phải sử dụng một ngôn ngữ cụ thể, Tailmance không tự động thay thế bằng ngôn ngữ khác mà không thông báo.",
    "controlsH": "Yêu cầu pháp lý riêng theo quốc gia",
    "controls": "Hai mươi hai lĩnh vực yêu cầu pháp lý được rà soát cho quốc gia áp dụng dựa trên các nguồn chính thức có thể xác định rõ. Pháp luật hiện hành và ngày có hiệu lực được tách biệt với đề xuất, dự thảo tham vấn và biện pháp trong tương lai; đề xuất không bao giờ được coi là pháp luật hiện hành.",
    "privacyH": "Quyền riêng tư, an toàn và quyền của người dùng",
    "privacy": "Quyền riêng tư, yêu cầu dữ liệu, xóa tài khoản và dữ liệu, chuyển dữ liệu quốc tế, xác minh độ tuổi, tiếp thị điện tử cùng nghĩa vụ bảo mật và thông báo vi phạm được áp dụng theo đúng bối cảnh pháp lý. Hãy sử dụng Trung tâm pháp lý trong ứng dụng để xem thông báo, xuất và xóa dữ liệu.",
    "healthAi": "Kiểm tra tài liệu sức khỏe có hỗ trợ AI. Tailmance có thể dùng nhận dạng văn bản có hỗ trợ AI để xem xét sổ sức khỏe mà bạn tải lên cho thú cưng. Bước kiểm tra chỉ đọc nội dung ghi trong tài liệu: không xác định giống của thú cưng, không khám hay chẩn đoán thú cưng và không phải là chứng nhận của bác sĩ thú y. Nếu tài liệu đầy đủ và nhất quán (có số vi mạch, các mũi tiêm và việc xử lý ký sinh trùng trong và ngoài, không có lỗi hay thông tin mâu thuẫn), bước kiểm tra có thể đánh dấu tài liệu là đã xác minh. Tài liệu thiếu, không rõ hoặc không nhất quán sẽ không được xác minh tự động và có thể do một người xem xét. AI có thể mắc lỗi, bỏ sót sai sót hoặc đọc sai tài liệu, vì vậy hãy tự kiểm tra các thông tin quan trọng. Nhãn đã xác minh không bảo đảm tình trạng sức khỏe hay tiêm chủng của thú cưng và không phải là quyết định cuối cùng, ràng buộc hay có giá trị pháp lý. Hãy dựa vào bác sĩ thú y có giấy phép cho các quyết định về sức khỏe và đừng trì hoãn việc chăm sóc vì một kết quả hiển thị trong ứng dụng.",
    "consumerH": "Đăng ký và thông tin người tiêu dùng",
    "consumer": "Cửa hàng ứng dụng được dùng để mua là nguồn tham chiếu cho giá đăng ký hiển thị, đơn vị tiền tệ và cách hiển thị thuế áp dụng. Thông tin bắt buộc về gia hạn, hủy và trước giao kết được hiển thị trước khi mua. Tailmance không bán động vật hoặc hàng hóa vật lý và không xử lý thanh toán giữa người dùng cho việc bán động vật.",
    "welfareH": "Phúc lợi động vật và không thương mại",
    "welfare": "Cấm bán động vật thương mại và các chợ dành cho hoạt động nhân giống thương mại. Việc phối giống do chủ nuôi tự sắp xếp chỉ khả dụng khi đáp ứng các yêu cầu áp dụng của quốc gia về phúc lợi động vật, nhân giống, sức khỏe, quan hệ huyết thống và điều kiện; nếu không, tính năng vẫn bị chặn.",
    "contactH": "Liên hệ và nguồn chính thức",
    "contact": "Câu hỏi về các thông báo này hoặc yêu cầu quyền riêng tư có thể gửi tới yektaozel@icloud.com. Các nguồn chính thức được sử dụng cho lần rà soát pháp lý này được liệt kê bên dưới.",
    "future": "Ngày rà soát nguồn: 1 tháng 10 năm 2026. Các biện pháp tương lai, dự thảo và tham vấn được theo dõi riêng và không được trình bày như pháp luật hiện hành."
  }
};
const frameworkCopy={
  "en": {
    "heading": "Reviewed legal frameworks",
    "note": "The principal framework identifiers recorded in Tailmance’s official-source review for the applicable country are listed below. Inclusion identifies review scope only: whether a rule is currently effective, future-effective, proposed, or subject to a narrower applicability condition is determined by the effective-date and exact-scope controls and is never inferred from this list alone."
  },
  "de": {
    "heading": "Geprüfte Rechtsrahmen",
    "note": "Nachstehend sind die wesentlichen Rechtsrahmen aufgeführt, die in der amtlichen Quellenprüfung von Tailmance für das maßgebliche Land erfasst sind. Die Aufnahme kennzeichnet nur den Prüfungsumfang: Ob eine Regel bereits gilt, künftig wirksam wird, lediglich vorgeschlagen ist oder nur unter engeren Voraussetzungen Anwendung findet, bestimmen die Wirksamkeits- und Anwendbarkeitskontrollen; dies wird niemals allein aus dieser Liste abgeleitet."
  },
  "fr": {
    "heading": "Cadres juridiques examinés",
    "note": "Les principaux cadres juridiques recensés dans l’examen des sources officielles de Tailmance pour le pays applicable sont indiqués ci-dessous. Leur présence délimite uniquement le champ de l’examen : le caractère en vigueur, à effet futur, proposé ou soumis à une condition d’applicabilité plus étroite est déterminé par les contrôles de date d’effet et de champ exact, et ne se déduit jamais de cette liste seule."
  },
  "nl": {
    "heading": "Beoordeelde juridische kaders",
    "note": "Hieronder staan de belangrijkste juridische kaders die in de officiële-bronnenbeoordeling van Tailmance voor dit rechtsland zijn opgenomen. Vermelding geeft alleen de reikwijdte van de beoordeling aan: of een regel nu geldt, later in werking treedt, slechts is voorgesteld of alleen onder een beperktere toepasselijkheidsvoorwaarde geldt, wordt bepaald door de controles op ingangsdatum en exacte toepasselijkheid en nooit uitsluitend uit deze lijst afgeleid."
  },
  "es": {
    "heading": "Marcos jurídicos revisados",
    "note": "A continuación se indican los principales marcos jurídicos registrados en la revisión de fuentes oficiales de Tailmance para el país aplicable. Su inclusión solo delimita el alcance de la revisión: si una norma está vigente, entra en vigor en el futuro, es una propuesta o depende de una condición de aplicabilidad más limitada se determina mediante los controles de fecha de eficacia y ámbito exacto, y nunca se deduce únicamente de esta lista."
  },
  "ca": {
    "heading": "Marcs jurídics revisats",
    "note": "A continuació s’indiquen els principals marcs jurídics registrats en la revisió de fonts oficials de Tailmance per al país aplicable. La inclusió només delimita l’abast de la revisió: si una norma és vigent, entra en vigor en el futur, és una proposta o depèn d’una condició d’aplicabilitat més limitada es determina mitjançant els controls de data d’efecte i d’àmbit exacte, i mai no es dedueix únicament d’aquesta llista."
  },
  "eu": {
    "heading": "Berrikusitako lege-esparruak",
    "note": "Jarraian, Tailmancek aplikatu beharreko herrialderako iturri ofizialen berrikuspenean jasotako lege-esparru nagusiak ageri dira. Zerrendan agertzeak berrikuspenaren irismena baino ez du adierazten: arau bat indarrean dagoen, etorkizunean sartuko den indarrean, proposamena den edo aplikagarritasun-baldintza estuago baten mende dagoen eraginkortasun-dataren eta aplikagarritasun zehatzaren kontrolek zehazten dute, eta ez da inoiz zerrenda honetatik bakarrik ondorioztatzen."
  },
  "gl": {
    "heading": "Marcos xurídicos revisados",
    "note": "A continuación indícanse os principais marcos xurídicos rexistrados na revisión de fontes oficiais de Tailmance para o país aplicable. A inclusión só delimita o alcance da revisión: se unha norma está vixente, entra en vigor no futuro, é unha proposta ou depende dunha condición de aplicabilidade máis limitada determínase cos controis de data de efecto e ámbito exacto, e nunca se deduce unicamente desta lista."
  },
  "pt-BR": {
    "heading": "Marcos jurídicos revisados",
    "note": "A seguir estão os principais marcos jurídicos registrados na revisão de fontes oficiais da Tailmance para o país aplicável. A inclusão indica apenas o escopo da revisão: se uma regra está vigente, terá vigência futura, é apenas proposta ou depende de uma condição de aplicabilidade mais restrita é determinado pelos controles de data de eficácia e de escopo exato, e nunca é inferido somente desta lista."
  },
  "hi": {
    "heading": "समीक्षित कानूनी ढाँचे",
    "note": "लागू देश के लिए Tailmance की आधिकारिक-स्रोत समीक्षा में दर्ज प्रमुख कानूनी ढाँचे नीचे दिए गए हैं। सूची में शामिल होना केवल समीक्षा के दायरे को दर्शाता है: कोई नियम वर्तमान में प्रभावी है, भविष्य में प्रभावी होगा, केवल प्रस्तावित है या किसी सीमित लागू-क्षेत्र की शर्त पर निर्भर है, यह प्रभावी-तिथि और सटीक लागू-क्षेत्र नियंत्रण से तय होता है; केवल इस सूची से ऐसा निष्कर्ष नहीं निकाला जाता।"
  },
  "id": {
    "heading": "Kerangka hukum yang ditinjau",
    "note": "Kerangka hukum utama yang dicatat dalam tinjauan sumber resmi Tailmance untuk negara yang berlaku tercantum di bawah. Pencantuman hanya menunjukkan cakupan tinjauan: apakah suatu aturan sudah berlaku, berlaku pada masa mendatang, masih berupa usulan, atau tunduk pada syarat penerapan yang lebih sempit ditentukan oleh kontrol tanggal berlaku dan cakupan penerapan yang tepat, dan tidak pernah disimpulkan hanya dari daftar ini."
  },
  "it": {
    "heading": "Quadri giuridici esaminati",
    "note": "Di seguito sono indicati i principali quadri giuridici registrati nella revisione delle fonti ufficiali di Tailmance per il Paese applicabile. L’inclusione indica soltanto l’ambito della revisione: l’effettiva vigenza, l’entrata in vigore futura, lo stato di proposta o una condizione di applicabilità più ristretta sono determinati dai controlli sulla data di efficacia e sull’ambito esatto e non vengono mai desunti dalla sola presenza in questo elenco."
  },
  "ja": {
    "heading": "確認済みの法的枠組み",
    "note": "この法的国について、Tailmance の公的資料レビューで確認対象として記録された主要な法的枠組みを以下に示します。掲載はレビュー範囲を示すだけです。各規則が現在施行中か、将来施行か、提案段階か、またはより限定された適用条件に従うかは、施行日と正確な適用範囲のコントロールで判断され、この一覧だけから推定されることはありません。"
  },
  "ko": {
    "heading": "검토된 법적 체계",
    "note": "적용 국가에 대해 Tailmance의 공식 자료 검토에 기록된 주요 법적 체계를 아래에 표시합니다. 목록에 포함되었다는 사실은 검토 범위만 의미합니다. 특정 규정이 현재 시행 중인지, 향후 시행되는지, 제안 단계인지, 또는 더 제한된 적용 요건에 따르는지는 시행일 및 정확한 적용 범위 통제로 판단하며 이 목록만으로 추정하지 않습니다."
  },
  "pl": {
    "heading": "Zweryfikowane ramy prawne",
    "note": "Poniżej wskazano główne ramy prawne ujęte w przeglądzie oficjalnych źródeł Tailmance dla właściwego państwa. Ujęcie na liście określa wyłącznie zakres przeglądu: to, czy dana reguła już obowiązuje, zacznie obowiązywać w przyszłości, jest jedynie propozycją albo podlega węższemu warunkowi stosowania, wynika z kontroli daty wejścia w życie i dokładnego zakresu zastosowania, a nigdy wyłącznie z tej listy."
  },
  "ru": {
    "heading": "Проверенные правовые рамки",
    "note": "Ниже перечислены основные правовые рамки, зафиксированные в проверке официальных источников Tailmance для применимой страны. Включение в список обозначает только охват проверки: действует ли норма сейчас, вступит в силу позднее, является предложением или применяется лишь при более узких условиях, определяется контролем дат вступления в силу и точной применимости и никогда не выводится только из этого списка."
  },
  "ar": {
    "heading": "الأطر القانونية التي تمت مراجعتها",
    "note": "ترد أدناه الأطر القانونية الرئيسية المسجلة في مراجعة Tailmance للمصادر الرسمية الخاصة بالدولة المطبقة. ويعني إدراجها نطاق المراجعة فقط؛ أما كون القاعدة نافذة حاليًا أو نافذة مستقبلًا أو مجرد مقترح أو خاضعة لشرط تطبيق أضيق فيُحسم من خلال ضوابط تاريخ النفاذ ونطاق التطبيق الدقيق، ولا يُستنتج مطلقًا من هذه القائمة وحدها."
  },
  "zh-Hans": {
    "heading": "已审查的法律框架",
    "note": "下方列出 Tailmance 针对适用国家在官方来源审查中记录的主要法律框架。列入清单仅表示审查范围；某项规则是当前生效、未来生效、仍属提案，还是受更窄的适用条件限制，由生效日期和精确适用范围控制决定，绝不会仅凭此清单作出推断。"
  },
  "zh-Hant": {
    "heading": "已審查的法律框架",
    "note": "下方列出 Tailmance 針對適用國家在官方來源審查中記錄的主要法律框架。列入清單僅表示審查範圍；某項規則是目前生效、未來生效、仍屬提案，或受更窄的適用條件限制，由生效日期與精確適用範圍控制決定，絕不會僅憑此清單作出推斷。"
  },
  "th": {
    "heading": "กรอบกฎหมายที่ผ่านการทบทวน",
    "note": "ด้านล่างคือกรอบกฎหมายหลักที่บันทึกไว้ในการทบทวนแหล่งข้อมูลทางการของ Tailmance สำหรับประเทศที่ใช้บังคับ การระบุไว้ในรายการหมายถึงขอบเขตการทบทวนเท่านั้น ส่วนกฎใดมีผลใช้บังคับแล้ว จะมีผลในอนาคต ยังเป็นเพียงข้อเสนอ หรือมีเงื่อนไขการใช้บังคับที่แคบกว่านั้น จะพิจารณาจากการควบคุมวันที่มีผลและขอบเขตการใช้บังคับที่แน่นอน และจะไม่อนุมานจากรายการนี้เพียงอย่างเดียว"
  },
  "tr": {
    "heading": "İncelenen hukuki çerçeveler",
    "note": "Uygulanacak ülke için Tailmance’ın resmî kaynak incelemesinde kayıtlı başlıca hukuki çerçeveler aşağıda yer alır. Listede bulunması yalnız inceleme kapsamını gösterir: bir kuralın bugün yürürlükte, gelecekte yürürlüğe girecek, yalnızca teklif aşamasında veya daha dar bir uygulanabilirlik koşuluna bağlı olup olmadığı yürürlük tarihi ve kesin uygulanabilirlik kontrolleriyle belirlenir; yalnız bu listeden sonuç çıkarılmaz."
  },
  "vi": {
    "heading": "Khung pháp lý đã được rà soát",
    "note": "Dưới đây là các khung pháp lý chính được ghi nhận trong quá trình Tailmance rà soát nguồn chính thức cho quốc gia áp dụng. Việc được liệt kê chỉ thể hiện phạm vi rà soát: một quy tắc hiện đang có hiệu lực, sẽ có hiệu lực trong tương lai, mới ở giai đoạn đề xuất hay chỉ áp dụng khi có điều kiện hẹp hơn được xác định bằng các kiểm soát về ngày hiệu lực và phạm vi áp dụng chính xác, không bao giờ chỉ suy ra từ danh sách này."
  }
};
const accessibilityNote={
  "en": "This version is provided as an accessibility translation. It does not replace a required-language version where applicable law or this legal configuration requires one.",
  "de": "Diese Fassung wird als barrierearme Übersetzung bereitgestellt. Sie ersetzt keine vorgeschriebene Sprachfassung, wenn das anwendbare Recht oder diese rechtliche Konfiguration eine solche verlangt.",
  "fr": "Cette version est fournie comme traduction d’accessibilité. Elle ne remplace pas une version dans une langue obligatoire lorsque le droit applicable ou cette configuration juridique l’exige.",
  "nl": "Deze versie wordt aangeboden als toegankelijkheidsvertaling. Zij vervangt geen verplichte taalversie wanneer het toepasselijke recht of deze juridische configuratie die vereist.",
  "es": "Esta versión se ofrece como traducción de accesibilidad. No sustituye una versión en un idioma obligatorio cuando la ley aplicable o esta configuración jurídica la exige.",
  "ca": "Aquesta versió s’ofereix com a traducció d’accessibilitat. No substitueix una versió en una llengua obligatòria quan la legislació aplicable o aquesta configuració jurídica l’exigeixen.",
  "eu": "Bertsio hau irisgarritasunerako itzulpen gisa eskaintzen da. Ez du nahitaezko hizkuntzako bertsioa ordezten aplikatu beharreko legeak edo konfigurazio juridiko honek hala eskatzen duenean.",
  "gl": "Esta versión ofrécese como tradución de accesibilidade. Non substitúe unha versión nunha lingua obrigatoria cando a normativa aplicable ou esta configuración xurídica a esixe.",
  "pt-BR": "Esta versão é fornecida como tradução para acessibilidade. Ela não substitui uma versão em idioma obrigatório quando a lei aplicável ou esta configuração jurídica assim exigir.",
  "hi": "यह संस्करण सुगम्यता के लिए अनुवाद के रूप में उपलब्ध कराया गया है। जहाँ लागू कानून या यह कानूनी व्यवस्था किसी आवश्यक भाषा संस्करण की माँग करती है, यह उसका स्थान नहीं लेता।",
  "id": "Versi ini disediakan sebagai terjemahan untuk aksesibilitas. Versi ini tidak menggantikan versi dalam bahasa yang diwajibkan apabila hukum yang berlaku atau konfigurasi hukum ini mensyaratkannya.",
  "it": "Questa versione è fornita come traduzione per l’accessibilità. Non sostituisce una versione in una lingua obbligatoria quando la legge applicabile o questa configurazione giuridica la richiedono.",
  "ja": "この版はアクセシビリティのための翻訳として提供されます。適用法またはこの法的設定で所定の言語版が必要な場合、その版に代わるものではありません。",
  "ko": "이 버전은 접근성을 위한 번역으로 제공됩니다. 적용 법률이나 이 법적 설정에서 특정 필수 언어 버전을 요구하는 경우 그 버전을 대체하지 않습니다.",
  "pl": "Ta wersja jest udostępniana jako tłumaczenie zwiększające dostępność. Nie zastępuje wersji w wymaganym języku, jeżeli wymaga tego właściwe prawo lub ta konfiguracja prawna.",
  "ru": "Эта версия предоставляется как перевод для доступности. Она не заменяет версию на обязательном языке, если такая версия требуется применимым правом или этой правовой конфигурацией.",
  "ar": "تُقدَّم هذه النسخة كترجمة لأغراض إتاحة الوصول. وهي لا تحل محل النسخة باللغة الإلزامية عندما يقتضي القانون المعمول به أو هذه التهيئة القانونية تلك النسخة.",
  "zh-Hans": "此版本作为无障碍翻译提供。如果适用法律或本法律配置要求特定的必需语言版本，本版本不会取代该版本。",
  "zh-Hant": "此版本作為無障礙翻譯提供。若適用法律或本法律設定要求特定的必要語言版本，本版本不會取代該版本。",
  "th": "ฉบับนี้จัดทำเป็นคำแปลเพื่อการเข้าถึง และไม่ใช้แทนฉบับภาษาที่กฎหมายที่ใช้บังคับหรือการกำหนดทางกฎหมายนี้กำหนดให้ต้องใช้",
  "tr": "Bu sürüm erişilebilirlik amacıyla çeviri olarak sunulur. Uygulanabilir hukuk veya bu hukuki yapılandırma zorunlu bir dil sürümü gerektiriyorsa onun yerine geçmez.",
  "vi": "Phiên bản này được cung cấp dưới dạng bản dịch hỗ trợ khả năng tiếp cận. Phiên bản này không thay thế bản bằng ngôn ngữ bắt buộc khi pháp luật áp dụng hoặc cấu hình pháp lý này yêu cầu."
};

for(const locale of allLegalLocales){
  if(!localized[locale])throw new Error(`missing localized country supplement template: ${locale}`);
  if(!frameworkCopy[locale])throw new Error(`missing localized legal-framework copy: ${locale}`);
}
fs.rmSync(outSource,{recursive:true,force:true}); fs.rmSync(outWeb,{recursive:true,force:true});
const manifest={schema_version:2,as_of:asOf,scope:'Exact legal-country × every supported legal-document locale jurisdiction supplements for the 27 configured Tailmance markets. Required/binding document locales remain explicitly distinguished from accessibility translations.',policy:{exact_country_and_locale_required:true,all_supported_legal_locales_per_country:true,binding_locale_and_accessibility_translation_must_be_distinguished:true,silent_cross_country_fallback:'BLOCK',silent_cross_language_fallback:'BLOCK',future_or_proposed_measures_never_represented_as_current:true,source_review_topic_families:sourceReview.required_topic_families?.length??0},summary:{markets:0,routes:0,binding_routes:0,accessibility_translation_routes:0,source_files:0,generated_html_files:0},markets:{}};
const csp="default-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests";
for(const [country,m] of Object.entries(applicability.markets)){
  const requiredRouteLocales=[...bindingLocaleSetFor(m)];
  const routeLocales=[...allLegalLocales];
  const sr=sourceReview.markets[country]; if(!sr)throw new Error(`${country}: official source review missing`);
  const gate=releaseGates.markets?.[country]; if(!gate)throw new Error(`${country}: country release gate missing`);
  const frameworks=[...(gate.framework??[])].filter(Boolean); if(!frameworks.length)throw new Error(`${country}: reviewed legal framework inventory missing`);
  const sources=[...new Set(Object.values(sr.topics??{}).flatMap(t=>Array.isArray(t.evidence_reference)?t.evidence_reference:[]).filter(Boolean))];
  if((sourceReview.required_topic_families?.length??0)!==22)throw new Error('expected 22 official-source legal topic families');
  for(const topic of sourceReview.required_topic_families)if(!sr.topics?.[topic]?.evidence_reference?.length)throw new Error(`${country}/${topic}: attributable source missing`);
  manifest.markets[country]={name:m.name,required_route_locales:requiredRouteLocales,available_route_locales:routeLocales,routes:{}};
  for(const locale of routeLocales){
    const t=localized[locale];
    const display=displayFor(country,locale,requiredRouteLocales);
    if(!display?.country||!display?.languages)throw new Error(`${country}/${locale}: localized country/language display labels missing`);
    const isBindingLocale=requiredRouteLocales.includes(locale);
    const vars=s=>s.replaceAll('{CC}',display.country).replaceAll('{LOCALES}',display.languages);
    const doc={schema_version:1,as_of:asOf,legal_country_code:country,country_display_name:display.country,document_locale:locale,document_language_display_names:display.languages,document_type:'jurisdiction_country_supplement',title:t.title,sections:[
      {heading:t.scopeH,paragraphs:[vars(t.lead),t.scope]},
      {heading:t.langH,paragraphs:[vars(t.lang),...(!isBindingLocale?[accessibilityNote[locale]]:[])]},
      {heading:t.controlsH,paragraphs:[t.controls,t.future]},
      {heading:frameworkCopy[locale].heading,paragraphs:[frameworkCopy[locale].note],items:frameworks},
      {heading:t.privacyH,paragraphs:[t.privacy,t.healthAi]},
      {heading:t.consumerH,paragraphs:[t.consumer]},
      {heading:t.welfareH,paragraphs:[t.welfare]},
      {heading:t.contactH,paragraphs:[t.contact],official_sources:sources}
    ],official_source_review_sha256:sha(JSON.stringify(sr)),official_source_count:sources.length,official_topic_families:22,reviewed_legal_frameworks:frameworks,no_silent_fallback:true,route_role:isBindingLocale?'required_binding_document_locale':'accessibility_translation_non_controlling',required_binding_document_locales:requiredRouteLocales,display_language_name:display.displayLanguage};
    const srcDir=path.join(outSource,country); fs.mkdirSync(srcDir,{recursive:true});
    const srcPath=path.join(srcDir,`${locale}.json`); const srcJson=JSON.stringify(doc,null,2)+'\n'; fs.writeFileSync(srcPath,srcJson);
    const body=doc.sections.map((s,i)=>`<section aria-labelledby="s${i+1}"><h2 id="s${i+1}">${esc(s.heading)}</h2>${(s.paragraphs??[]).map(p=>`<p>${esc(p)}</p>`).join('')}${s.items?`<ul>${s.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}${s.official_sources?`<ul>${s.official_sources.map(u=>`<li><a href="${esc(u)}" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ul>`:''}</section>`).join('');
    const html=`<!doctype html>\n<html lang="${esc(locale)}" dir="${rtl.has(locale)?'rtl':'ltr'}" data-legal-country="${country}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><title>Tailmance | ${esc(doc.title)} | ${esc(display.country)}</title><link rel="stylesheet" href="../../../styles.css"><meta name="robots" content="index,follow"></head><body><main class="wrap"><div class="brand">Tailmance 🐾</div><h1>${esc(doc.title)}</h1><p><strong>${esc(display.country)}</strong></p>${body}</main></body></html>\n`;
    const webDir=path.join(outWeb,country,locale); fs.mkdirSync(webDir,{recursive:true}); const webPath=path.join(webDir,'jurisdiction.html'); fs.writeFileSync(webPath,html);
    manifest.markets[country].routes[locale]={source_file:path.relative(root,srcPath),public_file:path.relative(root,webPath),public_url_path:`/legal-country/${country}/${locale}/jurisdiction.html`,source_sha256:sha(srcJson),public_sha256:sha(html),official_source_count:sources.length,official_topic_families:22,internal_language_qa_status:'complete_internal_reviewed',route_role:doc.route_role,required_binding_locale:isBindingLocale};
    manifest.summary.routes++;if(isBindingLocale)manifest.summary.binding_routes++;else manifest.summary.accessibility_translation_routes++;manifest.summary.source_files++;manifest.summary.generated_html_files++;
  }
  manifest.summary.markets++;
}
fs.writeFileSync(outManifest,JSON.stringify(manifest,null,2)+'\n');
console.log(`generate-country-legal-supplements: PASS ${manifest.summary.markets}/27 markets; ${manifest.summary.routes}/594 all-language country routes (${manifest.summary.binding_routes}/34 binding + ${manifest.summary.accessibility_translation_routes}/560 accessibility); 22/22 official-source topic families per market`);
