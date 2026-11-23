/**
 * 生成改前/改后并排对照图：docs/screenshots-djk/compare.png
 * 用法：node scripts/djk-compare.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'docs', 'screenshots-djk');
const pairs = [
  ['待机 idle', '01-idle'],
  ['蓄势 windup', '02-windup'],
  ['指点峰值 jab peak', '03-jab-peak'],
  ['收势 recover', '04-recover'],
  ['淘汰后 after kill（完整 UI）', '05-after-kill-full-ui'],
];

const rows = pairs.map(([label, name]) => `
  <tr>
    <td class="lb">${label}<br><code>${name}.png</code></td>
    <td><img src="./before/${name}.png"><div class="tag">改前 before</div></td>
    <td><img src="./after/${name}.png"><div class="tag">改后 after</div></td>
  </tr>`).join('\n');

const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:#111;color:#eee;font:14px/1.4 "Microsoft YaHei",sans-serif}
  h1{font-size:18px;padding:10px 14px;margin:0}
  table{border-collapse:collapse;width:100%}
  td{border:1px solid #333;padding:6px;vertical-align:top}
  img{width:100%;display:block}
  .lb{width:110px;font-weight:600}
  .tag{color:#9ad;margin-top:4px}
  code{color:#fa8}
</style>
<h1>大贱客出招 · 改前/改后同机位对照（默认镜头、同窗口尺寸）</h1>
<table>${rows}</table>`;

const fs = await import('node:fs');
fs.writeFileSync(path.join(dir, 'compare.html'), html);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('file://' + path.join(dir, 'compare.html'));
await page.waitForTimeout(1200); // 等图片解码
// 截为若干张：每行一张，避免单图过长
const trs = await page.locator('tr').all();
for (let i = 0; i < trs.length; i++) {
  await trs[i].screenshot({ path: path.join(dir, `compare-${String(i + 1).padStart(2, '0')}.png`) });
}
await page.screenshot({ path: path.join(dir, 'compare-full.png'), fullPage: true });
await browser.close();
console.log('OK', path.join(dir, 'compare-full.png'));
process.exit(0);
