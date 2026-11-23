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

async function run(stageId,label){
  const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[];p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()==='error')errs.push('CE:'+m.text());});
  const url=BASE+'?stage='+stageId;
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForFunction(()=>!!window.__flow,{timeout:60000});
  const S=()=>p.evaluate(()=>window.__flow.state());
  const shot=n=>p.screenshot({path:`${OUT}/${stageId}-${n}.png`});
  await p.waitForTimeout(900);
  const stage=(await S()).stage;
  console.log(`\n=== ${label} (${stageId}) ===`);
  console.log('STAGE',JSON.stringify(stage));
  if(stage.id!==stageId)throw new Error(`stage id mismatch: ${stage.id} != ${stageId}`);
  // 开场
  await shot('01-intro');
  await p.evaluate(()=>window.__flow.skip()); await p.waitForTimeout(1300);
  console.log('MENU',(await S()).phase); await shot('02-menu');
  // 大厅 + 准备态
  await p.evaluate(()=>window.__flow.create()); await p.waitForTimeout(1400);
  console.log('LOBBY',(await S()).phase); await shot('03-lobby');
  await p.evaluate(()=>window.__flow.ready()); await p.waitForTimeout(300);
  console.log('READY',(await S()).hostReady);
  // 选角
  await p.evaluate(()=>window.__flow.toSelect()); await p.waitForTimeout(1400);
  await p.evaluate(()=>window.__flow.select(1)); await p.waitForTimeout(700);
  console.log('SELECT',(await S()).sel,(await S()).selCount,'cam',JSON.stringify((await S()).cam));
  await shot('04-select');
  // 战场
  await p.evaluate(()=>window.__flow.confirm()); await p.waitForTimeout(3600);
  console.log('BATTLE',(await S()).battlePick,(await S()).battleRival,JSON.stringify((await S()).nameTags));
  await shot('05-battle');
  console.log('ERRS',errs.slice(0,8));
  await b.close();
  return {stage,errs};
}

const a=await run('v6-floating-ruins','默认 V6 悬浮遗迹');
const c=await run('demo-crystal-arena','换图验证：晶格试炼场');
console.log('\n=== SUMMARY ===');
console.log('available stages:',JSON.stringify(a.stage.available));
console.log('two maps different floorY:',a.stage.floorY,'vs',c.stage.floorY,'=>',a.stage.floorY!==c.stage.floorY?'PASS':'FAIL');
console.log('both zero page errors:',a.errs.length===0&&c.errs.length===0?'PASS':'FAIL');
