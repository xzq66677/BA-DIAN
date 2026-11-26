import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'slot-effects');
const url = process.argv[2] ?? 'http://127.0.0.1:5187/slot-preview.html';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const report = {
  url,
  startedAt: new Date().toISOString(),
  checks: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  stats: {},
};

function record(name, value = true) {
  report.checks.push({ name, passed: value !== false });
  assert.notEqual(value, false, name);
}

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => report.pageErrors.push(`${label}: ${error.message}`));
  page.on('requestfailed', (request) => report.requestFailures.push(`${label}: ${request.url()} ${request.failure()?.errorText}`));
}

async function shot(page, name) {
  const target = page.locator('.slot-preview-battlefield');
  const file = path.join(output, `${name}.png`);
  await target.screenshot({ path: file });
  report.screenshots.push(path.relative(root, file));
}

async function ready(page) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__slotPreview?.ready === true);
}

async function state(page) {
  return page.evaluate(() => window.__slotPreview.getState());
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, 'desktop');
  await ready(page);

  await page.getByTestId('preview-pull').click();
  record('preview selects four reels by default', await page.locator('.slot-reel').count() === 4);
  record('four-reel mode target is at least 44px', await page.getByTestId('preview-reels-4').evaluate((button) => button.getBoundingClientRect().height >= 44));
  await shot(page, 'desktop-pull-4-idle');
  await page.getByTestId('preview-reset').click();
  await page.getByTestId('preview-pull').click();
  await page.getByTestId('slot-pull-overlay').getByRole('button', { name: '3 数字', exact: true }).click();
  const initialDigits = await page.locator('.slot-reel').evaluateAll((reels) => reels.map((reel) => ({
    digit: Number(reel.dataset.digit),
    symbol: reel.dataset.symbol,
  })));
  record('three-reel mode shows digits from zero to nine', initialDigits.length === 3 && initialDigits.every(({ digit }) => digit >= 0 && digit <= 9));
  record('each reel shows the mapped concrete symbol', initialDigits.every(({ digit, symbol }) => symbol === (digit === 0 ? 'key' : digit <= 3 ? 'money' : digit <= 7 ? 'bomb' : 'attack')));
  record('number and symbol legend is visible', await page.getByRole('list', { name: '老虎机数字符号对照' }).isVisible());
  await shot(page, 'desktop-pull-idle');
  const handle = page.getByRole('button', { name: '拉动老虎机拉杆' });
  const box = await handle.boundingBox();
  assert(box);
  record('desktop lever target is at least 44px', box.width >= 44 && box.height >= 44);
  await page.mouse.move(box.x + box.width / 2, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-testid="slot-pull-overlay"]')?.getAttribute('data-phase') === 'spinning', null, { timeout: 2000 });
  record('drag enters spinning phase', true);
  await page.waitForFunction(() => window.__slotPreview.getState().status.includes('已受理'));
  record('desktop pointer drag submits once', (await state(page)).interactive === false);
  await shot(page, 'desktop-pull-spinning');
  await page.waitForFunction(() => window.__slotPreview.getState().status === '演出完成', null, { timeout: 5000 });
  const resultText = await page.locator('.slot-machine-caption').textContent() ?? '';
  record('result caption shows the three reel digits', initialDigits.every(({ digit }) => resultText.includes(String(digit))));
  await shot(page, 'desktop-pull-result');

  await page.getByTestId('preview-pull').click();
  await page.getByRole('button', { name: '取消演出' }).click();
  record('cancel does not submit', (await state(page)).status.includes('未提交'));

  await page.getByTestId('preview-pull').click();
  const cancelBox = await handle.boundingBox();
  await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + 60, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  record('window blur cancels drag without submit', (await state(page)).status === '等待玩家拉动拉杆');
  record('blur returns lever to idle', await page.getByTestId('slot-pull-overlay').getAttribute('data-phase') === 'idle');

  await page.getByTestId('preview-pull').click();
  await handle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__slotPreview.getState().status.includes('已受理'));
  record('keyboard activation submits', true);

  await page.getByTestId('preview-pull').click();
  await page.getByTestId('slot-pull-overlay').getByRole('button', { name: '4 数字', exact: true }).click();
  const fourDigits = await page.locator('.slot-reel').evaluateAll((reels) => reels.map((reel) => Number(reel.dataset.digit)));
  await handle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__slotPreview.getState().status === '演出完成', null, { timeout: 5000 });
  const fourResultText = await page.locator('.slot-machine-caption').textContent() ?? '';
  record('four-reel keyboard result shows all digits', fourDigits.length === 4 && fourDigits.every((digit) => fourResultText.includes(String(digit))));
  await shot(page, 'desktop-pull-4-result');

  await page.getByTestId('preview-drop-2d').click();
  await page.waitForTimeout(420);
  await shot(page, 'desktop-drop-2d-falling');
  record('2D drop overlay is visible', await page.getByTestId('slot-drop-overlay').isVisible());
  record('landed 2D machine keeps four reels', await page.locator('.slot-reel').count() === 4);
  await page.waitForFunction(() => window.__slotPreview.getState().status === '演出完成', null, { timeout: 5000 });

  await page.getByLabel('reduced-motion').check();
  await page.getByTestId('preview-drop-2d').click();
  const reducedAnimation = await page.locator('.slot-drop-trajectory').evaluate((element) => getComputedStyle(element).animationName);
  record('reduced-motion disables falling animation', reducedAnimation === 'none');
  await shot(page, 'desktop-drop-2d-reduced');
  await page.waitForFunction(() => window.__slotPreview.getState().status === '演出完成', null, { timeout: 3000 });
  await page.getByLabel('reduced-motion').uncheck();

  await page.getByTestId('preview-drop-3d').click();
  await page.waitForSelector('[data-testid="preview-scene"] canvas');
  await page.waitForFunction(() => window.__slotPreview.stats()?.slotDrops === 1);
  await page.waitForTimeout(1350);
  await shot(page, 'desktop-drop-3d-impact');
  report.stats.desktop3dImpact = await page.evaluate(() => window.__slotPreview.stats());
  record('3D drop active in renderer', report.stats.desktop3dImpact.slotDrops === 1);
  await page.waitForFunction(() => window.__slotPreview.stats()?.slotDrops === 0, null, { timeout: 6000 });
  report.stats.desktop3dSettled = await page.evaluate(() => window.__slotPreview.stats());

  await page.getByTestId('preview-drop-3d').click();
  await page.waitForFunction(() => window.__slotPreview.stats()?.slotDrops === 1);
  await page.waitForFunction(() => window.__slotPreview.stats()?.slotDrops === 0, null, { timeout: 6000 });
  report.stats.desktop3dSecondSettled = await page.evaluate(() => window.__slotPreview.stats());
  record('3D effect resources return to baseline',
    report.stats.desktop3dSecondSettled.geometries === report.stats.desktop3dSettled.geometries
    && report.stats.desktop3dSecondSettled.textures === report.stats.desktop3dSettled.textures);

  await page.getByLabel('low-effects').check();
  await page.getByTestId('preview-drop-3d').click();
  await page.waitForFunction(() => window.__slotPreview.stats()?.slotDrops === 1);
  await page.waitForTimeout(1450);
  await shot(page, 'desktop-drop-3d-low-effects');
  await page.waitForFunction(() => window.__slotPreview.stats()?.slotDrops === 0, null, { timeout: 6000 });
  await context.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  watch(mobilePage, 'mobile');
  await ready(mobilePage);
  const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record('390px layout has no horizontal overflow', overflow <= 0);
  await mobilePage.getByTestId('preview-pull').tap();
  const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record('390px four-reel overlay has no horizontal overflow', mobileOverflow <= 0);
  await shot(mobilePage, 'mobile-pull-4-idle');
  await mobilePage.getByTestId('preview-reset').tap();
  await mobilePage.getByRole('button', { name: '3 数字', exact: true }).tap();
  await mobilePage.getByTestId('preview-pull').tap();
  const mobileBox = await mobilePage.getByRole('button', { name: '拉动老虎机拉杆' }).boundingBox();
  assert(mobileBox);
  record('mobile lever target is at least 44px', mobileBox.width >= 44 && mobileBox.height >= 44);
  await shot(mobilePage, 'mobile-pull-idle');
  const cdp = await mobile.newCDPSession(mobilePage);
  const x = mobileBox.x + mobileBox.width / 2;
  const y = mobileBox.y + 18;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 6; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 9, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobilePage.waitForFunction(() => window.__slotPreview.getState().status.includes('已受理'));
  record('real touch drag submits', true);
  await mobilePage.waitForTimeout(650);
  await shot(mobilePage, 'mobile-pull-spinning');
  await mobilePage.getByTestId('preview-reset').tap();
  await mobilePage.getByRole('button', { name: '4 数字', exact: true }).tap();
  await mobilePage.getByTestId('preview-drop-2d').tap();
  await mobilePage.waitForTimeout(450);
  await shot(mobilePage, 'mobile-drop-2d');
  record('mobile 2D drop is visible', await mobilePage.getByTestId('slot-drop-overlay').isVisible());
  record('mobile landed machine keeps four reels', await mobilePage.locator('.slot-reel').count() === 4);
  await mobile.close();

  record('no browser console errors', report.consoleErrors.length === 0);
  record('no browser page errors', report.pageErrors.length === 0);
  record('no failed network requests', report.requestFailures.length === 0);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'browser-qa.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
