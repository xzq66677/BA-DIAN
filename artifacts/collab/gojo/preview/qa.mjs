import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('D:/AI工作区/badian-game/node_modules/playwright/index.mjs').href);
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '..', 'evidence');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), pageErrors, consoleErrors, checks: {} };
try {
  await page.goto('http://127.0.0.1:5213/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__gojo?.ready === true, null, { timeout: 60000 });
  report.initial = await page.evaluate(() => ({ stats: window.__gojo.stats, state: window.__gojo.getState(), status: document.querySelector('#status').textContent }));
  report.checks.initialReady = report.initial.state.eyesBlocked && report.initial.state.blindfoldFixed;
  report.checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  await page.evaluate(() => window.__gojo.seek('idle', 0));
  await page.evaluate(() => document.querySelector('#face').click());
  await page.screenshot({ path: path.join(evidence, 'preview-masked-face.png') });

  await page.evaluate(() => window.__gojo.seek('domain_expand', .6));
  await page.screenshot({ path: path.join(evidence, 'preview-domain-expand-face.png') });
  report.domainExpanding = await page.evaluate(() => window.__gojo.getState());
  report.checks.domainEyesStayBlocked = report.domainExpanding.eyesBlocked && report.domainExpanding.blindfoldFixed;

  await page.evaluate(() => window.__gojo.seek('domain_expand', 1.6));
  await page.screenshot({ path: path.join(evidence, 'preview-domain-gesture.png') });
  report.domainGesture = await page.evaluate(() => window.__gojo.getState());
  report.checks.domainGestureSeal = report.domainGesture.handSeal && report.domainGesture.eyesBlocked && report.domainGesture.blindfoldFixed;

  await page.evaluate(() => window.__gojo.seek('domain_idle', 2));
  await page.screenshot({ path: path.join(evidence, 'preview-domain-held-face.png') });
  report.domainHeld = await page.evaluate(() => window.__gojo.getState());
  report.checks.domainHeldState = report.domainHeld.handSeal && report.domainHeld.eyesBlocked && report.domainHeld.blindfoldFixed;

  await page.evaluate(() => document.querySelector('#resetCamera').click());
  await page.evaluate(() => window.__gojo.seek('domain_idle', 2));
  await page.screenshot({ path: path.join(evidence, 'preview-domain-hand.png') });
  await page.evaluate(() => window.__gojo.seek('idle', .7));
  await page.screenshot({ path: path.join(evidence, 'preview-idle.png') });
  await page.evaluate(() => window.__gojo.seek('attack', .45));
  await page.screenshot({ path: path.join(evidence, 'preview-attack.png') });
  await page.evaluate(() => window.__gojo.seek('dead', 1.2));
  await page.screenshot({ path: path.join(evidence, 'preview-dead.png') });

  await page.evaluate(() => document.querySelector('#domain').click());
  await page.waitForFunction(() => {
    const state = window.__gojo.getState();
    return state.current === 'domain_idle' && state.eyesBlocked && state.blindfoldFixed && state.handSeal;
  }, null, { timeout: 15000 });
  report.domainButton = await page.evaluate(() => window.__gojo.getState());
  report.checks.domainButtonTransitionsToHeldState = report.domainButton.eyesBlocked && report.domainButton.blindfoldFixed;
  report.checks.domainHandSeal = report.domainButton.handSeal;

  report.export = await page.evaluate(() => window.__gojo.exportGlb());
  report.validation = await page.evaluate(() => window.__gojo.validateSaved());
  report.checks.independentGlbValidation = report.validation.pass;
  report.checks.independentRendererRender = report.validation.renderer.independentGlbReload.calls > 0 && report.validation.renderer.independentGlbReload.triangles > 0;
  report.checks.independentLoadedStats = report.validation.loaded.stats.triangles === report.initial.stats.triangles && report.validation.loaded.stats.bones === report.initial.stats.bones && report.validation.loaded.stats.meshes === report.initial.stats.meshes;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__gojo.seek('domain_idle', 2));
  report.mobileState = await page.evaluate(() => window.__gojo.getState());
  report.checks.mobileDomainState = report.mobileState.eyesBlocked && report.mobileState.blindfoldFixed && report.mobileState.handSeal;
  await page.screenshot({ path: path.join(evidence, 'preview-mobile-390.png'), fullPage: true });
  report.mobile = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, stage: { width: document.querySelector('#stage').clientWidth, height: document.querySelector('#stage').clientHeight }, domainButton: document.querySelector('#domain').getBoundingClientRect().toJSON() }));
  report.checks.mobileNoHorizontalOverflow = report.mobile.scrollWidth <= report.mobile.viewport;
  report.checks.mobileTouchTarget = report.mobile.domainButton.width >= 44 && report.mobile.domainButton.height >= 44;
  report.pass = Object.values(report.checks).every(Boolean) && pageErrors.length === 0 && consoleErrors.length === 0;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  report.pass = false;
} finally {
  await writeFile(path.join(evidence, 'browser-qa.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ pass: report.pass, checks: report.checks, export: report.export, validationPass: report.validation?.pass, failure: report.failure }, null, 2));
if (!report.pass) process.exitCode = 1;
