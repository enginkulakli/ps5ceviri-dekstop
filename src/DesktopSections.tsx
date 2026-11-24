import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Field, Notice, StatusBadge, Stepper } from "./components/ui";
import { GameGlossaryEditor } from "./components/GameGlossaryEditor";
import { errorText } from "./Ps5Connections";
import { useSettings, type OcrRegion, type Settings } from "./settings";

export function useDesktopStatus() {
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [tv, setTv] = useState<TvStatus | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const bridge = window.ps5Desktop;
    if (!bridge) return;
    const [current, network] = await Promise.allSettled([bridge.live.status(), bridge.tv.status()]);
    if (current.status === "fulfilled") setLive(current.value);
    if (network.status === "fulfilled") { setTv(network.value); setError(""); }
    else setError(errorText(network.reason));
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 850);
    return () => clearInterval(timer);
  }, [refresh]);
  return { live, tv, error, refresh };
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return { busy, error, message, setMessage, run };
}

function ActionStatus({ error, message }: { error: string; message: string }) {
  if (error) return <div role="alert"><Notice kind="error" text={error} /></div>;
  if (message) return <div role="status"><Notice kind="success" text={message} /></div>;
  return null;
}

function OcrAreaEditor() {
  const { settings, update } = useSettings();
  const area = settings.ocrRegion;
  const [draft, setDraft] = useState([area.x, area.y, area.w, area.h].map((n) => String(Math.round(n * 100))).join(", "));
  const [masks, setMasks] = useState(settings.exclusions.map((e) =>
    [e.x, e.y, e.w, e.h].map((n) => Math.round(n * 100)).join(", ")).join("\n"));
  const action = useAction();
  function parse(raw: string): OcrRegion {
    const parts = raw.split(",").map((part) => part.trim());
    const [x, y, w, h] = parts.map((part) => Number(part) / 100);
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)) || w < .05 || h < .05 || x + w > 1.00001 || y + h > 1.00001) {
      throw new Error("Her dikdörtgen için 0–100 arası sol, üst, genişlik ve yükseklik değerleri girin.");
    }
    return { x, y, w, h };
  }
  return (
    <Card>
      <h3>OCR alanı ve maskeler</h3>
      <Field label="Altyazı bölgesi · sol, üst, genişlik, yükseklik" value={draft} onChangeText={setDraft}
        hint="Yüzde olarak. Varsayılan 0, 72, 100, 28." />
      <Field label="Maskeler · satır başına bir alan" multiline value={masks} onChangeText={setMasks}
        hint="En fazla 8 alan. Tam ekran modunda yalnızca tam kare taranır." />
      <div className="actions">
        <Button label="OCR alanlarını kaydet" onPress={() => void action.run(async () => {
          const lines = masks.split("\n").map((line) => line.trim()).filter(Boolean);
          if (lines.length > 8) throw new Error("En fazla sekiz maske ekleyin.");
          if (update({ ocrRegion: parse(draft), exclusions: lines.map(parse) })) action.setMessage("OCR alanları kaydedildi.");
        })} />
      </div>
      <ActionStatus {...action} />
    </Card>
  );
}

export function TranslationSettings({ live }: { live: LiveStatus | null }) {
  const { settings, update } = useSettings();
  const bridge = window.ps5Desktop?.live;
  const action = useAction();
  const [draft, setDraft] = useState("");
  const [keys, setKeys] = useState<Record<RemoteEngine, boolean>>({ google_cloud: false, ai: false });
  const [usage, setUsage] = useState<{ daily: { chars: number }; monthly: { chars: number } }>();
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const engine = settings.engine;
  useEffect(() => {
    setDraft("");
    setUsage(undefined);
    if (!bridge || engine === "offline") return;
    void bridge.keys().then(setKeys).catch(() => {});
    void bridge.usage(engine).then(setUsage).catch(() => {});
  }, [bridge, engine]);

  const step = (
    field: "ocrIntervalMs" | "confirmations" | "minimumVisibleMs" | "clearDelayMs" | "sensitivity",
    label: string, amount: number, min: number, max: number, suffix: string,
  ) => (
    <Stepper label={label} display={field === "sensitivity" ? Math.round(settings[field] * 100) + "%" : settings[field] + suffix}
      onDec={() => update({ [field]: Math.max(min, Math.round((settings[field] - amount) * 100) / 100) })}
      onInc={() => update({ [field]: Math.min(max, Math.round((settings[field] + amount) * 100) / 100) })}
      testID={field} />
  );

  return (
    <>
      {live?.available === false && <Notice kind="warning" text="Bu pakette Windows OCR ve V3 çalışma zamanı bulunamadı." />}
      <Card>
        <h3>Görüntü modu</h3>
        <div className="actions">
          <Chip label="Altyazı" selected={settings.mode === "subtitle"} onPress={() => update({ mode: "subtitle" })} />
          <Chip label="Tam ekran" selected={settings.mode === "fullscreen"} onPress={() => update({ mode: "fullscreen" })} />
        </div>
        <h3>Çeviri motoru · İngilizce → Türkçe</h3>
        <div className="actions">
          <Chip label="Cihaz içi" selected={engine === "offline"} onPress={() => update({ engine: "offline" })} />
          <Chip label="Google Cloud" selected={engine === "google_cloud"} onPress={() => update({ engine: "google_cloud" })} />
          <Chip label="OpenAI" selected={engine === "ai"} onPress={() => update({ engine: "ai" })} />
        </div>
        {engine === "offline" ? (
          <div className="actions">
            <Button label="Yerel EN→TR modelini hazırla" variant="secondary" disabled={!live?.available || live.model === "loading"} loading={live?.model === "loading"}
              onPress={() => void action.run(async () => { await bridge!.offline(); action.setMessage("Yerel çeviri modeli hazır."); })} />
            <span className="hint">{live?.model === "ready" ? "Model hazır" : "İlk hazırlamada model internetten indirilir."}</span>
          </div>
        ) : (
          <>
            <Field label={engine === "ai" ? "OpenAI API anahtarı" : "Google Cloud API anahtarı"} value={draft} onChangeText={setDraft}
              secureTextEntry autoCapitalize="none" hint={keys[engine] ? "Windows güvenli deposuna kayıtlı." : "Bir anahtar kaydedin."} />
            <div className="actions">
              <Button label="API anahtarını kaydet" disabled={!bridge || !draft.trim() || action.busy}
                onPress={() => void action.run(async () => { await bridge!.key(engine, draft.trim()); setDraft(""); setKeys(await bridge!.keys()); })} />
              <Button label="API anahtarını sil" variant="secondary" disabled={!bridge || !keys[engine] || action.busy}
                onPress={() => void action.run(async () => { await bridge!.key(engine, ""); setDraft(""); setKeys(await bridge!.keys()); })} />
            </div>
            <CharacterLimits settings={settings} />
            {usage && <p className="hint">Kullanım · bugün {usage.daily.chars}, bu ay {usage.monthly.chars} karakter</p>}
          </>
        )}
        {step("ocrIntervalMs", "OCR tarama aralığı", 50, 150, 2000, " ms")}
        {step("confirmations", "OCR doğrulaması", 1, 1, 4, "")}
        {step("sensitivity", "OCR hassasiyeti", .1, 0, 1, "")}
        {step("minimumVisibleMs", "Minimum görünürlük", 100, 0, 3000, " ms")}
        {step("clearDelayMs", "Altyazı temizleme süresi", 250, 500, 10000, " ms")}
        <ActionStatus {...action} />
      </Card>
      <OcrAreaEditor />
      <section aria-labelledby="glossary-heading">
        <h2 id="glossary-heading">Oyun sözlüğü</h2>
        <GameGlossaryEditor entries={settings.glossary} onSave={(glossary) => update({ glossary })} />
      </section>
      <Card>
        <h3>Çeviri testi</h3>
        <Field label="İngilizce metin" multiline maxLength={1200} value={input}
          placeholder="Get to the boat, quickly!" onChangeText={setInput} />
        <div className="actions"><Button label="Metni çevir" disabled={!live?.available || !input.trim() || action.busy}
          onPress={() => void action.run(async () => {
            const translated = await bridge!.translate(input, settings);
            setResult(translated.text);
            if (engine !== "offline") setUsage(await bridge!.usage(engine));
            if (translated.cached) action.setMessage("Çeviri arşivden alındı.");
          })} /></div>
        {result && <p>{result}</p>}
      </Card>
    </>
  );
}

function CharacterLimits({ settings }: { settings: Settings }) {
  const { update } = useSettings();
  const [daily, setDaily] = useState(String(settings.dailyCharacters));
  const [monthly, setMonthly] = useState(String(settings.monthlyCharacters));
  const valid = /^\d{1,9}$/.test(daily) && Number(daily) <= 10_000_000 && /^\d{1,9}$/.test(monthly) && Number(monthly) <= 100_000_000;
  return (
    <>
      <div className="form-grid">
        <Field label="Günlük karakter sınırı" inputMode="numeric" value={daily} onChangeText={setDaily} />
        <Field label="Aylık karakter sınırı" inputMode="numeric" value={monthly} onChangeText={setMonthly} />
      </div>
      <div className="actions"><Button label="Sınırları kaydet" variant="secondary" disabled={!valid}
        onPress={() => update({ dailyCharacters: Number(daily), monthlyCharacters: Number(monthly) })} /></div>
    </>
  );
}

export function SamsungTv({ status, refresh, openSetup }: {
  status: TvStatus | null; refresh: () => Promise<void>; openSetup?: () => void;
}) {
  const bridge = window.ps5Desktop;
  const { settings, update } = useSettings();
  const action = useAction();
  const [ip, setIp] = useState(settings.tvIp);
  const [port, setPort] = useState(String(settings.tvPort));
  const [addresses, setAddresses] = useState<string[]>([]);
  const [testSent, setTestSent] = useState(false);
  useEffect(() => { void bridge?.getLanAddresses().then(setAddresses).catch(() => {}); }, [bridge]);

  function validate() {
    const address = ip.trim();
    const parts = address.split(".");
    if (address && (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) ||
      Number(parts[0]) === 0 || Number(parts[0]) === 127 || Number(parts[0]) >= 224)) {
      throw new Error("TV’nin IPv4 adresini girin. Örnek 192.168.1.42.");
    }
    const number = Number(port);
    if (!/^\d{1,5}$/.test(port) || number < 1 || number > 65535) throw new Error("Port numarası 1 ile 65535 arasında olmalıdır.");
    return { address, number };
  }

  return (
    <Card>
      <h3>TV altyazı sunucusu</h3>
      <StatusBadge kind={status?.clients.length ? "ready" : status?.running ? "busy" : "idle"}
        label={status?.clients.length ? `${status.clients.length} TV bağlı` : status?.running ? "Sunucu açık · TV bekleniyor" : "Sunucu kapalı"} />
      {status?.available === false && <Notice kind="warning" text="Bu pakette V3 TV sunucusu bulunamadı." />}
      {status?.lastError && <Notice kind="error" text={status.lastError} />}
      {status?.running && (
        <>
          <p>TV uygulamasındaki tablet IP alanına bilgisayarınızın yerel IPv4 adresini, port alanına <strong>{status.port}</strong> girin.</p>
          {addresses.length > 0 && <p className="hint">Bu bilgisayardaki IPv4 adresleri · {addresses.join(" · ")}</p>}
          {!!status.clients.length && <p className="hint">İstemci · {status.clients.join(", ")} · Tam ekran desteği {status.overlayClients} · Gönderilen {status.sentCount}</p>}
          {status.lastSentText && <p>Son gönderim · {status.lastSentText}</p>}
        </>
      )}
      <div className="form-grid">
        <Field label="Samsung TV IP adresi" placeholder="192.168.1.42" value={ip} onChangeText={setIp} hint="İsteğe bağlı IP filtresi." />
        <Field label="Altyazı sunucusu portu" inputMode="numeric" value={port} onChangeText={setPort} />
      </div>
      <ActionStatus {...action} />
      <div className="actions">
        <Button label="Tercihleri kaydet" variant="secondary" disabled={action.busy} onPress={() => void action.run(async () => {
          const { address, number } = validate();
          if (update({ tvIp: address, tvPort: number })) action.setMessage("TV adresi ve port tercihi kaydedildi.");
        })} />
        {status?.running ? <Button label="Sunucuyu durdur" variant="secondary" disabled={action.busy}
          onPress={() => void action.run(async () => { await bridge!.tv.stop(); setTestSent(false); await refresh(); })} />
          : <Button label="TV sunucusunu başlat" disabled={!status?.available || action.busy} onPress={() => void action.run(async () => {
            const { address, number } = validate();
            await bridge!.tv.start(number, address);
            update({ tvIp: address, tvPort: number });
            await refresh();
          })} />}
        <Button label="Test altyazısı gönder" variant="secondary" disabled={!status?.clients.length || action.busy}
          onPress={() => void action.run(async () => {
            await bridge!.tv.test(); setTestSent(true); action.setMessage("Test metni TV bağlantısına gönderildi.");
          })} />
        {openSetup && <Button label="Kurulum sihirbazı" variant="secondary" onPress={openSetup} />}
      </div>
      {testSent && <Button label="Metni TV’de gördüm" variant="ghost" onPress={() => {
        setTestSent(false); action.setMessage("TV’de test altyazısı görüldü.");
      }} />}
    </Card>
  );
}

export function TranslationArchive() {
  const bridge = window.ps5Desktop?.archive;
  const { settings, update } = useSettings();
  const action = useAction();
  const [games, setGames] = useState<ArchiveGame[]>([]);
  const [records, setRecords] = useState<ArchiveRecord[]>([]);
  const [gameName, setGameName] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [next, setNext] = useState(false);
  const game = settings.gameId;
  const load = useCallback(async (before = 0) => {
    if (!bridge) return;
    const [available, page] = await Promise.all([bridge.games(), bridge.page(game, search, before)]);
    setGames(available);
    setRecords((previous) => before > 0 ? [...previous, ...page] : page);
    setNext(page.length === 50);
  }, [bridge, game, search]);
  useEffect(() => { void load().catch(() => {}); }, [load]);

  return (
    <>
      <Card>
        <h3>Oyun arşivi</h3>
        <label className="ip-picker">Oyun
          <select value={game} onChange={(event) => update({ gameId: event.target.value })}>
            {games.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.count}</option>)}
          </select>
        </label>
        <Field label="Yeni oyun adı" value={gameName} onChangeText={setGameName} maxLength={100} />
        <div className="actions">
          <Button label="Oyun oluştur" disabled={!bridge || !gameName.trim() || action.busy}
            onPress={() => void action.run(async () => { update({ gameId: await bridge!.create(gameName) }); setGameName(""); })} />
          <Button label="Arşivi içe aktar" variant="secondary" disabled={!bridge || action.busy}
            onPress={() => void action.run(async () => {
              const result = await bridge!.import();
              if (result) { await load(); action.setMessage(`${result.added} kayıt eklendi, ${result.skipped} kayıt zaten vardı.`); }
            })} />
          <Button label="Arşivi dışa aktar" variant="secondary" disabled={!bridge || action.busy}
            onPress={() => void action.run(async () => {
              if (await bridge!.export()) action.setMessage("Arşiv dışa aktarıldı.");
            })} />
        </div>
        <label><input type="checkbox" checked={settings.generalArchive} onChange={(event) => update({ generalArchive: event.target.checked })} /> Genel arşivi de kullan</label>
        <label><input type="checkbox" checked={settings.shareEngines} onChange={(event) => update({ shareEngines: event.target.checked })} /> Çevirileri motorlar arasında paylaş</label>
        <ActionStatus {...action} />
        <Field label="Çeviri kayıtlarında ara" value={search} onChangeText={setSearch} />
      </Card>
      {records.length === 0 && <Card><p className="hint">Bu görünümde çeviri kaydı bulunamadı.</p></Card>}
      {records.map((record) => (
        <Card key={record.id}>
          <p className="hint">{record.source}</p>
          {editing?.id === record.id
            ? <Field label="Türkçe çeviri" multiline maxLength={1200} value={editing.text}
              onChangeText={(text) => setEditing({ id: record.id, text })} /> : <p>{record.translated}</p>}
          <small>{record.engine} · {new Date(record.created).toLocaleString("tr-TR")}</small>
          <div className="actions">
            {editing?.id === record.id ? <Button label="Düzenlemeyi kaydet" onPress={() => void action.run(async () => {
              await bridge!.edit(record.id, editing.text); setEditing(null); await load();
            })} /> : <Button label="Düzenle" variant="secondary" onPress={() => setEditing({ id: record.id, text: record.translated })} />}
            <Button label="Kaydı sil" variant="danger" onPress={() => {
              if (window.confirm("Bu çeviri kaydını silmek istiyor musunuz?")) void action.run(async () => { await bridge!.delete(record.id); await load(); });
            }} />
          </div>
        </Card>
      ))}
      {next && <Button label="Daha fazla kayıt" variant="secondary" onPress={() => void action.run(() => load(records.at(-1)?.id ?? 0))} />}
    </>
  );
}
