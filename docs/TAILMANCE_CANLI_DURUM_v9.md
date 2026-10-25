# Tailmance — Canlı Durum v9 (2026-10-25, gece)

v8'in devamı. Kod hattı birleşik; bu turda veteriner kavramı tamamen çıkarıldı ve yapay zekâ belge kontrolü genişletildi.

## Bu turda yapılanlar

- **Veteriner yok:** 19 uygulama dili, 22 yasal dil, 594 ülke eki, Türkçe statik sayfalar, mağaza metinleri ve push metinlerinde veteriner ifadesi kalmadı. "Veteriner" mekân kategorisi uygulamadan ve veritabanı kısıtından çıkarıldı (migrasyon 206). Depo genelinde koruma testi eklendi: `npm run test:no-vet`.
- **Mikroçip kontrolü:** Yapay zekâ belge kontrolü sayfalarda mikroçip numarası görürse ISO 11784 yapısını (15 hane), sayfalar arası tutarlılığı ve sahibin girdiği numarayla eşleşmeyi denetler; sonuç `microchip_verified` sinyali olur (migrasyon 206). Test: 34 senaryo.
- **Irk, cinsiyet, yaş, boyut:** Kural motoru bu bilgileri alır; kılavuzlarda (WSAVA 2024, ESCCAP, ISO 11784) ırk, cinsiyet veya boyuta göre farklı aşı takvimi bulunamadığı için kural değiştirmezler. Kaynaklı bir kural eklendiğinde `healthBookletCheck.ts` içine kaynağıyla birlikte girer. Yaş ve tür kuralları aktif.
- **Eksik etiketler:** Mekân kategori filtresi etiketleri (`places.category.*`) hiçbir dilde yoktu; 19 dile eklendi. Katalog 19 × 1915 anahtar.
- **Yasal metin özeti:** Sağlık belgesi kontrolü açıklamasına mikroçip cümlesi 22 dilde eklendi. Migrasyon 207 (594 ülke eki özet senkronu) üretildi; migrasyon 140 prod'a uygulanan haline geri alındı.
- **Doğrulama:** `npm ci && npm run verify` çıkış kodu 0; gerçek PostgreSQL'de 001–207 uygulandı, plpgsql_check 0 hata.

## Prod durumu (tailmance-prod)

- Prod'da 0 pet ve 0 sağlık kaydı var; 205 ve 206 veri kaybettirmez.
- **205, 206, 207 henüz uygulanmadı:** Supabase aracı her uygulamada kullanıcı onayı istiyor; onay süresinde yanıt gelmedi. Onay verildiğinde sırayla 205 → 206 → 207 uygulanır.
- Eski `health-verification-webhook` fonksiyonu prod'da duruyor; araçla silinemiyor, 410 yanıtlı bir sürümle değiştirilecek.
- Edge secret değerleri araç üzerinden yalnızca panelde elle girilebiliyor (15 vault adı v8'de listeli).

## Engeller (dış izin gerektirenler)

- **Ağ:** Ortam, resmî yasal kaynak sitelerine (225 ana makine) ve WSAVA/ESCCAP sitelerine çıkışı engelliyor. 27 pazarın kaynak taraması ve 31 Ekim süresinin uzatılması bu yüzden yapılamadı; süre uzatılmadı.
- **Sentry:** Org `yektaozel`, proje `tailmance` mevcut; DSN alındı. `SENTRY_AUTH_TOKEN` (sembol yükleme) yalnızca sahibinde.
- **Mağaza ekran görüntüleri:** Gerçek cihaz/emülatör çıktısı olmadan üretilmedi.
