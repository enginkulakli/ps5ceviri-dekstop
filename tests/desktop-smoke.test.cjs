const { expect, _electron } = require("@playwright/test");
const { mkdtemp, rm } = require("node:fs/promises");
const { isIPv4 } = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { strict: assert } = require("node:assert");
const { test } = require("node:test");

test("desktop setup, connection preferences and glossary survive a restart", { timeout: 90_000 }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "ps5-desktop-test-"));
  const executablePath = process.env.PS5_DESKTOP_EXECUTABLE;
  const args = [`--user-data-dir=${profile}`];
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    args.push("--ozone-platform=headless");
  }
  if (!executablePath) args.push(path.resolve(__dirname, ".."));
  let app;

  try {
    app = await _electron.launch({ args, executablePath, chromiumSandbox: process.platform !== "linux" });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByRole("heading", { name: "Hoş geldiniz" })).toBeVisible();

    await page.getByRole("button", { name: "TV’yi hazırlamaya başla" }).click();
    await expect(page.getByText("12345", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Bilgisayarın yerel IP adresi")).toBeVisible();
    const addresses = await page.evaluate(() => window.ps5Desktop.getLanAddresses());
    assert.ok(addresses.every(isIPv4));
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");

    await page.getByRole("button", { name: "Devam et" }).click();
    await expect(page.getByText("TV keşfi, sertifika ile imzalama, yükleme ve test altyazısı masaüstü entegrasyonu bekliyor.")).toBeVisible();
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

    app = await _electron.launch({ args, executablePath, chromiumSandbox: process.platform !== "linux" });
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
