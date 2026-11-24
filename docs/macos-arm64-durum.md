# Apple Silicon macOS

Uygulama macOS 15 ve üzeri Apple Silicon Mac’ler için derlenir. Windows x64 sürümüyle aynı Electron arayüzü, C/Chiaki taşıma kodu, Kotlin/JVM V3 çekirdeği, OCR, çeviri motorları, SQLite arşivi ve TV protokolünü kullanır. DMG içindeki uygulama ARM64 Chiaki, Temurin 21 JVM ve H.264 için derlenen FFmpeg bileşenlerini içerir. Uygulamayı çalıştırmak için Homebrew, ayrı Java/FFmpeg kurulumu veya Rosetta gerekmez.

## Kurulum ve izinler

1. GitHub Actions’ta **Build macOS Apple Silicon** çalıştırmasının `ps5ceviri-macos-arm64` artefaktını indirin. ZIP’i açın, DMG’yi bağlayın ve PS5 Çevirmen’i Uygulamalar klasörüne sürükleyin. Paket yerel ad hoc imzalıdır ve Apple noter onayı bulunmaz. Bu nedenle indirilmiş uygulamayı açarken Gatekeeper uyarısı görülebilir. [macOS derlemeleri](https://github.com/enginkulakli/ps5ceviri-dekstop/actions/workflows/macos.yml)
2. İlk PS5 keşfi veya TV bağlantısında macOS yerel ağ erişimi isterse izin verin. İzni **Sistem Ayarları → Gizlilik ve Güvenlik → Yerel Ağ** altında kontrol edebilirsiniz. Mac güvenlik duvarı altyazı sunucusu için gelen bağlantı izni isterse kullandığınız yerel ağdaki bağlantıya izin verin. [Apple yerel ağ ayarları](https://support.apple.com/guide/mac-help/control-access-to-your-local-network-on-mac-mchla4f49138/mac)
3. PS5 ve TV adımları ortak donanım kılavuzundakiyle aynıdır. TV istemcisindeki adres alanına Mac’in yerel IPv4 adresini yazın. Yerel OPUS-MT modeli ilk hazırlamada yaklaşık 510 MB indirir. PS5 eşleştirme anahtarları, Google Cloud ve OpenAI anahtarları macOS Keychain destekli güvenli depolamayla şifrelenir. [Donanım testi kılavuzu](windows-donanim-testi.md)

## Doğrulama kapsamı

| Alan | Otomatik doğrulama |
| --- | --- |
| Apple Silicon paket | CI, DMG sağlama toplamını ve imzayı doğrular. Uygulamanın, Chiaki’nin, JVM’in ve FFmpeg’in ARM64 mimarisini, uygulama kimliğini, yerel ağ izin metnini ve yardımcı uygulama adlarını kontrol eder. Açılış testi DMG’ye bağlanan uygulamadan çalışır. |
| PS5 | Gerçek UDP alışverişi yerel bir test istemcisiyle sınanır. MAC kimliğiyle kayıt, IP yenileme, PIN ve oturum denetimi test düzeneğinde doğrulanır. Paketli Chiaki yardımcı programı kendini sınar. |
| OCR ve çeviri | Sentetik H.264 video gerçek FFmpeg ve Tesseract’tan geçer. V3 takip, sözlük, arşiv, önbellek ve geç gelen sonuçlar kontrol edilir. Paketli uygulama yerel OPUS-MT modelini çalıştırır. Google Cloud ve OpenAI için temsili servis yanıtları kullanılır. |
| Samsung TV | Yerel WebSocket istemcisi test altyazısını, TTL yenilemesini, bağlantı yenilemesini ve V3 konumlu altyazı mesajını kontrol eder. |
| Ortak arayüz | Keychain destekli anahtar şifreleme, TV bağlantı ayarları, kurulum adımları ve oyun sözlüğünün yeniden açılışta korunması paketli uygulamada kontrol edilir. Windows adımı aynı testi DPAPI ile çalıştırır. |

Gerçek PS5’e bağlanarak oyun akışı alma, fiziksel Tizen 4.0 TV’ye bağlanma, kişisel Mac’te yerel ağ/Gatekeeper izin akışı ve gerçek Google Cloud/OpenAI anahtarıyla servis erişimi donanım testinde doğrulanacak. Otomatik TV keşfi ve Tizen imzalama/yükleme Windows v0.2.0 kapsamı dışında kaldı. TV’ye ilk kurulum gerektiğinde Tizen Studio kullanılır.
