'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCSV,totals,comparisonRows,comparisonCoverage,collectWarnings,languageRoles}=require('./app.js');
const {auditRows,normalizeScore,validateConfig}=require('./eval_config.js');
const config=()=>({version:1,name:'Fixture',weights:{C:1},evals:[{name:'Eval',category:'C',match:{regex:'task_.+'},metric:'acc',filter:'',score:{scale:1},normalize:{min:.25,max:1}}],languages:[{tasks:['task_en'],scope:'single',language:'eng_Latn'}]});
const row=(patch={})=>({checkpoint:'Model A',task:'task_en',metric:'acc',filter:'',n_shot:'0',harness:'test',backend:'cpu',value:'.625',...patch});
const close=(a,b)=>{assert.ok(Number.isFinite(a)&&Number.isFinite(b));assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);};

test('language columns sort siblings recursively without changing scores or hierarchy',()=>{
 const {sortBreakdownTree}=require('./app.js');
 const node=(label,a,children=[])=>({kind:'language',label,a,b:a===null?null:100-a,delta:a===null?null:2*a-100,count:a,children});
 const tree=[node('fra_Latn',30,[node('z',2),node('a',8)]),node('eng_Latn',80),node('deu_Latn',80),node('mul',null)];
 const original=structuredClone(tree);
 for(const field of ['label','count','a','b','delta'])for(const order of ['ascending','descending']){
  const sorted=sortBreakdownTree(tree,field,order);
  function check(nodes){
   const value=n=>field==='label'?(n.label==='mul'?'Multilingual (pooled)':n.label):n[field];
   for(let i=1;i<nodes.length;i++){
    const x=value(nodes[i-1]),y=value(nodes[i]);
    if(y===null)continue;assert.notEqual(x,null);
    const diff=typeof x==='string'?x.localeCompare(y):x-y;
    assert.ok(order==='ascending'?diff<=0:diff>=0);
   }
   for(const n of nodes)check(n.children);
  }
  check(sorted);assert.equal(sorted.find(n=>n.label==='fra_Latn').children.length,2);
  assert.equal(sorted.find(n=>n.label==='fra_Latn').a,30);
 }
 assert.deepEqual(tree,original);
 assert.deepEqual(sortBreakdownTree(tree,'a','descending').map(n=>n.label),['deu_Latn','eng_Latn','fra_Latn','mul']);
 assert.deepEqual(sortBreakdownTree([],'a','descending'),[]);
});

test('CSV round trips BOM, CRLF, Unicode, commas, quotes, and embedded newlines',()=>{
 const records=[['name','value'],['é,中','a"b'],['multi\nline',''],['last','2']];
 const source='\ufeff'+records.map(r=>r.map(s=>'"'+s.replaceAll('"','""')+'"').join(',')).join('\r\n');
 assert.deepEqual(parseCSV(source),records.slice(1).map(r=>({name:r[0],value:r[1]})));
});
for(const [name,source] of Object.entries({empty:'',headerOnly:'a,b\n',duplicateHeader:'a,a\n1,2',blankHeader:'a,\n1,2',shortRow:'a,b\n1',longRow:'a,b\n1,2,3',unclosed:'a,b\n"x,2',bareQuote:'a,b\nx"y,2',afterQuote:'a,b\n"x"tail,2',emptyRecord:'a,b\n,\n1,2'})){
 test('CSV rejects '+name,()=>assert.throws(()=>parseCSV(source),/CSV|quote|header|row|measurements/i));
}
for(const field of ['checkpoint','task','metric','harness','backend']){
 for(const value of ['', ' ', null, 123])test(`reject invalid identity ${field}=${value}`,()=>assert.throws(()=>auditRows([row({[field]:value})],config()),new RegExp(field)));
}
for(const value of ['', '-1','1.5','NaN','00','1e1',true,null])test(`reject invalid shots ${value}`,()=>assert.throws(()=>auditRows([row({n_shot:value})],config()),/n_shot/));
test('reject reserved demo label and malformed filter',()=>{
 assert.throws(()=>auditRows([row({checkpoint:'SYNTHETIC demo — perturbed'})],config()),/reserved/i);
 assert.throws(()=>auditRows([row({filter:null})],config()),/filter/);
});
test('required columns are checked even on unconfigured tasks',()=>{
 for(const field of Object.keys(row())){const bad=row({task:'unconfigured'});delete bad[field];assert.throws(()=>auditRows([bad],config()),new RegExp(field));}
});
for(const value of ['', ' ', 'NaN','Infinity','0x1','0b1','0o1','1_0',true,null,-.1,1.01,{},[]]){
 test(`reject invalid selected score ${JSON.stringify(value)}`,()=>{
  assert.throws(()=>normalizeScore(value,config().evals[0]),/score/i);
  assert.throws(()=>auditRows([row({value})],config()),/Model A.*task_en.*acc.*score/i);
 });
}
test('legitimate zero, decimal, and scientific scores retain their value',()=>{
 for(const [value,expected] of [['0',0],['.625',50],['6.25e-1',50],[' 0.625 ',50],[1,100]])close(auditRows([row({value})],config())[0].score_100,expected);
});
test('duplicates are rejected within a model; distinct models and protocols remain distinct',()=>{
 const a=row();assert.throws(()=>auditRows([a,a],config()),/Duplicate/);
 for(const patch of [{checkpoint:'Model B'},{n_shot:'5'},{harness:'another'},{backend:'another'}])assert.equal(auditRows([a,row(patch)],config()).filter(r=>r.selected).length,2);
});
test('invalid alternate scores are retained for inspection but never normalized or substituted',()=>{
 const cfg=config(),rows=auditRows([row({metric:'acc_norm',value:'not numeric'})],cfg);
 assert.equal(rows[0].selected,false);assert.equal(rows[0].value,'not numeric');assert.equal(rows[0].score_100,null);
 assert.ok(collectWarnings(new Map([['A',rows]]),cfg).some(w=>w.type==='Missing scoring field'));
});
test('unknown language warns without exclusion or invented language labels',()=>{
 const cfg=config(),rows=auditRows([row({task:'task_unknown'})],cfg);
 const warnings=collectWarnings(new Map([['A',rows]]),cfg);
 assert.ok(warnings.some(w=>w.type==='Unknown language'&&w.detail.includes('English')));
 assert.equal(rows[0].selected,true);assert.equal(languageRoles(rows[0],new Map())[0].language,'Unknown');
 close(totals(rows,cfg,cfg.weights,'english_eval',{C:.5}).score,50);
});
test('sample-count disagreement warns while preserving matched scores',()=>{
 const cfg=config(),a=auditRows([row({n_samples:'100'})],cfg),b=auditRows([row({checkpoint:'B',n_samples:'90'})],cfg);
 const result=comparisonCoverage(a,b,cfg);
 assert.equal(result.pairs.length,1);assert.ok(result.warnings.some(w=>w.type==='Sample-count mismatch'));
 assert.ok(!comparisonCoverage(a,auditRows([row({checkpoint:'B',n_samples:'100'})],cfg),cfg).warnings.length);
});
test('invalid optional sample counts warn without becoming weights or dropping scores',()=>{
 const cfg=config();
 for(const n_samples of ['0','-1','1.5','many']){
  const rows=auditRows([row({n_samples})],cfg);
  assert.ok(collectWarnings(new Map([['A',rows]]),cfg).some(w=>w.type==='Invalid sample count'));
  close(totals(rows,cfg,cfg.weights).score,50);
 }
 for(const n_samples of ['',undefined,'10']){
  const rows=auditRows([row({n_samples})],cfg);
  assert.ok(!collectWarnings(new Map([['A',rows]]),cfg).some(w=>w.type==='Invalid sample count'));
 }
});
test('no shared data produces unavailable totals, not a zero score',()=>{
 const cfg=config(),a=auditRows([row()],cfg),b=auditRows([row({task:'task_other'})],cfg);
 const result=comparisonCoverage(a,b,cfg);assert.equal(result.pairs.length,0);assert.equal(totals(result.a,cfg,cfg.weights).score,null);
 assert.ok(result.warnings.length);
});
test('zero-weight coverage cannot manufacture a composite',()=>{
 const cfg=config();cfg.weights={C:0,D:1};cfg.evals.push({...cfg.evals[0],name:'Missing',category:'D',match:{name:'missing'}});
 const rows=auditRows([row()],cfg);assert.equal(totals(rows,cfg,cfg.weights).score,null);
});
test('config validation rejects malformed shapes, normalization and ambiguous matching',()=>{
 for(const mutate of [c=>c.weights=null,c=>c.version=true,c=>c.notes=null,c=>c.evals[0].score.scale=0,c=>c.evals[0].normalize={min:.5,max:.5},c=>c.evals[0].shots=-1,c=>c.languages[0].language='en',c=>c.languages.push(c.languages[0]),c=>c.evals[0].warning='',c=>c.english_weights={C:1.1}]){
  const cfg=config();mutate(cfg);assert.throws(()=>validateConfig(cfg));
 }
 const cfg=config();cfg.evals.push({...cfg.evals[0],name:'Overlap'});assert.throws(()=>auditRows([row()],cfg),/Ambiguous/);
});

// Independent scalar reference: compare against the allocation engine and all
// chart groupings, across deterministic randomized coverage and language mixes.
test('300 varied comparisons reconcile all aggregates, row weights, filters and swaps',()=>{
 let seed=73421;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
 const reference=(rows,cfg,mode)=>{
  let total=0,weight=0;
  for(const [category,cw] of Object.entries(cfg.weights)){
   const evals=cfg.evals.filter(e=>e.category===category).map(e=>rows.filter(r=>r.eval===e.name)).filter(rr=>rr.length);
   if(!evals.length)continue;weight+=cw;
   const parts=rr=>['english','other'].map(side=>rr.filter(r=>(r.task.endsWith('_en')?'english':'other')===side).map(r=>r.score_100));
   const blend=([en,other])=>!en.length?mean(other):!other.length?mean(en):cfg.english_weights[category]*mean(en)+(1-cfg.english_weights[category])*mean(other);
   const score=mode==='standard'||!cfg.english_weights[category]?mean(evals.map(rr=>mean(rr.map(r=>r.score_100)))):mode==='english_eval'?mean(evals.map(rr=>blend(parts(rr)))):blend([0,1].map(i=>evals.map(rr=>parts(rr)[i]).filter(xs=>xs.length).map(mean)));
   total+=cw*score;
  }
  return weight?total/weight:null;
 };
 for(let trial=0;trial<100;trial++){
  const cfg={evals:[],weights:{C:.6,D:.4},english_weights:{C:[0,.2,.5,1][trial%4],D:.8},languages:[]},a=[],b=[];
  for(let i=0;i<6;i++){
   const ev={name:'e'+i,category:i<3?'C':'D'};cfg.evals.push(ev);
   for(let j=0;j<4;j++){
    const task=`t${i}_${j}_${j%2?'fr':'en'}`,r={...row(),...ev,eval:ev.name,task,score_100:rand()*100,raw_score_100:rand()*100};
    cfg.languages.push({tasks:[task],scope:'single',language:j%2?'fra_Latn':'eng_Latn'});
    if(rand()>.2)a.push(r);if(rand()>.2)b.push({...r,score_100:rand()*100,raw_score_100:rand()*100});
   }
  }
  const shared=comparisonCoverage(a,b,cfg);
  for(const mode of ['standard','english_eval','english_category']){
   const x=totals(shared.a,cfg,cfg.weights,mode),y=totals(shared.b,cfg,cfg.weights,mode);
   close(x.score,reference(shared.a,cfg,mode));close(y.score,reference(shared.b,cfg,mode));
   close([...x.rowWeights.values()].reduce((s,w)=>s+w,0),1);close(x.evals.reduce((s,e)=>s+e.contribution,0),x.score);
   const metadata=new Map(cfg.languages.flatMap(g=>g.tasks.map(t=>[t,g])));
   for(const grouping of ['variant','eval','category']){
    const chart=comparisonRows(shared.pairs,shared.a,cfg,cfg.weights,grouping,'weighted','descending','delta',metadata,mode);
    close(chart.reduce((s,r)=>s+r.weightedDelta,0),x.score-y.score);
   }
   const chosen=shared.pairs.filter((_,i)=>i%2===0),other=shared.pairs.filter((_,i)=>i%2!==0);
   const contribution=pp=>comparisonRows(pp,shared.a,cfg,cfg.weights,'variant','weighted','descending','delta',metadata,mode).reduce((s,r)=>s+r.weightedDelta,0);
   close(contribution(chosen)+contribution(other),x.score-y.score);
   const swapped=comparisonCoverage(b,a,cfg);close(totals(swapped.a,cfg,cfg.weights,mode).score-totals(swapped.b,cfg,cfg.weights,mode).score,y.score-x.score);
  }
 }
});
