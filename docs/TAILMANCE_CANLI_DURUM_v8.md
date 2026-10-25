# Tailmance — Canlı Durum v8 (2026-10-25)

v7 notunun üzerine: v5 şartname kaynağı (zip) ile repodaki 2026-10-05 hattı birleştirildi.

## Birleştirme

- İki hat 2026-10-03 tabanından ayrılmıştı: zip = v5 işi (migrasyon 201–204, 6 yeni ekran, uyum skoru, 186 anahtar × 19 dil); repo = Android/iOS yerel modüller, veteriner kavramsız sağlık belgesi kontrolü, 22 dilde hukuk metinleri, mağaza görselleri.
- Üç yönlü birleştirme yapıldı (taban: 25d930f). Elle çözülen çakışmalar: `PetProfileScreen` (repo'nun veterinersiz rozet satırı + v5 takip/gizlilik eylemleri), i18n allowlist, harici hukuk kanıtı sayıları.
- **Migrasyon numara çakışması:** repodaki `201_health_document_check_without_veterinarian_signals.sql` prod'daki v5 201'i ile aynı numarayı taşıyordu. `205_…` olarak yeniden numaralandı; prod'da 201–204 v5 olarak uygulı, 205 henüz uygulanmadı.
- **Anlamsal düzeltme:** v5 `matching.ts` sağlık bileşeni, kaldırılan `veterinarianVerified` alanını okuyordu (tsc hatası). Sağlık bileşeni artık yalnızca aşı durumuna dayanıyor (ikisi de tamamsa tam puan).
- Test altyapısı: `supabase_platform_stub.sql`'e pg_cron taklidi eklendi (202/203 `cron.schedule` çağırıyor; prod migrasyon dosyalarına dokunulmadı, MD5 korunur).

## Doğrulama

- `npm ci && npm run verify`: çıkış kodu 0.
- Gerçek PostgreSQL 16 (PostGIS + pgvector + plpgsql_check): **205/205 migrasyon sırayla uygulandı**, plpgsql_check 0 hata, sağlık belgesi smoke testi geçti.
- Edge sözdizimi/semantik (42 dosya), proje lint, katalog 19 dil × 1907 anahtar geçti.

## Sizde kalanlar

1. **Migrasyon 205'i prod'a uygulayın** (veteriner alanlarını kaldırır; prod'daki mevcut veri üzerinde geri alınabilir bir işlemde önce deneyin).
2. push-dispatch deploy, Edge secret'ları, `drop schema zz_tailmance_apply cascade;` (v7 bölüm 3).
3. 31 Ekim'den önce 27 pazarın yasal kaynak taraması.
4. `release:observability` ve `release:store-assets` kapıları sahip sırlarına/cihaz ekran görüntülerine bağlı (EXPO_PUBLIC_SENTRY_DSN, `store/screenshots/android`).
