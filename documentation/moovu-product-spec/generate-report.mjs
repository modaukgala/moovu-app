import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { buildReportHtml, reportFacts, skippedVisuals } from "./report-template.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, "..", "..");
const assetsDir = path.join(__dirname, "assets");
const screenshotsDir = path.join(__dirname, "screenshots");
const outputDir = path.join(__dirname, "output");
const htmlPath = path.join(__dirname, "report.html");
const pdfPath = path.join(os.homedir(), "Desktop", "MOOVU-System-Design-and-Product-Specification.pdf");
const tempPdfPath = path.join(outputDir, "MOOVU-System-Design-and-Product-Specification.tmp.pdf");
const validationPath = path.join(outputDir, "validation.json");
const devLogPath = path.join(outputDir, "report-dev.log");
const devErrPath = path.join(outputDir, "report-dev.err.log");
const bundledNodeModules = "C:\\Users\\kgala\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const { PDFDocument } = require(path.join(bundledNodeModules, "pdf-lib"));
const reportDate = new Intl.DateTimeFormat("en-ZA", {
  year: "numeric",
  month: "long",
  day: "numeric",
}).format(new Date());

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    process.env.MS_EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function launchBrowser() {
  const executablePath = resolveBrowserExecutable();
  if (executablePath) {
    return chromium.launch({
      headless: true,
      executablePath,
    });
  }

  return chromium.launch({ headless: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileSafe(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

function relativeToReport(filePath) {
  return `./${path.relative(__dirname, filePath).replace(/\\/g, "/")}`;
}

async function isServerReachable(url) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

function startDevServer(port) {
  const logFd = fs.openSync(devLogPath, "w");
  const errFd = fs.openSync(devErrPath, "w");
  const child = spawn(
    process.env.ComSpec || "cmd.exe",
    ["/c", `npm run dev -- --port ${port}`],
    {
      cwd: repoRoot,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", logFd, errFd],
      env: {
        ...process.env,
        PORT: String(port),
      },
    },
  );
  return child;
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

async function captureScreenshots(baseUrl) {
  const browser = await launchBrowser();
  const captures = {};
  const targets = [
    { key: "home", route: "/", width: 430, height: 932 },
    { key: "customerAuth", route: "/customer/auth?next=/book", width: 430, height: 932 },
    { key: "driverLogin", route: "/driver/login", width: 430, height: 932 },
    { key: "driverApply", route: "/driver/apply", width: 430, height: 1100 },
    { key: "adminLogin", route: "/admin/login", width: 1440, height: 1024 },
  ];

  try {
    for (const target of targets) {
      const page = await browser.newPage({
        viewport: { width: target.width, height: target.height },
        deviceScaleFactor: 1,
      });
      try {
        await page.goto(`${baseUrl}${target.route}`, {
          waitUntil: "domcontentloaded",
          timeout: 120000,
        });
        await page.waitForTimeout(3500);
        const filePath = path.join(screenshotsDir, `${target.key}.png`);
        await page.screenshot({
          path: filePath,
          fullPage: true,
          animations: "disabled",
        });
        captures[target.key] = relativeToReport(filePath);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return captures;
}

function copyBrandAssets() {
  const publicDir = path.join(repoRoot, "public");
  const assets = {
    logoMain: ["logo.png", "logo-main.png"],
    logoBlack: ["Moovu-Black.png", "logo-black.png"],
    logoWhite: ["Moovu-White.png", "logo-white.png"],
    goIcon: [path.join("icons", "moovu-go-clean.png"), "moovu-go-clean.png"],
    goXlIcon: [path.join("icons", "moovu-go-xl-clean.png"), "moovu-go-xl-clean.png"],
  };

  const result = {};
  for (const [key, [sourceRel, targetName]] of Object.entries(assets)) {
    const source = path.join(publicDir, sourceRel);
    const target = path.join(assetsDir, targetName);
    copyFileSafe(source, target);
    result[key] = relativeToReport(target);
  }
  return result;
}

async function renderPdfFromHtml() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, {
      waitUntil: "load",
      timeout: 120000,
    });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: tempPdfPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: {
        top: "14mm",
        right: "13mm",
        bottom: "16mm",
        left: "13mm",
      },
    });
  } finally {
    await browser.close();
  }
}

async function enrichPdfMetadata() {
  const pdfBytes = fs.readFileSync(tempPdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.setTitle(reportFacts.reportTitle);
  pdfDoc.setAuthor("OpenAI Codex for MOOVU");
  pdfDoc.setSubject(reportFacts.reportSubtitle);
  pdfDoc.setProducer("OpenAI Codex");
  pdfDoc.setCreator("OpenAI Codex");
  pdfDoc.setKeywords([
    "MOOVU",
    "ride-hailing",
    "product specification",
    "system design",
    "dispatch",
    "driver operations",
  ]);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());
  const saved = await pdfDoc.save();
  fs.writeFileSync(pdfPath, saved);
}

function pythonForValidation(pdfFile) {
  return `
import json
from pathlib import Path
from pypdf import PdfReader

pdf_path = Path(r"""${pdfFile}""")
reader = PdfReader(str(pdf_path))
texts = []
blank_pages = []
for index, page in enumerate(reader.pages):
    text = (page.extract_text() or "").strip()
    texts.append(text)
    if len(text) < 8:
        blank_pages.append(index + 1)

joined = "\\n".join(texts)
first_page = texts[0] if texts else ""
result = {
  "page_count": len(reader.pages),
  "text_length": len(joined),
  "first_page_text": first_page[:1200],
  "contains_local_paths": any(token in joined for token in [r"D:\\\\Users\\\\", "src/app", "src/lib"]),
  "blank_pages": blank_pages,
}
print(json.dumps(result))
`;
}

function validatePdf() {
  const pythonPath = "C:\\Users\\kgala\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
  const output = execFileSync(
    pythonPath,
    ["-", pdfPath],
    {
      input: pythonForValidation(pdfPath),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const json = JSON.parse(output.trim());
  const size = fs.statSync(pdfPath).size;
  const coverOk = String(json.first_page_text || "").includes(reportFacts.reportTitle);
  const pageCount = Number(json.page_count || 0);
  const hasNoLocalPaths = !json.contains_local_paths;
  const opensSuccessfully = pageCount > 0;
  const sizeOk = size > 1024 * 1024;
  const pageCountOk = pageCount > 40;
  const noBlankPages = Array.isArray(json.blank_pages) && json.blank_pages.length === 0;

  const result = {
    pdfPath,
    pageCount,
    fileSizeBytes: size,
    fileSizeMb: Number((size / (1024 * 1024)).toFixed(2)),
    coverOk,
    opensSuccessfully,
    sizeOk,
    pageCountOk,
    hasNoLocalPaths,
    noBlankPages,
    blankPages: json.blank_pages,
  };

  fs.writeFileSync(validationPath, JSON.stringify(result, null, 2));

  if (!opensSuccessfully) throw new Error("Generated PDF could not be opened.");
  if (!coverOk) throw new Error("Generated PDF cover does not contain the expected title.");
  if (!hasNoLocalPaths) throw new Error("Generated PDF still contains local file paths.");
  if (!pageCountOk) throw new Error(`Generated PDF has only ${pageCount} pages.`);
  if (!sizeOk) throw new Error(`Generated PDF is smaller than expected at ${size} bytes.`);
  if (!noBlankPages) throw new Error(`Generated PDF contains blank pages: ${json.blank_pages.join(", ")}`);

  return result;
}

async function main() {
  ensureDir(assetsDir);
  ensureDir(screenshotsDir);
  ensureDir(outputDir);

  const assetRefs = copyBrandAssets();
  const port = 3100;
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = null;

  try {
    const alreadyRunning = await isServerReachable(baseUrl);
    if (!alreadyRunning) {
      server = startDevServer(port);
      const ready = await waitForServer(baseUrl, 180000);
      if (!ready) {
        throw new Error("MOOVU local server did not start in time for screenshot capture.");
      }
    }

    const screenshotRefs = await captureScreenshots(baseUrl);
    const reportAssets = {
      ...assetRefs,
      ...screenshotRefs,
    };

    const html = buildReportHtml({
      screenshots: reportAssets,
      generatedOn: reportDate,
    });
    fs.writeFileSync(htmlPath, html, "utf8");

    await renderPdfFromHtml();
    await enrichPdfMetadata();
    const validation = validatePdf();

    console.log(JSON.stringify({
      fileName: path.basename(pdfPath),
      filePath: pdfPath,
      pageCount: validation.pageCount,
      fileSizeBytes: validation.fileSizeBytes,
      fileSizeMb: validation.fileSizeMb,
      noLocalPaths: validation.hasNoLocalPaths,
      skippedVisuals,
    }, null, 2));
  } finally {
    if (server) {
      stopProcessTree(server);
    }
  }
}

main().catch((error) => {
  console.error("[moovu-product-spec] generation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
