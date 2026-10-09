'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditRows}=require('../app/eval_config.js');
const {compare,comparisonCoverage,totals}=require('../app/analysis.js');
const {resolveConfig,suiteCoverage}=require('../app/suite_config.js');
const catalogue=()=>({version:1,name:'Rules',evals:['E','F'].map(name=>({name,category:'C',match:{name:name.toLowerCase()},metric:'acc_norm',metric_filter:'none',score:{scale:1},warning:name+' caveat'})),languages:[{tasks:['e','f'],scope:'single',language:'eng_Latn'}]});
const profile={version:1,name:'Weights',weights:{C:1}};
const available={version:1,name:'Any available',mode:'available'};
const fixed={version:1,name:'Required',mode:'fixed',evals:[{name:'E'},{name:'F'}]};
const row=(task='e',metric='acc_norm')=>({checkpoint:'A',task,metric,filter:'none',n_shot:'0',harness:'test',backend:'cpu',value:'.8'});
function run(left,right,suite=available){
 const c=catalogue(),a=auditRows(left,c),b=auditRows(right.map(r=>({...r,checkpoint:'B'})),c),config=resolveConfig(c,suite,profile);
 const scope=suiteCoverage(a,b,suite),coverage=comparisonCoverage(scope.a,scope.b,config);
 const warnings=compare([...a,...b],{catalogue:c,suite,profile},'A','B').diagnostics;
 return {warnings,scope,coverage,score:totals(coverage.a,config,config.weights).score};
}
test('displayed evals emit their caveats; unused catalogue rules and excluded evals do not',()=>{
 const r=run([row()],[row()]);assert.deepEqual(r.warnings.filter(w=>w.type==='Config caveat').map(w=>w.name),['E']);
 const excluded=run([row(),row('f')],[row(),row('f')],{...available,exclude:['F']});
 assert.deepEqual(excluded.warnings.filter(w=>w.type==='Config caveat').map(w=>w.name),['E']);
 assert.equal(excluded.warnings.filter(w=>w.type==='Not used').length,0);
 const info=excluded.warnings.filter(w=>w.severity==='info');assert.equal(info.length,1);
 assert.equal(info[0].code,'intentional_exclusion');assert.deepEqual(info[0].exclusions[0].models,['A','B']);
 assert.equal(excluded.coverage.pairs.length,1);
});
test('unselected eval data warns even if it only contains the wrong metric',()=>{
 const r=run([row(),row('f','acc')],[row()],{...fixed,evals:[{name:'E'}]});
 assert.ok(r.warnings.some(w=>w.type==='Not used'&&w.name==='F'&&w.model==='A'));
 assert.ok(!r.warnings.some(w=>w.type==='Missing scoring field'&&w.tasks.includes('f')));
 assert.equal(r.coverage.pairs.length,1);assert.equal(r.score,80);
});
test('required eval absent from one or both models warns and is excluded from both scores',()=>{
 for(const b of [[row()],[row(),row('f')]]){
  const r=run([row()],b,fixed);assert.ok(r.warnings.some(w=>w.type==='Missing suite data'&&w.name==='F'));
  assert.equal(r.scope.complete,false);assert.equal(r.coverage.pairs.length,1);assert.equal(r.score,80);
 }
});
test('missing configured metric warns, excludes, and never substitutes an alternate metric',()=>{
 const r=run([row(),row('f','acc')],[row(),row('f')],fixed);
 assert.ok(r.warnings.some(w=>w.type==='Missing scoring field'&&w.tasks.includes('f')&&w.model==='A'));
 assert.ok(r.warnings.some(w=>w.type==='Missing suite data'&&w.name==='F'));
 assert.equal(r.coverage.pairs.length,1);assert.equal(r.score,80);
});
test('freeform mismatches warn and use only common measurements',()=>{
 const r=run([row(),row('f')],[row()]);assert.ok(r.warnings.some(w=>w.type==='Comparison coverage'&&w.name==='F'));
 assert.equal(r.coverage.pairs.length,1);assert.equal(r.score,80);
 assert.ok(!r.warnings.some(w=>w.type==='Missing suite data'));
});
test('unconfigured eval data warns and cannot affect the score',()=>{
 const r=run([row(),row('unknown')],[row(),row('unknown')]);
 assert.equal(r.warnings.filter(w=>w.type==='No config'&&w.name==='unknown').length,2);
 assert.equal(r.coverage.pairs.length,1);assert.equal(r.score,80);
});
test('a caveat is not advertised for an eval excluded by A/B coverage',()=>{
 const r=run([row(),row('f')],[row()]);
 assert.deepEqual(r.warnings.filter(w=>w.type==='Config caveat').map(w=>w.name),['E']);
});
test('available-mode exclusions reject unknown catalogue names',()=>{
 const {validateSuite}=require('../app/suite_config.js');
 for(const exclude of [null,'E',['E','E'],[''],[1]])assert.throws(()=>validateSuite({...available,exclude}));
 assert.throws(()=>validateSuite({...fixed,exclude:['E']}));
 assert.throws(()=>resolveConfig(catalogue(),{...available,exclude:['Absent from this catalogue']},profile),/no catalogue rule/);
 const r=run([row()],[row()],{...available,exclude:['E','F']});
 assert.equal(r.score,null);assert.equal(r.coverage.pairs.length,0);
 assert.equal(r.warnings.filter(w=>w.type==='Not used').length,0);
 assert.equal(r.warnings.filter(w=>w.severity==='info').length,1);
});
