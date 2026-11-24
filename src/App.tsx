import { useState, type CSSProperties } from "react";

import appIcon from "./assets/images/icon.png";
import { GameGlossaryEditor } from "./components/GameGlossaryEditor";
import { Ionicons } from "./components/Ionicons";
import { Button, Card, Chip, Field, Notice, StatusBadge, Stepper, type IconName } from "./components/ui";
import { SetupWizard } from "./SetupWizard";
import { useSettings } from "./settings";
import { dark } from "./theme";

const pages = {
  status: { label: "Durum", icon: "speedometer-outline" },
  consoles: { label: "PS5 bağlantıları", icon: "game-controller-outline" },
  translation: { label: "Çeviri ayarları", icon: "language-outline" },
  tv: { label: "Samsung TV", icon: "tv-outline" },
  archive: { label: "Çeviri geçmişi", icon: "time-outline" },
  settings: { label: "Genel ayarlar", icon: "settings-outline" },
  setup: { label: "Kurulum sihirbazı", icon: "construct-outline" },
} satisfies Record<string, { label: string; icon: IconName }>;

type Page = keyof typeof pages;

const cssColors = Object.fromEntries(Object.entries(dark).map(([name, color]) => [`--${name}`, color])) as CSSProperties;

const pipelineCards: { title: string; icon: IconName }[] = [
  { title: "PS5 bağlantısı", icon: "game-controller-outline" },
  { title: "Remote Play oturumu", icon: "radio-outline" },
  { title: "Görüntü akışı", icon: "videocam-outline" },
  { title: "OCR", icon: "scan-outline" },
  { title: "Çeviri motoru", icon: "language-outline" },
  { title: "TV bağlantısı", icon: "tv-outline" },
];

function Status({ openSetup }: { openSetup: () => void }) {
  const { settings } = useSettings();
  return (
    <>
      <Card>
        <div className="actions">
          <Button label="Çeviriyi Başlat" icon="play-outline" disabled onPress={() => {}} />
          <Button label="Kurulum sihirbazı" variant="secondary" onPress={openSetup} />
        </div>
        <p className="hint">Canlı çeviri için masaüstü Remote Play ve OCR entegrasyonu gerekiyor.</p>
      </Card>
      <section aria-labelledby="connection-heading">
        <h2 id="connection-heading">Bağlantı durumu</h2>
        <div className="status-grid">
          {pipelineCards.map(({ title, icon }) => (
            <Card key={title}>
              <div className="card-heading">
                <span className="tile-icon"><Ionicons name={icon} size={20} color={dark.brandPrimary} /></span>
                <h3>{title}</h3>
              </div>
              <StatusBadge kind="native" />
            </Card>
          ))}
        </div>
      </section>
      <section aria-labelledby="subtitle-heading">
        <h2 id="subtitle-heading">Son altyazı</h2>
        <Card>
          <dl className="subtitle">
            <div><dt>Son algılanan İngilizce</dt><dd>—</dd></div>
            <div><dt>TV’ye son gönderilen Türkçe</dt><dd>—</dd></div>
          </dl>
          <p className="hint">{settings.mode === "fullscreen" ? "Tam ekran çeviri" : "Altyazı çevirisi"} · İngilizce → Türkçe</p>
        </Card>
      </section>
    </>
  );
}

function Translation() {
  const { settings, update } = useSettings();
  return (
    <>
      <Notice kind="info" text="Bu tercihler bilgisayarda saklanır. OCR ve çeviri motorları entegrasyon bekliyor." />
      <Card>
        <h3>Görüntü modu</h3>
        <div className="actions">
          <Chip label="Altyazı" selected={settings.mode === "subtitle"} onPress={() => update({ mode: "subtitle" })} />
          <Chip label="Tam ekran" selected={settings.mode === "fullscreen"} onPress={() => update({ mode: "fullscreen" })} />
        </div>
        <h3>Çeviri motoru · İngilizce → Türkçe</h3>
        <div className="actions">
          <Chip label="Cihaz içi" selected={settings.engine === "offline"} onPress={() => update({ engine: "offline" })} />
          <Chip label="Google Cloud" selected={settings.engine === "google_cloud"} onPress={() => update({ engine: "google_cloud" })} />
        </div>
        <Stepper
          label="OCR tarama aralığı"
          display={`${settings.ocrIntervalMs} ms`}
          onDec={() => update({ ocrIntervalMs: Math.max(150, settings.ocrIntervalMs - 50) })}
          onInc={() => update({ ocrIntervalMs: Math.min(2000, settings.ocrIntervalMs + 50) })}
          testID="ocr-interval"
        />
      </Card>
      <section aria-labelledby="glossary-heading">
        <h2 id="glossary-heading">Oyun sözlüğü</h2>
        <GameGlossaryEditor entries={settings.glossary} onSave={(glossary) => update({ glossary })} />
      </section>
    </>
  );
}

function SamsungTv({ openSetup }: { openSetup: () => void }) {
  const { settings, update } = useSettings();
  const [ip, setIp] = useState(settings.tvIp);
  const [port, setPort] = useState(String(settings.tvPort));
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    const address = ip.trim();
    const parts = address.split(".");
    if (address && (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) ||
      Number(parts[0]) === 0 || Number(parts[0]) === 127 || Number(parts[0]) >= 224)) {
      setFeedback({ ok: false, text: "TV’nin IPv4 adresini girin. Örnek 192.168.1.42." });
      return;
    }
    const number = Number(port);
    if (!/^\d{1,5}$/.test(port) || number < 1 || number > 65535) {
      setFeedback({ ok: false, text: "Port numarası 1 ile 65535 arasında olmalıdır." });
      return;
    }
    if (update({ tvIp: address, tvPort: number })) setFeedback({ ok: true, text: "TV adresi ve port tercihi kaydedildi." });
  }

  return (
    <>
      <Notice kind="info" text="TV keşfi, bağlantı testi ve altyazı gönderimi entegrasyon bekliyor." />
      <Card>
        <h3>Bağlantı tercihleri</h3>
        <div className="form-grid">
          <Field label="Samsung TV IP adresi" placeholder="192.168.1.42" value={ip} onChangeText={(value) => { setIp(value); setFeedback(null); }} />
          <Field label="Altyazı sunucusu portu" inputMode="numeric" value={port} onChangeText={(value) => { setPort(value); setFeedback(null); }} />
        </div>
        {feedback && <Notice kind={feedback.ok ? "success" : "error"} text={feedback.text} />}
        <div className="actions">
          <Button label="Tercihleri kaydet" onPress={save} />
          <Button label="Kurulum sihirbazı" variant="secondary" onPress={openSetup} />
        </div>
      </Card>
    </>
  );
}

export function App() {
  const { settings, error } = useSettings();
  const [page, setPage] = useState<Page>(settings.tvSetupDeferred ? "status" : "setup");
  const openSetup = () => setPage("setup");

  return (
    <div className="shell" style={cssColors}>
      <aside className="sidebar">
        <div className="brand">
          <img src={appIcon} alt="" />
          <span>PS5 Çevirmen</span>
        </div>
        <nav aria-label="Uygulama bölümleri">
          {(Object.entries(pages) as [Page, (typeof pages)[Page]][]).map(([id, item]) => (
            <button key={id} type="button" className="nav-button" aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}>
              <Ionicons name={item.icon} size={19} color={page === id ? dark.brandPrimary : dark.muted} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main" key={page}>
        <header>
          <h1>{pages[page].label}</h1>
        </header>
        {error && <div role="alert"><Notice kind="error" text={error} /></div>}
        {page === "status" && <Status openSetup={openSetup} />}
        {page === "translation" && <Translation />}
        {page === "tv" && <SamsungTv openSetup={openSetup} />}
        {page === "setup" && <SetupWizard finishLater={() => setPage("status")} openTv={() => setPage("tv")} />}
        {page === "consoles" && <Card><StatusBadge kind="native" /><p>Yerel ağ keşfi, manuel IP bağlantısı ve eşleştirme Remote Play adaptörüyle eklenecek.</p></Card>}
        {page === "archive" && <Card><StatusBadge kind="native" /><p>Çeviri kayıtları ve Android V3 arşiv aktarımı SQLite adaptörüyle kullanılabilecek.</p></Card>}
        {page === "settings" && (
          <Card>
            <h3>Samsung TV kurulumu</h3>
            <p className="hint">{settings.tvSetupDeferred ? "TV kurulumu daha sonra yapılmak üzere ertelendi." : "TV kurulumu bekliyor."}</p>
            <div className="actions"><Button label="Kurulum sihirbazını aç" variant="secondary" onPress={openSetup} /></div>
          </Card>
        )}
      </main>
    </div>
  );
}
