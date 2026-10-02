'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateCatalogue}=require('../app/eval_config.js');
const {validateWeightProfile,parseWeightProfile,serializeWeightProfile,validateSuite,resolveConfig,scopeRows,suiteCoverage,parseSuite,serializeSuite}=require('../app/suite_config.js');
const catalogue=()=>({version:1,name:'Catalogue',evals:[{name:'E',category:'C',match:{regex:'e_.+'},metric:'acc',filter:'none',score:{scale:1}},{name:'Unused',category:'D',match:{name:'unused'},metric:'acc',filter:'none',score:{scale:1}}],languages:[{tasks:['e_en'],scope:'single',language:'eng_Latn'},{tasks:['e_fr'],scope:'single',language:'fra_Latn'}]});
const suite=()=>({version:1,name:'Required',mode:'fixed',evals:[{name:'E',variants:[{task:'e_en',n_shot:0},{task:'e_fr',n_shot:5}]}]});
const profile=()=>({version:1,name:'Weights',weights:{C:.5,D:.5}});
const row=(task,n_shot='0')=>({task,n_shot,eval:'E',selected:true});
test('catalogue, weight profile and optional eval set are independent',()=>{
 assert.equal(validateCatalogue(catalogue()).evals.length,2);
 const c=resolveConfig(catalogue(),suite(),profile());assert.deepEqual(c.evals.map(e=>e.name),['E']);assert.deepEqual(c.weights,{C:.5,D:.5});
 assert.deepEqual(parseSuite(serializeSuite(suite())),suite());
 assert.throws(()=>validateCatalogue({...catalogue(),weights:{C:1}}));
});
test('fixed membership respects tasks and shots, ignores unselected alternate metrics',()=>{
 const s=suite(),rows=[row('e_en'),row('e_fr','5'),row('e_fr','0'),row('e_de'),{...row('e_en'),selected:false}];
 const scope=scopeRows(rows,s);assert.equal(scope.rows.length,2);assert.equal(scope.extras.length,2);assert.equal(scope.missing.length,0);
 const c=suiteCoverage([row('e_en')],[row('e_en')],s);
 assert.equal(c.complete,false);assert.equal(c.required,2);assert.equal(c.presentA,1);assert.equal(c.presentB,1);
 assert.equal(c.warnings.length,2);assert.ok(c.warnings.every(w=>w.type==='Missing suite data'));
});
test('any available creates no missing or extra suite requirements',()=>{
 const s={version:1,name:'Any available',mode:'available'};
 assert.equal(resolveConfig(catalogue(),s,profile()).evals.length,2);
 const c=suiteCoverage([row('e_en')],[],s);assert.deepEqual(c.warnings,[]);assert.equal(c.required,null);
});
test('eval-only requirement permits all its recognized variants',()=>{
 const s={...suite(),evals:[{name:'E'}]};assert.equal(scopeRows([row('e_de')],s).missing.length,0);
 assert.equal(scopeRows([],s).missing.length,1);
});
test('invalid suite definitions and catalogue references fail clearly',()=>{
 for(const change of [s=>s.mode='wrong',s=>s.evals.push(s.evals[0]),s=>s.evals[0].variants.push(s.evals[0].variants[0]),s=>s.evals[0].variants[0].n_shot=-1,s=>s.evals[0].variants=[],s=>s.evals=[]]){const s=suite();change(s);assert.throws(()=>validateSuite(s));}
 for(const change of [s=>s.evals[0].name='Absent',s=>s.evals[0].variants[0].task='unmapped']){const s=suite();change(s);assert.throws(()=>resolveConfig(catalogue(),s,profile()));}
 assert.throws(()=>validateSuite({...suite(),mode:'available'}));
});

test('weight profiles validate independently and do not require an eval set',()=>{
 assert.deepEqual(parseWeightProfile(serializeWeightProfile(profile())),profile());
 for(const patch of [{weights:{C:-1}},{english_weights:{Z:.5}},{aggregate:'wrong'},{notes:null},{evals:[]}])assert.throws(()=>validateWeightProfile({...profile(),...patch}));
 assert.throws(()=>validateSuite({...suite(),weights:{C:1}}));
 assert.equal(resolveConfig(catalogue(),suite(),{...profile(),weights:{D:1}}).weights.C,0);
});
test('a fixed set is incomplete when required measurements have incompatible protocols',()=>{
 const s={...suite(),evals:[{name:'E',variants:[{task:'e_en'}]}]};
 const c=suiteCoverage([row('e_en','0')],[row('e_en','5')],s);
 assert.equal(c.presentA,1);assert.equal(c.presentB,1);assert.equal(c.sharedRequired,0);assert.equal(c.complete,false);
});
test('fixed-set scores use the shared subset and contributions reconcile in every aggregate',()=>{
 const {auditRows}=require('../app/eval_config.js'),{comparisonCoverage,totals,comparisonRows}=require('../app/analysis.js');
 const c=catalogue(),s=suite(),p={...profile(),english_weights:{C:.5,D:.5}},config=resolveConfig(c,s,p);
 const measurement=(task,shot,value,checkpoint='A')=>({checkpoint,task,n_shot:String(shot),value:String(value),metric:'acc',filter:'none',harness:'test',backend:'cpu'});
 const a=auditRows([measurement('e_en',0,.8),measurement('e_fr',5,.6),measurement('e_de',0,1)],c);
 const b=auditRows([measurement('e_en',0,.4,'B'),measurement('e_fr',0,.2,'B')],c);
 const scope=suiteCoverage(a,b,s),coverage=comparisonCoverage(scope.a,scope.b,config);
 assert.equal(scope.complete,false);assert.equal(scope.presentB,1);assert.equal(scope.sharedRequired,1);
 assert.equal(scope.extrasA,1);assert.equal(scope.extrasB,1);
 assert.ok(scope.warnings.some(w=>w.type==='Missing suite data'&&w.model==='B'));
 assert.ok(coverage.warnings.some(w=>w.type==='Comparison coverage'));
 const metadata=new Map(c.languages.flatMap(g=>g.tasks.map(t=>[t,g])));
 for(const mode of ['standard','english_eval','english_category']){
  const left=totals(coverage.a,config,config.weights,mode),right=totals(coverage.b,config,config.weights,mode);
  assert.equal(left.score,80);assert.equal(right.score,40);
  const bars=comparisonRows(coverage.pairs,coverage.a,config,config.weights,'eval','weighted','descending','delta',metadata,mode);
  assert.equal(bars.reduce((n,b)=>n+b.weightedDelta,0),left.score-right.score);
 }
});
test('an alternate metric cannot satisfy a required measurement',()=>{
 const {auditRows}=require('../app/eval_config.js'),{diagnosticsFor}=require('./diagnostic_fixture.cjs');
 const rows=auditRows([{checkpoint:'A',task:'e_en',n_shot:'0',value:'.8',metric:'acc_norm',filter:'none',harness:'test',backend:'cpu'}],catalogue());
 assert.equal(scopeRows(rows,suite()).missing.length,2);
 assert.equal(scopeRows(rows,suite()).extras.length,0);
 assert.ok(diagnosticsFor(new Map([['A',rows]]),catalogue()).some(w=>w.type==='Missing scoring field'));
});
test('all shipped sets and profiles are independent and resolve against the global catalogue',()=>{
 const fs=require('node:fs'),{parseCatalogue}=require('../app/eval_config.js');
 const c=require('../app/catalogue_io.cjs').loadCatalogue('configs/catalogue.yaml');
 const profiles=fs.readdirSync('configs/weights').filter(f=>f.endsWith('.yaml')).map(f=>parseWeightProfile(fs.readFileSync('configs/weights/'+f,'utf8')));
 for(const p of profiles)for(const filename of fs.readdirSync('configs/sets').filter(f=>f.endsWith('.yaml'))){
  const s=parseSuite(fs.readFileSync('configs/sets/'+filename,'utf8'));
  resolveConfig(c,s,p);
  assert.equal(s.weights,undefined);assert.equal(c.weights,undefined);assert.equal(p.evals,undefined);
 }
});
