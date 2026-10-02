'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../app/eval_config.js'),A=require('../app/analysis.js');
const levels=['low','medium','high','top'];
const config=()=>({version:1,name:'Components',weights:{Reasoning:1},english_weights:{Reasoning:.5},evals:[{name:'Poly',category:'Reasoning',match:{regex:'poly_.+'},metric:'acc',metric_filter:'none',score:{scale:1},aggregation:{components:levels.map((name,i)=>({name,match:{regex:'poly_.+_'+name},relative_weight:2**i}))}}],languages:['en','de','fr'].map((lang,i)=>({tasks:levels.map(l=>'poly_'+lang+'_'+l),scope:'single',language:['eng_Latn','deu_Latn','fra_Latn'][i]}))});
const rows=(cfg=config(),langs=['en'],values=[.6,.3,.15,0],checkpoint='A')=>E.auditRows(langs.flatMap(lang=>levels.map((l,i)=>({checkpoint,task:'poly_'+lang+'_'+l,metric:'acc',filter:'none',n_shot:'0',harness:'test',backend:'cpu',value:values[i]}))),cfg);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('relative weights round trip; invalid component rules reject',()=>{
 const c=config();E.validateConfig(c);const catalogue={version:1,name:c.name,evals:c.evals,languages:c.languages};assert.deepEqual(E.parseCatalogue(E.serializeCatalogue(catalogue)),catalogue);
 for(const mutate of [a=>a.components=[],a=>{a.components[0].weight=1;delete a.components[0].relative_weight;},a=>a.components[0].relative_weight=0,a=>a.components[0].relative_weight=-1,a=>a.components[0].relative_weight=Infinity,a=>a.components[0].relative_weight='1',a=>a.components[0].name='medium',a=>a.components[0].extra=true,a=>a.components[0].match={regex:'['},a=>a.extra=true,a=>a.components.forEach(c=>c.relative_weight=1e308)]){const bad=config();mutate(bad.evals[0].aggregation);assert.throws(()=>E.validateConfig(bad));}
});
test('PolyMath formula, scale invariance, coefficients and unchanged source scores',()=>{
 const c=config(),r=rows(c),result=A.totals(r,c,c.weights);close(result.score,12);close([...result.rowWeights.values()].reduce((s,v)=>s+v,0),1);close(result.rowWeights.get(r[3]),8/15);close(r[0].raw_score_100,60);
 c.evals[0].aggregation.components.forEach(x=>x.relative_weight*=10);close(A.totals(r,c,c.weights).score,12);
});
test('components normalize before weighting and balance languages after weighting',()=>{
 const c=config();c.evals[0].normalize={min:.25,max:1};
 const r=[...rows(c,['en'],[.25,.25,.25,1]),...rows(c,['de','fr'],[.25,.25,.25,.25])];
 close(A.totals(r,c,c.weights).score,100*8/45);
 for(const mode of ['english_eval','english_category'])close(A.totals(r,c,c.weights,mode).score,100*4/15);
});
test('incomplete language excluded from both models, preserving other languages and raw audit',()=>{
 const c=config(),a=rows(c,['en','de']),b=rows(c,['en','de'],[.2,.3,.4,.5],'B').filter(r=>r.task!=='poly_en_top');
 const coverage=A.comparisonCoverage(a,b,c);assert.equal(coverage.a.length,4);assert.equal(coverage.b.length,4);assert.ok(coverage.a.every(r=>r.task.includes('_de_')));assert.equal(a.length,8);assert.ok(coverage.warnings.some(w=>w.type==='Incomplete components'&&w.detail.includes('top')));
 close(A.totals(coverage.a,c,c.weights).score,12);
});
test('incomplete on both sides, missing metric, unknown language and unknown component never score',()=>{
 for(const kind of ['missing','metric','language','unmatched','ambiguous','duplicate']){
  const c=config();let raw=rows(c);
  if(kind==='missing')raw.pop();
  if(kind==='metric')raw=E.auditRows(raw.map((r,i)=>i===3?{...r,metric:'wrong'}:r),c).filter(r=>r.selected);
  if(kind==='language')c.languages=[];
  if(kind==='unmatched')c.evals[0].aggregation.components[3].match={name:'absent'};
  if(kind==='ambiguous')c.evals[0].aggregation.components[3].match={regex:'poly_.+'};
  if(kind==='duplicate'){raw.push({...raw[0],task:'poly_en_extra_low'});c.languages[0].tasks.push('poly_en_extra_low');}
  const result=A.comparisonCoverage(raw,raw,c);assert.equal(result.pairs.length,0,kind);assert.ok(result.warnings.length,kind);assert.equal(A.totals(raw,c,c.weights).score,null,kind);
 }
});
test('different protocols cannot fill missing components; complete protocols average equally',()=>{
 const c=config(),a=rows(c),mixed=a.map((r,i)=>({...r,n_shot:i===3?'5':'0'}));assert.equal(A.totals(mixed,c,c.weights).score,null);
 const extra=rows(c,['en'],[1,1,1,1]).map(r=>({...r,n_shot:'5'}));close(A.totals(a.concat(extra),c,c.weights).score,56);
});
test('delta contributions reconcile and raw comparisons remain raw',()=>{
 const c=config(),a=rows(c,['en','de']),b=rows(c,['en','de'],[.2,.3,.4,.5],'B'),coverage=A.comparisonCoverage(a,b,c);
 for(const mode of ['standard','english_eval','english_category']){
  const score=A.totals(coverage.a,c,c.weights,mode).score-A.totals(coverage.b,c,c.weights,mode).score;
  const items=A.comparisonRows(coverage.pairs,coverage.a,c,c.weights,'variant','weighted','descending','delta',new Map(),mode);
  close(items.reduce((s,r)=>s+r.weightedDelta,0),score);close(items.find(r=>r.task==='poly_en_low').rawDelta,40);
 }
});
test('breakdowns expose calculated parents and individual weights/contributions',()=>{
 const c=config(),r=rows(c),p=A.pairRows(r,r),m=new Map(c.languages.flatMap(g=>g.tasks.map(t=>[t,g])));
 const tree=A.buildBreakdownTree(p,m,'category','','',c),language=tree[0].children[0].children[0];close(language.a,12);const low=language.children.find(n=>n.label==='poly_en_low');close(low.a,60);close(low.componentShare,1/15);close(low.componentA,4);
 const filtered=A.buildBreakdownTree(p.slice(0,1),m,'category','','',c);assert.equal(filtered[0].a,null);
});
test('ordinary evals retain simple averages',()=>{const c=config();delete c.evals[0].aggregation;close(A.totals(rows(c),c,c.weights).score,26.25);});

test('200 independent component calculations reconcile modes, groups, and category shares',()=>{
 let seed=811;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let trial=0;trial<200;trial++){
  const c=config(),share=rand(),weights=levels.map(()=>1+Math.floor(rand()*8));c.english_weights.Reasoning=share;
  c.evals[0].aggregation.components.forEach((x,i)=>x.relative_weight=weights[i]);
  c.evals.push({name:'Ordinary',category:'Reasoning',match:{name:'ordinary'},metric:'acc',metric_filter:'none',score:{scale:1}});
  c.languages.push({tasks:['ordinary'],scope:'single',language:'eng_Latn'});
  const inputs=['en','de','fr'].map(()=>levels.map(()=>rand()));
  let r=inputs.flatMap((values,i)=>rows(c,[['en','de','fr'][i]],values));
  const ordinary=rand()*100;r.push({...r[0],task:'ordinary',eval:'Ordinary',score_100:ordinary,raw_score_100:ordinary});
  const means=inputs.map(xs=>xs.reduce((sum,x,i)=>sum+x*100*weights[i],0)/weights.reduce((a,b)=>a+b,0)),other=(means[1]+means[2])/2;
  const expected={standard:((means[0]+means[1]+means[2])/3+ordinary)/2,english_eval:(share*means[0]+(1-share)*other+ordinary)/2,english_category:share*(means[0]+ordinary)/2+(1-share)*other};
  for(const [mode,want] of Object.entries(expected)){const t=A.totals(r,c,c.weights,mode);close(t.score,want);close(r.reduce((sum,x)=>sum+x.score_100*t.rowWeights.get(x),0),want);close([...t.rowWeights.values()].reduce((sum,x)=>sum+x,0),1);}
 }
});
test('missing groups redistribute eval/category weights',()=>{
 const c=config();c.weights={Reasoning:.4,Other:.6};c.evals.push({name:'Other',category:'Other',metric:'acc',metric_filter:'none',match:{name:'other'},score:{scale:1}});
 const incomplete=rows(c).slice(0,3),ordinary={...incomplete[0],task:'other',eval:'Other',category:'Other',score_100:70,raw_score_100:70};
 const t=A.totals([...incomplete,ordinary],c,c.weights);close(t.score,70);assert.ok(t.evals.find(e=>e.name==='Poly').excluded);close(t.rowWeights.get(ordinary),1);
});
test('explicit translation pairs are independent component groups',()=>{
 const c=config(),r=rows(c,['en','de']);c.languages=c.languages.slice(0,2).map((g,i)=>({tasks:g.tasks,scope:'translation',source_language:i?'deu_Latn':'eng_Latn',target_language:'fra_Latn'}));
 assert.equal(A.componentCoverage(r,c).groups.length,2);close(A.totals(r,c,c.weights).score,12);
});

test('catalogue rejects incompatible component matching and selection',()=>{
 for(const mutate of [
  c=>c.evals[0].aggregation.components[0].match={regex:'poly_.+'},
  c=>c.evals[0].aggregation.components[0].match={name:'other_eval'},
  c=>c.evals[0].select={regex:'poly_.+_(low|medium|high)'},
  c=>c.languages[0].tasks.pop(),
  c=>c.evals[0].aggregation.components[0].metric='other',
  c=>c.evals[0].aggregation.components[0].metric_filter='other',
  c=>c.evals[0].aggregation.components[0].score={scale:100},
  c=>c.evals[0].aggregation.components[0].normalize={min:.25,max:1},
  c=>c.evals[0].aggregation.components[0].shots=5
 ]){const c=config();mutate(c);assert.throws(()=>E.validateConfig(c));}
 // A wholly absent language is not an implicit requirement.
 const c=config();c.languages.pop();assert.doesNotThrow(()=>E.validateConfig(c));
});
test('named sets require compatible complete component selections per language and shots',()=>{
 const S=require('../app/suite_config.js'),c=config(),catalogue={version:1,name:c.name,evals:c.evals,languages:c.languages},profile={version:1,name:'P',weights:c.weights};
 const suite=()=>({version:1,name:'Components',mode:'fixed',evals:[{name:'Poly',variants:levels.map(l=>({task:'poly_en_'+l,n_shot:0}))}]});
 for(const mutate of [s=>s.evals[0].variants.pop(),s=>s.evals[0].variants[3].n_shot=5,s=>delete s.evals[0].variants[3].n_shot,s=>s.evals[0].variants[3].task='poly_de_top']){
  const s=suite();mutate(s);assert.throws(()=>S.resolveConfig(catalogue,s,profile),/aggregation.*Poly|Poly.*aggregation/i);
 }
 for(const s of [suite(),{...suite(),evals:[{name:'Poly'}]},{version:1,name:'Available',mode:'available'}])assert.doesNotThrow(()=>S.resolveConfig(catalogue,s,profile));
 const allShots=suite();allShots.evals[0].variants.forEach(v=>delete v.n_shot);assert.doesNotThrow(()=>S.resolveConfig(catalogue,allShots,profile));
 const pinned=structuredClone(catalogue);pinned.evals[0].shots=0;const mixed=suite();delete mixed.evals[0].variants[0].n_shot;assert.doesNotThrow(()=>S.resolveConfig(pinned,mixed,profile));
 const both=suite();both.evals[0].variants.push(...both.evals[0].variants.map(v=>({...v,n_shot:5})));assert.doesNotThrow(()=>S.resolveConfig(catalogue,both,profile));
 const alias=structuredClone(catalogue);alias.languages[0].tasks.push('poly_en_alias_low');const duplicate=suite();duplicate.evals[0].variants.push({task:'poly_en_alias_low',n_shot:0});assert.throws(()=>S.resolveConfig(alias,duplicate,profile),/multiple/i);
});

test('newly observed tasks must match exactly one component even beyond declared metadata',()=>{
 const c=config(),raw={...rows(c)[0],task:'poly_en_future'};
 assert.throws(()=>E.auditRows([raw],c),/Incompatible aggregation config.*exactly one/);
 c.evals[0].aggregation.components[0].match.regex='poly_.+_(low|future)';
 c.evals[0].aggregation.components[1].match.regex='poly_.+_(medium|future)';
 assert.doesNotThrow(()=>E.validateConfig(c));
 assert.throws(()=>E.auditRows([raw],c),/Incompatible aggregation config.*exactly one/);
 assert.equal(E.auditRows([{...raw,metric:'alternate'}],c)[0].selected,false);
});
