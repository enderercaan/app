import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const out='.tmp-domain-test';rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
execFileSync('tsc',['--target','ES2022','--module','ES2022','--moduleResolution','bundler','--outDir',out,'src/types/domain.ts','src/domain/matching.ts','src/domain/validation.ts','src/domain/contentSafety.ts','src/services/locale.ts'],{stdio:'inherit'});
const matching=await import(pathToFileURL(`${process.cwd()}/${out}/domain/matching.js`));
const validation=await import(pathToFileURL(`${process.cwd()}/${out}/domain/validation.js`));
const safety=await import(pathToFileURL(`${process.cwd()}/${out}/domain/contentSafety.js`));
const locale=await import(pathToFileURL(`${process.cwd()}/${out}/services/locale.js`));
const checks=[]; const check=(name,fn)=>{fn();checks.push(name)};
const photo=(id,sortOrder)=>({id,url:'x',sortOrder,moderationStatus:'approved'});
const base={id:'1',name:'A',species:'dog',breed:'Golden Retriever',sex:'male',birthDate:'2023-01-01',ageYears:3,size:'large',weightKg:30,energyLevel:4,temperamentTags:['friendly'],city:'İstanbul',district:'Kadıköy',neighborhood:'Caddebostan',purposes:['socialize','walk'],bio:'ok',photos:[photo('1',1),photo('2',2),photo('3',3)],profileVerified:true,ownerVerified:true,health:{vaccinationStatus:'complete',neutered:false,microchipVerified:true,geneticScreeningAvailable:false,pedigreeAvailable:false}};
const other={...base,id:'2',name:'B',sex:'female',purposes:['socialize','playmate'],energyLevel:5};
check('common purposes',()=>assert.deepEqual(matching.commonPurposes(base,other),['socialize']));
check('compatibility score',()=>assert.ok(matching.compatibilityScore(base,other)>=70));
check('match score weights sum to 100',()=>assert.equal(Object.values(matching.MATCH_SCORE_WEIGHTS).reduce((a,b)=>a+b,0),100));
check('match score perfect pair',()=>assert.equal(matching.compatibilityScore(base,{...base,id:'3',approximateDistanceKm:0.5}),100));
check('match score breakdown components',()=>assert.deepEqual(matching.matchScoreBreakdown(base,{...base,id:'3',approximateDistanceKm:0.5}).components,{proximity:30,energy:25,size:20,character:15,health:10}));
check('match score distance decay',()=>assert.ok(matching.compatibilityScore(base,{...base,id:'3',approximateDistanceKm:20})<matching.compatibilityScore(base,{...base,id:'3',approximateDistanceKm:2})));
check('giant-mini dogs excluded',()=>{const r=matching.matchScoreBreakdown({...base,size:'giant'},{...base,id:'3',size:'mini'});assert.equal(r.sizeExcluded,true);assert.equal(r.score,0);});
check('giant-mini cats not excluded',()=>assert.equal(matching.isSizeSafetyExcluded({...base,species:'cat',size:'giant'},{...base,id:'3',species:'cat',size:'mini'}),false));
check('mating baseline eligible',()=>assert.equal(matching.matingSafetySignals(base,other).eligibleForDiscovery,true));
check('mating vaccine guard',()=>assert.equal(matching.matingSafetySignals(base,{...other,health:{...other.health,vaccinationStatus:'incomplete'}}).eligibleForDiscovery,false));
check('valid discovery pet',()=>assert.deepEqual(validation.validatePetForDiscovery(base),[]));
check('three photo rule',()=>assert.ok(validation.validatePetForDiscovery({...base,photos:base.photos.slice(0,2)}).length>0));
check('setup complete',()=>assert.equal(validation.isPetSetupComplete(base),true));
check('neighborhood required',()=>assert.equal(validation.isPetSetupComplete({...base,neighborhood:''}),false));
check('message normalization',()=>assert.equal(validation.normalizeMessageBody('  merhaba   pati  '),'merhaba pati'));
check('contact sharing warning',()=>assert.equal(safety.preflightUserText('WhatsApp numaramı vereyim').shouldWarn,true));
check('safe meetup text',()=>assert.equal(safety.preflightUserText('Yarın parkta görüşelim mi?').shouldWarn,false));
check('age before birthday uses local calendar date',()=>assert.equal(matching.ageYearsFromBirthDate('2020-09-23',new Date(2026,8,22,23,55)),5));
check('age on birthday increments exactly once',()=>assert.equal(matching.ageYearsFromBirthDate('2020-09-22',new Date(2026,8,22,0,5)),6));
check('invalid calendar date is rejected',()=>assert.equal(matching.ageYearsFromBirthDate('2024-02-30',new Date(2026,8,22)),undefined));
check('future birth date is rejected',()=>assert.equal(matching.ageYearsFromBirthDate('2027-01-01',new Date(2026,8,22)),undefined));

check('metric distance remains canonical',()=>assert.equal(locale.canonicalDistanceKm(12.5,'metric'),12.5));
check('imperial distance round-trips to canonical kilometers',()=>assert.ok(Math.abs(locale.canonicalDistanceKm(locale.displayDistanceValue(10,'imperial'),'imperial')-10)<1e-9));
check('imperial weight round-trips to canonical kilograms',()=>assert.ok(Math.abs(locale.canonicalWeightKg(locale.displayWeightValue(20,'imperial'),'imperial')-20)<1e-9));


check('localized decimal: comma and dot',()=>{assert.equal(validation.parseLocalizedDecimal('1,5'),1.5);assert.equal(validation.parseLocalizedDecimal('1.5'),1.5);});
check('localized decimal: in-progress typing keeps value',()=>{assert.equal(validation.parseLocalizedDecimal('2,'),2);assert.equal(validation.parseLocalizedDecimal('2.'),2);assert.equal(validation.parseLocalizedDecimal(',5'),0.5);});
check('localized decimal: empty and invalid',()=>{for(const v of ['','  ','abc','1.000,5','1,2,3','-1','1e3'])assert.equal(validation.parseLocalizedDecimal(v),null,v);});

rmSync(out,{recursive:true,force:true});
console.log(`domain-tests: ${checks.length}/${checks.length} passed`);
