// Public-fixture browser checks: no private evaluation export is required.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{parseConfig,serializeConfig}=require('./eval_config.js');
const root=fileURLToPath(new URL('.',import.meta.url));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quickdash-browser-'));
let ws;
try{
 const fixture=parseConfig(fs.readFileSync(path.join(root,'configs/example.yaml'),'utf8'));
 const configs=path.join(temporary,'configs');fs.mkdirSync(configs);
 fs.writeFileSync(path.join(configs,'example.yaml'),serializeConfig(fixture));
 const invalidForScores=structuredClone(fixture);invalidForScores.name='Small scale fixture';invalidForScores.evals[0].score.scale=.1;
 fs.writeFileSync(path.join(configs,'small.yaml'),serializeConfig(invalidForScores));
 const empty=path.join(temporary,'empty');
 execFileSync('python3',[path.join(root,'build.py'),'--configs-dir',configs,'--output',empty],{cwd:root,stdio:'pipe'});
 let tabs;
 // A cold CI runner can take longer than five seconds to launch Chrome.
 const startupDeadline=Date.now()+30_000;
 while(Date.now()<startupDeadline){
  try{tabs=await(await fetch('http://127.0.0.1:9227/json/list')).json();if(tabs.some(t=>t.type==='page'))break;}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 assert.ok(tabs?.some(t=>t.type==='page'),'Start an isolated Chrome session on port 9227');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map(),errors=[],network=[];
 ws.addEventListener('message',e=>{
  const m=JSON.parse(e.data);
  if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
  else if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))network.push(m.params.request.url);
 });
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const change=(selector,value)=>evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
 const navigate=async url=>{await send('Page.navigate',{url});for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,50));if(await evaluate("document.querySelector('#view')?.textContent.length>0"))return;}throw Error('Dashboard did not render');};
 await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
 await navigate(pathToFileURL(path.join(empty,'index.html')).href);
 assert.equal(await evaluate("document.querySelector('#modelA').options.length"),0);
 assert.equal(await evaluate("document.querySelector('#cards').hidden"),true);
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Compare your evaluation results/);
 assert.equal(await evaluate("document.querySelector('#configPreset').options.length"),3);
 for(const view of ['categories','languages','comparisons','config','warnings','score'])await click('[data-view='+view+']');
 await change('#configPreset','1');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 const upload=async(selector,content,name)=>evaluate(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)}));const e=document.querySelector(${JSON.stringify(selector)});e.files=dt.files;if(e.id==='modelFile')await e.onchange({target:e});else await document.querySelector('#view').onchange({target:e});})()`);
 await upload('#modelFile',fs.readFileSync(path.join(root,'examples/scores.csv'),'utf8'),'scores.csv');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 assert.equal(await evaluate("document.querySelector('#modelA').value"),'Example A');
 assert.equal(await evaluate("document.querySelector('#modelB').value"),'Example B');
 assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'0');
 assert.equal(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent"),'-2.50');
 const original=await evaluate("document.querySelector('#cards').textContent");
 await change('#configPreset','2');
 assert.match(await evaluate("document.querySelector('#error').textContent"),/Invalid score/);
 assert.equal(await evaluate("document.querySelector('#configPreset').value"),'1');
 assert.equal(await evaluate("document.querySelector('#cards').textContent"),original);
 await click('[data-view=config]');
 const uploaded=structuredClone(fixture);uploaded.name='Temporary config';uploaded.evals[0].normalize.min=0;
 await upload('#configFile',serializeConfig(uploaded),'temporary.yaml');
 assert.equal(await evaluate("document.querySelector('#configPreset').value"),'custom');
 assert.notEqual(await evaluate("document.querySelector('#cards').textContent"),original);
 await change('#configPreset','1');assert.equal(await evaluate("document.querySelector('#cards').textContent"),original);
 await click('#clearModels');assert.equal(await evaluate("document.querySelector('#modelA').options.length"),0);
 await change('#configPreset','2');assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 await upload('#modelFile',fs.readFileSync(path.join(root,'examples/scores.csv'),'utf8'),'bad-for-config.csv');
 assert.match(await evaluate("document.querySelector('#error').textContent"),/Invalid score/);
 assert.equal(await evaluate("document.querySelector('#modelA').options.length"),0);
 // A shared-results build embeds both models and defaults to the real comparison.
 const results=path.join(temporary,'results');fs.mkdirSync(results);
 fs.copyFileSync(path.join(root,'examples/scores.csv'),path.join(results,'example.csv'));
 const shared=path.join(temporary,'shared');
 execFileSync('python3',[path.join(root,'build.py'),'--results-dir',results,'--config',path.join(root,'configs/example.yaml'),'--output',shared],{cwd:root,stdio:'pipe'});
 await navigate(pathToFileURL(path.join(shared,'index.html')).href);
 assert.equal(await evaluate("document.querySelector('#modelB').value"),'Example B');
 for(const view of ['score','categories','languages','comparisons','config','warnings'])await click('[data-view='+view+']');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 assert.deepEqual(errors,[]);assert.deepEqual(network,[],'Loading and comparing local files must not send HTTP requests');
 console.log('Public browser checks passed: empty start, shared models, config choices, temporary uploads, rollback, clear models and no uploads.');
}finally{
 ws?.close();fs.rmSync(temporary,{recursive:true,force:true});
}
