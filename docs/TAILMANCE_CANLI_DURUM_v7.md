# Tailmance — Canlı Durum v7 (2026-10-25)

Bu not v6'nın yerine geçer. Prod projesi: `tailmance-prod` (`fskxcneajoujvnjxsbqi`, eu-central-1).

## 1. Bu turda prod'a uygulananlar

Her migrasyon önce geri alınan (rollback) bir işlemde uçtan uca test edildi, sonra uygulandı. `schema_migrations` kaydının MD5 değeri repodaki dosyayla birebir aynı.

| Migrasyon | İçerik | Test sonucu |
|---|---|---|
| **201** — kimlik, gizlilik, sosyal | Benzersiz `@kullanıcı adı`; gizli profil ve takip isteği (kabul, ret, takipçi çıkarma); sessize alma; tek seviye yorum yanıtı (idempotent); yorum beğenisi; varsayılan sessiz saat 22.00–08.00 | Takip isteği, gizlilik kapısı, akışta sessize alma, yanıt ve beğeni sayıları, takipçi çıkarınca görünürlüğün kapanması: hepsi beklenen sonucu verdi |
| **201 — güvenlik açığı kapatıldı** | Gizli profilin gönderisine takipçi olmayan kişi yorum, beğeni ya da kaydetme yapabiliyordu. Artık `create_comment`, `set_post_like`, `set_saved_post` ve `set_comment_like` aynı görünürlük kapısından geçiyor. Gizlilik kapısı olmayan eski `get_feed` (2 sürüm) ve `get_post_comments` fonksiyonları istemciye kapatıldı (uygulama bunları kullanmıyor) | Kabulden önce yorum, beğeni ve yorum beğenisi `not_found` döndü |
| **202** — gerçek dünya | **Pati Radar:** 7 günlük süre ve uzatma, 24 saat sonra sahibin onayıyla 10 km'ye genişleme, Gördüm/Buldum bildirimi (yaklaşık konum, geri çekme), alarm kapanınca teşekkür bildirimi. **Check-in:** 2 saat, 500 m geofence, koordinat saklanmaz. **Etkinlik:** bekleme listesi ve otomatik terfi, tür ve boyut kısıtı, iptal bildirimi, 24 saat ve 1 saat önce hatırlatma. **Cron:** `tailmance-real-world-housekeeping` (5 dakikada bir) | 27 kontrolün tamamı beklenen sonucu verdi |
| **202 — kritik hata düzeltildi** | `enforce_high_risk_device_integrity` tetikleyicisi `new.kind` alanını okuyordu. Bu alan olmayan her tabloda (Pati Radar alarmı, etkinlik, oyun randevusu, boost, seyahat modu) giriş yapmış kullanıcıların kaydı **42703 hatasıyla düşüyordu**. Düzeltildi | Test sırasında yakalandı; düzeltmeden sonra kayıtlar sorunsuz oluşuyor |

| **203** — bakım, destek, topluluk | **Kilo kaydı** + 31 günde ≥%10 değişimde "veterinerinize danışın" uyarısı (dozaj/ilaç önerisi yok); **alerji kartı**; **bakım hatırlatıcıları** (ilaç/vitamin/tüy/tırnak/diş/banyo; saat dilimine göre; cron `tailmance-care-reminders` 5 dk); **destek merkezi** (TM-YYYYMMDD-XXXXXX talep no, idempotent, mesajlaşma, durum takibi; personel yanıtı yalnız service role); **topluluklar** (bölge/ırk, kurallar, sahip/moderatör, onaylı üyelik, sahiplik devri, topluluk akışı ve etkinlik takvimi) | Rollback testi + uygulama sonrası ikinci rollback testi: 40+ kontrolün tamamı beklendiği gibi (yabancı kullanıcı başkasının kilo/talep verisine erişemedi, moderatör sahibi çıkaramadı, sahip devretmeden ayrılamadı, hatırlatma bir kez tetiklenip ileri alındı) |

Önceki 50 migrasyonun (150–200) prod'daki kaydı da repodaki dosyalarla tek tek karşılaştırıldı. Hepsi birebir aynı.

## 2. Repodaki diğer değişiklikler

- `src/domain/matching.ts`: Uyum skoru artık Ek A ağırlıklarını kullanıyor (yakınlık %30, enerji %25, boyut %20, karakter %15, sağlık %10).
  - Skor bileşenleriyle birlikte döndürülüyor (`matchScoreBreakdown`).
  - Dev ve mini ırk köpekler hiçbir zaman eşleşmiyor.
  - Domain testleri: **27/27 geçti**.
- `src/services/api.ts`: 201–202'deki tüm yeni RPC'ler için tipli istemci fonksiyonları eklendi. Yeni alanlar `src/types/domain.ts` dosyasına eklendi.
- 19 yeni bildirim metni **19 dilin tamamına** eklendi (bakım hatırlatması ve destek güncellemesi dahil):
  - takip isteği ve takip kabulü;
  - Gördüm/Buldum ve teşekkür;
  - etkinlik hatırlatma, iptal ve bekleme listesinden yer açılması.
  
  `pushCopy.generated.ts` yeniden üretildi; i18n kontrolü ve push metni kontrolü geçti.
- `NotificationsScreen`: yeni bildirim şablonlarını uygulama içinde doğru dilde gösteriyor.
- `push-dispatch` kaynağı:
  - Pati Radar bildirimleri **sessiz saatlere takılmıyor**;
  - yüksek öncelik ve iOS `time-sensitive` ile gönderiliyor;
  - yeni şablonların metinleri eklendi.
  
  Edge sözdizimi ve strict tip kontrolü: 42 dosya geçti.

## 3. Sizin yapmanız gerekenler

1. **push-dispatch deploy:** Kaynak güncel ama prod'daki sürüm hâlâ eski. Deploy edilene kadar:
   - Pati Radar bildirimleri sessiz saatte bekletilir;
   - yeni bildirimler İngilizce yedek metinle gider.
   
   ```
   supabase functions deploy push-dispatch --project-ref fskxcneajoujvnjxsbqi --no-verify-jwt
   ```
2. **Edge secret'ları:** Vault'taki değerleri Edge secrets'a kopyalayın (v6, bölüm A/B/C). Bu yapılmadan cron işleri 401 hatası alır.
3. **Geçici şema temizliği:** `drop schema zz_tailmance_apply cascade;` komutunu çalıştırın.

## 4. Henüz yapılmayanlar

Bunlar dürüstçe açık bırakıldı; "hazır" etiketi verilmedi.

| Alan | Durum | Not |
|---|---|---|
| Destek talebine ek dosya yükleme; personel destek paneli (Edge/admin) | ❌ | Veri modeli ve `staff_reply_support_ticket` hazır |
| Topluluk içeriği için ayrı moderasyon kuyruğu | 🟡 | Şu an metin filtreleri + mevcut şikâyet akışı |
| Yeni özelliklerin ekranları | ✅ | 201–203 özelliklerinin hepsi ekranlara bağlandı, metinleri 19 dilde (bkz. bölüm 5–6) |
| Etkinlik grup sohbeti; ihbara fotoğraf eki; anonim sesli röle | ❌ | |
| Sunucu tarafı keşif sıralamasının Ek A'ya hizalanması (pgvector) | 🟡 | İstemci skoru hazır |
| Uçtan uca şifreleme (E2EE) | ❌ | Bağımsız güvenlik denetimi gerekiyor; uygulamada "E2EE" ifadesi kullanılmamalı |
| Aşı kural tablosu, ırka özel içerik | ❌ | Veteriner onayı gerekiyor. Taslak üretilebilir ama onaylı diye işaretlenmez |
| Yasal metinler | ❌ | Avukat onayı gerekiyor. İç onaylar 2026-10-31'de sona eriyor |
| Gerçek cihaz testleri, EAS build, mağaza gönderimi | ❌ | |

Not: `npm ci && npm run verify` paketin temiz bir kopyasında çalıştırıldı ve hatasız geçti (bkz. bölüm 6).


## 5. Ek tur (2026-10-25, akşam)

- **`npm ci` ve tam tip kontrolü:** `tsc --noEmit` hatasız geçti (TypeScript 5.9). `npm test` zincirindeki 79 kontrol tek tek çalıştırıldı. Bulunan gerçek sorunlar giderildi:
  - **Veri dışa aktarımı:** Yeni kişisel tablolar "Verilerimi indir" çıktısına eklendi (takip istekleri, sessize alınanlar, yorum beğenileri, Gördüm/Buldum, check-in, bekleme listesi, kilo, alerji, bakım, topluluk üyelikleri, destek talepleri ve mesajları). `security-checks` 382/382 geçti.
  - **Migration 204** (prod'a uygulandı, MD5 doğrulandı): kullanıcı adı müsaitliği ve destek RPC'leri artık oturum iptali ve MFA sınırından geçiyor. `auth-session-boundary` 173/173 geçti.
  - **Yasal takvim, güncel kaynakla:** Brezilya'daki Portaria Conjunta nº 3/2026'nın genel hükümleri 2026-10-23'te yürürlüğe girdi; durum "current effective" olarak güncellendi. Brezilya'da ücretli tanıtım, şeffaflık kontrolleri doğrulanana kadar kapalı kalıyor. Çin'in Siber Uzay İdaresi (CAC) taslağı yeniden kontrol edildi: hâlâ görüşe açık taslak, bağlayıcı değil. Bir sonraki kontrol 2026-11-25.
  - Katalog sayısı ve manifest yeniden üretildi.
- **Ekranlar:** Gizlilik ve takipçiler, Bakım ve sağlık günlüğü, Yardım ve destek, Topluluklar ekranları eklendi. Yorum yanıtı ve beğenisi, Pati Radar araçları, park check-in, etkinlik bekleme listesi ve iptali, gönderiyi toplulukta paylaşma mevcut ekranlara bağlandı. Ayarlar'dan erişiliyor.
- **Ekran metinleri:** 186 anahtar 19 dilin tamamına eklendi (bkz. bölüm 6).
- **Yasal onay süresi:** Süre kaldırılmadı. Bu süre, yasaların değişip değişmediğinin periyodik olarak yeniden kontrol edilmesini zorunlu kılan güvenlik kilidi. Gerçek bir yeniden kontrol yapılmadan süreyi uzatmak, yapılmamış bir inceleme kaydı oluşturmak anlamına gelir. 31 Ekim'den önce 27 pazarın kaynak taraması yenilenip süre bir sonraki aya taşınmalı; bu ayrı bir araştırma işi.

## 6. Son tur (2026-10-25, gece)

- **19 dil tamam:** 186 yeni ekran anahtarı 19 dilin hepsinde var. Katalog her dilde 1858 anahtar. Yer tutucular eşleşiyor; Rusça, Arapça, Asya dilleri ve Tay dili kendi alfabesinde. İngilizceyle aynı kalan kelimeler (kg, Mini, Moderator, Bug gibi) dil-sabiti izin listesine açıkça eklendi.
- **Tema:** Bakım ekranı karanlık ve aydınlık temaya tepki veriyor (`test:ux` geçti).
- **`npm ci && npm run verify` artık sizde de çalışır:** Hijyen kontrolü, `npm ci` sonrası kökte oluşan ve `.gitignore`'da olan `node_modules/` klasörünü hata sayıyordu. Bu yüzden `verify` her kurulumda kırılıyordu. Düzeltildi: kökteki git-ignored `node_modules/` atlanıyor, alt klasörlerdeki `node_modules` hâlâ yasak.
- **Kanıt:** Zip'in temiz bir kopyası açıldı. `npm ci` ve `npm run verify` (tsc + tüm `npm test` zinciri) çıkış kodu 0 ile bitti. Tip kontrolü kanıtı kaynak hash'lerine bağlandı; RELEASE_EVIDENCE, güncel durum belgeleri ve SHA-256 manifesti yeniden üretildi.
- **Yasal onay süresi:** Değişmedi (gerekçe bölüm 5'te).

### Hâlâ sizde olanlar

Bölüm 3'teki üç adım duruyor:

1. push-dispatch deploy;
2. Edge secret'ları;
3. `drop schema zz_tailmance_apply cascade;`.

Ayrıca 31 Ekim'den önce 27 pazarın yasal kaynak taraması yapılmalı.

## 7. Yasal durum yeniden doğrulaması (2026-10-25)

Resmî kaynaklardan **yeniden doğrulananlar** (hepsi hâlâ yürürlükte değil): AB KIDS Act (Komisyon önerisi, 2026-09-17), Kanada Bill C-34 (ilk okuma), İngiltere 16 yaş altı kuralı (duyuru), Avusturya 14 yaş altı taslağı (görüş süresi 21 Eylül'de bitti, 2027-01-01 öngörülüyor), Hollanda (AB'ye öneri), Singapur (düzenleme 2027 başı). İzleme listesi notları işlendi.

**Doğrulanamayanlar:** Polonya Sejm sayfası bot doğrulamasında kaldı; bu kayıt eski haliyle duruyor. Fransa Décret 2026-883 ikincil kaynakla (Le Monde du Droit) doğrulandı: 24 Eylül yayım, 25 Eylül yürürlük. 31 Ekim onay süresi uzatılmadı; 27 pazarın tamamı gerçekten taranmadan uzatılmayacak.
