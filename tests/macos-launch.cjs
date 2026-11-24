const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("@playwright/test");

async function launchMacPackage(executable, args) {
  // Exercise the signed bundle without injecting the Playwright Node loader.
  const child = spawn(executable, [...args, "--remote-debugging-port=0", "--enable-logging=stderr"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = once(child, "exit");
  // The cleanup path must also work if launch fails before a process exists.
  exited.catch(() => {});
  let browser;

  async function close() {
    try {
      if (browser?.isConnected()) {
        const session = await browser.newBrowserCDPSession();
        await session.send("Browser.close").catch(() => {});
        await Promise.race([exited, delay(1500, undefined, { ref: false })]);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      await exited.catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error(`No Electron DevTools endpoint.\n${output}`)), 20_000);
      const cleanup = () => clearTimeout(timeout);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        output = (output + chunk).slice(-16_000);
        const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
        if (match) {
          cleanup();
          resolve(match[1]);
        }
      });
      child.once("error", (error) => { cleanup(); reject(error); });
      child.once("exit", (code, signal) => {
        cleanup();
        reject(new Error(`Electron stopped during launch (${code ?? signal}).\n${output}`));
      });
    });
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
    return {
      async firstWindow() {
        const [context] = browser.contexts();
        return context.pages()[0] ?? context.waitForEvent("page", { timeout: 15_000 });
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { launchMacPackage };
