# PS5 Çevirmen · Masaüstü

Windows x64 ve Apple Silicon macOS için ortak Electron projesi. Android V3.0.1’in renkleri, yazı tipleri, kartları, ayar varsayılanları ve oyun sözlüğü düzenleyicisi masaüstüne uyarlandı. Kaynak incelemesi ve entegrasyon planı [Aşama 1 teknik raporunda](docs/asama-1-teknik-rapor.md).

## Bu sürümde

- Türkçe durum ekranı ve masaüstü gezinmesi.
- Çeviri modu, motor tercihi, OCR aralığı, oyun sözlüğü ve TV adresi/portu için yerel ayarlar.
- İlk açılışta Samsung TV hazırlık adımları ve bilgisayarın yerel IPv4 adresleri. TV kurulumu atlanabilir ve Genel ayarlar’dan tekrar açılabilir.

PS5 keşfi/eşleştirme, Remote Play, OCR, çeviri motorları, çeviri arşivi, TV keşfi ve altyazı sunucusu ile Tizen imzalama/yükleme sonraki aşamalara ait. Bu sürüm hesap kimliği, PIN, API anahtarı veya sertifika parolası istemez.

## Yerelde derleme

Node.js 24 ve npm gerekir.

```sh
npm ci
npm run build
npx --no-install install-electron
npm start
```

Açılış, yerel IP köprüsü, ayar doğrulama ve yeniden başlatma testi için `npm run test:smoke` komutunu çalıştırın. Linux, geliştirme ve bu test için kullanılabilir.

## Windows ve macOS paketleri

- Windows 10/11 x64 üzerinde `npm run dist:win`, NSIS `.exe` dosyasını `release/` klasörüne yazar.
- Apple Silicon macOS üzerinde `npm run dist:mac`, `.app` ile onu içeren `.dmg` dosyasını `release/` klasörüne yazar.
- [GitHub Actions](https://github.com/enginkulakli/ps5ceviri-dekstop/actions) başarılı işlerin Artifacts bölümünde Windows ve macOS paketlerini ayrı sunar.

Bu derlemelerde Windows paketi imzasızdır. macOS paketi yerel ad hoc imza kullanır ve Apple noter onayı içermez. İndirilen paketlerde Windows SmartScreen veya macOS Gatekeeper uyarısı görülebilir. Genel dağıtım için yayıncı imzası ve macOS noter onayı ayrıca yapılandırılmalıdır.

Lisans [AGPL-3.0-only](LICENSE). Android kaynak referansı ve yazı tipi lisansları [licenses](licenses/) altında.
