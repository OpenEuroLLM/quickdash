// Public-fixture browser checks: no private evaluation export is required.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{parseCatalogue,serializeCatalogue}=require('../app/eval_config.js'),{parseWeightProfile,serializeWeightProfile,serializeSuite}=require('../app/suite_config.js');
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quickdash-browser-'));
let ws;
try{
 const fixture=parseCatalogue(fs.readFileSync(path.join(root,'configs/examples/catalogue.yaml'),'utf8'));
 fixture.evals[0].match.regex='example_reasoning_(en|fr|de)';
 fixture.languages[1].tasks.push('example_reasoning_de');
 const weighting=parseWeightProfile(fs.readFileSync(path.join(root,'configs/examples/weights.yaml'),'utf8'));
 const profiles=path.join(temporary,'weights');fs.mkdirSync(profiles);
 fs.copyFileSync(path.join(root,'configs/weights/oellm.yaml'),path.join(profiles,'oellm.yaml'));
 fs.writeFileSync(path.join(profiles,'default.txt'),'oellm.yaml\n');
 fs.writeFileSync(path.join(profiles,'example.yaml'),serializeWeightProfile(weighting));
 const empty=path.join(temporary,'empty');
 execFileSync('python3',['-m','app.build','--weights-dir',profiles,'--output',empty],{cwd:root,stdio:'pipe'});
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
 await send('Runtime.discardConsoleEntries');
 await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
 await navigate(pathToFileURL(path.join(empty,'index.html')).href);
 assert.equal(await evaluate("document.querySelector('#modelA').options.length"),0);
 assert.equal(await evaluate("document.querySelector('#cards').hidden"),true);
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Compare your evaluation results/);
 assert.equal(await evaluate("document.querySelector('#suitePreset').options.length"),2);
 assert.equal(await evaluate("document.querySelector('#suitePreset').selectedOptions[0].textContent"),'Any available');
 for(const view of ['categories','languages','comparisons','config','warnings','score'])await click('[data-view='+view+']');
 const upload=async(selector,content,name)=>evaluate(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)}));const e=document.querySelector(${JSON.stringify(selector)});e.files=dt.files;if(e.id==='modelFile')await e.onchange({target:e});else await document.querySelector('#view').onchange({target:e});})()`);
 await click('[data-view=config]');await upload('#configFile',serializeCatalogue(fixture),'catalogue.yaml');
 await change('#weightPreset','1');
 await upload('#modelFile',fs.readFileSync(path.join(root,'examples/scores.csv'),'utf8'),'scores.csv');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 assert.equal(await evaluate("document.querySelector('#modelA').value"),'Example A');
 assert.equal(await evaluate("document.querySelector('#modelB').value"),'Example B');
 assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'0');
 assert.equal(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent"),'-2.50');
 const original=await evaluate("document.querySelector('#cards').textContent");
 // A catalogue without loaded data is not a coverage requirement.
 const extended=structuredClone(fixture);extended.evals.push({...extended.evals[0],name:'Unused eval',match:{name:'unused'}});
 await upload('#configFile',serializeCatalogue(extended),'extended.yaml');
 assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'0');
 const invalid=structuredClone(fixture);invalid.evals[0].score.scale=.1;
 await upload('#configFile',serializeCatalogue(invalid),'invalid.yaml');
 assert.match(await evaluate("document.querySelector('#error').textContent"),/Invalid score/);
 assert.equal(await evaluate("document.querySelector('#cards').textContent"),original);
 // Named sets check requirements missing from both models and retain extras for inspection.
 const fixed={version:1,name:'Example required set',mode:'fixed',evals:[{name:'Example reasoning',variants:[{task:'example_reasoning_en',n_shot:0},{task:'example_reasoning_de',n_shot:0}]}]};
 await upload('#suiteFile',serializeSuite(fixed),'set.yaml');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 assert.match(await evaluate("document.querySelector('#coverage').textContent"),/INCOMPLETE.*1\/2 requirements shared.*4 extra/);
 assert.equal(await evaluate("document.querySelector('#weightPreset').value"),'1');
 await click('[data-view=warnings]');
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Missing suite data.*example_reasoning_de/s);
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Not used/);
 await click('[data-view=config]');
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Example math/);
 await click('[data-view=score]');await change('[data-weight=Reasoning]','.8');await change('[data-weight=Math]','.2');
 await change('#suitePreset','0');
 assert.equal(await evaluate("document.querySelector('[data-weight=Reasoning]').value"),'0.8');
 await click('[data-view=config]');
 const unavailable={...fixed,evals:[{name:'Absent eval'}]};
 await upload('#suiteFile',serializeSuite(unavailable),'invalid-set.yaml');
 assert.match(await evaluate("document.querySelector('#error').textContent"),/no catalogue rule/);
 assert.equal(await evaluate("document.querySelector('#suitePreset').value"),'0');
 await upload('#suiteFile',serializeSuite(fixed),'set.yaml');
 await change('#weightPreset','0');
 assert.equal(await evaluate("document.querySelector('#suitePreset').value"),'custom');
 await change('#weightPreset','1');
 await evaluate(`window.originalCreate=URL.createObjectURL;window.originalClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{window.exportBlob=b;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};`);
 await click('#exportConfig');assert.deepEqual(await evaluate('exportBlob.text().then(parseCatalogue)'),extended);
 await click('#exportSuite');assert.deepEqual(await evaluate('exportBlob.text().then(parseSuite)'),fixed);
 await click('#exportWeights');assert.deepEqual(await evaluate('exportBlob.text().then(parseWeightProfile)'),{...weighting,english_weights:weighting.english_weights,aggregate:'standard'});
 await evaluate('URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick');
 await change('#suitePreset','0');await click('#clearModels');
 assert.equal(await evaluate("document.querySelector('#modelA').options.length"),0);
 await click('[data-view=config]');await upload('#configFile',serializeCatalogue(invalid),'small.yaml');
 await upload('#modelFile',fs.readFileSync(path.join(root,'examples/scores.csv'),'utf8'),'bad-for-config.csv');
 assert.match(await evaluate("document.querySelector('#error').textContent"),/Invalid score/);
 assert.equal(await evaluate("document.querySelector('#modelA').options.length"),0);
 // A shared-results build embeds both models and defaults to the real comparison.
 const results=path.join(temporary,'results');fs.mkdirSync(results);
 fs.copyFileSync(path.join(root,'examples/scores.csv'),path.join(results,'example.csv'));
 const shared=path.join(temporary,'shared');
 execFileSync('python3',['-m','app.build','--results-dir',results,'--catalogue',path.join(root,'configs/examples/catalogue.yaml'),'--weights',path.join(root,'configs/examples/weights.yaml'),'--eval-set',path.join(root,'configs/sets/any-available.yaml'),'--output',shared],{cwd:root,stdio:'pipe'});
 await navigate(pathToFileURL(path.join(shared,'index.html')).href);
 assert.equal(await evaluate("document.querySelector('#modelB').value"),'Example B');
 for(const view of ['score','categories','languages','comparisons','config','warnings'])await click('[data-view='+view+']');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 // Starting directly on a named subset must retain out-of-set data, including the demo.
 const subset=path.join(temporary,'subset.yaml');
 fs.writeFileSync(subset,serializeSuite({version:1,name:'Reasoning only',mode:'fixed',evals:[{name:'Example reasoning'}]}));
 const fixedBuild=path.join(temporary,'fixed-build');
 execFileSync('python3',['-m','app.build','--results-dir',results,'--catalogue',path.join(root,'configs/examples/catalogue.yaml'),'--weights',path.join(root,'configs/examples/weights.yaml'),'--eval-set',subset,'--output',fixedBuild],{cwd:root,stdio:'pipe'});
 await navigate(pathToFileURL(path.join(fixedBuild,'index.html')).href);
 assert.match(await evaluate("document.querySelector('#coverage').textContent"),/Reasoning only.*Complete.*2 extra measurements excluded/);
 await click('[data-view=config]');assert.match(await evaluate("document.querySelector('#view').textContent"),/Example math/);
 // Caveats follow comparison membership; excluded data remains inspectable with its caveat.
 const caveated=structuredClone(fixture);caveated.evals[1].warning='Example math requires review.';
 await upload('#configFile',serializeCatalogue(caveated),'caveat.yaml');
 await click('[data-view=warnings]');
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Not used.*Example math/s);
 assert.doesNotMatch(await evaluate("document.querySelector('#view').textContent"),/Example math requires review/);
 await click('[data-view=config]');
 assert.match(await evaluate("document.querySelector('[data-eval=\"Example math\"] .normalization-info').textContent"),/Example math requires review/);
 await upload('#suiteFile',serializeSuite({version:1,name:'Freeform',mode:'available'}),'freeform.yaml');
 await click('[data-view=warnings]');
 assert.match(await evaluate("document.querySelector('#view').textContent"),/Config caveat.*Example math requires review/s);
 // Weighted components use fictional scores and remain inspectable after exclusion.
 await click('#clearModels');await click('[data-view=config]');
 const levels=['low','medium','high','top'];
 const componentCatalogue={version:1,name:'Component example',evals:[{name:'Poly example',category:'Reasoning',match:{regex:'poly_.+'},metric:'acc',filter:'none',score:{scale:1},aggregation:{components:levels.map((name,i)=>({name,match:{regex:'poly_.+_'+name},relative_weight:2**i})),note:'Fictional component fixture.'}}],languages:['en','de'].map((lang,i)=>({tasks:levels.map(l=>'poly_'+lang+'_'+l),scope:'single',language:i?'deu_Latn':'eng_Latn'}))};
 await upload('#configFile',serializeCatalogue(componentCatalogue),'components.yaml');
 await upload('#weightsFile',serializeWeightProfile({version:1,name:'Component weights',weights:{Reasoning:1},english_weights:{Reasoning:.5}}),'weights.yaml');
 const componentCSV=(model,omit=false)=>['checkpoint,task,metric,filter,n_shot,harness,backend,value',...['en','de'].flatMap(lang=>levels.flatMap((l,i)=>omit&&lang==='en'&&l==='top'?[]:[`${model},poly_${lang}_${l},acc,none,0,test,cpu,${model==='Component A'?(lang==='en'?[.6,.3,.15,0][i]:.2):(lang==='en'?.3:.1)}`]))].join('\n');
 await upload('#modelFile',componentCSV('Component A'),'a.csv');
 await upload('#modelFile',componentCSV('Component B'),'b.csv');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.score-card strong')].map(e=>e.textContent)"),['16.00','20.00','-4.00']);
 for(const view of ['categories','languages']){
  await click('[data-view='+view+']');
  const parent= view==='categories'?'[data-kind=eval][data-label="Poly example"]':'[data-kind=language][data-label=eng_Latn]';
  const expected=view==='categories'?'16.00':'12.00';
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(parent)}+' > summary').children[2].textContent`),expected);
  const leaf='[data-kind=variant][data-label=poly_en_low]';
  assert.deepEqual(await evaluate(`Array.from(document.querySelector(${JSON.stringify(leaf)}).children).slice(2).map(e=>e.textContent)`),['60.00','30.00','30.00','1 · 6.67%','4.000','2.000']);
  await evaluate("document.querySelectorAll('.breakdown-node').forEach(e=>e.open=true)");
  const aligned=await evaluate(`{const header=[...document.querySelector('.tree-head').children].map(e=>e.getBoundingClientRect().right),row=[...document.querySelector(${JSON.stringify(leaf)}).children].map(e=>e.getBoundingClientRect().right);header.every((x,i)=>i===0||Math.abs(x-row[i])<2)}`);
  assert.equal(aligned,true);
  if(view==='languages'){await click('[data-language-sort=componentA]');assert.match(await evaluate("document.querySelector('#view').textContent"),/Group contribution/);}
 }
 await click('[data-view=config]');
 assert.match(await evaluate("document.querySelector('.component-info').textContent"),/sum\(relative_weight × normalized score\) \/ 15/);
 await evaluate(`window.originalCreate=URL.createObjectURL;window.originalClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{window.exportBlob=b;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};`);
 await click('#exportConfig');assert.deepEqual(await evaluate('exportBlob.text().then(parseCatalogue)'),componentCatalogue);
 await evaluate('URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick');
 await upload('#configFile',serializeCatalogue(componentCatalogue).replace('relative_weight: 1','relative_weight: 0'),'invalid-components.yaml');
 assert.match(await evaluate("document.querySelector('#error').textContent"),/positive/);
 assert.equal(await evaluate("document.querySelector('.score-card strong').textContent"),'16.00');
 await upload('#modelFile',componentCSV('Component C',true),'incomplete.csv');
 assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.score-card strong')].map(e=>e.textContent)"),['20.00','10.00','10.00']);
 await click('[data-view=warnings]');assert.match(await evaluate("document.querySelector('#view').textContent"),/Incomplete components.*top: missing/s);
 await click('[data-view=config]');
 await click('[data-task=poly_en_low] > summary');
 assert.match(await evaluate("document.querySelector('[data-task=poly_en_low] .task-details').textContent"),/Excluded from comparison/);
 const componentSet={version:1,name:'All component tasks',mode:'fixed',evals:[{name:'Poly example',variants:componentCatalogue.languages.flatMap(g=>g.tasks.map(task=>({task,n_shot:0})))}]};
 await upload('#suiteFile',serializeSuite(componentSet),'components-set.yaml');
 assert.match(await evaluate("document.querySelector('#coverage').textContent"),/INCOMPLETE.*4\/8 requirements shared/);
 await click('[data-view=comparisons]');await change('#compareGroup','variant');await change('#compareMeasure','weighted');
 assert.match(await evaluate("document.querySelector('#view').textContent"),/10.0000 index points/);
 assert.deepEqual(errors,[]);assert.deepEqual(network,[],'Loading and comparing local files must not send HTTP requests');
 console.log('Public browser checks passed: empty start, shared models, independent weights and eval sets, required coverage, temporary uploads, rollback, clear models and no uploads.');
}finally{
 ws?.close();fs.rmSync(temporary,{recursive:true,force:true});
}
