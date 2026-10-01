const assert=require('node:assert/strict'),fs=require('node:fs');
const {parseCSV,selectRows,totals,pairRows,synthetic}=require('../app/app.js');
const data=JSON.parse(fs.readFileSync(__dirname+'/../output/analysis.json')),scheme=data.scheme;
const selected=selectRows(data.rows,scheme);
assert.equal(selected.length,403);
assert.ok(Math.abs(totals(selected,scheme,scheme.weights).score-data.models[0].score)<1e-10);
const withoutIF=totals(selected.filter(r=>r.eval!=='IFEval'),scheme,scheme.weights);
assert.ok(Number.isFinite(withoutIF.score));assert.equal(withoutIF.categories.find(c=>c.name==='Instruction following').excluded,true);
assert.equal(totals(selected,scheme,{...scheme.weights,Code:.2}).score,null);
assert.throws(()=>selectRows([selected[0],selected[0]],scheme),/Duplicate/);
assert.throws(()=>selectRows([{...selected[0],value:'NaN'}],scheme),/Invalid/);
assert.deepEqual(parseCSV('a,b\r\n"x,y","q""r"\r\n'),[{a:'x,y',b:'q"r'}]);
assert.throws(()=>parseCSV('a,b\n"unfinished'),/Unclosed/);
const mockScheme={evals:[{name:'f1',category:'C'},{name:'f2',category:'C'},{name:'f3',category:'D'}]};
const mockRows=[{eval:'f1',score_100:0},{eval:'f1',score_100:100},{eval:'f2',score_100:100},{eval:'f3',score_100:0}];
assert.equal(totals(mockRows,mockScheme,{C:.8,D:.2}).score,60); // f1=50, f2=100; C=75. No row-count weighting.
const fake=synthetic(selected,scheme);assert.deepEqual(fake,synthetic(selected,scheme));assert.ok(fake.every(r=>r.score_100>=0&&r.score_100<=100));
assert.equal(pairRows(selected,fake).length,403);
assert.equal(pairRows([selected[0]],[{...fake[0],n_shot:'999'}]).length,0);
assert.ok(pairRows(selected,selected).every(r=>r.delta===0));
assert.equal(pairRows(selected,fake.slice(1)).length,402);
console.log('JS checks passed: scoring, missing data, protocol matching, CSV parsing, synthetic reproducibility, Python parity.');

// The catalogue must retain excluded tasks, summaries and alternate metrics.
const {auditRows,buildCatalogue}=require('../app/app.js');
const audited=auditRows(data.rows,scheme);
assert.equal(audited.length,2124);
assert.equal(audited.filter(r=>r.selected).length,403);
const catalogue=buildCatalogue(audited,scheme);
assert.equal(catalogue.length,45);
assert.equal(catalogue.reduce((n,f)=>n+f.tasks.length,0),1556);
assert.equal(catalogue.flatMap(f=>f.tasks).reduce((n,t)=>n+t.rows.length,0),2124);
const he=catalogue.find(f=>f.name==='HumanEval').tasks[0];
assert.equal(he.rows.find(r=>r.metric==='python_pass@1').selected,true);
assert.equal(he.rows.find(r=>r.metric==='sh_pass@1').selected,false);
assert.match(he.rows.find(r=>r.metric==='sh_pass@1').decision,/python_pass@1/);
const hs=catalogue.find(f=>f.name==='HellaSwag').tasks.find(t=>t.name==='hellaswag');
assert.equal(hs.rows.length,4);
assert.equal(hs.rows.filter(r=>r.selected).length,1);
assert.equal(hs.rows.find(r=>r.selected).n_shot,'0');
const mmlu=catalogue.find(f=>f.name==='MMLU');
assert.ok(mmlu.tasks.every(t=>!t.name.startsWith('global_')));
assert.ok(catalogue.find(f=>f.name==='Global MMLU').tasks.every(t=>t.name.startsWith('global_mmlu_')));
assert.ok(mmlu.tasks.some(t=>t.name==='mmlu_abstract_algebra'&&t.rows.every(r=>!r.selected)));
const imported=[...data.rows,{...data.rows.find(r=>r.task==='HumanEval'),checkpoint:'second real model'}];
const union=buildCatalogue(auditRows(imported,scheme),scheme);
assert.equal(union.find(f=>f.name==='HumanEval').tasks.length,1);
assert.equal(union.find(f=>f.name==='HumanEval').tasks[0].rows.length,3);
console.log('Catalogue checks passed: all tasks and metrics retained, category mapping, protocols, model union.');

const {comparisonRows,languageRoles,matchesLanguage}=require('../app/app.js');
const toy=[{task:'a',eval:'f1',category:'C',delta:10,score_delta:10,a:30,b:20},{task:'b',eval:'f1',category:'C',delta:30,score_delta:30,a:50,b:20},{task:'c',eval:'f2',category:'C',delta:-10,score_delta:-10,a:10,b:20},{task:'d',eval:'f3',category:'D',delta:5,score_delta:5,a:25,b:20}];
const toyWeights={C:.8,D:.2};
for(const grouping of ['category','eval','variant']){
 const rows=comparisonRows(toy,toy,mockScheme,toyWeights,grouping,'weighted','descending');
 assert.equal(rows.reduce((s,r)=>s+r.weightedDelta,0),5);
 assert.ok(rows.every(r=>Math.abs((r.a-r.b)-r.rawDelta)<1e-10));
}
assert.equal(comparisonRows(toy.slice(0,1),toy,mockScheme,toyWeights,'variant','weighted','name')[0].weightedDelta,2);
const actual=comparisonRows(pairRows(selected,fake),selected,scheme,scheme.weights,'variant','weighted','descending');
assert.ok(Math.abs(actual.reduce((s,r)=>s+r.weightedDelta,0)-(totals(selected,scheme,scheme.weights).score-totals(fake,scheme,scheme.weights).score))<1e-10);
assert.equal(actual.length,403);
const asc=comparisonRows(toy,toy,mockScheme,toyWeights,'variant','raw','ascending');
assert.deepEqual(asc.map(r=>r.rawDelta),[-10,5,10,30]);
const weighted=comparisonRows(toy,toy,mockScheme,toyWeights,'variant','weighted','descending');
assert.deepEqual(weighted.map(r=>r.weightedDelta),[6,2,1,-4]);
const metadata=new Map(data.metadata.map(r=>[r.task,r]));
assert.deepEqual(languageRoles({task:'AIME24'},metadata),[{language:'eng_Latn',role:'eval'}]);
assert.deepEqual(languageRoles({task:'bigbench_language_identification_multiple_choice'},metadata),[{language:'mul',role:'eval'}]);
assert.deepEqual(languageRoles({task:'flores200:fin_Latn-eng_Latn'},metadata),[{language:'fin_Latn',role:'from'},{language:'eng_Latn',role:'to'}]);
assert.equal(matchesLanguage({task:'flores200:fin_Latn-eng_Latn'},metadata,'fin_Latn','from'),true);
assert.equal(matchesLanguage({task:'flores200:fin_Latn-eng_Latn'},metadata,'fin_Latn','to'),false);
assert.equal(matchesLanguage({task:'flores200:fin_Latn-eng_Latn'},metadata,'eng_Latn','to'),true);
assert.deepEqual(languageRoles({task:'not-a-known-task'},metadata),[{language:'Unknown',role:'eval'}]);
// Raw deltas stay independent of chance normalization; weighted deltas reconcile.
const {normalizeScore,validateConfig,taskLanguage,matchTask}=require('../app/eval_config.js');
const adjusted=structuredClone(scheme);adjusted.evals[0].normalize={min:.25,max:1};
const ar=selectRows(data.rows,adjusted),br=synthetic(ar,adjusted),pp=pairRows(ar,br);
const rawPairs=pairRows(selected,fake);
assert.deepEqual(pp.map(r=>r.delta),rawPairs.map(r=>r.delta));
const contributions=comparisonRows(pp,ar,adjusted,adjusted.weights,'variant','weighted','descending');
assert.ok(Math.abs(contributions.reduce((s,r)=>s+r.weightedDelta,0)-(totals(ar,adjusted,adjusted.weights).score-totals(br,adjusted,adjusted.weights).score))<1e-10);
const normal={score:{scale:1},normalize:{min:.25,max:1}};
for(const [input,expected] of [[.1,0],[.25,0],[.625,50],[1,100]])assert.deepEqual(normalizeScore(input,normal),{raw_score_100:input*100,score_100:expected});
assert.deepEqual(normalizeScore(62.5,{...normal,score:{scale:100}}),{raw_score_100:62.5,score_100:50});
assert.equal(normalizeScore(.1,{...normal,normalize:{min:.25,max:1,clip:false}}).score_100,-20);
assert.equal(taskLanguage('made_up_eng_Latn',scheme).status,'unknown');
assert.equal(matchTask({name:'eval'},'eval_fr'),false);
assert.equal(matchTask({regex:'eval_(fr|en)'},'eval_fr'),true);
assert.equal(matchTask({regex:'eval_(fr|en)'},'eval_fr\n'),false);
for(const mutate of [c=>c.languages.push(c.languages[0]),c=>c.languages[0].language='English',c=>c.evals[0].normalize={min:1,max:1},c=>c.weights.Code=.2,c=>c.evals[0].shots='0',c=>c.evals[0].extra='typo']){const c=structuredClone(scheme);mutate(c);assert.throws(()=>validateConfig(c));}
console.log('Config and comparison checks passed: explicit languages, translation roles, normalization, raw preservation, weighted reconciliation, validation.');

const {buildBreakdownTree,breakdownAggregate}=require('../app/app.js');
const pairs=pairRows(selected,fake),ct=buildBreakdownTree(pairs,metadata,'category'),lt=buildBreakdownTree(pairs,metadata,'language');
assert.equal(ct.length,9);
assert.equal(ct.reduce((n,c)=>n+c.count,0),403);
const translate=ct.find(n=>n.label==='Translation');
assert.ok(translate.children.every(e=>e.kind==='eval'));
const english=translate.children[0].children.find(n=>n.label==='eng_Latn');
assert.deepEqual(english.children.map(n=>n.label),['From eng_Latn','To eng_Latn']);
assert.ok(english.children[0].children.every(n=>n.label.startsWith('eng_Latn → ')));
assert.ok(english.children[1].children.every(n=>n.label.endsWith(' → eng_Latn')));
assert.ok(english.children.flatMap(n=>n.children).every(n=>n.kind==='pair'&&n.children.every(v=>v.kind==='variant')));
assert.ok(translate.children[0].children.reduce((n,l)=>n+l.count,0)>translate.children[0].count);
assert.equal(translate.count,pairs.filter(r=>r.category==='Translation').length);
assert.equal(lt.find(n=>n.label==='eng_Latn').count,pairs.filter(r=>matchesLanguage(r,metadata,'eng_Latn')).length);
assert.ok(lt.every(l=>l.children.every(c=>c.kind==='category'&&c.children.every(e=>e.kind==='eval'))));
for(const view of ['category','language']){
 const tree=buildBreakdownTree(pairs.filter(r=>matchesLanguage(r,metadata,'fin_Latn','to')),metadata,view,'fin_Latn','to');
 function check(nodes){for(const n of nodes){if(n.kind==='language')assert.equal(n.label,'fin_Latn');if(n.kind==='direction')assert.equal(n.label,'To fin_Latn');check(n.children);}}
 check(tree);
}
assert.equal(breakdownAggregate([...pairs,pairs[0]]).count,403);
assert.equal(breakdownAggregate([...pairs,pairs[0]]).a,breakdownAggregate(pairs).a);
console.log('Hierarchy checks passed: category/eval/language and language/category/eval ordering, translation directions/pairs, filtered branches, unique aggregates.');

const {collectWarnings}=require('../app/app.js');
const baselineWarnings=collectWarnings(new Map([['real',audited]]),scheme);
assert.deepEqual(baselineWarnings.filter(w=>w.type==='Inconsistent scoring settings').map(w=>w.name).sort(),['ARC Challenge','MGSM','PIQA']);
assert.deepEqual(baselineWarnings.filter(w=>w.type==='Config caveat').map(w=>w.name).sort(),['FLORES200','MultiBlimp','OpenSubtitles']);
const unknown=auditRows([{...data.rows[0],task:'new_task_without_config'}],scheme)[0];
assert.equal(unknown.selected,false);assert.equal(unknown.eval,'');assert.equal(unknown.score_100,null);
const warningRows=audited.filter(r=>r.eval!=='HumanEval').concat(unknown);
const warnings=collectWarnings(new Map([['real',warningRows]]),scheme);
assert.equal(warnings.length,baselineWarnings.length+2);
assert.ok(warnings.some(w=>w.type==='No config'&&w.name==='new_task_without_config'));
assert.ok(warnings.some(w=>w.type==='No eval data'&&w.name==='HumanEval'));
const alternate=structuredClone(scheme);alternate.evals.find(e=>e.name==='HumanEval').metric='nonexistent';
assert.ok(collectWarnings(new Map([['real',auditRows(data.rows,alternate)]]),alternate).some(w=>w.type==='No selected score'));
console.log('Warning checks passed: unconfigured exclusion, absent evals, selected metric gaps.');
const {languageCoverage}=require('../app/app.js');
assert.deepEqual(languageCoverage([{task:'AIME24'},{task:'AIME25'}],metadata),{count:1,pooled:0,unknown:0});
assert.deepEqual(languageCoverage([{task:'flores200:eng_Latn-fin_Latn'},{task:'flores200:fin_Latn-eng_Latn'}],metadata),{count:2,pooled:0,unknown:0});
assert.deepEqual(languageCoverage([{task:'bigbench_language_identification_multiple_choice'},{task:'multiblimp_hbs'},{task:'not-known'}],metadata),{count:1,pooled:1,unknown:1});
console.log('Language count checks passed: distinct codes, translation endpoints, pooled and unknown results.');
// Column sorting is independent of the bar metric, with deterministic ties.
for(const field of ['label','category','a','b','rawDelta','weightedDelta','languageCount']){
 for(const order of ['ascending','descending']){
  const rows=comparisonRows(pairRows(selected,fake),selected,scheme,scheme.weights,'eval','raw',order,field,metadata);
  for(let i=1;i<rows.length;i++){const x=rows[i-1][field],y=rows[i][field],diff=typeof x==='string'?x.localeCompare(y):x-y;assert.ok(order==='ascending'?diff<=0:diff>=0,field+' '+order);}
  assert.ok(rows.every(r=>r.delta===r.rawDelta));
 }
}
const missingArc=audited.filter(r=>!(r.task==='arc_challenge_mt_cs'&&r.metric==='acc_norm'));
const arcWarnings=collectWarnings(new Map([['real',missingArc]]),scheme).filter(w=>w.type==='Missing scoring field');
assert.equal(arcWarnings.length,1);
assert.equal(arcWarnings[0].type,'Missing scoring field');
assert.equal(arcWarnings[0].name,'arc_challenge_mt_cs');
assert.match(arcWarnings[0].detail,/expected acc_norm/);
const wrongFilter=data.rows.map(r=>r.task==='arc_challenge_mt_cs'&&r.metric==='acc_norm'?{...r,filter:'wrong'}:r);
assert.ok(collectWarnings(new Map([['real',auditRows(wrongFilter,scheme)]]),scheme).some(w=>w.type==='Missing scoring setting'));
// MMLU child tasks are intentionally excluded, so missing summary metrics there are not warnings.
assert.ok(!collectWarnings(new Map([['real',audited]]),scheme).some(w=>w.name==='mmlu_abstract_algebra'));
console.log('Column sort and per-task missing metric/setting checks passed.');
// Grouped multilingual scores must expose differences in the selected protocol.
const protocolConfig=structuredClone(scheme);
for(const e of protocolConfig.evals)delete e.warning;
const consistent=audited.map(r=>({...r,n_shot:'0'}));
assert.deepEqual(collectWarnings(new Map([['real',consistent]]),protocolConfig),[]);
for(const field of ['n_shot','filter','metric','harness','backend']){
 const changed=consistent.map(r=>r.task==='arc_challenge_mt_cs'&&r.selected?{...r,[field]:field==='n_shot'?'5':'different'}:r);
 const issues=collectWarnings(new Map([['real',changed]]),protocolConfig).filter(w=>w.type==='Inconsistent scoring settings');
 assert.equal(issues.length,1,field);assert.equal(issues[0].name,'ARC Challenge');assert.match(issues[0].detail,/arc_challenge_mt_cs/);assert.match(issues[0].detail,/ces_Latn/);
}
// Alternate, excluded measurements do not change the protocol used in aggregates.
const excludedChange=consistent.map(r=>!r.selected?{...r,n_shot:'99'}:r);
assert.deepEqual(collectWarnings(new Map([['real',excludedChange]]),protocolConfig),[]);
const repeated=consistent.concat(consistent.filter(r=>r.eval==='ARC Challenge'&&r.selected).map(r=>({...r,n_shot:'5'})));
assert.deepEqual(collectWarnings(new Map([['real',repeated]]),protocolConfig),[],'same settings set for every task is consistent');
const noteConfig=structuredClone(protocolConfig);noteConfig.evals.find(e=>e.name==='FLORES200').warning='Review language-pair calibration.';
const noteWarnings=collectWarnings(new Map([['first',consistent],['second',consistent]]),noteConfig).filter(w=>w.type==='Config caveat');
assert.equal(noteWarnings.length,1,'config notes are not duplicated for each model');assert.match(noteWarnings[0].detail,/language-pair/);
assert.throws(()=>validateConfig({...noteConfig,evals:noteConfig.evals.map(e=>({...e,warning:17}))}),/warning/i);
console.log('Protocol consistency and editable normalization warning checks passed.');

for(const name of ['LSAT AR','X-CSQA','Belebele','MultiBlimp'])assert.equal(scheme.evals.find(e=>e.name===name).metric,'acc_norm');
assert.equal(scheme.evals.find(e=>e.name==='SIB-200').metric,'acc');
assert.equal(scheme.evals.find(e=>e.name==='SIB-200').warning,undefined);
