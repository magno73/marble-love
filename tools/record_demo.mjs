// Puppeteer recorder for the Marble Love gameplay demo.
// Invoked by tools/record_demo.sh (which starts the dev server + runs ffmpeg).
//
// Requires `npm i -D puppeteer` and local ROM ZIPs in
// packages/web/public/roms/ (the dev server auto-loads them). Captures the
// page via the Chrome DevTools screencast and writes JPEG frames; the wrapper
// turns them into docs/media/demo.mp4 + demo.gif.
//
// Env: DEMO_URL, DEMO_SECONDS, DEMO_FRAMES_DIR.
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.DEMO_URL ?? "http://127.0.0.1:5173/?autoLoad=1";
const SECONDS = Number(process.env.DEMO_SECONDS ?? 30);
const FRAMES_DIR = process.env.DEMO_FRAMES_DIR ?? "/tmp/marble-demo-frames";

let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  console.error("puppeteer is not installed. Run: npm i -D puppeteer");
  process.exit(2);
}

mkdirSync(FRAMES_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader", // software WebGL so it works headless / in CI
    "--window-size=1024,768",
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  // Let the engine boot from the local ROMs and reach live gameplay.
  await new Promise((r) => setTimeout(r, 4000));

  const client = await page.target().createCDPSession();
  let n = 0;
  client.on("Page.screencastFrame", async ({ data, sessionId }) => {
    writeFileSync(`${FRAMES_DIR}/frame-${String(n++).padStart(5, "0")}.jpg`, Buffer.from(data, "base64"));
    try {
      await client.send("Page.screencastFrameAck", { sessionId });
    } catch {
      /* session ending */
    }
  });

  await client.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  await client.send("Page.stopScreencast");
  console.log(`captured ${n} frames to ${FRAMES_DIR}`);
} finally {
  await browser.close();
}
