import type { AppNotification, Match, Pet, PetEvent, Post, Story } from '../types/domain';

const approved = (id: string, url: string, sortOrder: 1 | 2 | 3) => ({ id, url, sortOrder, moderationStatus: 'approved' as const });

export const demoActivePet: Pet = {
  id: 'demo-loki', name: 'Loki', species: 'dog', breed: 'Golden Retriever', sex: 'male', birthDate: '2023-04-12', ageYears: 3,
  size: 'large', weightKg: 31, energyLevel: 4, temperamentTags: ['Sosyal', 'Oyuncu', 'Çocuk dostu'], city: 'İstanbul', district: 'Kadıköy', neighborhood: 'Caddebostan',
  purposes: ['socialize', 'playmate', 'walk'], bio: 'Deniz kenarı yürüyüşlerini ve top oyununu seviyor.', profileVerified: true,
  photos: [
    approved('l1','https://images.unsplash.com/photo-1552053831-71594a27632d?w=1000',1),
    approved('l2','https://images.unsplash.com/photo-1558788353-f76d92427f16?w=1000',2),
    approved('l3','https://images.unsplash.com/photo-1518717758536-85ae29035b6d?w=1000',3)
  ],
  health: { vaccinationStatus: 'complete', veterinarianVerified: true, neutered: false, microchipVerified: true, geneticScreeningAvailable: true, pedigreeAvailable: false }
};

export const demoPets: Pet[] = [
  {
    id:'demo-luna', name:'Luna', species:'dog', breed:'Golden Retriever', sex:'female', birthDate:'2023-08-20', ageYears:3, size:'large', weightKg:28,
    energyLevel:4, temperamentTags:['Sosyal','Nazik','Oyuncu'], city:'İstanbul', district:'Kadıköy', neighborhood:'Fenerbahçe', approximateDistanceKm:2,
    purposes:['socialize','playmate','walk'], bio:'Yeni park arkadaşları arıyor.', profileVerified:true, compatibilityScore:94, followersCount:284,
    photos:[approved('lu1','https://images.unsplash.com/photo-1558788353-f76d92427f16?w=1000',1),approved('lu2','https://images.unsplash.com/photo-1518717758536-85ae29035b6d?w=1000',2),approved('lu3','https://images.unsplash.com/photo-1552053831-71594a27632d?w=1000',3)],
    health:{vaccinationStatus:'complete',veterinarianVerified:true,neutered:false,microchipVerified:true,geneticScreeningAvailable:true,pedigreeAvailable:true}
  },
  {
    id:'demo-miso', name:'Miso', species:'cat', breed:'British Shorthair', sex:'female', birthDate:'2024-02-10', ageYears:2, size:'small', weightKg:4.7,
    energyLevel:2, temperamentTags:['Sakin','Meraklı'], city:'İstanbul', district:'Beşiktaş', neighborhood:'Etiler', approximateDistanceKm:9,
    purposes:['socialize'], bio:'Sakin ev buluşmaları için uyumlu kedi arkadaşları.', profileVerified:true, compatibilityScore:58, followersCount:133,
    photos:[approved('mi1','https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=1000',1),approved('mi2','https://images.unsplash.com/photo-1495360010541-f48722b34f7d?w=1000',2),approved('mi3','https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=1000',3)],
    health:{vaccinationStatus:'complete',veterinarianVerified:true,neutered:true,microchipVerified:true,geneticScreeningAvailable:false,pedigreeAvailable:false}
  },
  {
    id:'demo-atlas', name:'Atlas', species:'dog', breed:'Border Collie', sex:'male', birthDate:'2022-11-01', ageYears:3, size:'medium', weightKg:20,
    energyLevel:5, temperamentTags:['Enerjik','Zeki','Atletik'], city:'İstanbul', district:'Şişli', neighborhood:'Teşvikiye', approximateDistanceKm:10,
    purposes:['playmate','walk'], bio:'Uzun yürüyüş ve koşu arkadaşı arıyor.', profileVerified:false, compatibilityScore:79, followersCount:410,
    photos:[approved('a1','https://images.unsplash.com/photo-1551717743-49959800b1f6?w=1000',1),approved('a2','https://images.unsplash.com/photo-1507146426996-ef05306b995a?w=1000',2),approved('a3','https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?w=1000',3)],
    health:{vaccinationStatus:'complete',veterinarianVerified:false,neutered:false,microchipVerified:false,geneticScreeningAvailable:false,pedigreeAvailable:false}
  }
];

export const demoMatches: Match[] = [{ id:'match-1', conversationId:'conversation-1', otherPet:demoPets[0]!, matchedAt:new Date().toISOString(), commonPurposes:['socialize','playmate','walk'], unreadCount:1, lastMessage:'Yarın parkta görüşelim mi?', lastMessageAt:new Date().toISOString() }];

export const demoPosts: Post[] = demoPets.map((pet, i) => ({
  id:`post-${i}`, pet, caption:i===0?'Bugün sahilde biraz koştuk 🐾':'Yeni bir gün, yeni kokular.',
  mediaUrls:[pet.photos[1]?.url ?? pet.photos[0]!.url], createdAt:new Date(Date.now()-i*3600000).toISOString(), likeCount:42+i*17, commentCount:5+i, likedByMe:i===0, savedByMe:false
}));

export const demoStories: Story[] = demoPets.map((p,i)=>({id:`story-${i}`,petId:p.id,petName:p.name,avatarUrl:p.photos[0]?.url,mediaUrl:p.photos[2]?.url ?? p.photos[0]!.url,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+20*3600000).toISOString(),seen:i===2}));

export const demoEvents: PetEvent[] = [
  { id:'event-1', creatorPetId:'demo-luna', title:'Caddebostan Pati Yürüyüşü', description:'Sakin tempolu toplu sahil yürüyüşü.', city:'İstanbul', district:'Kadıköy', startsAt:new Date(Date.now()+3*86400000).toISOString(), attendeeCount:18, myStatus:'interested' },
  { id:'event-2', creatorPetId:'demo-atlas', title:'Enerjik Köpekler Park Buluşması', description:'Orta ve yüksek enerjili köpekler için kontrollü oyun.', city:'İstanbul', district:'Şişli', startsAt:new Date(Date.now()+6*86400000).toISOString(), attendeeCount:11 }
];

export const demoNotifications: AppNotification[] = [
  { id:'n1', type:'match', title:'Yeni eşleşme 🐾', body:'Loki ve Luna eşleşti.', createdAt:new Date().toISOString() },
  { id:'n2', type:'health', title:'Aşı hatırlatıcısı', body:'Kuduz aşısının bir sonraki dozu 14 gün sonra.', createdAt:new Date(Date.now()-3600000).toISOString() }
];
