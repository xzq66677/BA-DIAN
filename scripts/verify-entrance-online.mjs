/**
 * 入口上线回归：默认游客态 = 电影感入口（iframe 原型）
 *  - 默认加载新入口，iframe 内原型 __flow 可用、四段流程可走
 *  - ?stage=map006-weather 透传到 iframe
 *  - ?entrance=classic 回退旧 Home（拔典 / 账号池）
 *  - ?proto=A 原型探索不受影响
 *  - 桥接按钮存在：宿主点击 createBtn 触发真实建/入房间链路（真实网络）
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = process.env.PLAYWRIGHT_URL || 'http://localhost:3199';
const OUT = process.env.ENTRANCE_EVIDENCE_DIR || path.join(ROOT, 'visual-prototype/screenshots/entrance-online');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // ── 1. 默认入口 = 新视觉 ──
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance-shell .entrance-frame', { timeout: 15000 });
  const frameSrc = await page.getAttribute('.entrance-frame', 'src');
  check('默认游客态加载电影感入口', !!frameSrc && frameSrc.includes('v5-entrance.html'), frameSrc || '');
  check('保留经典入口回退开关', await page.locator('a.entrance-classic').count() === 1);

  // ── 2. iframe 原型就绪 + 四段流程 ──
  const frame = page.frameLocator('.entrance-frame');
  await frame.locator('#skipIntro').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const f = document.querySelector('.entrance-frame');
    return f && f.contentWindow && f.contentWindow.__flow;
  }, null, { timeout: 15000 });
  const flow = await page.evaluate(() => {
    const f = document.querySelector('.entrance-frame');
    return f.contentWindow.__flow.state();
  });
  check('原型 __flow 就绪', !!flow && flow.phase, `phase=${flow.phase}`);

  // 跳过开场 → 菜单 → 创建房间 → 作战室 → 选角 → 确认出战
  await frame.locator('#skipIntro').click();
  await page.waitForTimeout(700);
  let st = await page.evaluate(() => document.querySelector('.entrance-frame').contentWindow.__flow.state());
  check('开场→主菜单', st.phase === 'menu', `phase=${st.phase}`);

  await frame.locator('#createBtn').click();
  await page.waitForTimeout(900);
  st = await page.evaluate(() => document.querySelector('.entrance-frame').contentWindow.__flow.state());
  check('主菜单→作战室', st.phase === 'lobby', `phase=${st.phase}`);

  await frame.locator('#toSelectBtn').click();
  await page.waitForTimeout(900);
  st = await page.evaluate(() => document.querySelector('.entrance-frame').contentWindow.__flow.state());
  check('作战室→选角', st.phase === 'select', `phase=${st.phase}`);

  await frame.locator('#selTabRow .tab').nth(2).click();
  await page.waitForTimeout(300);
  st = await page.evaluate(() => document.querySelector('.entrance-frame').contentWindow.__flow.state());
  check('选角可切换角色', st.sel === 'bagun', `sel=${st.sel}`);
  await page.screenshot({ path: path.join(OUT, '01-select.png') });

  // 确认出战 → 桥接消息 → 真实建房间 → 进入真实 lobby（等网络）
  await frame.locator('#confirmBtn').click();
  await page.getByRole('radio', { name: '关闭' }).check();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await page.waitForTimeout(1600);
  const enteredLobby = await page.locator('.tcg-lobby, .lobby').count() > 0
    || await page.locator('text=房间').count() > 0
    || !(await page.locator('.entrance-shell').count());
  check('确认出战进入真实对局链路', enteredLobby, `url=${page.url()}`);
  check('新入口关闭天气配置已进入真实房间', await page.getByText('地图：悬浮遗迹 · 天气与泥潭：关闭').count() === 1);

  // ── 3. 地图参数透传 ──
  await page.evaluate(() => localStorage.removeItem('badian-session'));
  await page.goto(BASE + '/?stage=map006-weather', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance-frame', { timeout: 15000 });
  const src2 = await page.getAttribute('.entrance-frame', 'src');
  check('stage 参数透传到 iframe', !!src2 && src2.includes('map006-weather'), src2 || '');

  // ── 4. 经典入口回退 ──
  // 上一步确认出战写入了 badian-session，先清掉以便回到游客态
  await page.goto(BASE + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('badian-session'));
  await page.goto(BASE + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.entrance-shell', { state: 'detached', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const hasClassic = (await page.locator('.tcg-lobby').count() > 0
    || await page.locator('text=角色卡池').count() > 0)
    && await page.locator('text=开启对局').count() > 0;
  check('经典入口回退旧 Home', hasClassic);
  await page.screenshot({ path: path.join(OUT, '02-classic.png') });

  // ── 5. 原型探索不受影响 ──
  await page.goto(BASE + '/?proto=A', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const protoOk = await page.locator('.pbar-btn').count() > 0;
  check('原型探索 ?proto=A 不受影响', protoOk);

  check('页面报错为 0', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('脚本执行未抛异常', false, String(e));
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== ${pass}/${results.length} PASS ===`);
if (pass !== results.length) process.exit(1);
