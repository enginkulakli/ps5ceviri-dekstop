# Windows V3 test sürümü

| Bölüm | Uygulama ve doğrulama |
| --- | --- |
| PS5 | Android V3’teki sabit Chiaki C kaydı ve 720p/30 H.264 oturumu başsız Windows yardımcı programına uyarlandı. UDP keşfi, MAC ile tek kayıt, adres güncelleme, manuel IP ve kullanıcı giriş PIN’i desteği var. Anahtarlar Windows DPAPI destekli Electron güvenli deposuyla korunuyor. Oturum protokolü ayrı bir PS5 üzerinde henüz denenmedi. |
| OCR | Paketli FFmpeg, H.264’ü bellekte gri karelere çeviriyor. Tesseract İngilizce OCR kalıcı bir iş parçacığında çalışıyor. V3 altyazı bölgesi, maskeler, HUD filtresi, satır konumu, 180/300 ms tarama zamanlaması, doğrulama, altyazı yaşam döngüsü ve tam ekran takip/boyutlandırma kuralları Kotlin/JVM çekirdeğinden kullanılıyor. OCR modeli değiştiği için Android ML Kit ile güven ve kalite eşitliği doğrulanmadı. |
| Çeviri | Basic v2 Google Cloud gövde ve yanıt kodu Kotlin’den alındı. OpenAI, Android V3’teki etkin olmayan AI seçeneğinin masaüstü sağlayıcısıdır. Uzak istekler için güvenli anahtar kaydı, karakter sayaçları, hata yönetimi ve iptal bulunuyor. Google/OpenAI ağ testleri oturum sahibinin gerçek anahtarıyla yapılmalı. |
| Cihaz içi | Android ML Kit bileşeni masaüstü JVM’de çalışmaz. Windows, ilk indirmeden sonra CPU üzerinde ONNX M2M100 EN→TR modelini kullanıyor. Bu modelin çeviri cümleleri Android’deki karşılığıyla farklı olabilir. |
| Arşiv | V3 sözlük kuralları Kotlin’den, SQLite şeması ve motor/oyun/sürüm seçim kuralları Android’den taşındı. Bellek önbelleği, disk arşivi, birleştirilen istekler ve eski sonucun görünmesini önleme uygulanıyor. Android v1 JSON arşiv biçimini içe/dışa aktarma, oyun bazında göz atma, düzenleme ve silme var. |
| TV | Android V3 WebSocket sunucusu yeniden kullanılıyor. Mevcut metin, TTL, yenileme, temizleme ve V3 konumlu altyazı mesajları korunuyor. Windows TV istemcisinin bağlanmasını, IP’yi, yeniden bağlantıyı ve gönderilen test metnini gösterebiliyor. Gerçek Tizen 4.0 TV’de HDMI, kumanda, sertifika ve kurulum doğrulaması bekliyor. |
| Arayüz | Durum, PS5, çeviri, Samsung TV, geçmiş, ayarlar ve kurulum ekranları bağlandı. Windows paketi Android cihaz veya emülatör kullanmaz. |

Kapsam dışında kalan önceki Android işlevleri arasında MediaProjection ekran yakalama, Android arka plan bildirimi, sistem üstü yerel altyazı katmanı ve ML Kit’in çok dilli model yöneticisi var. Windows OCR alanı ayarı yüzde girdilerini kullanıyor. Otomatik Samsung TV keşfi ve Tizen sertifika/imzalama/yükleme sihirbazı henüz uygulanmadı. Kurulu olmayan TV için Tizen Studio adımları donanım testi kılavuzunda bulunuyor. Bu sürümde macOS için Windows çalışma zamanı taşınmadı.

## Otomatik doğrulama

- `npm run test:unit` gerçek yerel UDP alışverişini, MAC birleştirme ve IP yenilemeyi, oturum durumlarını, kullanıcı PIN kanalını ve test anahtarının korumalı dosya arayüzünü kapsar.
- `npm run test:windows` sentetik H.264 örneğini gerçek FFmpeg ile çözer, Tesseract ile okur ve aynı Kotlin altyazı izleyicisine verir. Tizen WebSocket yaşam döngüsü, Google Basic v2 ve OpenAI temsili bağlantıları, V3 arşiv biçimi, sözlük, önbellek ve eski sonuç engeli de kapsanır.
- `npm run test:smoke` paketli Windows uygulamasını açar, başsız bileşenleri ve DPAPI anahtar saklama arayüzünü çalıştırır, paketli FFmpeg/Tesseract’ı sentetik kayıtta dener ve kullanıcı ayarlarının yeniden açılışta korunduğunu kontrol eder.

[Windows iş akışı ve sonuçları](https://github.com/enginkulakli/ps5ceviri-dekstop/actions/workflows/windows.yml) · [Donanım testi adımları](windows-donanim-testi.md)
