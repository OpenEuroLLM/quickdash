'use strict';
const QuickdashAnalysis=(()=>{
'use strict';
const key = r => JSON.stringify(['task','metric','filter','n_shot','harness','backend'].map(k=>r[k]));
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const fmt = (x,digits=2) => x === null || !Number.isFinite(x) ? '—' : x.toFixed(digits);
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {parseCSV,parseCatalogue,serializeCatalogue,validateCatalogue,normalizeScore,taskLanguage,auditRows,matchTask,demoModel,isDemoModel}=typeof module!=='undefined'?require('./eval_config.js'):EvalConfig;
const {parseSuite,serializeSuite,parseWeightProfile,serializeWeightProfile,resolveConfig,inSuite,suiteCoverage,scopeRows}=typeof module!=='undefined'?require('./suite_config.js'):SuiteConfig;
function selectRows(rows,scheme){const selected=auditRows(rows,scheme).filter(r=>r.selected);if(!selected.length)throw Error('No selected measurements');return selected;}
function buildCatalogue(rows,scheme){
 return scheme.evals.map(f=>{const tasks=new Map();for(const r of rows.filter(r=>r.eval===f.name)){if(!tasks.has(r.task))tasks.set(r.task,[]);tasks.get(r.task).push(r);}return {...f,tasks:[...tasks].map(([name,rows])=>({name,rows})).sort((a,b)=>a.name.localeCompare(b.name))};}).filter(f=>f.tasks.length);
}
function comparisonRows(pairs,reference,scheme,weights,group,measure,sort,sortBy='delta',metadata=new Map(),aggregate='standard',englishWeights=scheme.english_weights||{}){
 const allocation=totals(reference,scheme,weights,aggregate,englishWeights,metadata),coefficients=new Map(reference.map(r=>[key(r),allocation.rowWeights.get(r)]));
 const groups=new Map();for(const r of pairs){const k=group==='category'?r.category:group==='eval'?r.eval:key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const items=[...groups].map(([k,rows])=>{
 const raw=group==='category'?avg([...new Set(rows.map(r=>r.eval))].map(f=>avg(rows.filter(r=>r.eval===f).map(r=>r.delta)))):avg(rows.map(r=>r.delta));
 const weighted=rows.reduce((sum,r)=>sum+r.score_delta*coefficients.get(key(r)),0);
 return {a:group==='category'?avg([...new Set(rows.map(r=>r.eval))].map(f=>avg(rows.filter(r=>r.eval===f).map(r=>r.a)))):avg(rows.map(r=>r.a)),b:group==='category'?avg([...new Set(rows.map(r=>r.eval))].map(f=>avg(rows.filter(r=>r.eval===f).map(r=>r.b)))):avg(rows.map(r=>r.b)),tasks:[...new Set(rows.map(r=>r.task))],languageCount:languageCoverage(rows,metadata).count,weightedDelta:weighted,task:group==='variant'?rows[0].task:'',label:group==='variant'?rows[0].task+' · '+rows[0].n_shot+' shot':k,category:rows[0].category,eval:group==='category'?'':rows[0].eval,count:rows.length,rawDelta:raw,delta:measure==='weighted'?weighted:raw};
 });
 const field=sort==='name'?'label':sortBy,direction=sort==='ascending'||sort==='name'?1:-1;
 items.sort((a,b)=>{const x=a[field],y=b[field],difference=typeof x==='string'?x.localeCompare(y):sort==='absolute'?Math.abs(x)-Math.abs(y):x-y;return direction*difference||a.label.localeCompare(b.label);});
 return items;
}
function weightingLanguage(row,metadata){
 const m=metadata.get(row.task);
 return m?.scope==='translation'?m.target_language:['single','pooled'].includes(m?.scope)?m.language:null;
}
function scoreLanguage(row,metadata){
 const language=weightingLanguage(row,metadata);
 return !language||language==='mul'||language==='eng_Latn'?'english':'other';
}
function englishAssignment(row,metadata){
 const language=weightingLanguage(row,metadata);
 return !language||language==='mul'?'English (fallback: unknown or mixed language; weighting only)':language==='eng_Latn'?'English':'Other languages';
}
// Component completeness is checked before scoring, within an explicit language and protocol.
function componentCoverage(rows,config){
 const accepted=new Set(),groups=[],warnings=[];
 const metadata=new Map((config.languages||[]).flatMap(g=>g.tasks.map(t=>[t,g])));
 for(const e of config.evals){
  const rr=rows.filter(r=>r.eval===e.name);
  if(!e.aggregation){for(const r of rr)accepted.add(r);continue;}
  const buckets=new Map();
  for(const r of rr){
   const m=metadata.get(r.task),language=m?.scope==='translation'?m.source_language+' → '+m.target_language:m?.language;
   const id=JSON.stringify([r.checkpoint,language||'Unknown',m?.scope,...['metric','filter','n_shot','harness','backend'].map(k=>r[k])]);
   if(!buckets.has(id))buckets.set(id,{language:language||'Unknown',known:!!language,rows:[]});buckets.get(id).rows.push(r);
  }
  for(const group of buckets.values()){
   const matches=new Map(e.aggregation.components.map(c=>[c,[]])),problems=[];
   if(!group.known)problems.push('explicit language assignment missing');
   for(const r of group.rows){const cc=e.aggregation.components.filter(c=>matchTask(c.match,r.task));if(cc.length!==1)problems.push(r.task+': '+(cc.length?'ambiguous component matches':'no component match'));else matches.get(cc[0]).push(r);}
   for(const [c,rr] of matches)if(rr.length!==1)problems.push(c.name+': '+(rr.length?'multiple results':'missing'));
   if(problems.length){warnings.push({type:'Incomplete components',name:e.name,eval:e.name,detail:group.language+' · '+group.rows[0].n_shot+' shots: '+problems.join('; ')+'. This language/protocol group is excluded from the calculation. All configured components are required; raw results remain in Eval configuration.',variants:[{settings:'Excluded component group',tasks:group.rows.map(r=>r.task)}]});continue;}
   const total=e.aggregation.components.reduce((sum,c)=>sum+c.relative_weight,0),parts=[...matches].map(([c,rr])=>({row:rr[0],component:c,share:c.relative_weight/total}));
   for(const r of group.rows)accepted.add(r);groups.push({...group,eval:e.name,parts});
  }
 }
 return {rows:rows.filter(r=>accepted.has(r)),excluded:rows.filter(r=>!accepted.has(r)),groups,warnings};
}
// Each complete language/protocol group has equal influence within its eval.
function evalDistribution(rows,config){
 const e=config.evals.find(e=>e.name===rows[0]?.eval),coefficients=new Map();
 const coverage=e?.aggregation?componentCoverage(rows,{...config,evals:[e]}):{rows,groups:[]};
 if(e?.aggregation){for(const g of coverage.groups)for(const p of g.parts)coefficients.set(p.row,p.share/coverage.groups.length);}
 else for(const r of coverage.rows)coefficients.set(r,1/coverage.rows.length);
 return {rows:coverage.rows,coefficients,score:coverage.rows.length?coverage.rows.reduce((sum,r)=>sum+r.score_100*coefficients.get(r),0):null};
}
function totals(rows,scheme,weights,aggregate='standard',englishWeights=scheme.english_weights||{},metadata=new Map((scheme.languages||[]).flatMap(g=>g.tasks.map(task=>[task,g])))){
 const rowWeights=new Map(rows.map(r=>[r,0]));
 const fs=scheme.evals.map(f=>{const distribution=evalDistribution(rows.filter(r=>r.eval===f.name),scheme),rr=distribution.rows;return {...f,score:distribution.score,rows:rr,weight:0,contribution:rr.length?null:0,aggregateScore:null,excluded:!rr.length,englishShare:0,effectiveEnglishShare:null,englishScore:null,otherScore:null,issue:''};});
 const availableWeight=Object.entries(weights).filter(([name])=>fs.some(f=>f.category===name&&f.rows.length)).reduce((sum,[,weight])=>sum+weight,0);
 const cats=Object.keys(weights).map(name=>{
  const configured=fs.filter(f=>f.category===name),ff=configured.filter(f=>f.rows.length),share=aggregate!=='standard'?(Object.hasOwn(englishWeights,name)?englishWeights[name]:0):0,split=share!==0;
  const c={name,weight:ff.length&&availableWeight?weights[name]/availableWeight:0,excluded:!ff.length,excludedEvals:configured.filter(f=>!f.rows.length).map(f=>f.name),score:null,englishShare:share,effectiveEnglishShare:null,englishScore:null,otherScore:null,issue:''};
  if(c.excluded)return c;
  if(!Number.isFinite(share)||share<0||share>1)c.issue='English share must be between 0 and 1.';
  else if(!split){c.score=avg(ff.map(f=>f.score));for(const f of ff)for(const [r,w] of evalDistribution(f.rows,scheme).coefficients)rowWeights.set(r,c.weight/ff.length*w);}
  else if(aggregate==='english_eval'){
   for(const f of ff){
    f.englishShare=share;
    const groups=['english','other'].map(side=>f.rows.filter(r=>scoreLanguage(r,metadata)===side));
    [f.englishScore,f.otherScore]=groups.map(group=>evalDistribution(group,scheme).score);
    f.effectiveEnglishShare=f.englishScore===null?0:f.otherScore===null?1:share;
    f.aggregateScore=f.effectiveEnglishShare*(f.englishScore??0)+(1-f.effectiveEnglishShare)*(f.otherScore??0);
    groups.forEach((group,i)=>{for(const [r,w] of evalDistribution(group,scheme).coefficients)rowWeights.set(r,c.weight/ff.length*(i===0?f.effectiveEnglishShare:1-f.effectiveEnglishShare)*w);});
   }
   if(!c.issue)c.score=avg(ff.map(f=>f.aggregateScore));
  }
  else {
   const groups=['english','other'].map(side=>ff.map(f=>({eval:f,rows:f.rows.filter(r=>scoreLanguage(r,metadata)===side)})).filter(f=>f.rows.length));
   [c.englishScore,c.otherScore]=groups.map(group=>avg(group.map(f=>evalDistribution(f.rows,scheme).score)));
   if(!c.issue){
    c.effectiveEnglishShare=c.englishScore===null?0:c.otherScore===null?1:share;
    const parts=[c.effectiveEnglishShare,1-c.effectiveEnglishShare];
    c.score=parts[0]*(c.englishScore??0)+parts[1]*(c.otherScore??0);
    groups.forEach((group,i)=>{for(const f of group)for(const [r,w] of evalDistribution(f.rows,scheme).coefficients)rowWeights.set(r,c.weight*parts[i]/group.length*w);});
   }
  }
  for(const f of ff){f.weight=f.rows.reduce((sum,r)=>sum+rowWeights.get(r),0);f.contribution=c.score===null?null:f.rows.reduce((sum,r)=>sum+r.score_100*rowWeights.get(r),0);f.aggregateScore=c.score!==null&&f.weight?f.contribution/f.weight:null;}
  return c;
 });
 const valid=Object.values(weights).every(w=>Number.isFinite(w)&&w>=0)&&Math.abs(Object.values(weights).reduce((s,w)=>s+w,0)-1)<1e-8;
 return {evals:fs,categories:cats,rowWeights,score:valid&&availableWeight>0&&cats.filter(c=>!c.excluded).every(c=>c.score!==null)?cats.reduce((s,c)=>s+(c.excluded?0:c.score*c.weight),0):null};
}
function pairRows(a,b){const bm=new Map(b.map(r=>[key(r),r]));return a.filter(r=>bm.has(key(r))).map(r=>({...r,a:r.raw_score_100,b:bm.get(key(r)).raw_score_100,delta:r.raw_score_100-bm.get(key(r)).raw_score_100,score_delta:r.score_100-bm.get(key(r)).score_100}));}
function sampleCount(row){const value=String(row.n_samples??'');return /^[1-9][0-9]*$(?![\s\S])/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;}
function comparisonCoverage(a,b,config){
 const left=componentCoverage(a,config),right=componentCoverage(b,config),initial=pairRows(left.rows,right.rows),shared=new Set(initial.map(key));
 const sharedLeft=componentCoverage(left.rows.filter(r=>shared.has(key(r))),config),sharedRight=componentCoverage(right.rows.filter(r=>shared.has(key(r))),config);
 const aa=sharedLeft.rows,bb=sharedRight.rows,pairs=pairRows(aa,bb),matched=new Set(pairRows(a,b).map(key));
 const onlyA=a.filter(r=>!matched.has(key(r))),onlyB=b.filter(r=>!matched.has(key(r))),warnings=[];
 for(const [model,coverage] of [['A',left],['B',right],['Shared A',sharedLeft],['Shared B',sharedRight]])for(const w of coverage.warnings)warnings.push({...w,detail:model+': '+w.detail});
 const excludedA=a.filter(r=>!aa.includes(r)),excludedB=b.filter(r=>!bb.includes(r));
 for(const e of config.evals){const left=onlyA.filter(r=>r.eval===e.name),right=onlyB.filter(r=>r.eval===e.name);if(!left.length&&!right.length)continue;
  const hasShared=pairs.some(r=>r.eval===e.name);
  warnings.push({type:'Comparison coverage',name:e.name,eval:e.name,detail:(hasShared?'Unmatched variants are excluded from both scores.':'No matching scores: this eval is excluded from both scores.')+' '+left.length+' measurement(s) available only in A; '+right.length+' only in B. Remaining evals share their category weight; empty categories are excluded and remaining category weights are rescaled.',variants:[[left,'Available only in A (missing from B)'],[right,'Available only in B (missing from A)']].filter(([rr])=>rr.length).map(([rr,settings])=>({settings,tasks:rr.map(r=>r.task+' · '+r.metric+' / '+(r.filter||'blank filter')+' / '+r.n_shot+' shots / '+r.harness+' / '+r.backend)}))});
 }
 const bm=new Map(bb.map(r=>[key(r),r]));
 for(const e of config.evals){
  const mismatch=aa.filter(r=>r.eval===e.name&&sampleCount(r)!==null&&sampleCount(bm.get(key(r)))!==null&&sampleCount(r)!==sampleCount(bm.get(key(r))));
  if(mismatch.length)warnings.push({type:'Sample-count mismatch',name:e.name,eval:e.name,detail:'Matched measurements report different n_samples for A and B. Scores remain included; review dataset coverage before comparing.',variants:[{settings:'Reported sample counts',tasks:mismatch.map(r=>r.task+' · '+r.metric+' · A: '+r.n_samples+' / B: '+bm.get(key(r)).n_samples)}]});
 }
 return {a:aa,b:bb,pairs,warnings,onlyA,onlyB,excludedA,excludedB};
}
const syntheticOptions=Object.freeze([
 Object.freeze({name:demoModel,offset:0}),
 Object.freeze({name:'SYNTHETIC demo — higher scores',offset:3}),
 Object.freeze({name:'SYNTHETIC demo — lower scores',offset:-3})
]);
function synthetic(rows,config,option=syntheticOptions[0]){
 let seed=20260930;
 const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed+.5)/4294967296;};
 const evals=new Map(config.evals.map(e=>[e.name,e]));
 return rows.map(r=>{
  const perturb=2*Math.sqrt(-2*Math.log(rand()))*Math.cos(2*Math.PI*rand()),e=evals.get(r.eval);
  const value=Math.max(0,Math.min(100,r.raw_score_100+option.offset+perturb))/100*e.score.scale;
  return {...r,checkpoint:option.name,value:String(value),...normalizeScore(value,e),stderr:'',result_time:'',results_file:`synthetic: seed 20260930; mean shift ${option.offset}; normal sd 2 score points; clipped to [0,100]`};
 });
}
function languageRoles(row,metadata){const m=metadata.get(row.task);return m?.scope==='translation'?[{language:m.source_language,role:'from'},{language:m.target_language,role:'to'}]:[{language:m?.language||'Unknown',role:'eval'}];}
function matchesLanguage(row,metadata,language='',role=''){return languageRoles(row,metadata).some(m=>(!language||m.language===language)&&(!role||m.role===role));}
function languageCoverage(rows,metadata){
 const codes=new Set(),pooled=new Set(),unknown=new Set();
 for(const r of rows){const m=metadata.get(r.task);if(!m||m.scope==='unknown')unknown.add(r.task);else if(m.scope==='pooled')pooled.add(m.language);else for(const role of languageRoles(r,metadata))codes.add(role.language);}
 return {count:codes.size,pooled:pooled.size,unknown:unknown.size};
}
function languageCountLabel(coverage){return [coverage.count?String(coverage.count):'',coverage.pooled?coverage.pooled+' pooled':'',coverage.unknown?'unknown':''].filter(Boolean).join(' + ')||'0';}
function languageLabel(code){return code==='mul'?'Multilingual (pooled)':code;}
function sortBreakdownTree(tree,field='label',order='ascending'){
 const label=n=>n.kind==='language'?languageLabel(n.label):n.label;
 const value=n=>field==='label'?label(n):n[field];
 return tree.map(n=>({...n,children:sortBreakdownTree(n.children,field,order)})).sort((a,b)=>{
  const x=value(a),y=value(b),missing=v=>v===null||v===undefined||typeof v==='number'&&!Number.isFinite(v);
  if(missing(x)!==missing(y))return missing(x)?1:-1;
  const difference=missing(x)?0:typeof x==='string'?x.localeCompare(y):x-y;
  return (order==='ascending'?1:-1)*difference||label(a).localeCompare(label(b))||(a.detail||'').localeCompare(b.detail||'');
 });
}
// Summaries use distinct measurements, independent of repeated translation branches.
function breakdownAggregate(rows,config=null){
 const unique=[...new Map(rows.map(r=>[key(r),r])).values()],evals=[...new Set(unique.map(r=>r.eval))];
 const scores=evals.map(name=>{
  const rr=unique.filter(r=>r.eval===name),e=config?.evals.find(e=>e.name===name);
  if(!e?.aggregation)return {a:avg(rr.map(r=>r.a)),b:avg(rr.map(r=>r.b))};
  const dist=evalDistribution(rr,config);
  if(dist.rows.length!==rr.length||!rr.length)return {a:null,b:null};
  return {a:dist.score,b:rr.reduce((sum,r)=>sum+(r.score_100-r.score_delta)*dist.coefficients.get(r),0)};
 });
 const a=scores.some(s=>s.a===null)?null:avg(scores.map(s=>s.a)),b=scores.some(s=>s.b===null)?null:avg(scores.map(s=>s.b));
 return {a,b,delta:a===null||b===null?null:a-b,count:unique.length,evals:evals.length};
}
function buildBreakdownTree(rows,metadata,view,languageFilter='',roleFilter='',config=null,reference=rows){
 const components=new Map();
 if(config)for(const group of componentCoverage(reference,config).groups)for(const p of group.parts)components.set(key(p.row),{componentName:p.component.name,componentRelativeWeight:p.component.relative_weight,componentShare:p.share,componentNormalizedA:p.row.score_100,componentNormalizedB:p.row.score_100-p.row.score_delta,componentA:p.row.score_100*p.share,componentB:(p.row.score_100-p.row.score_delta)*p.share});
 const groups=(rr,values)=>{const map=new Map();for(const r of rr)for(const value of new Set(values(r))){if(!map.has(value))map.set(value,[]);map.get(value).push(r);}return [...map].sort(([a],[b])=>a.localeCompare(b));};
 const node=(kind,label,rr,children=[])=>({kind,label,...breakdownAggregate(rr,config),componentAggregate:rr.length>0&&rr.every(r=>config?.evals.find(e=>e.name===r.eval)?.aggregation),children});
 const leaves=rr=>rr.slice().sort((a,b)=>a.task.localeCompare(b.task)||key(a).localeCompare(key(b))).map(r=>({...node('variant',r.task,[r]),...breakdownAggregate([r]),...components.get(key(r)),detail:r.metric+' · '+(r.filter||'no filter')+' · '+r.n_shot+' shot'}));
 const languageGroups=rr=>groups(rr,r=>languageRoles(r,metadata).filter(m=>(!languageFilter||m.language===languageFilter)&&(!roleFilter||m.role===roleFilter)).map(m=>m.language));
 function details(rr,language){
  const ordinary=rr.filter(r=>metadata.get(r.task)?.scope!=='translation'),translation=rr.filter(r=>metadata.get(r.task)?.scope==='translation');
  const children=leaves(ordinary);
  for(const role of ['from','to']){
   if(roleFilter&&roleFilter!==role)continue;
   const directed=translation.filter(r=>matchesLanguage(r,metadata,language,role));if(!directed.length)continue;
   children.push(node('direction',(role==='from'?'From ':'To ')+language,directed,groups(directed,r=>{const m=metadata.get(r.task);return [m.source_language+' → '+m.target_language];}).map(([pair,rr])=>node('pair',pair,rr,leaves(rr)))));
  }
  return children;
 }
 if(view==='category')return groups(rows,r=>[r.category]).map(([category,rr])=>node('category',category,rr,groups(rr,r=>[r.eval]).map(([name,ee])=>node('eval',name,ee,languageGroups(ee).map(([language,ll])=>node('language',language,ll,details(ll,language)))))));
 return languageGroups(rows).map(([language,ll])=>node('language',language,ll,groups(ll,r=>[r.category]).map(([category,cc])=>node('category',category,cc,groups(cc,r=>[r.eval]).map(([name,ee])=>node('eval',name,ee,details(ee,language)))))));
}
function protocolWarning(rows,evalConfig,config,model){
 // Compare sets per task: identical alternate settings in every language are consistent.
 const fields=['n_shot','metric','filter','harness','backend'],tasks=new Map();
 for(const r of rows.filter(r=>r.selected)){if(!tasks.has(r.task))tasks.set(r.task,new Set());tasks.get(r.task).add(JSON.stringify(fields.map(f=>String(r[f]))));}
 const groups=new Map();for(const [task,settings] of tasks){const signature=JSON.stringify([...settings].sort());if(!groups.has(signature))groups.set(signature,[]);groups.get(signature).push(task);}
 if(groups.size<2)return null;
 const variants=[...groups].map(([signature,names])=>{
  const settings=JSON.parse(signature).map(k=>{const [shots,metric,filter,harness,backend]=JSON.parse(k);return shots+' shots / '+metric+' / filter '+(filter||'(empty)')+' / '+harness+' / '+backend;}).join('; ');
  const labels=names.sort().map(task=>{const m=taskLanguage(task,config),language=m.scope==='translation'?m.source_language+' → '+m.target_language:m.language||'Unknown';return task+' ['+language+']';});
  return {settings,tasks:labels};
 });
 return {type:'Inconsistent scoring settings',name:evalConfig.name,eval:evalConfig.name,model,detail:'Selected variants use different settings: '+variants.map(v=>v.settings+' ('+v.tasks.length+' tasks; '+v.tasks.slice(0,2).join(', ')+(v.tasks.length>2?', …':'')+')').join(' versus ')+'. '+(evalConfig.aggregation?'Only complete component groups within each protocol are included.':'These variants are still included in the aggregate.')+' Review the protocol before comparing languages.',variants};
}
function normalizationLabel(e){const n=e.normalize;if(!n||n.min===0&&n.max===1)return n?.basis==='unresolved'?'Unresolved · no correction':'No chance correction';return fmt(n.min*100,2)+'% baseline';}
function sameCoverage(a,b){return a.length===b.length&&pairRows(a,b).length===a.length;}
// Public, serializable analysis boundary used by Python parity tests and the UI.
function compareText(a,b){const aa=Array.from(a,c=>c.codePointAt(0)),bb=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;}
function measurementId(r){return JSON.stringify([r.checkpoint,...['task','metric','filter','n_shot','harness','backend'].map(k=>r[k])]);}
const diagnosticTitles={config_caveat:'Config caveat',no_config:'No config',not_used:'Not used',unknown_language:'Unknown language',invalid_sample_count:'Invalid sample count',inconsistent_scoring_settings:'Inconsistent scoring settings',missing_scoring_field:'Missing scoring field',missing_scoring_setting:'Missing scoring setting',no_selected_score:'No selected score',missing_suite_data:'Missing suite data',incomplete_components:'Incomplete components',comparison_coverage:'Comparison coverage',sample_count_mismatch:'Sample-count mismatch',no_category_weight:'No category weight'};
function diagnostic(code,model,evalName,rows,detail,effect='included',tasks=null){
 const names=[...new Set(tasks??rows.map(r=>r.task))].sort(compareText);
 return {code,type:diagnosticTitles[code],model,eval:evalName,name:evalName||names[0]||model,tasks:names,measurement_ids:rows.map(measurementId).sort(compareText),effect,detail,variants:names.length?[{settings:detail,tasks:names}]:[]};
}
function reportDiagnostics(audits,config,included,comparison=false){
 const {catalogue,suite,profile}=config,scheme=resolveConfig(catalogue,suite,profile),out=[];
 const used=new Set([...included.values()].flat().map(r=>r.eval));
 for(const e of catalogue.evals)if(e.warning&&used.has(e.name))out.push(diagnostic('config_caveat','Selected comparison',e.name,[],e.warning));
 for(const [model,rows] of audits){
  const scope=scopeRows(rows,suite),accepted=included.get(model)||[],acceptedIds=new Set(accepted.map(measurementId));
  for(const task of [...new Set(rows.filter(r=>!r.eval).map(r=>r.task))].sort(compareText))out.push(diagnostic('no_config',model,null,rows.filter(r=>r.task===task),'No eval configuration; excluded from scoring.','excluded'));
  for(const e of catalogue.evals){
   const all=rows.filter(r=>r.eval===e.name),outside=all.filter(r=>(!e.select||matchTask(e.select,r.task))&&!inSuite(r,suite)),matching=all.filter(r=>inSuite(r,suite)),selected=matching.filter(r=>r.selected);
   const add=(code,rr,detail,effect='included',tasks=null)=>out.push(diagnostic(code,model,e.name,rr,detail,effect,tasks));
   if(outside.length)add('not_used',outside,'Eval data is present but not selected by '+suite.name+'. Excluded from the calculation.','excluded');
   if(!matching.length)continue;
   const unknown=selected.filter(r=>taskLanguage(r.task,catalogue).status==='unknown');
   if(unknown.length)add('unknown_language',unknown,e.aggregation?'Explicit language assignment missing; component groups are excluded.':'Unknown language; English fallback applies for weighting only.',e.aggregation?'excluded':'included');
   const bad=selected.filter(r=>r.n_samples!==undefined&&r.n_samples!==null&&String(r.n_samples)!==''&&sampleCount(r)===null);
   if(bad.length)add('invalid_sample_count',bad,'Invalid sample count; retained scores are not weighted by sample count.');
   const protocol=protocolWarning(matching,e,catalogue,model);
   if(protocol)add('inconsistent_scoring_settings',selected,protocol.detail);
   for(const task of [...new Set(matching.filter(r=>!e.select||matchTask(e.select,r.task)).map(r=>r.task))].sort(compareText)){
    const rr=matching.filter(r=>r.task===task);if(rr.some(r=>r.selected))continue;
    add(rr.some(r=>r.metric===e.metric)?'missing_scoring_setting':'missing_scoring_field',rr,'Excluded: expected '+e.metric+' / '+(e.filter||'(empty)')+('shots'in e?' / '+e.shots+' shots':'')+'.','excluded');
   }
   if(!selected.length)add('no_selected_score',matching,'No score matches the configured metric, filter, shots and selection. Excluded.','excluded');
  }
  for(const name of [...new Set(scope.missing.map(r=>r.eval))])out.push(diagnostic('missing_suite_data',model,name,[],'Required results are missing from '+suite.name+'. Excluded; remaining weights are redistributed.','excluded',scope.missing.filter(r=>r.eval===name&&r.task).map(r=>r.task)));
  const component=componentCoverage(scope.rows,scheme);
  for(const name of [...new Set(component.excluded.map(r=>r.eval))])out.push(diagnostic('incomplete_components',model,name,component.excluded.filter(r=>r.eval===name),component.warnings.filter(w=>w.eval===name).map(w=>w.detail).join(' '),'excluded'));
  if(comparison)for(const name of [...new Set(component.rows.filter(r=>!acceptedIds.has(measurementId(r))).map(r=>r.eval))])out.push(diagnostic('comparison_coverage',model,name,component.rows.filter(r=>r.eval===name&&!acceptedIds.has(measurementId(r))),'Unmatched results are excluded from both scores; weights use shared data only.','excluded'));
 }
 for(const category of [...new Set([...included.values()].flat().map(r=>r.category))])if(!Object.hasOwn(profile.weights,category))out.push({...diagnostic('no_category_weight','Selected comparison',null,[...included.values()].flat().filter(r=>r.category===category),category+' has no category weight and contributes zero.','zero_weight'),name:category,category});
 if(comparison){const entries=[...included],a=entries[0]?.[1]||[],b=entries[1]?.[1]||a,bm=new Map(b.map(r=>[key(r),r]));
  for(const e of catalogue.evals){const rr=a.filter(r=>r.eval===e.name&&bm.has(key(r))&&sampleCount(r)!==null&&sampleCount(bm.get(key(r)))!==null&&sampleCount(r)!==sampleCount(bm.get(key(r))));if(rr.length)out.push(diagnostic('sample_count_mismatch','Selected comparison',e.name,rr.concat(rr.map(r=>bm.get(key(r)))),'Matched results have different sample counts. Scores remain included.'));}
 }
 return out;
}
function allocationTree(rows,config,allocation,model){
 const metadata=new Map(config.languages.flatMap(g=>g.tasks.map(t=>[t,g])));
 const grouped=(rr,fn)=>{const groups=new Map();for(const r of rr){const k=fn(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}return [...groups].sort(([a],[b])=>compareText(a,b));};
 const language=r=>{const m=metadata.get(r.task);return m?.scope==='translation'?m.source_language+' → '+m.target_language:m?.language||'Unknown';};
 function node(kind,label,rr,children=[],relative=null,measurement=null){const weight=rr.reduce((s,r)=>s+(allocation.rowWeights.get(r)||0),0),contribution=rr.reduce((s,r)=>s+r.score_100*(allocation.rowWeights.get(r)||0),0);return {kind,label,score:weight?contribution/weight:measurement?rr[0].score_100:null,weight:0,effective_weight:weight,contribution,relative_weight:relative,measurement_id:measurement,children};}
 const leaves=(rr,e)=>rr.slice().sort((a,b)=>compareText(measurementId(a),measurementId(b))).map(r=>{const c=e.aggregation?.components.find(c=>matchTask(c.match,r.task));return node(c?'component':'measurement',c?.name||r.task,[r],[],c?.relative_weight??null,measurementId(r));});
 const langs=(rr,e)=>grouped(rr,language).map(([l,ll])=>node('language',l,ll,e.aggregation?grouped(ll,r=>JSON.stringify(['metric','filter','n_shot','harness','backend'].map(k=>r[k]))).map(([p,pp])=>node('protocol',p,pp,leaves(pp,e))):leaves(ll,e)));
 const balance=(rr,children)=>grouped(rr,r=>scoreLanguage(r,metadata)).map(([side,ss])=>node('language_group',side,ss,children(ss)));
 const evalNodes=(rr,split)=>config.evals.filter(e=>rr.some(r=>r.eval===e.name)).map(e=>{const ee=rr.filter(r=>r.eval===e.name);return node('eval',e.name,ee,split?balance(ee,ss=>langs(ss,e)):langs(ee,e));});
 const cats=Object.keys(config.weights).sort(compareText).filter(c=>rows.some(r=>r.category===c)).map(c=>{const rr=rows.filter(r=>r.category===c),split=config.aggregate!=='standard'&&(Object.hasOwn(config.english_weights,c)?config.english_weights[c]:0)!==0;return node('category',c,rr,split&&config.aggregate==='english_category'?balance(rr,ss=>evalNodes(ss,false)):evalNodes(rr,split));});
 const root=node('model',model,rows,cats);root.score=allocation.score;root.weight=allocation.score===null?0:1;
 function assign(n,path){n.id=JSON.stringify(path);for(const child of n.children){child.weight=n.effective_weight?child.effective_weight/n.effective_weight:0;assign(child,[...path,[child.kind,child.measurement_id||child.label]]);}}
 assign(root,[['model',model]]);return root;
}
function modelReport(model,audit,rows,config,suite){
 const allocation=totals(rows,config,config.weights,config.aggregate,config.english_weights),ids=new Set(rows.map(measurementId));
 return {model,score:allocation.score,tree:allocationTree(rows,config,allocation,model),measurements:audit.map(r=>({...r,id:measurementId(r),language:taskLanguage(r.task,config),included:ids.has(measurementId(r)),exclusion:r.selected?inSuite(r,suite)?ids.has(measurementId(r))?null:'coverage':'eval_set':'interpretation',effective_weight:allocation.rowWeights.get(r)||0,contribution:ids.has(measurementId(r))?r.score_100*(allocation.rowWeights.get(r)||0):0}))};
}
function prepareAnalysis(rows,config){
 const scheme=resolveConfig(config.catalogue,config.suite,config.profile),audit=auditRows(rows,config.catalogue),models=[...new Set(audit.map(r=>r.checkpoint))].sort(compareText);
 return {scheme,audits:new Map(models.map(m=>[m,audit.filter(r=>r.checkpoint===m)]))};
}
function analyze(rows,config){
 const {scheme,audits}=prepareAnalysis(rows,config),included=new Map([...audits].map(([m,rr])=>[m,componentCoverage(scopeRows(rr,config.suite).rows,scheme).rows]));
 return {models:[...audits].map(([m,rr])=>modelReport(m,rr,included.get(m),scheme,config.suite)),diagnostics:reportDiagnostics(audits,config,included),coverage:[...audits].map(([model,rr])=>{const scope=scopeRows(rr,config.suite);return {model,missing:scope.missing,complete:!scope.missing.length&&scope.rows.length===included.get(model).length};})};
}
function compareAudits(auditA,auditB,config,a,b){
 const scheme=resolveConfig(config.catalogue,config.suite,config.profile),scope=suiteCoverage(auditA,auditB,config.suite),coverage=comparisonCoverage(scope.a,scope.b,scheme),effective=suiteCoverage(coverage.a,coverage.b,config.suite);
 const audits=new Map([[a,auditA],[b,auditB]]),included=new Map([[a,coverage.a],[b,coverage.b]]),left=modelReport(a,auditA,coverage.a,scheme,config.suite),right=modelReport(b,auditB,coverage.b,scheme,config.suite);
 const aw=new Map(left.measurements.map(r=>[r.id,r.effective_weight]));
 const result={a:left,b:right,delta:left.score===null||right.score===null?null:left.score-right.score,diagnostics:reportDiagnostics(audits,config,included,true),coverage:{complete:config.suite.mode==='fixed'?effective.complete:!coverage.excludedA.length&&!coverage.excludedB.length,required:scope.required,sharedRequired:effective.sharedRequired,presentA:scope.presentA,presentB:scope.presentB,extrasA:scope.extrasA,extrasB:scope.extrasB},deltas:coverage.pairs.map(r=>({task:r.task,measurement_a:measurementId(r),measurement_b:measurementId({...r,checkpoint:b}),raw_delta:r.delta,score_delta:r.score_delta,effective_weight:aw.get(measurementId(r)),contribution_delta:r.score_delta*aw.get(measurementId(r))}))};
 return {result,scope:{...scope,complete:effective.complete,sharedRequired:effective.sharedRequired},...coverage};
}
function compare(rows,config,a,b){
 const {audits}=prepareAnalysis(rows,config);if(!audits.has(a)||!audits.has(b))throw Error('Unknown comparison model');
 return compareAudits(audits.get(a),audits.get(b),config,a,b).result;
}

return {analyze,compare,compareAudits,allocationTree,measurementId,selectRows,buildCatalogue,comparisonRows,weightingLanguage,scoreLanguage,englishAssignment,componentCoverage,evalDistribution,totals,pairRows,sampleCount,comparisonCoverage,synthetic,syntheticOptions,isDemoModel,languageRoles,matchesLanguage,languageCoverage,languageCountLabel,languageLabel,sortBreakdownTree,breakdownAggregate,buildBreakdownTree,protocolWarning,reportDiagnostics,normalizationLabel,sameCoverage,key,avg,fmt,esc,parseCSV,parseCatalogue,serializeCatalogue,validateCatalogue,normalizeScore,taskLanguage,auditRows,matchTask,demoModel,parseSuite,serializeSuite,parseWeightProfile,serializeWeightProfile,resolveConfig,inSuite,suiteCoverage,scopeRows};
})();
if(typeof module!=='undefined')module.exports=QuickdashAnalysis;
