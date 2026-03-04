#!/usr/bin/env node
import { chromium } from "playwright";

const DEFAULT_URL = "https://bobbinry.utaboshi.com";
const OUTPUT_DIR = "/home/strider/Code/bobbins/.screenshots";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) || DEFAULT_URL;
const path = args.find((a) => a.startsWith("/")) || null;
const width = parseInt(args.find((a) => /^\d+x/.test(a))?.split("x")[0]) || 1280;
const height = parseInt(args.find((a) => /x\d+/.test(a))?.split("x")[1]) || 800;
const fullPage = args.includes("--full");
const waitFor = args.find((a) => a.startsWith("--wait="))?.split("=")[1];

const finalUrl = path ? new URL(path, url).href : url;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });

await page.goto(finalUrl, { waitUntil: "networkidle", timeout: 15000 });

if (waitFor) {
  await page.waitForSelector(waitFor, { timeout: 10000 });
}

// Small extra delay for animations/transitions to settle
await page.waitForTimeout(500);

const { mkdirSync } = await import("fs");
mkdirSync(OUTPUT_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const filename = `${OUTPUT_DIR}/screenshot-${timestamp}.png`;

await page.screenshot({ path: filename, fullPage });
await browser.close();

console.log(filename);
