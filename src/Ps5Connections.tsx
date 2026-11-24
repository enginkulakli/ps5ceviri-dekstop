import { useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Notice, StatusBadge } from "./components/ui";

export function errorText(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error: /, "");
}

export const stageLabel: Record<Ps5Status["stage"], string> = {
  idle: "Oturum kapalı",
  discovering: "PS5 adresi aranıyor",
  connecting: "Remote Play bağlantısı kuruluyor",
  connected: "PS5 bağlı · Görüntü bekleniyor",
  pin: "PS5 kullanıcı giriş PIN’i gerekiyor",
  video: "H.264 görüntüsü alınıyor",
  stopping: "Oturum kapatılıyor",
  error: "Bağlantı hatası",
};

export function usePs5Status() {
  const [state, setState] = useState<Ps5Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const bridge = window.ps5Desktop?.ps5;
    if (!bridge) return;
    try { setState(await bridge.status()); setError(null); }
    catch (cause) { setError(errorText(cause)); }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 650);
    return () => clearInterval(interval);
  }, [refresh]);
  return { state, error, refresh };
}

export function Ps5Connections({ state, refresh }: { state: Ps5Status | null; refresh: () => Promise<void> }) {
  const bridge = window.ps5Desktop?.ps5;
  const [found, setFound] = useState<DetectedPs5[] | null>(null);
  const [ip, setIp] = useState("");
  const [name, setName] = useState("PS5");
  const [account, setAccount] = useState("");
  const [pin, setPin] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [override, setOverride] = useState("");
  const [selected, select] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registered = state?.consoles.find((console) => console.id === selected) ?? state?.consoles[0];
  const active = state && !["idle", "error"].includes(state.stage);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await action(); await refresh(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return (
    <>
      {state?.available === false && <Notice kind="warning" text="Bu pakette başsız Remote Play bileşeni bulunamadı." />}
      {error && <div role="alert"><Notice kind="error" text={error} /></div>}
      {state?.error && state.error !== error && <Notice kind="error" text={state.error} />}
      <Card>
        <h3>Kayıtlı konsollar</h3>
        <StatusBadge kind={state?.stage === "video" ? "ready" : active ? "busy" : "idle"} label={stageLabel[state?.stage ?? "idle"]} />
        {state?.consoles.length ? (
          <>
            <label className="ip-picker">PS5
              <select value={registered?.id} onChange={(event) => { select(event.target.value); setOverride(""); }} disabled={!!active}>
                {state.consoles.map((console) => <option key={console.id} value={console.id}>{console.name} · {console.ip}</option>)}
              </select>
            </label>
            <Field label="Bu oturum için manuel PS5 IP adresi" value={override} onChangeText={setOverride}
              hint="Boş bırakırsanız kayıtlı konsol ağda yeniden aranır." editable={!active} />
            <div className="actions">
              {active
                ? <Button label="Remote Play’i durdur" disabled={["discovering", "stopping"].includes(state.stage)} onPress={() => void run(() => bridge!.stop())} />
                : <Button label="Remote Play’i başlat" disabled={!registered || !state.available || busy}
                    onPress={() => void run(() => bridge!.start(registered!.id, override.trim()))} />}
              <Button label="Konsol kaydını sil" variant="secondary" disabled={!registered || !!active || busy}
                onPress={() => void run(() => bridge!.forget(registered!.id))} />
            </div>
          </>
        ) : <p className="hint">İlk bağlantı için PS5’i aşağıdan eşleştirin.</p>}
        {state?.stage === "pin" && (
          <>
            <Field label="PS5 kullanıcı giriş PIN’i" secureTextEntry inputMode="numeric" maxLength={4} value={loginPin} onChangeText={setLoginPin} />
            <div className="actions"><Button label="Giriş PIN’ini gönder" onPress={() => void run(async () => {
              try { await bridge!.login(loginPin); } finally { setLoginPin(""); }
            })} /></div>
          </>
        )}
      </Card>
      <Card>
        <h3>PS5 eşleştirme</h3>
        <p>PS5’te Ayarlar → Sistem → Remote Play bölümünden Remote Play’i açın. Cihazı Eşle ekranındaki sekiz haneli PIN’i kullanın.</p>
        <div className="actions"><Button label="Ağda PS5 ara" variant="secondary" disabled={!bridge || busy}
          onPress={() => void run(async () => { setFound(await bridge!.discover()); })} /></div>
        {found?.length === 0 && <Notice kind="info" text="Ağda PS5 bulunamadı. Konsolun IP adresini elle girebilirsiniz." />}
        {found?.map((console) => <Button key={console.id} label={`${console.name} · ${console.ip}${console.standby ? " (dinlenmede)" : ""}`}
          variant="secondary" onPress={() => { setIp(console.ip); setName(console.name); }} />)}
        <div className="form-grid">
          <Field label="PS5 IP adresi" value={ip} onChangeText={setIp} placeholder="192.168.1.55" />
          <Field label="Konsol adı" value={name} onChangeText={setName} maxLength={80} />
          <Field label="PSN Account ID (8 bayt Base64)" value={account} onChangeText={setAccount} secureTextEntry maxLength={12} />
          <Field label="PS5 eşleştirme PIN’i" secureTextEntry inputMode="numeric" maxLength={8} value={pin} onChangeText={setPin} />
        </div>
        <div className="actions"><Button label="PS5’i eşleştir" disabled={!state?.available || busy || !!active}
          onPress={() => void run(async () => {
            try { await bridge!.pair(ip.trim(), account.trim(), pin, name); }
            finally { setPin(""); setAccount(""); }
          })} /></div>
      </Card>
    </>
  );
}
