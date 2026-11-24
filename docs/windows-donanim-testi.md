# Windows x64 donanım testi

## Hazırlık

1. GitHub Actions’ın son başarılı **Build Windows x64** çalıştırmasındaki `ps5ceviri-windows-x64` artefaktını indirin. ZIP’i açıp içindeki `.exe` ile PS5 Çevirmen’i kurun. Windows paketi imzasızdır ve SmartScreen uyarısı çıkabilir. [Derlemeler](https://github.com/enginkulakli/ps5ceviri-dekstop/actions/workflows/windows.yml)
2. Windows bilgisayarı, PS5’i ve Samsung TV’yi aynı yerel ağa bağlayın. PS5’i TV’ye HDMI ile bağlayın ve oyunda İngilizce altyazıları açın. Windows güvenlik duvarı PS5 Çevirmen veya beraberindeki Java TV sunucusu için ağ izni isterse yalnızca kullandığınız özel ağı seçin.
3. **Çeviri ayarları** bölümünde motor seçin. Google Cloud için Basic v2 Translation API etkin olmalı ve anahtar Windows’tan kullanıma izin vermeli. Android paketine kısıtlanmış anahtar Windows’ta reddedilebilir. OpenAI için kendi API anahtarınızı girin. Cihaz içi seçenekte **Yerel EN→TR modelini hazırla** düğmesi ilk seferde yaklaşık 610 MB indirir. **Çeviri testi** ile bir İngilizce cümleyi deneyin.

## Samsung TV

1. TV’de V3 ile uyumlu **PS5 Altyazı TV** uygulamasını açın. Uygulama kurulacaksa Tizen 4.0 hedefli TV V2 kaynak commit’ini Tizen Studio’da açın. Uygulamalar bölümünde kumandadan `12345` girin, Developer Mode’u açın, bilgisayarın IPv4 adresini yazın ve TV’yi yeniden başlatın. Bazı modellerde `12345` Uygulamalar içindeki Ayarlar bölümünde girilir. Samsung Certificate Manager’da TV’nin DUID’sini içeren Samsung TV sertifika profili seçip `.wgt` paketini imzalayın ve Device Manager üzerinden yükleyin. [Sabit TV kaynağı](https://github.com/enginkulakli/-eviri/tree/70325025082dfedad4dfb392e007acd42b7e655e/Ps5AltyaziTV) · [Samsung cihaz kılavuzu](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) · [Samsung sertifika kılavuzu](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
2. Windows’ta **Samsung TV → TV sunucusunu başlat** seçeneğini açın. Port varsayılan olarak `8787`. TV uygulamasındaki tablet IP alanına **Windows bilgisayarın** IPv4 adresini yazın. Portu girin, bağlantıyı başlatın ve doğru HDMI girişini seçin. Windows’taki TV IP alanı isteğe bağlı bir bağlantı filtresidir.
3. Windows’ta **1 TV bağlı** görünce **Test altyazısı gönder** düğmesine basın. TV’de Türkçe test metnini gördükten sonra **Metni TV’de gördüm** seçeneğini kullanın. Bağlantı gelmezse IP adreslerini, portu, Windows güvenlik duvarını ve yönlendiricinin cihazlar arası erişimini kontrol edin.

## PS5 ve canlı altyazı

1. PS5’te **Ayarlar → Sistem → Remote Play** bölümünde Remote Play’i etkinleştirin ve **Cihazı Eşle** ekranını açın.
2. Windows’ta **PS5 bağlantıları → Ağda PS5 ara** seçeneğini kullanın veya konsolun IPv4 adresini girin. Android V3’te kullandığınız aynı 8 baytlık Base64 PSN Account ID değerini ve PS5 ekranındaki 8 haneli eşleştirme PIN’ini girin. PSN Account ID kullanıcı adı veya çevrimiçi kimlik değildir.
3. Kaydedilen konsolu seçin ve **Remote Play’i başlat** düğmesine basın. PS5 ayrıca bir kullanıcı giriş PIN’i isterse, **PS5 bağlantıları** ekranındaki dört haneli giriş PIN’i alanını kullanın.
4. **Durum** ekranında H.264 akışını, algılanan İngilizceyi ve Türkçe sonucu izleyin. Başlangıç testi için **Altyazı** modunu ve varsayılan alt %28 OCR alanını kullanın. TV’ye giden metni ve oyun altyazısı değiştiğinde eski satırın temizlendiğini kontrol edin.
5. IP değişimini denemek için oturumu durdurun, PS5’in yeni adresini almasını sağlayın ve tekrar bağlanın. Oturum başlamadan önce MAC kimliğinin keşifteki adresi aranır. Gerekirse **Bu oturum için manuel PS5 IP adresi** alanını kullanın. TV bağlantısını kapatıp açarak yeniden bağlantıyı da sınayın.

PS5’in aynı kullanıcıyla yerel DualSense ve Remote Play oturumunu aynı anda sürdürüp sürdürmediğini ayrıca kontrol edin. Gerekirse kayıtlı ikinci bir PSN hesabıyla deneyin. Test sonucunda Windows sürümü, TV modeli/firmware’i, PS5 sistem sürümü, motor, görünen hata ve son OCR süresini kaydedin. API anahtarı, PSN Account ID ve PIN test kayıtlarına eklenmemelidir.
