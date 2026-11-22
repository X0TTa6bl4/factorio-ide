import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { startServer } from '/workspace/ui/tests/server.mjs';
const require=createRequire('/opt/ui-check/package.json');
const { chromium }=require('playwright');
const server=await startServer();
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--no-sandbox']});
const errors=[];const findings=[];
try {
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 for(const prefix of ['/ui/','/factorio-ide/ui/']) {
  for(const width of [390,768,1024,1440]) {
   await page.setViewportSize({width,height:1000});
   await page.goto(base+prefix+'docs.html');
   await page.waitForSelector('html[data-ui-ready="true"]');
   await page.waitForSelector('[data-doc-article="networks"]:not([hidden])');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`overflow ${width}`);
   const duplicates=await page.evaluate(()=>{const a=[...document.querySelectorAll('[id]')].map(e=>e.id);return a.filter((x,i)=>a.indexOf(x)!==i)});
   assert.deepEqual(duplicates,[]);
   if(width<900) {
    await page.locator('[data-doc-menu]').click();
    assert.equal(await page.locator('[data-doc-dialog]').evaluate(e=>e.open),true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('[data-doc-dialog]').open);
    assert.equal(await page.locator('[data-doc-menu]').evaluate(e=>e===document.activeElement),true);
    await page.locator('[data-doc-menu]').click();
    await page.locator('[data-doc-tree] [data-doc-target="decider"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-doc-dialog]').open);
    assert.equal(await page.locator('[data-doc-heading="decider"]').evaluate(e=>e===document.activeElement),true);
   } else await page.locator('[data-doc-tree] [data-doc-target="decider"]').click();
   assert.equal(await page.locator('[data-doc-article="decider"]').isVisible(),true);
   await page.locator('[data-doc-article="decider"] [data-doc-copy]').click();
   await page.getByText('Код скопирован',{exact:true}).waitFor();
   assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/when_true:/);
   await page.goBack();
   await page.waitForSelector('[data-doc-article="networks"]:not([hidden])');
   await page.goto(base+prefix+'docs.html#decider-errors');
   await page.waitForSelector('html[data-ui-ready="true"]');
   assert.equal(await page.locator('[data-doc-article="decider"]').isVisible(),true);
   if(width===1440&&prefix==='/ui/') {
    await page.goto(base+prefix+'docs.html#networks');await page.waitForSelector('html[data-ui-ready="true"]');
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
    await page.screenshot({path:'/artifacts/desktop.png',fullPage:true});
   }
   if(width===390&&prefix==='/ui/') {
    await page.goto(base+prefix+'docs.html#decider');await page.waitForSelector('html[data-ui-ready="true"]');
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
    await page.screenshot({path:'/artifacts/mobile.png',fullPage:true});
    await page.locator('[data-doc-menu]').click();
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
    await page.screenshot({path:'/artifacts/mobile-navigation.png'});
    await page.keyboard.press('Escape');
   }
   findings.push(`${prefix} ${width}px: navigation, focus, copy, history, anchors, overflow OK`);
  }
 }
 await page.goto(base+'/ui/docs.html#unknown');await page.waitForSelector('html[data-ui-ready="true"]');
 assert.equal(await page.locator('[data-doc-missing]').isVisible(),true);
 await page.goto(base+'/ui/index.html#documentation');await page.waitForSelector('html[data-ui-ready="true"]');
 assert.equal(await page.locator('[data-doc-article="networks"]').isVisible(),true);
 await page.locator('.fl-sidebar a[href="#forms"]').click();
 assert.equal(await page.locator('#forms').evaluate(e=>Math.abs(e.getBoundingClientRect().top)<100),true);
 const axe=require.resolve('axe-core/axe.min.js');
 await page.goto(base+'/ui/docs.html');await page.waitForSelector('html[data-ui-ready="true"]');
 await page.addScriptTag({path:axe});
 const results=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
 assert.deepEqual(results.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
 assert.deepEqual(errors,[]);
 findings.push('Unknown section, catalogue registration, axe WCAG A/AA: OK');
 await writeFile('/artifacts/report.txt',findings.join('\n')+'\n');
 console.log(findings.join('\n'));
} finally {await browser.close();server.close();}
