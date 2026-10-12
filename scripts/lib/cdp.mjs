// =============================================================================
// scripts/lib/cdp.mjs — a signed-in headless Chrome over the DevTools protocol,
// for page checks (K3+). No extra dependency: Node's built-in WebSocket.
//
//   const b = await openBrowser({ who: "pipeline", script: "x", projects: [id] });
//   await b.viewport(1440, 1000);           // { mobile, dark } optional
//   await b.goto(`http://localhost:3098/project/${id}/boq`, "[data-boq-review]");
//   await b.evaluate("document.title");
//   await b.key("Tab"); await b.key("ArrowDown");
//   await b.screenshot("shots/x.png", { fullPage: true });
//   await b.close();
//
// H1/H5: the browser carries a REAL dev account's session (the cookies
// @supabase/ssr writes) and that account is made a member of the projects it
// reads (service role, the operator act) — no bypass.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { devSession, grantProjectMembership } from "./dev-auth.mjs";

const CHROMES = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = {
  Tab: { code: "Tab", keyCode: 9 },
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  " ": { code: "Space", keyCode: 32, text: " " },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
};

/**
 * @param {{ who?: string, script?: string, projects?: string[], host?: string, signedIn?: boolean, args?: string[] }} [opts]
 */
export async function openBrowser(opts = {}) {
  const chromePath = CHROMES.find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error("needs Chrome or Edge");
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "k-cdp-"));
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "--hide-scrollbars", ...(opts.args ?? []), "about:blank"], { stdio: "ignore" });

  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
  }
  if (!wsUrl) throw new Error("Chrome did not start");
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const console_ = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") console_.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console_.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  await send("Page.enable");
  await send("Network.enable");
  await send("Runtime.enable");

  let userId = null;
  if (opts.signedIn !== false) {
    const me = await devSession(opts.who ?? "pipeline", { script: opts.script ?? "cdp" });
    userId = me.userId;
    if (opts.projects?.length && me.userId) await grantProjectMembership(me.userId, opts.projects, { script: opts.script ?? "cdp" });
    for (const c of me.cookies) await send("Network.setCookie", { name: c.name, value: c.value, domain: opts.host ?? "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" });
  }

  let vp = { width: 1440, height: 1000, mobile: false };
  const api = {
    userId,
    send,
    evaluate,
    errors: () => [...console_],
    /** @param {number} width @param {number} height @param {{ mobile?: boolean, touch?: boolean }} [o] */
    async viewport(width, height, o = {}) {
      vp = { width, height, mobile: !!o.mobile };
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!o.mobile });
      await send("Emulation.setTouchEmulationEnabled", o.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await send("Emulation.setEmitTouchEventsForMouse", { enabled: !!o.touch });
    },
    /** Force the theme the pre-paint script would set. */
    async theme(t) {
      await evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(t)})`);
    },
    async goto(url, readySelector, timeoutMs = 60000) {
      await send("Page.navigate", { url });
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        await sleep(250);
        try {
          if ((await evaluate("document.readyState")) === "complete" && (!readySelector || (await evaluate(`!!document.querySelector(${JSON.stringify(readySelector)})`)))) break;
        } catch {}
      }
      await sleep(1200); // hydration
    },
    async until(expr, timeoutMs = 10000) {
      const t = Date.now() + timeoutMs;
      while (Date.now() < t) {
        try {
          if (await evaluate(expr)) return true;
        } catch {}
        await sleep(150);
      }
      return false;
    },
    async key(key, mods = 0) {
      const k = KEYS[key] ?? { code: key, keyCode: key.toUpperCase().charCodeAt(0), text: key };
      const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: mods };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.text ? { text: k.text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(60);
    },
    async mouse(x, y, type = "mouseMoved") {
      await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    },
    async click(x, y) {
      await api.mouse(x, y, "mouseMoved");
      await api.mouse(x, y, "mousePressed");
      await api.mouse(x, y, "mouseReleased");
    },
    async tap(x, y) {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    /** @param {string} file @param {{ fullPage?: boolean, clip?: {x:number,y:number,width:number,height:number} }} [o] */
    async screenshot(file, o = {}) {
      let params = { format: "png" };
      if (o.fullPage) {
        const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
        await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: h, deviceScaleFactor: 1, mobile: vp.mobile });
        await sleep(400);
        params = { ...params, captureBeyondViewport: true };
      }
      if (o.clip) params = { ...params, clip: { ...o.clip, scale: 1 } };
      const { data } = await send("Page.captureScreenshot", params);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      if (o.fullPage) await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    },
    /** Run axe-core (node_modules) on the page; returns violations. */
    async axe(context = "document") {
      const src = fs.readFileSync(path.join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");
      await evaluate(src);
      return evaluate(`axe.run(${context}, { resultTypes: ["violations"] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ") + " — " + (n.failureSummary || "").split("\\n").slice(1, 3).join(" ")) })))`);
    },
    async close() {
      try {
        ws.close();
      } catch {}
      chrome.kill();
      await sleep(300);
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {}
    },
  };
  return api;
}
