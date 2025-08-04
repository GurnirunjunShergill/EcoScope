import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
dotenv.config();

async function scrape() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(process.env.TARGET_URL!);

  const reports = await page.$$eval('.report-item .title', (nodes) =>
    nodes.map((n) => n.textContent?.trim())
  );

  console.log('Scraped reports:', reports);

  await browser.close();
}

scrape().catch(console.error);
