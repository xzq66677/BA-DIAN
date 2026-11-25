// playwright 需可解析：本机从共享仓库根依赖加载；换环境请改此路径或设置 PLAYWRIGHT_URL
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const _here = path.dirname(fileURLToPath(import.meta.url));
const _root = path.resolve(_here, '../../..');            // 仓库根
const PW = process.env.PLAYWRIGHT_URL || pathToFileURL(path.join(_root, 'node_modules/playwright/index.mjs')).href;
const { chromium } = await import(PW);

const BASE = pathToFileURL(path.resolve(_here, '../prototypes/v5-entrance.html')).href;
const OUT = path.resolve(_here, '../screenshots');
fs.mkdirSync(OUT, { recursive: true });

const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
async function open(stageId) {
  const b = await chromium.launch({ headless: true, args: GL });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PE:' + String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('CE:' + m.text()); });
  await p.goto(BASE + '?stage=' + stageId, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => !!window.__flow, { timeout: 60000 });
  return { b, p, errs, S: () => p.evaluate(() => window.__flow.state()) };
}

// ── 1. 天气版地图：四段流程 + 四态天气 + 泥潭两态 ──
{
  const { b, p, errs, S } = await open('map006-weather');
  const shot = n => p.screenshot({ path: `${OUT}/map006-weather-${n}.png` });
  console.log('\n=== MAP-006 天气版 ===');
  await p.waitForTimeout(900);
  let s = await S();
  console.log('STAGE', JSON.stringify(s.stage));
  console.log('WEATHER init', JSON.stringify(s.weather));
  if (s.stage.id !== 'map006-weather') throw new Error('stage id mismatch');
  if (!s.weather || s.weather.weather !== 'clear') throw new Error('weather should init clear');
  const names = await p.evaluate(() => window.__flow.weatherNames());
  console.log('WEATHER names', JSON.stringify(names));
  if (names.length !== 4) throw new Error('expected 4 weather states');

  // 跳过开场到主菜单，在菜单机位遍历四态天气（便于对比云/雨/雾）
  await p.evaluate(() => window.__flow.skip()); await p.waitForTimeout(1200);
  for (const w of names) {
    await p.evaluate(w => window.__flow.setWeather(w, null), w);
    await p.waitForTimeout(700);
    const cur = (await S()).weather;
    console.log('WEATHER set ->', w, JSON.stringify(cur));
    if (cur.weather !== w) throw new Error('weather set failed: ' + w);
    await shot('weather-' + w);
  }
  // 泥潭预警态（大厅）
  await p.evaluate(() => window.__flow.create()); await p.waitForTimeout(1200);
  await p.evaluate(() => window.__flow.setWeather('rain', { phase: 'warn' }));
  await p.waitForTimeout(600);
  console.log('MUD warn', JSON.stringify((await S()).weather));
  await shot('weather-mud-warn');
  // 泥潭封路态
  await p.evaluate(() => window.__flow.setWeather('rain', { phase: 'active' }));
  await p.waitForTimeout(600);
  console.log('MUD active', JSON.stringify((await S()).weather));
  await shot('weather-mud-active');

  // 四段流程：清掉泥潭、回到晴天，走选角→战场
  await p.evaluate(() => window.__flow.setWeather('clear', null));
  await p.evaluate(() => window.__flow.ready()); await p.waitForTimeout(300);
  await p.evaluate(() => window.__flow.toSelect()); await p.waitForTimeout(1300);
  await p.evaluate(() => window.__flow.select(1)); await p.waitForTimeout(700);
  console.log('SELECT', (await S()).sel); await shot('04-select');
  await p.evaluate(() => window.__flow.confirm()); await p.waitForTimeout(3400);
  s = await S();
  console.log('BATTLE', s.battlePick, s.battleRival); await shot('05-battle');
  console.log('ERRS', errs.slice(0, 8));
  if (errs.length) throw new Error('page errors: ' + errs.slice(0, 3).join(' | '));
  await b.close();
}

// ── 2. 回归：旧两张地图不受天气钩子影响 ──
for (const id of ['v6-floating-ruins', 'demo-crystal-arena']) {
  const { b, p, errs, S } = await open(id);
  await p.waitForTimeout(700);
  const s = await S();
  const hasWeather = !!s.weather;
  console.log(`\n=== REGRESSION ${id} ===`);
  console.log('stage', s.stage.id, 'weather hook:', hasWeather ? 'present' : 'absent (expected)');
  if (hasWeather) throw new Error(id + ' should NOT have weather hook');
  await p.evaluate(() => window.__flow.skip()); await p.waitForTimeout(900);
  console.log('phase', (await S()).phase, 'errs', errs.length);
  if (errs.length) throw new Error(id + ' page errors: ' + errs.slice(0, 2).join(' | '));
  await b.close();
}

console.log('\n=== SUMMARY ===');
console.log('weather 4 states + mud 2 states + 4-phase flow + 2 regressions: PASS');
