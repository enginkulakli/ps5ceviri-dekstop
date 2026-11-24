import { useCallback, useEffect, useState } from "react";

import { Ionicons } from "./components/Ionicons";
import { Button, Card, Notice } from "./components/ui";
import { useSettings } from "./settings";
import { dark } from "./theme";

export function SetupWizard({ finishLater, openTv }: { finishLater: () => void; openTv: () => void }) {
  const { update } = useSettings();
  const [step, setStep] = useState(0);
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [ip, setIp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const refreshAddresses = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      if (!window.ps5Desktop) throw new Error("Yerel IP adresini okumak için masaüstü uygulamasını açın.");
      const found = await window.ps5Desktop.getLanAddresses();
      setAddresses(found);
      setIp((previous) => found.includes(previous) ? previous : found.length === 1 ? found[0] : "");
    } catch {
      setError(window.ps5Desktop
        ? "Bilgisayarın yerel IP adresi okunamadı. Wi-Fi veya Ethernet bağlantısını kontrol edin."
        : "Yerel IP adresini okumak için masaüstü uygulamasını açın.");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (step === 1) void refreshAddresses();
  }, [step, refreshAddresses]);

  function deferSetup() {
    if (update({ tvSetupDeferred: true })) finishLater();
  }

  return (
    <section aria-labelledby="wizard-heading" className="wizard">
      {step === 0 && (
        <Card>
          <span className="tile-icon"><Ionicons name="tv-outline" size={22} color={dark.brandPrimary} /></span>
          <h2 id="wizard-heading">Hoş geldiniz</h2>
          <p>PS5 oyunlarındaki İngilizce altyazıları Türkçeye çevirmek ve Samsung TV’nizde göstermek için TV’yi aynı yerel ağdaki bilgisayara bağlayın.</p>
          <div className="actions">
            <Button label="TV’yi hazırlamaya başla" onPress={() => setStep(1)} />
            <Button label="TV kurulumunu atla" variant="secondary" onPress={deferSetup} />
          </div>
        </Card>
      )}
      {step === 1 && (
        <Card>
          <h2 id="wizard-heading">Samsung TV’yi hazırlayın</h2>
          <div className="prepare-grid">
            <ol>
              <li>Smart Hub’ı açın ve <strong>Uygulamalar</strong> bölümünü seçin.</li>
              <li>Kumandadan veya ekrandaki sayı tuşlarından <kbd>12345</kbd> tuşlayın. Pencere açılmazsa Uygulamalar içindeki <strong>Ayarlar</strong> bölümünde tekrar deneyin.</li>
              <li><strong>Developer Mode</strong> seçeneğini açın.</li>
              <li>Bilgisayarın TV ile aynı ağdaki yerel IP adresini <strong>Host PC IP</strong> alanına girin ve onaylayın.</li>
              <li>TV’yi yeniden başlatın. Uygulamalar ekranındaki geliştirici modu göstergesini kontrol edin.</li>
            </ol>
            <div className="connection-diagram">
              <div className="tv-diagram" aria-hidden="true">
                <div className="diagram-title">Developer Mode <strong>ON</strong></div>
                <div className="diagram-ip"><span>Host PC IP</span><code>{ip || "—"}</code></div>
                <div className="diagram-ok">OK</div>
              </div>
              <label className="ip-picker">
                Bilgisayarın yerel IP adresi
                <select value={ip} onChange={(event) => setIp(event.target.value)} disabled={!addresses?.length}>
                  <option value="">{addresses?.length ? "TV ile aynı ağdaki adresi seçin" : scanning ? "Adresler okunuyor…" : "Adres bulunamadı"}</option>
                  {addresses?.map((address) => <option key={address} value={address}>{address}</option>)}
                </select>
              </label>
              <Button label="IP adreslerini yenile" variant="secondary" loading={scanning} onPress={() => void refreshAddresses()} />
            </div>
          </div>
          {error && <div role="alert"><Notice kind="error" text={error} /></div>}
          {addresses?.length === 0 && <Notice kind="warning" text="Wi-Fi veya Ethernet bağlantısını açın. IP adresini bilgisayarınızın ağ ayarlarında da bulabilirsiniz." />}
          <div className="actions">
            <Button label="Devam et" onPress={() => setStep(2)} />
            <Button label="Geri" variant="secondary" onPress={() => setStep(0)} />
            <Button label="TV kurulumunu atla" variant="ghost" onPress={deferSetup} />
          </div>
        </Card>
      )}
      {step === 2 && (
        <Card>
          <h2 id="wizard-heading">TV bağlantısı ve uygulama kurulumu</h2>
          <p>TV’de mevcut PS5 Altyazı TV uygulamasını açın. Üzerinde oyunun HDMI girişi açıkken bilgisayarın IP adresini ve sunucu portunu girin.</p>
          <Notice kind="info" text="Uygulama TV’de kurulu değilse donanım testi kılavuzundaki Samsung sertifikası ve Tizen Studio adımlarını kullanın." />
          <p>Samsung TV bölümünden altyazı sunucusunu açın, bir TV’nin bağlandığını kontrol edin ve test altyazısını gönderin.</p>
          <div className="actions">
            <Button label="TV adresi tercihlerine git" onPress={openTv} />
            <Button label="Geri" variant="secondary" onPress={() => setStep(1)} />
            <Button label="TV kurulumunu atla" variant="ghost" onPress={deferSetup} />
          </div>
        </Card>
      )}
    </section>
  );
}
