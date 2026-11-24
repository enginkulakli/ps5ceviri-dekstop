const { expect, _electron } = require("@playwright/test");
const { mkdtemp, rm, readFile } = require("node:fs/promises");
const { isIPv4 } = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { strict: assert } = require("node:assert");
const { test } = require("node:test");

test("desktop setup, connection preferences and glossary survive a restart", { timeout: process.env.PS5_PACKAGED_RUNTIME === "1" ? 420_000 : 90_000 }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "ps5-desktop-test-"));
  const executablePath = process.env.PS5_DESKTOP_EXECUTABLE;
  const args = [`--user-data-dir=${profile}`];
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    args.push("--ozone-platform=headless");
  }
  if (!executablePath) args.push(path.resolve(__dirname, ".."));
  const launch = () => _electron.launch({ args, executablePath, chromiumSandbox: process.platform !== "linux", timeout: 20_000 });
  let app;

  try {
    app = await launch();
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByRole("heading", { name: "Hoş geldiniz" })).toBeVisible();
    if (process.env.PS5_PACKAGED_RUNTIME === "1") {
      assert.equal(await page.evaluate(async () => (await window.ps5Desktop.ps5.status()).available), true);
      assert.equal(await page.evaluate(async () => (await window.ps5Desktop.tv.status()).available), true);
      assert.equal(await page.evaluate(async () => (await window.ps5Desktop.live.status()).available), true);
      await page.evaluate(() => window.ps5Desktop.live.key("google_cloud", "fixture-test-key"));
      assert.equal(await page.evaluate(async () => (await window.ps5Desktop.live.keys()).google_cloud), true);
      const sealed = await app.evaluate(async ({ app: electronApp, safeStorage }) => {
        const path = process.getBuiltinModule("node:path");
        const fs = process.getBuiltinModule("node:fs/promises");
        const data = Buffer.from(await fs.readFile(path.join(electronApp.getPath("userData"), "google_cloud.encrypted"), "utf8"), "base64");
        const decrypted = await safeStorage.decryptStringAsync(data);
        return { ciphertext: data.includes(Buffer.from("fixture-test-key")), matches: decrypted.result === "fixture-test-key", arch: process.arch };
      });
      assert.deepEqual(sealed, { ciphertext: false, matches: true, arch: process.platform === "darwin" ? "arm64" : "x64" });
      await page.evaluate(() => window.ps5Desktop.live.key("google_cloud", ""));

      const fixture = await readFile(path.join(__dirname, "fixtures", "subtitle.h264"), "base64");
      const recognized = await app.evaluate(async ({ app: electronApp }, encoded) => {
        const path = process.getBuiltinModule("node:path");
        const requireFromApp = process.getBuiltinModule("node:module").createRequire(path.join(electronApp.getAppPath(), "desktop", "main.cjs"));
        const { decode, Ocr } = requireFromApp("./frames.cjs");
        const ffmpeg = path.join(process.resourcesPath, "runtime", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
        const image = await new Promise((resolve, reject) => {
          const decoder = decode(ffmpeg, resolve, (error) => reject(new Error(error)));
          decoder.process.on("close", () => reject(new Error("No decoded image from packaged FFmpeg.")));
          decoder.input.end(Buffer.from(encoded, "base64"));
        });
        const ocr = new Ocr();
        try {
          const output = await ocr.read(image, { mode: "subtitle", ocrRegion: { x: 0, y: .72, w: 1, h: .28 }, exclusions: [] });
          return output.groups.flat().map((line) => line.text).join(" ");
        } finally { await ocr.stop(); }
      }, fixture);
      assert.match(recognized, /GET TO THE BOAT/i);
      const local = await page.evaluate(() => window.ps5Desktop.live.translate("Follow the lantern.", { engine: "offline" }));
      assert.match(local.text, /fener/i);
      assert.equal(local.cached, false);
      const cached = await page.evaluate(() => window.ps5Desktop.live.translate("Follow the lantern.", { engine: "offline" }));
      assert.equal(cached.cached, true);
      assert.equal(cached.text, local.text);
    }

    await page.getByRole("button", { name: "TV’yi hazırlamaya başla" }).click();
    await expect(page.getByText("12345", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Bilgisayarın yerel IP adresi")).toBeVisible();
    const addresses = await page.evaluate(() => window.ps5Desktop.getLanAddresses());
    assert.ok(addresses.every(isIPv4));
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");

    await page.getByRole("button", { name: "Devam et" }).click();
    await expect(page.getByText("Uygulama TV’de kurulu değilse donanım testi kılavuzundaki Samsung sertifikası ve Tizen Studio adımlarını kullanın.")).toBeVisible();
    await page.getByRole("button", { name: "TV adresi tercihlerine git" }).click();
    const ip = page.getByRole("textbox", { name: "Samsung TV IP adresi" });
    await ip.fill("999.0.1.1");
    await page.getByRole("button", { name: "Tercihleri kaydet" }).click();
    await expect(page.getByText("TV’nin IPv4 adresini girin. Örnek 192.168.1.42.")).toBeVisible();
    await ip.fill("192.168.1.42");
    await page.getByRole("textbox", { name: "Altyazı sunucusu portu" }).fill("8788");
    await page.getByRole("button", { name: "Tercihleri kaydet" }).click();
    await expect(page.getByText("TV adresi ve port tercihi kaydedildi.")).toBeVisible();

    await page.getByRole("button", { name: "Çeviri ayarları" }).click();
    await page.getByRole("button", { name: "Google Cloud" }).click();
    const glossary = page.getByRole("textbox", { name: "İngilizce terim = Türkçe karşılık" });
    await glossary.fill("Kratos = Kratos");
    await page.getByRole("button", { name: "Sözlüğü kaydet" }).click();
    await expect(page.getByText("Sözlük kaydedildi.")).toBeVisible();

    await page.getByRole("button", { name: "Genel ayarlar" }).click();
    await page.getByRole("button", { name: "Kurulum sihirbazını aç" }).click();
    await page.getByRole("button", { name: "TV kurulumunu atla" }).click();
    await expect(page.getByRole("button", { name: "Çeviriyi Başlat" })).toBeDisabled();
    assert.deepEqual(errors, []);
    await app.close();
    app = undefined;

    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.getByRole("heading", { name: "Durum", exact: true })).toBeVisible();
    await reopened.getByRole("button", { name: "Samsung TV", exact: true }).click();
    await expect(reopened.getByRole("textbox", { name: "Samsung TV IP adresi" })).toHaveValue("192.168.1.42");
    await expect(reopened.getByRole("textbox", { name: "Altyazı sunucusu portu" })).toHaveValue("8788");
    await reopened.getByRole("button", { name: "Çeviri ayarları" }).click();
    await expect(reopened.getByRole("textbox", { name: "İngilizce terim = Türkçe karşılık" })).toHaveValue("Kratos = Kratos");
    await expect(reopened.getByRole("button", { name: "Google Cloud" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
