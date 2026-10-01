import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const initialScore=JSON.parse(fs.readFileSync(root+'output/analysis.json','utf8')).models[0].score.toFixed(2);
const tabs=await(await fetch('http://127.0.0.1:9227/json/list')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(m.error);else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const change=(selector,value)=>evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
const screenshot=async name=>fs.writeFileSync(root+'output/'+name+'.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
await send('Runtime.enable');await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:new URL('../output/index.html',import.meta.url).href});
for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('#cards strong')"))break;await new Promise(r=>setTimeout(r,100));}
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),initialScore);
assert.equal(await evaluate("document.querySelectorAll('[data-view]').length"),6);
assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'5');
assert.equal(await evaluate("document.querySelector('#filters').hidden"),true);
assert.match(await evaluate("document.querySelector('#weightEditor .notice').textContent"),/saved but inactive/);
const englishScore=JSON.parse(fs.readFileSync(root+'output/analysis.json','utf8')).aggregates.english_category[0].score.toFixed(2);
const perEvalScore=JSON.parse(fs.readFileSync(root+'output/analysis.json','utf8')).aggregates.english_eval[0].score.toFixed(2);
assert.equal(await evaluate("document.querySelectorAll('[data-aggregate]').length"),3);
await click('[data-aggregate=english_eval]');
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),perEvalScore);
assert.match(await evaluate("document.querySelector('#weightEditor .notice').textContent"),/active now: inside each eval/);
await click('#englishComponents > summary');
assert.equal(await evaluate("document.querySelector('#englishComponents th').textContent"),'Eval');
assert.equal(await evaluate("document.querySelector('[data-english-weight=Code]').value"),'0.5');
await click('[data-aggregate=english_category]');
assert.match(await evaluate("document.querySelector('#weightEditor .notice').textContent"),/They are active now/);
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),englishScore);
assert.equal(await evaluate("document.querySelector('[data-aggregate=english_category]').getAttribute('aria-pressed')"),'true');
await change('[data-english-weight="Math"]','0.8');
assert.notEqual(await evaluate("document.querySelector('#cards strong').textContent"),englishScore);
await change('[data-english-weight="Math"]','0.5');
await change('[data-english-weight="Code"]','0.5');
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),englishScore);
assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'5');
assert.match(await evaluate("document.querySelector('#view').textContent"),/English weighting group only · full weight/);
await click('#weightEditor > summary');
assert.equal(await evaluate("document.querySelectorAll('#weights tbody tr').length"),9);
assert.ok(await evaluate("[...document.querySelectorAll('#weights tbody tr')].every(r=>r.cells.length===3&&r.querySelectorAll('input').length===2)"));
await evaluate("document.querySelector('#weightEditor').scrollIntoView()");await screenshot('weight-editor-preview');
await click('#englishComponents > summary');
assert.match(await evaluate("document.querySelector('#englishComponents').textContent"),/English A.*Other A/s);
await click('[data-aggregate=standard]');
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),initialScore);

assert.equal(await evaluate("document.querySelectorAll('svg').length"),0);
await click('[data-score-category="Reading"]');
assert.equal(await evaluate("document.querySelector('#scoreCategory').value"),'Reading');
assert.match(await evaluate("document.querySelector('#view').textContent"),/SQuAD v2/);
await evaluate("document.querySelector('#weightEditor').open=true");
await change('[data-weight="Code"]','.2');
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),'—');
assert.equal(await evaluate("document.querySelector('#weightEditor').open"),true);
await click('#resetWeights');
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),initialScore);
await evaluate("document.querySelector('#weightEditor').open=false;window.scrollTo(0,0)");
await screenshot('score-preview');

assert.equal(await evaluate("document.querySelector('#breakdownBy')"),null);
// Collapsed hierarchies have aggregates and expand through the requested orders.
await click('[data-view=categories]');
assert.equal(await evaluate("document.querySelectorAll('.breakdown-tree > .breakdown-node').length"),9);
assert.equal(await evaluate("document.querySelectorAll('.breakdown-node[open]').length"),0);
const categoryPath='.breakdown-tree > [data-label="Translation"]';
await click(categoryPath+' > summary');
const evalPath=categoryPath+' > [data-kind="eval"]';
await click(evalPath+' > summary');
const englishPath=evalPath+' > [data-label="eng_Latn"]';
await click(englishPath+' > summary');
await click(englishPath+' > [data-label="From eng_Latn"] > summary');
assert.ok(await evaluate(`document.querySelector(${JSON.stringify(englishPath+' > [data-label="From eng_Latn"]')}).innerText.includes('eng_Latn → spa_Latn')`));
assert.ok(await evaluate(`document.querySelector(${JSON.stringify(englishPath+' > [data-label="To eng_Latn"]')})!==null`));
await evaluate("document.querySelector('#view').scrollIntoView()");await screenshot('category-preview');
await click('[data-view=languages]');
assert.ok(await evaluate("document.querySelectorAll('.breakdown-tree > .breakdown-node').length>=38"));
assert.equal(await evaluate("document.querySelectorAll('.breakdown-node[open]').length"),0);
assert.ok(!(await evaluate("document.querySelector('.breakdown-tree').textContent")).includes('Unknown'));
await click('.breakdown-tree > [data-label="eng_Latn"] > summary');
await click('.breakdown-tree > [data-label="eng_Latn"] > [data-label="Translation"] > summary');
await click('.breakdown-tree > [data-label="eng_Latn"] > [data-label="Translation"] > [data-kind="eval"] > summary');
await evaluate("document.querySelector('#view').scrollIntoView()");await screenshot('language-preview');
// Sort every language column in both directions, including expanded descendants.
const languageOpen=await evaluate("[...document.querySelectorAll('.breakdown-node[open]')].map(n=>n.dataset.nodeKey).sort()");
const languageCards=await evaluate("document.querySelector('#cards').textContent");
for(const [field,index] of [['label',0],['count',1],['a',2],['b',3],['delta',4]]){
 for(let i=0;i<2;i++){
  const pageBefore=await evaluate('scrollY');
  await click('[data-language-sort="'+field+'"]');
  const direction=await evaluate(`document.querySelector('[data-language-sort="${field}"]').parentElement.getAttribute('aria-sort')`);
  const groups=await evaluate(`(()=>{const parents=[document.querySelector('.breakdown-tree'),...document.querySelectorAll('.breakdown-node')];return parents.map(p=>[...p.children].filter(n=>n.matches('.breakdown-node,.tree-leaf')).map(n=>${index}===0?(n.dataset.label==='mul'?'Multilingual (pooled)':n.dataset.label):Number((n.querySelector(':scope > summary')||n).children[${index}].textContent)));})()`);
  for(const values of groups){const expected=[...values].sort((a,b)=>(direction==='ascending'?1:-1)*(typeof a==='string'?a.localeCompare(b):a-b));assert.deepEqual(values,expected,field+' '+direction);}
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.breakdown-node[open]')].map(n=>n.dataset.nodeKey).sort()"),languageOpen);
  assert.equal(await evaluate("document.querySelector('#cards').textContent"),languageCards);
  assert.ok(Math.abs(await evaluate('scrollY')-pageBefore)<2,'language sorting reset scroll');
 }
}
await screenshot('language-sort-preview');

await change('#language','fin_Latn');
assert.equal(await evaluate("document.querySelectorAll('.breakdown-tree > .breakdown-node').length"),1);
await change('#direction','to');
assert.ok(await evaluate("[...document.querySelectorAll('[data-kind=direction]')].every(n=>n.dataset.label==='To fin_Latn')"));
await click('#clear');
await click('[data-view=comparisons]');
assert.equal(await evaluate("document.querySelector('#compareGroup').value"),'eval');
assert.equal(await evaluate("document.querySelectorAll('.comparison-row').length"),45);
assert.ok(await evaluate("!!document.querySelector('[data-chart-eval=\"Global MMLU\"]')&&!!document.querySelector('[data-chart-eval=MMLU]')"));
// Clickable headers sort every displayed value and expose their active direction.
for(const [field,index] of [['label',0],['category',1],['a',2],['b',3],['rawDelta',4],['weightedDelta',5],['languageCount',6]]){
 for(let clickCount=0;clickCount<2;clickCount++){
  await click('[data-sort-column="'+field+'"]');
  const order=await evaluate(`document.querySelector('[data-sort-column="${field}"]').closest('th').getAttribute('aria-sort')`);
  const cells=await evaluate(`[...document.querySelectorAll('.comparison-row')].map(r=>r.cells[${index}].textContent)`);
  const numbers=index>1,values=numbers?cells.map(v=>parseFloat(v)||0):cells;
  const expected=[...values].sort((a,b)=>(order==='ascending'?1:-1)*(numbers?a-b:a.localeCompare(b)));
  assert.deepEqual(values,expected,field+' '+order);
 }
}
assert.equal(await evaluate("document.querySelector('[data-chart-eval=HumanEval]').cells[1].textContent"),'Code');
// Sections use page scrolling; expanding retains the row position without a nested vertical scroller.
await change('#compareSort','name');
await evaluate(`{const button=document.querySelector('[data-expand-eval="HellaSwag"]'),box=button.closest('.table-scroll');button.scrollIntoView({block:'center'});window.scrollBefore={top:box.scrollTop,left:box.scrollLeft,page:scrollY,button:button.getBoundingClientRect().top};}`);
assert.ok(await evaluate('scrollBefore.page>100'));
await click('[data-expand-eval="HellaSwag"]');
assert.ok(await evaluate(`(()=>{const button=document.querySelector('[data-expand-eval="HellaSwag"]'),box=button.closest('.table-scroll');return Math.abs(button.getBoundingClientRect().top-scrollBefore.button)<2&&Math.abs(scrollY-scrollBefore.page)<2&&box.scrollTop===0})()`),'expansion moved the clicked row');
assert.ok(await evaluate("document.querySelectorAll('.comparison-detail').length>1"));
assert.match(await evaluate("document.querySelector('.comparison-detail').textContent"),/Latn|Cyrl/);
await click('[data-expand-eval="HellaSwag"]');
assert.equal(await evaluate("document.querySelectorAll('.comparison-row').length"),45);
assert.ok(await evaluate(`Math.abs(document.querySelector('[data-expand-eval="HellaSwag"]').getBoundingClientRect().top-scrollBefore.button)<2`),'collapse moved the clicked row');
assert.equal(await evaluate(`document.querySelector('[data-chart-eval="HumanEval"] .language-count').textContent`),'1');
assert.ok(await evaluate(`Number(document.querySelector('[data-chart-eval="FLORES200"] .language-count').textContent)>30`));
assert.equal(await evaluate(`document.querySelector('[data-chart-eval="Language ID"] .language-count').textContent`),'1 pooled');
await change('#language','fin_Latn');
assert.equal(await evaluate(`document.querySelector('[data-chart-eval="Belebele"] .language-count').textContent`),'1');
assert.equal(await evaluate(`document.querySelector('[data-chart-eval="FLORES200"] .language-count').textContent`),'2');
await click('#clear');await change('#compareSort','descending');
await change('#compareGroup','variant');
assert.equal(await evaluate("document.querySelectorAll('.comparison-row').length"),403);
assert.equal(await evaluate("document.querySelectorAll('.delta-track').length"),403);
const original=await evaluate("document.querySelector('#cards').textContent");
await change('#category','Code');
assert.equal(await evaluate("document.querySelectorAll('.comparison-row').length"),4);
assert.equal(await evaluate("document.querySelector('#cards').textContent"),original);
await click('#clear');await change('#compareMeasure','weighted');
let values=await evaluate("[...document.querySelectorAll('.comparison-row')].map(r=>Number(r.cells[5].textContent))");
assert.deepEqual(values,[...values].sort((a,b)=>b-a));
await change('#compareSort','ascending');
values=await evaluate("[...document.querySelectorAll('.comparison-row')].map(r=>Number(r.cells[5].textContent))");
assert.deepEqual(values,[...values].sort((a,b)=>a-b));
await change('#compareMeasure','raw');await change('#compareSort','descending');
values=await evaluate("[...document.querySelectorAll('.comparison-row')].map(r=>Number(r.cells[4].textContent))");
assert.deepEqual(values,[...values].sort((a,b)=>b-a));
await change('#compareGroup','eval');
assert.equal(await evaluate("document.querySelectorAll('.comparison-row').length"),45);
await click('[data-expand-eval="HumanEval"]');
assert.equal(await evaluate("document.querySelectorAll('.comparison-detail').length"),1);
await click('[data-expand-eval="HumanEval"]');
await change('#compareGroup','variant');
await click('#clear');
await evaluate("document.querySelector('#view').scrollIntoView()");await screenshot('comparison-preview');
await evaluate("document.querySelector('#search').value='no-such-eval';document.querySelector('#search').oninput()");
assert.match(await evaluate("document.querySelector('#view').textContent"),/No matched variants/);
await click('#clear');

await click('[data-view=config]');
assert.equal(await evaluate("document.querySelectorAll('.catalogue-task').length"),0);
assert.match(await evaluate("document.querySelector('#filterStatus').textContent"),/1556 of 1556 task names · 2124 metric rows/);
assert.ok(await evaluate("document.querySelectorAll('#view *').length<2500"),'collapsed catalogue rendered too much content');
assert.equal(await evaluate("document.querySelectorAll('.catalogue-metric').length"),0);
assert.match(await evaluate("document.querySelector('[data-eval=\"ARC Challenge\"] > summary .scoring-options').textContent"),/Selected: acc_norm.*Other available metrics: acc/);

const humanSummary=await evaluate("document.querySelector('[data-eval=HumanEval] > summary').textContent");
assert.match(humanSummary,/Selected: python_pass@1.*0-shot · no examples.*Other available metrics: sh_pass@1/);
assert.ok(!humanSummary.includes('all shots')&&!humanSummary.includes('(empty)'));
const humanCalculation=await evaluate("document.querySelector('[data-eval=HumanEval] .normalization-info').textContent");
assert.match(humanCalculation,/value − random_score.*1 − random_score/);
assert.match(humanCalculation,/random_score = 0/);
assert.ok(!humanCalculation.includes('value / 1')&&!humanCalculation.includes('1 − 0')&&!humanCalculation.includes('raw fraction'));
assert.equal(await evaluate("document.querySelector('[data-eval=HumanEval] .baseline-rationale').open"),false);

await click('[data-eval="HumanEval"] > summary');
await click('[data-eval="HumanEval"] .catalogue-variant > summary');
assert.equal(await evaluate("[...document.querySelectorAll('.catalogue-metric')].find(r=>r.cells[1].textContent==='sh_pass@1').querySelector('.source-score').textContent"),String(await evaluate("DATA.rows.find(r=>r.metric==='sh_pass@1').value")));
assert.match(await evaluate("document.querySelector('[data-eval=HumanEval]').innerText"),/eng_Latn/);
assert.match(await evaluate("document.querySelector('[data-eval=HumanEval]').innerText"),/python_pass@1/);
assert.match(await evaluate("document.querySelector('[data-eval=HumanEval]').innerText"),/sh_pass@1/);
await evaluate("document.querySelector('#search').value='mmlu_abstract_algebra';document.querySelector('#search').oninput()");
assert.equal(await evaluate("document.querySelectorAll('.catalogue-task').length"),1);
assert.match(await evaluate("document.querySelector('#view').textContent"),/Excluded/);
await click('#clear');
// Config import changes metric/category/normalization/languages atomically.
await evaluate(`window.loadTestConfig=async config=>{for(const [selector,object] of [['#weightsFile',Object.fromEntries(Object.entries(config).filter(([k])=>['version','name','weights','english_weights','aggregate'].includes(k)))],['#configFile',Object.fromEntries(Object.entries(config).filter(([k])=>!['weights','english_weights','aggregate'].includes(k)))]]){const dt=new DataTransfer();dt.items.add(new File([jsyaml.dump(object,{schema:jsyaml.CORE_SCHEMA})],'config.yaml'));const e=document.querySelector(selector);e.files=dt.files;await document.querySelector('#view').onchange({target:e});if(document.querySelector('#error').textContent)break;}};`);
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);c.name='Browser custom config';const he=c.evals.find(e=>e.name==='HumanEval');he.metric='sh_pass@1';he.category='Math';c.evals.find(e=>e.name==='HellaSwag').normalize={min:.25,max:1};const group=c.languages.find(g=>g.tasks.includes('AIME24'));group.tasks=group.tasks.filter(t=>t!=='AIME24');c.languages=c.languages.filter(g=>g.tasks.length);c.languages.push({tasks:['AIME24'],scope:'single',language:'fin_Latn'});await loadTestConfig(c);})()`);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
assert.notEqual(await evaluate("document.querySelector('#cards strong').textContent"),initialScore);
assert.match(await evaluate("document.querySelector('[data-eval=HumanEval] > summary').textContent"),/Math.*sh_pass@1/);
await evaluate("document.querySelector('#search').value='AIME24';document.querySelector('#search').oninput()");
assert.match(await evaluate("document.querySelector('.catalogue-task').textContent"),/fin_Latn/);
const customScore=await evaluate("document.querySelector('#cards').textContent");
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);c.languages.push(c.languages[0]);await loadTestConfig(c);})()`);
assert.match(await evaluate("document.querySelector('#error').textContent"),/Duplicate language/);
assert.equal(await evaluate("document.querySelector('#cards').textContent"),customScore);
// A config valid in shape but invalid for the loaded rows must also roll back.
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);c.evals[0].score.scale=.001;await loadTestConfig(c);})()`);
assert.match(await evaluate("document.querySelector('#error').textContent"),/Invalid score/);
assert.equal(await evaluate("document.querySelector('#cards').textContent"),customScore);
await evaluate(`loadTestConfig(DATA.scheme)`);
assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),initialScore);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
// Removing one task's configured metric warns even when other languages are selected.
await evaluate(`(async()=>{const rows=DATA.rows.filter(r=>!(r.task==='arc_challenge_mt_cs'&&r.metric==='acc_norm')).map(r=>({...r,checkpoint:'Missing Czech metric'}));const fields=Object.keys(rows[0]);const csv=[fields,...rows.map(r=>fields.map(f=>r[f]))].map(row=>row.map(v=>JSON.stringify(String(v??''))).join(',')).join('\\n');const dt=new DataTransfer();dt.items.add(new File([csv],'missing.csv'));const e=document.querySelector('#modelFile');e.files=dt.files;await e.onchange({target:e});})()`);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'11');
assert.match(await evaluate("document.querySelector('[data-eval=\"ARC Challenge\"] > summary').textContent"),/1 missing scoring/);
await click('[data-eval="ARC Challenge"] > summary');
await click('[data-task=arc_challenge_mt_cs] > summary');
assert.match(await evaluate("document.querySelector('.has-missing-field').textContent"),/arc_challenge_mt_cs.*Missing Czech metric.*expected acc_norm/s);
assert.notEqual(await evaluate("document.querySelector('#cards strong').textContent"),'—');
assert.match(await evaluate("document.querySelector('#coverage').textContent"),/excluded: 1 from A, 0 from B/);
await click('[data-view=warnings]');
assert.match(await evaluate("document.querySelector('#view').textContent"),/Missing scoring field.*arc_challenge_mt_cs/s);
assert.match(await evaluate("document.querySelector('#view').textContent"),/Comparison coverage.*ARC Challenge/s);
await evaluate(`(async()=>{const fields=['checkpoint','task','metric','filter','n_shot','harness','backend','value'];const rows=DATA.rows.filter(r=>r.eval!=='IFEval').map(r=>({...r,checkpoint:'Missing IFEval'}));const csv=[fields.join(','),...rows.map(r=>fields.map(f=>r[f]).join(','))].join('\\n');const dt=new DataTransfer();dt.items.add(new File([csv],'missing-eval.csv'));const e=document.querySelector('#modelFile');e.files=dt.files;await e.onchange({target:e});})()`);
assert.notEqual(await evaluate("document.querySelector('#cards strong').textContent"),'—');
assert.equal(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent"),'0.00');
assert.doesNotMatch(await evaluate("document.querySelector('#view').textContent"),/No eval data/);
assert.match(await evaluate("document.querySelector('#view').textContent"),/Comparison coverage.*IFEval/s);
for(const mode of ['standard','english_eval','english_category']){await click('[data-aggregate='+mode+']');assert.equal(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent"),'0.00');}
// Reload restores the original export before the remaining import checks.
await send('Page.reload');
for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate("document.querySelector('#warningCount')?.textContent==='5'"))break;}
await click('[data-view=config]');
await evaluate(`window.loadTestConfig=async config=>{for(const [selector,object] of [['#weightsFile',Object.fromEntries(Object.entries(config).filter(([k])=>['version','name','weights','english_weights','aggregate'].includes(k)))],['#configFile',Object.fromEntries(Object.entries(config).filter(([k])=>!['weights','english_weights','aggregate'].includes(k)))]]){const dt=new DataTransfer();dt.items.add(new File([jsyaml.dump(object,{schema:jsyaml.CORE_SCHEMA})],'config.yaml'));const e=document.querySelector(selector);e.files=dt.files;await document.querySelector('#view').onchange({target:e});if(document.querySelector('#error').textContent)break;}};`);
// English shares and the active aggregate are editable and portable in YAML.
await click('[data-view=score]');await click('[data-aggregate=english_category]');await change('[data-english-weight="Reading"]','0.7');
await click('[data-view=config]');
await evaluate(`window.originalCreate=URL.createObjectURL;window.originalClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=blob=>{window.exportBlob=blob;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};`);
await click('#exportWeights');
const englishExport=await evaluate(`exportBlob.text().then(parseWeightProfile)`);
assert.equal(englishExport.english_weights.Reading,.7);assert.equal(englishExport.aggregate,'english_category');
await evaluate(`URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;loadTestConfig(DATA.scheme)`);
assert.equal(await evaluate("document.querySelector('[data-aggregate][aria-pressed=true]').dataset.aggregate"),'standard');
// Export carries edited weights and the explicit language map.
await click('[data-view=score]');
await change('[data-weight="Code"]','.16');await change('[data-weight="Math"]','.14');
await click('[data-view=config]');
await evaluate(`window.originalCreate=URL.createObjectURL;window.originalClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=blob=>{window.exportBlob=blob;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};`);
await click('#exportWeights');
const exported=await evaluate(`exportBlob.text().then(parseWeightProfile)`);
assert.equal(exported.weights.Code,.16);assert.equal(exported.weights.Math,.14);
assert.equal(exported.languages,undefined);
await click('#exportConfig');assert.equal(await evaluate('exportBlob.text().then(parseCatalogue).then(c=>c.languages.flatMap(g=>g.tasks).length)'),1556);
await evaluate(`URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;loadTestConfig(DATA.scheme)`);
// Missing configuration is a warning and exclusion, not a failed import.
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);c.evals.find(e=>e.name==='HumanEval').match={name:'absent_eval_task'};await loadTestConfig(c);})()`);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'6');
assert.equal(await evaluate("document.querySelector('#warningCount').classList.contains('has-warnings')"),true);
await click('[data-view=warnings]');
assert.match(await evaluate("document.querySelector('#view').textContent"),/No config.*HumanEval/);
assert.doesNotMatch(await evaluate("document.querySelector('#view').textContent"),/No eval data/);
assert.equal(await evaluate("document.querySelector('#filters').hidden"),true);
await screenshot('warnings-preview');
await click('[data-view=config]');await evaluate(`loadTestConfig(DATA.scheme)`);
assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'5');
assert.equal(await evaluate("document.querySelector('#warningCount').classList.contains('has-warnings')"),true);
// Warnings expose concrete settings and editable config caveats.
await click('[data-view=warnings]');
assert.match(await evaluate("document.querySelector('#view').textContent"),/Inconsistent scoring settings.*MGSM.*0 shots.*5 shots/s);
assert.match(await evaluate("document.querySelector('#view').textContent"),/Not used.*Global PIQA \(prompted\)/s);
await click('[data-view=config]');
assert.match(await evaluate(`document.querySelector('[data-eval="ARC Challenge"] > summary').textContent`),/Inconsistent scoring settings/);
assert.doesNotMatch(await evaluate(`document.querySelector('[data-eval="SIB-200"] .normalization-info').textContent`),/Metric-selection exception/);
assert.match(await evaluate(`document.querySelector('[data-eval="JEEBench"] > summary').textContent`),/10.50% baseline/);
assert.match(await evaluate(`document.querySelector('[data-eval="JEEBench"] .normalization-info').textContent`),/Table 2/);
assert.match(await evaluate(`document.querySelector('[data-eval="FLORES200"] .normalization-info').textContent`),/0–100 points/g);
assert.match(await evaluate(`document.querySelector('[data-eval="OpenSubtitles"] .normalization-info').textContent`),/0–100 points/g);
await click('[data-eval="Language ID"] > summary');
await click('[data-task="bigbench_language_identification_multiple_choice"] > summary');
assert.match(await evaluate(`document.querySelector('[data-task="bigbench_language_identification_multiple_choice"] .task-details').textContent`),/English-balance group: English \(fallback/);
assert.match(await evaluate(`document.querySelector('[data-task="bigbench_language_identification_multiple_choice"]').closest('tr').textContent`),/Multilingual \(pooled\)/);
await click('[data-eval="MultiBlimp"] > summary');
await click('[data-task="multiblimp_hbs"] > summary');
assert.match(await evaluate(`document.querySelector('[data-task="multiblimp_hbs"] .task-details').textContent`),/English-balance group: Other languages/);
assert.match(await evaluate(`document.querySelector('[data-task="multiblimp_hbs"]').closest('tr').textContent`),/srp_Latn/);
assert.match(await evaluate(`document.querySelector('[data-eval="MultiBlimp"] .normalization-info').textContent`),/Language-grouping approximation.*more speakers/);

await click('[data-eval="Language ID"] > summary');
await click('[data-eval="MultiBlimp"] > summary');

for(const name of ['AIME24','AIME25'])assert.match(await evaluate(`document.querySelector('[data-eval="${name}"] .normalization-info').textContent`),/random_score = 0/);
// Custom caveats survive import/export and can be removed when resolved.
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);delete c.evals.find(e=>e.name==='MultiBlimp').warning;await loadTestConfig(c);})()`);
assert.equal(await evaluate("document.querySelector('#warningCount').textContent"),'4');
await evaluate(`loadTestConfig(DATA.scheme)`);
// Normalization is visible without opening individual language variants.
assert.match(await evaluate(`document.querySelector('[data-eval="SIB-200"] > summary').textContent`),/14.29% baseline/);
await click('[data-eval="SIB-200"] > summary');
assert.match(await evaluate(`document.querySelector('[data-eval="SIB-200"] .normalization-info').textContent`),/seven topic choices/);
assert.ok(await evaluate(`document.querySelector('[data-eval="SIB-200"] .normalization-info a').href.startsWith('https://github.com/')`));
assert.match(await evaluate(`document.querySelector('[data-eval="ARC Challenge"] > summary').textContent`),/25.00% baseline/);
await click('[data-eval="SIB-200"] > summary');
// Header and cell alignment must agree, including the catalogue grid.
assert.ok(await evaluate(`(()=>{const headers=[...document.querySelector('.catalogue-head').children],cells=[...document.querySelector('.catalogue-summary').children];return headers.every((h,i)=>Math.abs(h.getBoundingClientRect().x-cells[i].getBoundingClientRect().x)<1)})()`));
await evaluate("document.querySelector('#view').scrollIntoView()");await screenshot('config-preview');
await click('[data-view=score]');
assert.ok(await evaluate(`(()=>{const table=document.querySelector('#view table'),row=table.tBodies[0].rows[0];return [...row.cells].every((cell,i)=>!cell.classList.contains('num')||(getComputedStyle(table.tHead.rows[0].cells[i]).textAlign==='right'&&Math.abs(cell.getBoundingClientRect().right-table.tHead.rows[0].cells[i].getBoundingClientRect().right)<1))})()`));
await click('[data-view=comparisons]');
assert.ok(await evaluate(`(()=>{const h=document.querySelector('.chart-heading').getBoundingClientRect(),b=document.querySelector('.delta-track').getBoundingClientRect();return Math.abs(h.x-b.x)<1&&Math.abs(h.width-b.width)<1})()`));
await click('[data-view=config]');
// Weighted bars follow the aggregate while raw values stay fixed.
await click('[data-view=comparisons]');await change('#compareGroup','variant');await change('#compareMeasure','raw');await change('#compareSort','name');
const rawBefore=await evaluate("[...document.querySelectorAll('.comparison-row')].map(r=>r.cells[4].textContent)");
await click('[data-aggregate=english_category]');
assert.deepEqual(await evaluate("[...document.querySelectorAll('.comparison-row')].map(r=>r.cells[4].textContent)"),rawBefore);
await change('#compareMeasure','weighted');
const contributionSum=await evaluate("[...document.querySelectorAll('.comparison-row')].reduce((s,r)=>s+Number(r.cells[5].textContent),0)");
assert.ok(Math.abs(contributionSum-Number(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent")))<.03);
assert.ok(await evaluate("[...document.querySelectorAll('.table-scroll')].filter(e=>e.clientHeight).every(e=>e.scrollHeight<=e.clientHeight+1)"),'nested vertical table scrolling remains');
await click('[data-aggregate=standard]');await click('[data-view=config]');
// Failed model imports are atomic, including failures in the second model of a file.
await evaluate(`window.importTestCSV=async text=>{const dt=new DataTransfer();dt.items.add(new File([text],'test.csv'));const e=document.querySelector('#modelFile');e.files=dt.files;await e.onchange({target:e});};window.rowsCSV=rows=>{const keys=['checkpoint','task','metric','filter','n_shot','harness','backend','value','n_samples'];return [keys,...rows.map(r=>keys.map(k=>r[k]??''))].map(rr=>rr.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\\n');};window.importSnapshot=()=>JSON.stringify({models:[...document.querySelector('#modelA').options].map(o=>o.value),cards:document.querySelector('#cards').textContent,warnings:document.querySelector('#warningCount').textContent,coverage:document.querySelector('#coverage').textContent});`);
const beforeFailures=await evaluate('importSnapshot()');
for(const expression of [
 `''`, `'a,a\\n1,2'`, `'a,b\\n"x"tail,2'`,
 `rowsCSV([{...DATA.rows.find(r=>r.selected),checkpoint:'Rejected',value:'NaN'}])`,
 `rowsCSV([{...DATA.rows.find(r=>r.selected),checkpoint:'Rejected',n_shot:''}])`,
 `rowsCSV([{...DATA.rows.find(r=>r.selected),checkpoint:'Rejected'},{...DATA.rows.find(r=>r.selected),checkpoint:'Rejected'}])`,
 `rowsCSV([{...DATA.rows.find(r=>r.selected),checkpoint:'SYNTHETIC demo — perturbed'}])`,
 `rowsCSV([{...DATA.rows.find(r=>r.selected),checkpoint:'Valid first'},{...DATA.rows.find(r=>r.selected),checkpoint:'Invalid second',value:'-1'}])`,
 `rowsCSV([DATA.rows.find(r=>r.selected)])`,
]){
 await evaluate(`importTestCSV(${expression})`);
 assert.ok(await evaluate("document.querySelector('#error').textContent"),'bad CSV was accepted: '+expression);
 assert.equal(await evaluate('importSnapshot()'),beforeFailures,'bad import mutated active models/scores');
}
// An absent assignment warns, keeps the score, and still uses English fallback.
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);c.languages=c.languages.map(g=>({...g,tasks:g.tasks.filter(t=>t!=='AIME24')})).filter(g=>g.tasks.length);await loadTestConfig(c);})()`);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
await click('[data-view=warnings]');
assert.match(await evaluate("document.querySelector('#view').textContent"),/Unknown language.*AIME24.*English fallback/s);
await click('[data-aggregate=english_eval]');
assert.notEqual(await evaluate("document.querySelector('#cards strong').textContent"),'—');
await click('[data-view=config]');await evaluate('loadTestConfig(DATA.scheme)');
// Category names are configured, not tied to the initial Code category.
await evaluate(`(async()=>{const c=structuredClone(DATA.scheme);c.weights=Object.fromEntries(Object.entries(c.weights).map(([k,v])=>[k==='Code'?'Custom Code':k,v]));c.english_weights=Object.fromEntries(Object.entries(c.english_weights).map(([k,v])=>[k==='Code'?'Custom Code':k,v]));for(const e of c.evals)if(e.category==='Code')e.category='Custom Code';await loadTestConfig(c);})()`);
await click('[data-view=score]');assert.equal(await evaluate("document.querySelector('#scoreCategory').value"),'Custom Code');
assert.match(await evaluate("document.querySelector('#view').textContent"),/HumanEval/);
await click('[data-view=config]');await evaluate('loadTestConfig(DATA.scheme)');
// Imports render names as text; sample-count differences warn without excluding scores.
await evaluate(`window.literalModel='<img src=x onerror="window.unsafe=true">';importTestCSV(rowsCSV(DATA.rows.filter(r=>r.selected).map(r=>({...r,checkpoint:literalModel,n_samples:'1'}))));`);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
assert.equal(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent"),'0.00');
assert.equal(await evaluate('!!window.unsafe'),false);assert.equal(await evaluate("document.querySelectorAll('#cards img').length"),0);
await click('[data-view=warnings]');assert.match(await evaluate("document.querySelector('#view').textContent"),/Sample-count mismatch/);
// All-unconfigured imports remain inspectable; the composite is unavailable in every mode.
await evaluate(`importTestCSV(rowsCSV([{...DATA.rows[0],checkpoint:'Unconfigured fixture',task:'not_configured',value:'not a score'}]));`);
assert.equal(await evaluate("document.querySelector('#error').textContent"),'');
assert.match(await evaluate("document.querySelector('#view').textContent"),/No config.*not_configured/s);
for(const mode of ['standard','english_eval','english_category']){await click('[data-aggregate='+mode+']');assert.equal(await evaluate("document.querySelector('#cards strong').textContent"),'—');}
// Restore source data after destructive fixtures; imported models are session-local.
await send('Page.reload');
for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate("document.querySelector('#cards strong')?.textContent==="+JSON.stringify(initialScore)))break;}
await click('[data-view=config]');
// Full real CSV import preserves all source rows and gives zero delta for identical scores.
await evaluate(`(async()=>{const rr=DATA.rows.map(r=>({...r,checkpoint:'Browser fixture'}));const keys=['checkpoint','task','metric','filter','n_shot','harness','backend','value'];const csv=[keys.join(','),...rr.map(r=>keys.map(k=>r[k]).join(','))].join('\\n');const dt=new DataTransfer();dt.items.add(new File([csv],'model.csv'));const e=document.querySelector('#modelFile');e.files=dt.files;await e.onchange({target:e});})()`);
assert.equal(await evaluate("document.querySelector('#cards .score-card:last-child strong').textContent"),'0.00');
assert.match(await evaluate("document.querySelector('#filterStatus').textContent"),/4248 metric rows/);
assert.equal(await evaluate("document.querySelectorAll('.catalogue-metric').length"),0);
await click('#swap');
assert.equal(await evaluate("document.querySelector('#modelA').value"),'Browser fixture');
await click('#swap');
await click('[data-view=categories]');await click('[data-view=languages]');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
for(const view of ['score','categories','languages','comparisons','config','warnings']){await click('[data-view='+view+']');assert.ok(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),view+' overflows viewport');}
await click('[data-view=comparisons]');
assert.ok(await evaluate("[...document.querySelectorAll('.scroll-hint')].some(e=>!e.hidden)"),'horizontal overflow needs a visible hint');
assert.ok(await evaluate("[...document.querySelectorAll('.table-scroll')].filter(e=>e.clientHeight).every(e=>e.scrollHeight<=e.clientHeight+1)"));
assert.deepEqual(errors,[]);
console.log('Browser checks passed: six-tab layout, aggregate switching, English shares, page scrolling, YAML imports/exports, warning counts/exclusions, normalization provenance, header alignment, default language breakdown, horizontal delta bars, raw/weighted sorting, scoring drilldown, weights, complete configuration, imports, model swap and mobile layout.');
ws.close();
