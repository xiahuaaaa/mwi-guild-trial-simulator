import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const CHROME_CANDIDATES = [
  process.env.MWI_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((value): value is string => Boolean(value));

let cachedChromePath: string | undefined;

async function resolveChromePath(): Promise<string> {
  if (cachedChromePath) return cachedChromePath;
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      cachedChromePath = candidate;
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "未找到可用的 Chrome/Chromium。请安装浏览器或设置 MWI_CHROME_PATH。",
  );
}

export async function screenshotHtmlToPng(
  html: string,
  options: { width: number; height: number },
): Promise<Buffer> {
  const chromePath = await resolveChromePath();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mwi-report-"));
  const htmlPath = path.join(tempDir, "report.html");
  const pngPath = path.join(tempDir, "report.png");
  try {
    await writeFile(htmlPath, html, "utf8");
    await execFileAsync(
      chromePath,
      [
        "--headless=new",
        // Required on some Linux deployments / containers.
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        "--font-render-hinting=none",
        "--force-device-scale-factor=1",
        "--run-all-compositor-stages-before-draw",
        // Allow @font-face file:// / data URIs to settle before capture.
        "--virtual-time-budget=3000",
        `--window-size=${Math.max(1, Math.floor(options.width))},${Math.max(1, Math.floor(options.height))}`,
        `--screenshot=${pngPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const png = await readFile(pngPath);
    if (png.length < 8_000) {
      throw new Error("截图结果异常偏小，可能渲染失败。");
    }
    return png;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
