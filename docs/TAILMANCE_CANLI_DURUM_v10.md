# Tailmance — Canlı Durum v10 (2026-10-25, gece)

v9'un devamı. Ağ erişimi açıldıktan sonra yasal kaynak taraması ve kılavuz doğrulaması yapıldı.

## Yasal kaynak taraması (27 pazar)

- 606 resmî kaynak bağlantısı tarandı: **473 erişilebilir**, 133 erişilemedi (57 WAF/403, 22 bağlantı reddi, 19 TLS zinciri, 17 zaman aşımı, 11 ölü bağlantı, 7 hizmet dışı). Sonuçlar `release/official-source-recheck-2026-10-25.json` içinde, erişilenler için metin SHA-256 tabanı (sonraki taramalar bununla karşılaştırır).
- **Ölü bağlantılar:** 11 üründen 9'u (OAIC çocuk kodu, NParks pet dükkânı, u.ae iki sayfa, ABD 18 USC 2258A, ETDA, DLD iki PDF) doğrulanmış güncel resmî adreslerle değiştirildi. İki MEWA (Suudi) PDF'i arama motorlarında görünse de taramaya 404 verdi; işaretlenip bırakıldı.
- **Erişilemeyen kaynaklar:** 594 konu hücresinin 98'inde taramada erişilebilir kaynak yok (Légifrance, Ofcom, AB Dijital Strateji, Endonezya ve BAE mevzuat portalları, Sejm vb. botlara 403 veriyor). Bu hücreler 2026-10-01 taramasından **taşındı** ve defterde tek tek listelendi; yeniden doğrulandı denmedi.
- **İzleme listesi (31 Ekim'de dolacaklar):** AB KIDS Act (COM(2026) 681, 17 Eylül), Kanada C-34 (ilk okuma 10 Haziran), İngiltere 16 yaş altı (duyuru 15 Haziran, bahar 2027), Avusturya 14 yaş altı (değerlendirme 27 Temmuz), İspanya, Hollanda, Polonya, Singapur, Fransa kararı 2026-883: hepsi **yürürlükte değil / taslak veya öneri**; sonraki kontrol 2026-11-25. Polonya ve Fransa için birincil site engelli olduğundan aşama ikincil kaynaktan; defterde belirtildi.
- Tarama penceresi 2026-10-25 → **2026-11-24**. Migrasyon 207 bu pencereyle üretildi.

## Sağlık kuralları (birincil kaynaktan doğrulandı)

- WSAVA 2024 özeti ve ESCCAP GL1 PDF'leri indirilip okundu: çekirdek aşılar, ilk seri 2–4 haftada bir ve son doz ≥16 hafta, 26. haftada veya sonra tekrar; yetişkinde yılda en az 4 parazit uygulaması, yavruda kısa aralıklı ve 6 aya kadar aylık. **Irk, cinsiyet veya vücut boyutuna göre farklı takvim yok**; gebelik/emzirme girişleri isteğe bağlı ek uygulamalar. Motor bu bilgileri girdi olarak alır, kural değiştirmez.

## Hâlâ sizde

1. 205, 206, 207'yi prod'a uygulamak (Supabase onay istemi 60 saniyede yanıtlanmalı) veya SQL Editor'den çalıştırmak.
2. Edge secret değerlerini panelde girmek; `SENTRY_AUTH_TOKEN`; Android ekran görüntüleri.
