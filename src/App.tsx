import { useEffect, useState, type CSSProperties } from "react";

import appIcon from "./assets/images/icon.png";
import { Ionicons } from "./components/Ionicons";
import { Button, Card, Notice, StatusBadge, type IconName } from "./components/ui";
import { Ps5Connections, errorText, stageLabel, usePs5Status } from "./Ps5Connections";
import { SamsungTv, TranslationArchive, TranslationSettings, useDesktopStatus } from "./DesktopSections";
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

function Status({ openSetup, ps5, live, tv, refresh }: {
  openSetup: () => void; ps5: Ps5Status | null; live: LiveStatus | null; tv: TvStatus | null; refresh: () => Promise<void>;
}) {
  const { settings } = useSettings();
  const bridge = window.ps5Desktop?.ps5;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const console = ps5?.consoles.find((item) => item.id === settings.selectedConsoleId) ?? ps5?.consoles[0];
  const active = ps5 && !["idle", "error"].includes(ps5.stage);
  const work = ps5?.stage === "video";
  const cards: { title: string; icon: IconName; value: string; ready: boolean }[] = [
    { title: "PS5 bağlantısı", icon: "game-controller-outline", value: ps5?.ip ?? (console ? "Kayıtlı" : "Konsol eşleştirin"), ready: !!work },
    { title: "Remote Play oturumu", icon: "radio-outline", value: stageLabel[ps5?.stage ?? "idle"], ready: !!work },
    { title: "Görüntü akışı", icon: "videocam-outline", value: work ? "Başsız H.264" : "Bekliyor", ready: !!work },
    { title: "OCR", icon: "scan-outline", value: live?.ocr ?? "Bekliyor", ready: !!live?.ocrMs },
    { title: "Çeviri motoru", icon: "language-outline", value: live?.translation ?? "Bekliyor", ready: !!live?.turkish },
    { title: "TV bağlantısı", icon: "tv-outline", value: tv?.clients.length ? `${tv.clients.length} TV bağlı` : tv?.running ? "TV bekleniyor" : "Sunucu kapalı", ready: !!tv?.clients.length },
  ];

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (active) await bridge!.stop();
      else if (console) await bridge!.start(console.id, "", settings);
      await refresh();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Card>
        <div className="actions">
          <Button label={active ? "Çeviriyi Durdur" : "Çeviriyi Başlat"} icon={active ? "stop-outline" : "play-outline"}
            disabled={!ps5?.available || !live?.available || !console || ps5.stage === "discovering" || ps5.stage === "stopping"}
            loading={busy} onPress={() => void toggle()} />
          <Button label="Kurulum sihirbazı" variant="secondary" onPress={openSetup} />
        </div>
        {!console && <p className="hint">PS5 bağlantıları bölümünden bir konsol eşleştirin.</p>}
        {ps5?.stage === "pin" && <Notice kind="info" text="Kullanıcı giriş PIN’ini PS5 bağlantıları bölümünden gönderin." />}
        {(error || ps5?.error) && <Notice kind="error" text={error || ps5!.error!} />}
      </Card>
      <section aria-labelledby="connection-heading">
        <h2 id="connection-heading">Bağlantı durumu</h2>
        <div className="status-grid">
          {cards.map(({ title, icon, value, ready }) => (
            <Card key={title}>
              <div className="card-heading">
                <span className="tile-icon"><Ionicons name={icon} size={20} color={dark.brandPrimary} /></span>
                <h3>{title}</h3>
              </div>
              <StatusBadge kind={ready ? "ready" : "idle"} label={value} />
            </Card>
          ))}
        </div>
      </section>
      <section aria-labelledby="subtitle-heading">
        <h2 id="subtitle-heading">Son altyazı</h2>
        <Card>
          <dl className="subtitle">
            <div><dt>Algılanan İngilizce</dt><dd>{live?.english || "—"}</dd></div>
            <div><dt>Türkçe çeviri</dt><dd>{live?.turkish || "—"}</dd></div>
          </dl>
          <p className="hint">{settings.mode === "fullscreen" ? "Tam ekran çeviri" : "Altyazı çevirisi"} · İngilizce → Türkçe
            {live?.ocrMs ? ` · Son OCR ${live.ocrMs} ms` : ""}</p>
        </Card>
      </section>
    </>
  );
}

export function App() {
  const { settings, error } = useSettings();
  const ps5 = usePs5Status();
  const desktop = useDesktopStatus();
  useEffect(() => {
    void window.ps5Desktop?.live.configure(settings).catch(() => {});
  }, [settings]);
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
        {ps5.error && <Notice kind="error" text={ps5.error} />}
        {desktop.error && <Notice kind="error" text={desktop.error} />}
        {page === "status" && <Status openSetup={openSetup} ps5={ps5.state} live={desktop.live} tv={desktop.tv} refresh={ps5.refresh} />}
        {page === "translation" && <TranslationSettings live={desktop.live} />}
        {page === "tv" && <SamsungTv status={desktop.tv} refresh={desktop.refresh} openSetup={openSetup} />}
        {page === "setup" && <SetupWizard finishLater={() => setPage("status")} openTv={() => setPage("tv")} />}
        {page === "consoles" && <Ps5Connections state={ps5.state} refresh={ps5.refresh} />}
        {page === "archive" && <TranslationArchive />}
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
