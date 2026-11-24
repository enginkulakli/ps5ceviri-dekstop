# PS5 Çevirmen · Masaüstü

Windows x64 ve Apple Silicon macOS 15+ için PS5 Remote Play görüntüsünü arka planda alan, İngilizce altyazıları okuyup Türkçeye çeviren ve mevcut Samsung Tizen istemcisine gönderen test sürümü.

- [Windows kurulum paketi ve otomatik testler](https://github.com/enginkulakli/ps5ceviri-dekstop/actions/workflows/windows.yml)
- [Apple Silicon DMG ve otomatik testler](https://github.com/enginkulakli/ps5ceviri-dekstop/actions/workflows/macos.yml)
- [macOS kurulum, izinler ve doğrulama kapsamı](docs/macos-arm64-durum.md)
- [Gerçek PS5 ve Samsung Tizen 4.0 ile test adımları](docs/windows-donanim-testi.md)
- [Windows V3 işlevleri, test kapsamı ve eksikler](docs/windows-v3-durum.md)
- [Android V3 referansı ve mimari rapor](docs/asama-1-teknik-rapor.md)

Windows paketi imzasızdır. macOS paketi yerel ad hoc imzalıdır ve Apple noter onayı içermez. SmartScreen veya Gatekeeper uyarıları görülebilir.

## Derleme

Windows x64 kurulum derlemesi Node.js 24, npm, MSYS2 MinGW64 ve Temurin JDK 21 kullanır. GitHub Actions bağımlılıkları ve Windows çalıştırma zamanlarını hazırlar, ardından `npm run dist:win` komutuyla `release/` dizinine NSIS paketini üretir. Bağımlılık sürümleri, Chiaki kaynak commit’i ve FFmpeg SHA256 değeri derleme betiklerinde kayıtlıdır. [Windows iş akışı](.github/workflows/windows.yml)

Apple Silicon macOS derlemesi aynı Chiaki taşıma katmanını ve Kotlin/JVM çekirdeğini kullanır. ARM64 Chiaki ve FFmpeg ile Temurin JDK 21 çalışma zamanı hazırlandıktan sonra `npm run dist:mac` DMG’yi üretir. Homebrew bağımlılıkları yalnızca derleme aşamasında kullanılır. [macOS iş akışı](.github/workflows/macos.yml)

Masaüstü arayüzünü geliştirmek için `npm ci`, `npm run build`, `npx --no-install install-electron` ve `npm start` komutlarını kullanın. PS5 yerel ağ testleri `npm run test:unit` ile çalışır. `npm run test:runtime`, `scripts/build-v3-runtime.sh` ile oluşturulan JVM çıktısını ve FFmpeg’i kullanır.

[Lisans](LICENSE) · [Kaynak ve bağımlılık bildirimleri](licenses/NOTICE.txt)
