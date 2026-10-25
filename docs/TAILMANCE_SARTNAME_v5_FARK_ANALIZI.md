# Tailmance — Şartname v5.0 ↔ Mevcut Uygulama Fark Analizi

> **Güncelleme 2026-10-25:** Migrasyon 201, 202 ve 203 prod'a uygulandı (rollback testleri geçti, MD5 doğrulandı). Değişen satırlar aşağıda işaretlendi.

**Kıyaslanan:**
- Şartname: `Tailmance_Master_Urun_Deneyim_Sartnamesi_v5.0.docx` (40 bölüm, Ek A–J, 39 tablo)
- Kod: React Native/Expo uygulaması (35 ekran)
- Prod veritabanı: 200 migrasyon, 116 tablo
- Edge function'lar: 30 adet

**Yöntem:** Her madde için prod şeması ve kaynak kod taraması yapıldı.

**Durum etiketleri:**
- ✅ Var
- 🟡 Kısmen var
- ❌ Yok
- ⚖️ Bilinçli olarak farklı (kodda gerekçelendirilmiş bir karar var)

> Şartnamenin kendi kuralı (Ek J.1) şöyle: uygulanmamış hedef "hazır" etiketi alamaz, ama sessizce de kapsamdan çıkarılamaz. Bu belge o eşleştirmenin ilk sürümüdür.

## 1. Ek A parametreleri

| Parametre | Şartname | Prod / kod | Durum |
|---|---|---|---|
| Günlük sağa kaydırma (Standard) | 50 | `app_runtime_config.standard_daily_swipe_limit = 50` | ✅ |
| Günlük yeni sohbet (Standard) | 3 | `standard_daily_new_conversation_limit = 3` | ✅ |
| Kota sıfırlama | Yerel 00.00, sunucu saati | `daily_product_quotas` içinde `time_zone` + `reset_at` | ✅ |
| Pati Radar yarıçapı | 5 km, 24 saat sonra 10 km | Varsayılan 5; `expand_lost_pet_alert` 24 saat sonra sahibin onayıyla 10 km'ye genişletir ve yalnızca yeni kalan kullanıcılara bildirim gider (m202) | ✅ |
| Pati Radar süresi | 7 gün, uzatılabilir | `expires_at` = 7 gün; `extend_lost_pet_alert` +7 gün (en çok 35 gün); 5 dakikalık cron süresi dolanı `expired` yapar (m202) | ✅ |
| Uyum skoru ağırlıkları | Yakınlık %30, enerji %25, boyut %20, karakter %15, sağlık %10 | `matchScoreBreakdown` Ek A ağırlıklarıyla ve bileşen dökümüyle; dev–mini köpek eşleşmesi 0 puan + `sizeExcluded` (domain testleri 27/27) | ✅ istemci · 🟡 sunucu sıralaması (pgvector) ayrıca hizalanmalı |
| Süper Pati | Haftada 1 / 5 | `pet_likes.kind` ve tüketilebilir kredi altyapısı var. Haftalık hak sayısı doğrulanmadı | 🟡 |
| Boost | Ayda 1, 30 dk | `pet_boosts` var. Aylık Premium hakkı doğrulanmadı | 🟡 |
| Pet sayısı | En fazla 5 | Sınır izi var, sunucu kısıtı doğrulanmalı | 🟡 |
| Hikâye | 24 saat | `stories.expires_at` | ✅ |
| Reels | En fazla 60 sn | Moderasyonda 1–60 sn kontrolü | ✅ |
| Park check-in | 2 saat | `place_checkins`, 500 m geofence, koordinat saklanmaz, 2 saatte otomatik biter (m202) | ✅ |
| Aşı hatırlatma | 7, 3 ve 1 gün kala | Hatırlatıcı var, 7/3/1 kademesi doğrulanmadı | 🟡 |
| Etkinlik hatırlatma | 24 saat ve 1 saat önce | `run_real_world_housekeeping` cron'u (5 dk) 24 s / 1 s hatırlatmalarını tekil anahtarla üretir (m202) | ✅ |
| Sessiz saatler | Varsayılan 22.00–08.00 | Varsayılan 22.00–08.00 (m201). Pati Radar sessiz saati deler: kaynak güncellendi, push-dispatch yeniden deploy bekliyor | 🟡 deploy |
| Önbellek | 7 gün, 500 MB | CacheManager yok | ❌ |
| İstek imzası | 5 dakika | App Attest / Play Integrity challenge (5 dk) var, HMAC istek imzası yok | 🟡 |

## 2. Özellik bazında fark

| Alan (bölüm) | Durum | Not |
|---|---|---|
| Giriş: Apple, Google, e-posta OTP, 18+ (2.1, 28.1) | ✅ | Ek olarak MFA var |
| Onboarding 5 adım (2.2, 28.2) | 🟡 | Benzersiz @kullanıcı adı **eklendi** (m201: `set_pet_handle`, `pet_handle_available`). Onboarding ekranına bağlanması gerekiyor |
| Cihazda insan yüzü tespiti (ML Kit) | 🟡 | Edge-AI modülü yalnızca CoreML ile görüntü sınıflandırması yapıyor. ML Kit yüz tespiti yok. Sunucu moderasyonu "pet-first" kontrolünü yapıyor |
| `filterHumanTraces` / `sanitizeQuantumText` | 🟡 | Bu isimlerde fonksiyon yok. `domain/contentSafety.ts` ve sunucu tarafında satış/sahiplendirme/insan-flört filtreleri var |
| Gizli profil + takip isteği (2.3) | ✅ sunucu | m201: `is_private`, `follow_requests`, kabul/ret, takipçi çıkarma; akış, reels, yorum, beğeni, kaydetme ve önbellek gizlilik kapısından geçer. Eski `get_feed`/`get_post_comments` istemciye kapatıldı |
| Üçlü akış ve Reels (3.1–3.2) | ✅ | `social-read-cache`, `get_feed_page`, `get_reels_page` |
| Videoda ses maskeleme (3.2) | 🟡 | Sunucu tarafında ses dökümü ve sanitize video var. Cihazda maskeleme yok |
| Yorum yanıtı ve yorum beğenisi (3.3) | ✅ sunucu | m201: tek seviye yanıt (idempotent), `comment_likes`, sayfada `likeCount`/`likedByMe` |
| Koleksiyonlar (29.3) | 🟡 | Yalnızca `saved_posts` var, koleksiyon kavramı yok |
| Universal Links paylaşımı | 🟡 | `deepLinks.ts` var, `tailmance.com/pet/...` doğrulaması gerekli |
| Keşfet, Pas Geç, Rewind (3.5) | ✅ | `undo_last_pass` |
| Eşleşme animasyonu (Lottie) | 🟡 | Haptik var, Lottie yok |
| Mesajlaşma ve kota (3.6) | ✅ | Kota ve `isUnlocked` mantığı |
| **Uçtan uca şifreleme (12, 18)** | ⚖️ ❌ | `messages.body` düz metin, sunucuda moderasyon yapılıyor. Şartname 18 izin veriyor: E2EE yoksa kullanıcıya E2EE denmemeli ve koruma düzeyi açıkça anlatılmalı. **Metinlerin buna göre kontrol edilmesi zorunlu** |
| Sesli pati mesajı | ❌ | Yok |
| Oyun randevusu (31.2) | ✅/🟡 | `meetup_requests` var. Takvime ekleme ve "yeniden planla" durumları doğrulanmalı |
| Çevrim dışı kuyruk | ✅ | `offlineMutationQueue`, `client_mutation_receipts` |
| Konum gizliliği, ızgara ve kovalama (4.1) | ✅ | Migrasyon 200 |
| Harita ve mekânlar (4.2) | 🟡 | `pet_friendly_places` var. Kullanıcı mekân önerisi akışı yok |
| Parka giriş / check-in (4.2, 17) | ✅ sunucu | m202 |
| Etkinlik ve RSVP (4.3) | 🟡 | m202: bekleme listesi + otomatik terfi, tür/boyut kısıtı, iptal bildirimi, hatırlatma. **Kalan:** etkinlik grup sohbeti; aşı şartı (veteriner kural tablosu gerekir) |
| Topluluklar / kulüpler (4.4) | ✅ sunucu | m203: bölge/ırk kulübü, kurallar, sahip/moderatör, onaylı üyelik, akış, etkinlik takvimi |
| Pati Radar alarmı (4.5) | ✅ sunucu | m202: Gördüm/Buldum (yaklaşık konum, geri çekme, idempotent), teşekkür bildirimi, pet başına tek aktif alarm (mevcut index), açıklama/tasma/mikroçip var-yok. **Kalan:** ihbara fotoğraf eki, anonim sesli röle |
| Aşı takvimi (5.1) | ✅/🟡 | `pet_vaccinations` ve hatırlatıcı var. Tür bazlı aşı listesi (T7) doğrulanmalı |
| **Sağlık Onaylı rozeti, kural tablosu (5.2, 19)** | 🟡 | AI ve attestation altyapısı var. **Sürümlü, ülke ve tür bazlı, veteriner onaylı aşı kural tablosu** (`rule_version`) yok. Veteriner içeriği dışarıdan gelmeli |
| Kilo grafiği, alerji kartı, bakım hatırlatıcıları (5.3, 33.3) | ✅ sunucu | m203; ekranlar bekliyor |
| Şifreli mikroçip ve pasaport kasası, biyometrik (5.4) | ❌ | SecureStore var ama kasa akışı yok |
| Irka özel sağlık önerileri (5.5) | ❌ | Onaylı içerik kütüphanesi gerekiyor (veteriner kaynağı) |
| Dört zorunlu ekran durumu (6.2) | 🟡 | `EmptyState`, `RetryNotice`, `ShimmerSkeleton` var. Her ekranda kapsam denetlenmeli |
| Bildirim önceliği ve gruplama (6.3) | 🟡 | Tercihler, sessiz saat ve pazarlama onayı var. Pati Radar'ın sessiz saati delmesi ve beğeni gruplama doğrulanmalı |
| Premium ve paywall (8, 35) | ✅ | RevenueCat, webhook, ön-sözleşme sunumu |
| Hayalet mod ve Pati Pasaportu | ✅ | `users.incognito`, `user_travel_mode` |
| Verilerimi İndir ve Hesabımı Sil (10.3) | ✅ | Edge function'lar artık prod'da |
| 19 dil, RTL, CJK (9) | ✅ | i18n ve push metinleri 19 dilde |
| ErrorBoundary ve Sentry (11.3) | ✅ | |
| FlashList, XState, CacheManager, SafeStorage (11.3) | ❌ | Yok. Performans ve kararlılık hedefleri için gerekli |
| Sertifika sabitleme (12) | ⚖️ | `SECURITY_TRANSPORT_DECISION.md`: yönetilen 3. taraf uç noktalar için bilinçli olarak yok. Şartnamede "yedek pin ile" koşulu var; karar belgelenmiş |
| Evrensel arama (34.1) | 🟡 | Ayrı bir arama ekranı yok |
| Destek merkezi ve talep numarası (36.4) | ✅ sunucu | m203: talep no, mesajlar, durum; ek dosya ve personel paneli bekliyor |
| Sessize alma (29.1, 36.2) | ✅ sunucu | m201: `set_pet_mute`, akış/reels filtresi. "İlgilenmiyorum" ayrı sinyal olarak hâlâ yok |

## 3. Uygulama planı (şartnamenin kendi önceliği, T27)

1. **P0 — Güvenli çekirdek**
   - Mesajlaşma metinlerinde E2EE iddiası taranıp düzeltilmeli.
   - Gizli profil ve takip isteği eklenmeli.
   - Sessize alma eklenmeli.
   - Benzersiz kullanıcı adı eklenmeli.
2. **P1 — Sosyal çekirdek**
   - Yorum yanıtı ve yorum beğenisi.
   - Uyum skoru Ek A ağırlıklarına geçmeli; dev–mini ırk dışlaması eklenmeli.
   - Etkinlik bekleme listesi, hatırlatma ve grup sohbeti.
   - Park check-in (2 saat).
   - Topluluklar.
   - Lottie kutlaması.
   - FlashList.
3. **P2 — Kritik hizmet**
   - Pati Radar: Gördüm/Buldum, tek aktif alarm, 24 saat sonra 10 km, teşekkür bildirimi.
   - Sürümlü aşı kural tablosu ve rozet kararı.
   - Kilo, alerji ve bakım takibi.
   - Mikroçip kasası.
4. **P3 — Ücretli değer**
   - Süper Pati ve Boost haklarının Ek A ile doğrulanması.
5. **P4 — Ölçek**
   - Evrensel arama.
   - Destek merkezi.
   - Irk önerileri kütüphanesi.
   - Ses maskeleme ve ML Kit yüz tespiti için native modüller.

**Dış bağımlılıklar (kodla çözülemez):**
- Veteriner onaylı aşı kural tabloları ve ırk içerikleri
- Avukat onaylı yasal metinler
- E2EE bağımsız güvenlik denetimi
- Gerçek cihaz testleri ve mağaza hesapları

## 4. Çalışma kuralı

Her madde şu sırayla ilerler:
1. Migrasyon `201+` olarak repoya yazılır.
2. Rollback testi yapılır.
3. Prod'a uygulanır.
4. Uygulama kodu ve testleri eklenir.
5. EAS build alınır.

Prod veritabanına test edilmemiş şema değişikliği uygulanmaz.
