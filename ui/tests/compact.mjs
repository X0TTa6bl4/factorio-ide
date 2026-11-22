import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from './server.mjs';
const require = createRequire('/opt/ui-check/package.json');
const { chromium, firefox, webkit } = require('playwright');
const axe = require.resolve('axe-core/axe.min.js');
const output = process.env.UI_ARTIFACTS ?? '/artifacts';
await mkdir(output, { recursive: true });
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
 for (const [name, engine] of Object.entries({chromium, firefox, webkit})) {
  const browser = await engine.launch();
  try {
   const page = await browser.newPage();
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   for (const prefix of ['/ui/', '/factorio-ide/ui/']) {
    for (const width of [320, 390, 768, 900, 901, 1440, 1920]) {
     await page.setViewportSize({width, height:600});
     await page.goto(`${base}${prefix}compact.html`);
     await page.waitForFunction(() => document.documentElement.dataset.uiReady === 'true');
     const work = page.locator('[data-compact-workbench]');
     const views = work.locator('[data-work-view]');
     const area = work.locator('.fl-compact-editor textarea');
     const shape = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const broken = [];
      for (const attr of ['for','aria-controls','aria-labelledby','aria-describedby']) for (const el of document.querySelectorAll(`[${attr}]`)) for (const id of el.getAttribute(attr).split(/\s+/)) if (!document.getElementById(id)) broken.push(id);
      return {duplicates:ids.filter((id,i) => ids.indexOf(id)!==i), broken, overflow:document.documentElement.scrollWidth > innerWidth, vertical:document.scrollingElement.scrollHeight > innerHeight};
     });
     assert.deepEqual(shape, {duplicates:[],broken:[],overflow:false,vertical:false});
     const play = page.locator('[data-demo-play]');
     const size = await play.boundingBox();
     await play.click();
     assert.equal(await play.getAttribute('aria-label'), 'Приостановить');
     const after = await play.boundingBox();
     assert.equal(size.width,after.width); assert.equal(size.height,after.height);
     await page.locator('[data-demo-step]').click();
     assert.equal(await page.locator('[data-demo-tick]').textContent(),'1');
     await page.locator('[data-demo-back]').click();
     assert.equal(await page.locator('[data-demo-tick]').textContent(),'0');
     const speed = page.locator('[data-value-only]');
     await speed.locator('button').click();
     assert.equal(await speed.locator('.fl-selectbox__title').textContent(),'Скорость');
     const menu = await speed.locator('.fl-selectbox__popover').boundingBox();
     assert.equal(menu.width,144); assert.ok(menu.x >= 0 && menu.x + menu.width <= width);
     await speed.locator('button').press('Home');
     await speed.locator('button').press('Enter');
     assert.equal(await speed.locator('.fl-selectbox__value').textContent(),'1');
     await views.filter({hasText:'Сети'}).click();
     assert.equal(await work.locator('.fl-compact-networks').isVisible(), width <=900);
     if (width <=900) assert.equal(await area.isVisible(),false);
     await views.filter({hasText:'Код'}).click();
     await area.fill(Array.from({length:120},(_,i) => `// Строка ${i+1}: длинный текст для прокрутки`).join('\n'));
     await area.evaluate(el => { el.scrollTop = 350; el.dispatchEvent(new Event('scroll')); });
     assert.ok(await work.locator('.fl-editor__gutter').evaluate(el => el.scrollTop > 0));
     const before = await area.evaluate(el => el.scrollTop);
     await work.locator('.fl-editor__gutter').dispatchEvent('wheel', {deltaY:80, deltaMode:0});
     await page.waitForTimeout(60);
     assert.ok(await area.evaluate(el => el.scrollTop) > before);
     const scrolling = await work.evaluate(el => { const a=el.querySelector('textarea'),g=el.querySelector('.fl-editor__gutter'); return {a:a.scrollTop,g:g.scrollTop, ah:a.clientHeight,gh:g.clientHeight,as:a.scrollHeight,gs:g.scrollHeight}; });
     assert.ok(Math.abs(scrolling.a-scrolling.g)<2,JSON.stringify({name,prefix,width,...scrolling}));
     const longText = await area.inputValue();
     await area.fill('Edited');
     await work.locator('[data-demo-undo]').click();
     assert.equal(await area.inputValue(),longText);
     await work.locator('[data-demo-redo]').click();
     assert.equal(await area.inputValue(),'Edited');
     await work.locator('[data-demo-error]').click();
     await work.locator('[data-demo-jump]').click();
     assert.equal(await area.evaluate(el => el===document.activeElement),true);
     await views.filter({hasText:'События'}).click();
     assert.equal(await work.locator('.fl-compact-events').isVisible(),true);
     await work.locator('[data-demo-check]').click();
     await work.locator('[data-demo-stop]').click();
     assert.match(await work.locator('[data-event-status]').textContent(),/остановлена/);
     await views.filter({hasText:'Код'}).click();
     await page.addScriptTag({path:axe});
     const violations = await page.evaluate(async () => (await axe.run(document,{rules:{'color-contrast':{enabled:true}}})).violations.map(v => ({id:v.id, nodes:v.nodes.map(n=>n.target)})));
     assert.deepEqual(violations,[]);
     if(name==='chromium' && prefix==='/ui/' && [320,390,1440].includes(width)) {
      await area.fill('Circuit({\n  networks: [red_1, green_1],\n  devices: [],\n})');
      if (width > 900) await views.filter({hasText:'Сети'}).click();
      await page.screenshot({path:`${output}/compact-${width}.png`});
      await views.filter({hasText:'События'}).click();
      await page.screenshot({path:`${output}/events-${width}.png`});
     }
     results.push({browser:name,prefix,width,height:600,ok:true});
    }
   }
   await page.setViewportSize({width:390,height:900});
   await page.goto(`${base}/ui/compact.html`); await page.waitForFunction(()=>document.documentElement.dataset.uiReady==='true');
   await page.locator('[data-work-view="networks"]').click();
   await page.setViewportSize({width:1440,height:900});
   await page.waitForTimeout(60);
   assert.equal(await page.locator('.fl-compact-editor textarea').isVisible(),true);
   assert.equal(await page.locator('.fl-compact-networks').isVisible(),true);
   const touch = await browser.newPage({viewport:{width:390,height:900},hasTouch:true});
   await touch.goto(`${base}/ui/compact.html`);
   await touch.waitForFunction(()=>document.documentElement.dataset.uiReady==='true');
   await touch.locator('[data-work-view="events"]').tap();
   assert.equal(await touch.locator('.fl-compact-events').isVisible(),true);
   await touch.getByText('Настройки и подключения',{exact:true}).tap();
   assert.equal(await touch.getByRole('spinbutton',{name:'Лимит исполнителя, мс'}).isVisible(),true);
   await touch.locator('[data-work-view="networks"]').tap();
   assert.equal(await touch.locator('.fl-compact-networks').isVisible(),true);
   await touch.close();
   assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
 }
 await writeFile(`${output}/compact-report.json`, JSON.stringify(results,null,2));
 console.log(`PASS: ${results.length} viewport/path/browser combinations, controls, menus, panels, history, scrolling, axe`);
} finally { server.close(); }
