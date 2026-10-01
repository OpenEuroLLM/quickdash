'use strict';
const key = r => JSON.stringify(['task','metric','filter','n_shot','harness','backend'].map(k=>r[k]));
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const fmt = (x,digits=2) => x === null || !Number.isFinite(x) ? '—' : x.toFixed(digits);
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {parseCSV,parseCatalogue,serializeCatalogue,validateCatalogue,normalizeScore,taskLanguage,auditRows,matchTask,demoModel}=typeof module!=='undefined'?require('./eval_config.js'):EvalConfig;
const {parseSuite,serializeSuite,parseWeightProfile,serializeWeightProfile,resolveConfig,inSuite,suiteCoverage}=typeof module!=='undefined'?require('./suite_config.js'):SuiteConfig;
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
function totals(rows,scheme,weights,aggregate='standard',englishWeights=scheme.english_weights||{},metadata=new Map((scheme.languages||[]).flatMap(g=>g.tasks.map(task=>[task,g])))){
 const rowWeights=new Map(rows.map(r=>[r,0]));
 const fs=scheme.evals.map(f=>{const rr=rows.filter(r=>r.eval===f.name);return {...f,score:avg(rr.map(r=>r.score_100)),rows:rr,weight:0,contribution:rr.length?null:0,aggregateScore:null,excluded:!rr.length,englishShare:0,effectiveEnglishShare:null,englishScore:null,otherScore:null,issue:''};});
 const availableWeight=Object.entries(weights).filter(([name])=>fs.some(f=>f.category===name&&f.rows.length)).reduce((sum,[,weight])=>sum+weight,0);
 const cats=Object.keys(weights).map(name=>{
  const configured=fs.filter(f=>f.category===name),ff=configured.filter(f=>f.rows.length),share=aggregate!=='standard'?(englishWeights[name]??0):0,split=share!==0;
  const c={name,weight:ff.length&&availableWeight?weights[name]/availableWeight:0,excluded:!ff.length,excludedEvals:configured.filter(f=>!f.rows.length).map(f=>f.name),score:null,englishShare:share,effectiveEnglishShare:null,englishScore:null,otherScore:null,issue:''};
  if(c.excluded)return c;
  if(!Number.isFinite(share)||share<0||share>1)c.issue='English share must be between 0 and 1.';
  else if(!split){c.score=avg(ff.map(f=>f.score));for(const f of ff)for(const r of f.rows)rowWeights.set(r,c.weight/ff.length/f.rows.length);}
  else if(aggregate==='english_eval'){
   for(const f of ff){
    f.englishShare=share;
    const groups=['english','other'].map(side=>f.rows.filter(r=>scoreLanguage(r,metadata)===side));
    [f.englishScore,f.otherScore]=groups.map(group=>avg(group.map(r=>r.score_100)));
    f.effectiveEnglishShare=f.englishScore===null?0:f.otherScore===null?1:share;
    f.aggregateScore=f.effectiveEnglishShare*(f.englishScore??0)+(1-f.effectiveEnglishShare)*(f.otherScore??0);
    groups.forEach((group,i)=>{for(const r of group)rowWeights.set(r,c.weight/ff.length*(i===0?f.effectiveEnglishShare:1-f.effectiveEnglishShare)/group.length);});
   }
   if(!c.issue)c.score=avg(ff.map(f=>f.aggregateScore));
  }
  else {
   const groups=['english','other'].map(side=>ff.map(f=>({eval:f,rows:f.rows.filter(r=>scoreLanguage(r,metadata)===side)})).filter(f=>f.rows.length));
   [c.englishScore,c.otherScore]=groups.map(group=>avg(group.map(f=>avg(f.rows.map(r=>r.score_100)))));
   if(!c.issue){
    c.effectiveEnglishShare=c.englishScore===null?0:c.otherScore===null?1:share;
    const parts=[c.effectiveEnglishShare,1-c.effectiveEnglishShare];
    c.score=parts[0]*(c.englishScore??0)+parts[1]*(c.otherScore??0);
    groups.forEach((group,i)=>{for(const f of group)for(const r of f.rows)rowWeights.set(r,c.weight*parts[i]/group.length/f.rows.length);});
   }
  }
  for(const f of ff){f.weight=f.rows.reduce((sum,r)=>sum+rowWeights.get(r),0);f.contribution=c.score===null?null:f.rows.reduce((sum,r)=>sum+r.score_100*rowWeights.get(r),0);f.aggregateScore=c.score!==null&&f.weight?f.contribution/f.weight:null;}
  return c;
 });
 const valid=Object.values(weights).every(w=>Number.isFinite(w)&&w>=0)&&Math.abs(Object.values(weights).reduce((s,w)=>s+w,0)-1)<1e-8;
 return {evals:fs,categories:cats,rowWeights,score:valid&&availableWeight>0&&cats.filter(c=>!c.excluded).every(c=>c.score!==null)?cats.reduce((s,c)=>s+(c.excluded?0:c.score*c.weight),0):null};
}
function pairRows(a,b){const bm=new Map(b.map(r=>[key(r),r]));return a.filter(r=>bm.has(key(r))).map(r=>({...r,a:r.raw_score_100,b:bm.get(key(r)).raw_score_100,delta:r.raw_score_100-bm.get(key(r)).raw_score_100,score_delta:r.score_100-bm.get(key(r)).score_100}));}
function sampleCount(row){const value=String(row.n_samples??'');return /^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;}
function comparisonCoverage(a,b,config){
 const pairs=pairRows(a,b),matched=new Set(pairs.map(key)),aa=a.filter(r=>matched.has(key(r))),bb=b.filter(r=>matched.has(key(r)));
 const onlyA=a.filter(r=>!matched.has(key(r))),onlyB=b.filter(r=>!matched.has(key(r))),warnings=[];
 for(const e of config.evals){const left=onlyA.filter(r=>r.eval===e.name),right=onlyB.filter(r=>r.eval===e.name);if(!left.length&&!right.length)continue;
  const hasShared=pairs.some(r=>r.eval===e.name);
  warnings.push({type:'Comparison coverage',name:e.name,eval:e.name,detail:(hasShared?'Unmatched variants are excluded from both scores.':'No matching scores: this eval is excluded from both scores.')+' '+left.length+' measurement(s) available only in A; '+right.length+' only in B. Remaining evals share their category weight; empty categories are excluded and remaining category weights are rescaled.',variants:[[left,'Available only in A (missing from B)'],[right,'Available only in B (missing from A)']].filter(([rr])=>rr.length).map(([rr,settings])=>({settings,tasks:rr.map(r=>r.task+' · '+r.metric+' / '+(r.filter||'blank filter')+' / '+r.n_shot+' shots / '+r.harness+' / '+r.backend)}))});
 }
 const bm=new Map(bb.map(r=>[key(r),r]));
 for(const e of config.evals){
  const mismatch=aa.filter(r=>r.eval===e.name&&sampleCount(r)!==null&&sampleCount(bm.get(key(r)))!==null&&sampleCount(r)!==sampleCount(bm.get(key(r))));
  if(mismatch.length)warnings.push({type:'Sample-count mismatch',name:e.name,eval:e.name,detail:'Matched measurements report different n_samples for A and B. Scores remain included; review dataset coverage before comparing.',variants:[{settings:'Reported sample counts',tasks:mismatch.map(r=>r.task+' · '+r.metric+' · A: '+r.n_samples+' / B: '+bm.get(key(r)).n_samples)}]});
 }
 return {a:aa,b:bb,pairs,warnings,onlyA,onlyB};
}
function synthetic(rows,config){let seed=20260930;const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed+.5)/4294967296;};return rows.map(r=>{const perturb=2*Math.sqrt(-2*Math.log(rand()))*Math.cos(2*Math.PI*rand());return {...r,checkpoint:'SYNTHETIC demo — perturbed',...normalizeScore(Math.max(0,Math.min(100,r.raw_score_100+perturb))/100*config.evals.find(e=>e.name===r.eval).score.scale,config.evals.find(e=>e.name===r.eval)),stderr:'',result_time:'',results_file:'synthetic: seed 20260930; normal sd 2 score points; clipped to [0,100]'};});}
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
function breakdownAggregate(rows){
 const unique=[...new Map(rows.map(r=>[key(r),r])).values()],evals=[...new Set(unique.map(r=>r.eval))];
 const a=avg(evals.map(e=>avg(unique.filter(r=>r.eval===e).map(r=>r.a)))),b=avg(evals.map(e=>avg(unique.filter(r=>r.eval===e).map(r=>r.b))));
 return {a,b,delta:a===null||b===null?null:a-b,count:unique.length,evals:evals.length};
}
function buildBreakdownTree(rows,metadata,view,languageFilter='',roleFilter=''){
 const groups=(rr,values)=>{const map=new Map();for(const r of rr)for(const value of new Set(values(r))){if(!map.has(value))map.set(value,[]);map.get(value).push(r);}return [...map].sort(([a],[b])=>a.localeCompare(b));};
 const node=(kind,label,rr,children=[])=>({kind,label,...breakdownAggregate(rr),children});
 const leaves=rr=>rr.slice().sort((a,b)=>a.task.localeCompare(b.task)||key(a).localeCompare(key(b))).map(r=>({...node('variant',r.task,[r]),detail:r.metric+' · '+(r.filter||'no filter')+' · '+r.n_shot+' shot'}));
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
 return {type:'Inconsistent scoring settings',name:evalConfig.name,eval:evalConfig.name,model,detail:'Selected variants use different settings: '+variants.map(v=>v.settings+' ('+v.tasks.length+' tasks; '+v.tasks.slice(0,2).join(', ')+(v.tasks.length>2?', …':'')+')').join(' versus ')+'. These variants are still included in the aggregate. Review the protocol before comparing languages.',variants};
}
function collectWarnings(audits,config,aggregate='standard',englishWeights=config.english_weights||{},suite={mode:'available'},displayedRows=null){
 const displayed=new Set((displayedRows??[...audits.values()].flat().filter(r=>r.selected&&inSuite(r,suite))).map(r=>r.eval));
 const warnings=config.evals.filter(e=>e.warning&&displayed.has(e.name)).map(e=>({type:'Config caveat',name:e.name,eval:e.name,model:'Selected comparison',detail:e.warning}));
 for(const [model,rows] of audits){
  if(aggregate!=='standard')for(const c of totals(rows.filter(r=>r.selected),config,config.weights,aggregate,englishWeights).categories)if(c.englishShare!==0&&c.issue)warnings.push({type:'English split unavailable',name:c.name,model,detail:c.issue});
  for(const task of [...new Set(rows.filter(r=>!r.eval).map(r=>r.task))].sort())warnings.push({type:'No config',name:task,model,detail:'Excluded from scoring. Add an eval match to the YAML config.'});
  for(const e of config.evals){
   const all=rows.filter(r=>r.eval===e.name),outside=all.filter(r=>(!e.select||matchTask(e.select,r.task))&&!inSuite(r,suite));
   if(outside.length)warnings.push({type:'Not used',name:e.name,eval:e.name,model,detail:'Eval data is present but not selected by '+suite.name+'. These results are excluded from the calculation; inspect them in Eval configuration.',variants:[{settings:'Not used by the selected eval set',tasks:[...new Set(outside.map(r=>r.task+' · '+r.n_shot+' shots'))]}]});
   const matching=all.filter(r=>inSuite(r,suite));
   if(!matching.length)continue;
   const selected=matching.filter(r=>r.selected),unknown=[...new Set(selected.filter(r=>taskLanguage(r.task,config).status==='unknown').map(r=>r.task))];
   if(unknown.length)warnings.push({type:'Unknown language',name:e.name,eval:e.name,model,detail:'No explicit language assignment for '+unknown.length+' selected task(s). Included in scoring; both English-balance modes use the English fallback. Language views retain Unknown.',variants:[{settings:'Add an explicit language assignment in YAML',tasks:unknown}]});
   const badSamples=selected.filter(r=>r.n_samples!==undefined&&r.n_samples!==null&&String(r.n_samples)!==''&&sampleCount(r)===null);
   if(badSamples.length)warnings.push({type:'Invalid sample count',name:e.name,eval:e.name,model,detail:'n_samples must be a positive integer when supplied. Scores remain included; sample counts do not determine score weights. Check the export.',variants:[{settings:'Invalid reported n_samples',tasks:badSamples.map(r=>r.task+' · '+String(r.n_samples))}]});
   const protocol=protocolWarning(matching,e,config,model);if(protocol)warnings.push(protocol);
   const tasks=[...new Set(matching.filter(r=>!e.select||matchTask(e.select,r.task)).map(r=>r.task))];
   for(const task of tasks){const variants=matching.filter(r=>r.task===task);if(variants.some(r=>r.selected))continue;
    const hasMetric=variants.some(r=>r.metric===e.metric);
    warnings.push({type:hasMetric?'Missing scoring setting':'Missing scoring field',name:task,eval:e.name,model,detail:'Excluded: expected '+e.metric+' with filter '+(e.filter||'(empty)')+('shots'in e?', '+e.shots+' shots':'')+'. Available: '+[...new Set(variants.map(r=>r.metric+' / '+(r.filter||'(empty)')+' / '+r.n_shot+' shots'))].join('; ')+'.'});
   }
   if(!matching.some(r=>r.selected))warnings.push({type:'No selected score',name:e.name,model,detail:'Tasks exist, but none match the configured metric, filter, shots and selection rule. Excluded from scoring; remaining evals share the category weight.'});
  }
 }
 return warnings;
}
function normalizationLabel(e){const n=e.normalize;if(!n||n.min===0&&n.max===1)return n?.basis==='unresolved'?'Unresolved · no correction':'No chance correction';return fmt(n.min*100,2)+'% baseline';}
function sameCoverage(a,b){return a.length===b.length&&pairRows(a,b).length===a.length;}
if(typeof module!=='undefined')module.exports={parseCSV,auditRows,selectRows,buildCatalogue,totals,pairRows,comparisonCoverage,synthetic,comparisonRows,languageRoles,matchesLanguage,languageCoverage,breakdownAggregate,buildBreakdownTree,sortBreakdownTree,collectWarnings,sameCoverage};
if(typeof document!=='undefined')start();

function start(){
 const $=id=>document.getElementById(id);let catalogue=DATA.catalogue,suite=DATA.suite,profile=DATA.profile,scheme=DATA.scheme,weights={...scheme.weights},englishWeights={...scheme.english_weights};
 const suites=DATA.suites,profiles=DATA.profiles;let activeSuite='0',activeProfile='0';
 let catalogueGroups=new Map();
 let models=new Map(),sourceAudits=new Map(),metadata=new Map(DATA.metadata.map(r=>[r.task,r]));
 for(const m of DATA.models){const audit=auditRows(DATA.rows.filter(r=>r.checkpoint===m.model),catalogue);sourceAudits.set(m.model,audit);models.set(m.model,audit.filter(r=>r.selected));}
 if(models.size)models.set(demoModel,synthetic([...models.values()][0],catalogue));
 const state={aggregate:scheme.aggregate||'standard',view:'score',scoreCategory:Object.keys(weights)[0],group:'eval',expandedComparisons:new Set(),measure:'raw',sort:'descending',sortBy:'delta',languageSort:'label',languageOrder:'ascending'};
 const languages=r=>languageRoles(r,metadata).map(m=>m.language);
 const td=x=>'<td>'+esc(x)+'</td>';
 const num=(x,digits=2)=>'<td class="num">'+fmt(x,digits)+'</td>';
 const delta=(x,digits=2)=>'<td class="num '+(x>0?'positive':x<0?'negative':'')+'">'+fmt(x,digits)+'</td>';
 const table=(headers,rows,numeric=[],chart=-1,sortHeaders={})=>'<div class="table-scroll"><table><thead><tr>'+headers.map((h,i)=>'<th scope="col"'+(sortHeaders[i]?' aria-sort="'+sortHeaders[i]+'"':'')+' class="'+(numeric.includes(i)?'num':i===chart?'chart-cell':'')+'">'+(i===chart?'<div class="chart-heading">'+h+'</div>':h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
 const button=(label,attr,value)=>'<button class="text-button" '+attr+'="'+esc(value)+'">'+esc(label)+'</button>';
 const options=(entries,value)=>entries.map(([k,v])=>'<option value="'+esc(k)+'"'+(k===value?' selected':'')+'>'+esc(v)+'</option>').join('');
 const control=(id,label,entries,value)=>'<label>'+label+'<select id="'+id+'">'+options(entries,value)+'</select></label>';
 function modelOptions(preferredB){const previousB=$('modelB').value;for(const id of ['modelA','modelB']){const previous=$(id).value;$(id).innerHTML=options([...models.keys()].map(k=>[k,k]),previous);if(models.has(previous))$(id).value=previous;$(id).disabled=!models.size;}$('modelB').value=preferredB??(models.has(previousB)?previousB:[...sourceAudits.keys()][1]??(models.has(demoModel)?demoModel:''));$('swap').disabled=!models.size;$('clearModels').disabled=!models.size;}
 function configOptions(){
  for(const [id,presets,active,current] of [['suitePreset',suites,activeSuite,suite],['weightPreset',profiles,activeProfile,profile]]){
   const entries=presets.map((p,i)=>[String(i),p.config.name]);if(active==='custom')entries.push(['custom','Uploaded: '+current.name]);$(id).innerHTML=options(entries,active);
  }
 }
 function languageOptions(){const previous=$('language').value;const all=[...new Set([...sourceAudits.values()].flat().flatMap(languages))].sort();$('language').innerHTML=options([['','All languages'],...all.map(k=>[k,languageLabel(k)])],previous);}
 function filters(r){const q=$('search').value.trim().toLowerCase();return (!$('category').value||r.category===$('category').value)&&(!$('eval').value||r.eval===$('eval').value)&&matchesLanguage(r,metadata,$('language').value,$('direction').value)&&(!q||(r.task+' '+r.eval+' '+r.metric).toLowerCase().includes(q));}
 function selected(){
  const scope=suiteCoverage(models.get($('modelA').value)||[],models.get($('modelB').value)||[],suite);
  const coverage=comparisonCoverage(scope.a,scope.b,scheme);
  return {...coverage,scope,shown:coverage.pairs.filter(filters)};
 }
 function activeWarnings(){
  const coverage=selected(),chosen=new Map([...sourceAudits].filter(([name])=>[$('modelA').value,$('modelB').value].includes(name)));
  const warnings=collectWarnings(chosen,catalogue,'standard',{},suite,coverage.a).concat(coverage.warnings.map(w=>({...w,model:'A: '+$('modelA').value+' · B: '+$('modelB').value})));
  if(models.size)warnings.push(...coverage.scope.warnings.map(w=>({...w,model:w.model+': '+$(w.model==='A'?'modelA':'modelB').value})));
  for(const category of new Set(coverage.a.map(r=>r.category)))if(!Object.hasOwn(profile.weights,category)&&weights[category]===0)warnings.push({type:'No category weight',name:category,model:'Selected comparison',detail:'This category is not in the weighting profile and contributes zero. Add it to the profile to include it in the weighted score.'});
  if(state.aggregate!=='standard')for(const c of totals(coverage.a,scheme,weights,state.aggregate,englishWeights,metadata).categories)if(c.issue)warnings.push({type:'English split unavailable',name:c.name,model:'Selected comparison',detail:c.issue});
  return warnings;
 }
 function clearFilters(){for(const id of ['category','eval','language','direction','search'])$(id).value='';}
 function rowBar(value,max){const width=max?Math.abs(value)/max*50:0;return '<div class="delta-track" aria-label="A minus B '+fmt(value,6)+'"><span style="left:'+(value>=0?50:50-width)+'%;width:'+width+'%;background:'+(value>=0?'#188c82':'#c35871')+'"></span></div>';}
 function englishShareLabel(c){
  if(c.excluded)return 'Excluded · no shared scores';
  if(!c.englishShare)return 'Original · split off';
  if(!c.issue&&c.englishScore===null)return 'Other languages only · full weight';
  if(!c.issue&&c.otherScore===null)return 'English weighting group only · full weight';
  return fmt(c.englishShare*100,0)+'% English · '+fmt((1-c.englishShare)*100,0)+'% other';
 }
 function renderScore(a,b,ta,tb,valid){
  if(!models.size)return '<h2>Compare your evaluation results</h2><p>Use <strong>Add model CSV</strong> to open your results. Add a second model to compare training methods.</p><p>Active config: <strong>'+esc(scheme.name)+'</strong>. To use your own YAML, open <button class="text-button" data-open-config="true">Eval configuration</button> and choose <strong>Load catalogue</strong>.</p><p>CSV and YAML files opened here stay in your browser; they are not uploaded. Reloading restores the published models and settings.</p>';

  let html='<div class="section-heading"><div><h2>Weighted score</h2><p>Follow selected variants through eval means and category weights.</p></div></div><div class="formula"><span>Normalize variant scores to 0–100</span><b>→</b><span>'+(state.aggregate==='english_eval'?'Balance languages within each eval':'Mean within each eval')+'</span><b>→</b><span>'+(state.aggregate==='english_category'?'Balance languages across each category':'Average evals equally within each category')+'</span><b>→</b><span>Apply category weights</span></div>';
  html+=table(['Category','Weight','A','B','A contribution','B contribution','Contribution Δ','Explore'],ta.categories.map((c,i)=>{const d=tb.categories[i],w=c.weight,ca=c.excluded?0:c.score===null?null:c.score*w,cb=d.excluded?0:d.score===null?null:d.score*w;return '<tr><td>'+esc(c.name)+(state.aggregate!=='standard'?'<small class="variant-language">'+esc(state.aggregate==='english_eval'?(c.englishShare?fmt(c.englishShare*100,0)+'% English within each eval':'Original · split off'):englishShareLabel(c))+'</small>':'')+(c.excluded?'<small class="missing-field">Excluded · no shared scores</small>':c.excludedEvals.length?'<small class="variant-language">'+c.excludedEvals.length+' eval(s) excluded</small>':'')+(c.issue?'<small class="missing-field">'+esc(c.issue)+'</small>':'')+'</td><td class="num">'+fmt(w*100,3)+'%</td>'+num(c.score)+num(d.score)+num(ca,4)+num(cb,4)+delta(valid&&ca!==null&&cb!==null?ca-cb:null,4)+'<td>'+button('Evals','data-score-category',c.name)+'</td></tr>';}),[1,2,3,4,5,6]);
  html+='<details id="weightEditor"><summary>Adjust category weights and English shares</summary><p class="notice">English shares apply only when <strong>either English-balance option</strong> is selected in <strong>Score calculation</strong> above. '+(state.aggregate!=='standard'?'They are active now: '+(state.aggregate==='english_eval'?'inside each eval':'across each category')+'.':'They are saved but inactive while Original weighted score is selected.')+'</p><p class="caption">Category weights sum to 1. English share gives English and other languages 0.5 each at a 50/50 setting. It is applied inside each eval or across the category, according to the selected calculation. A group with only one language side keeps its full weight automatically. Set 0 to disable the split.</p><div id="weights">'+table(['Category','Category weight','English share'],Object.entries(weights).map(([c,w])=>'<tr data-weight-category="'+esc(c)+'"><td>'+esc(c)+'</td><td class="num"><input aria-label="'+esc(c)+' category weight" type="number" step="any" min="0" max="1" data-weight="'+esc(c)+'" value="'+w+'"></td><td class="num"><input aria-label="'+esc(c)+' English share" type="number" step="0.05" min="0" max="1" data-english-weight="'+esc(c)+'" value="'+(englishWeights[c]??0)+'"></td></tr>'),[1,2])+'</div><p id="weightSum">Total category weight: '+fmt(Object.values(weights).reduce((s,w)=>s+w,0),6)+' · must equal 1.</p><button id="resetWeights">Reset profile weights</button></details>';

  const category=state.scoreCategory;
  html+='<div class="section-heading"><h3>Inside a category</h3>'+control('scoreCategory','Category',Object.keys(weights).map(k=>[k,k]),category)+'</div>';
  const fs=scheme.evals.filter(f=>f.category===category);
  if(state.aggregate!=='standard'){
   const perEval=state.aggregate==='english_eval',aa=perEval?ta.evals.filter(e=>e.category===category):ta.categories,bb=perEval?tb.evals.filter(e=>e.category===category):tb.categories;
   html+='<details id="englishComponents"><summary>English / other-language components '+(perEval?'within each eval':'across each category')+'</summary>'+table([perEval?'Eval':'Category','Split used','English A','Other A','English B','Other B'],aa.map((c,i)=>'<tr>'+td(c.name)+td(englishShareLabel(c))+num(c.englishScore)+num(c.otherScore)+num(bb[i].englishScore)+num(bb[i].otherScore)+'</tr>'),[2,3,4,5])+'<p class="caption">'+(perEval?'Each eval combines its English mean and other-language mean first. The resulting eval scores are averaged equally within the category.':'Each side averages variants within an eval, then represented evals equally. The category combines those English and other-language averages; eval weights can differ.')+' A group with only one language side retains its full weight. Translation uses the target language. Unknown or mixed-language scores count as English for weighting; known non-English pools count as other. Missing evals are excluded; remaining weights are rescaled.</p></details>';
  }
  html+=table(['Eval','Metric used','Variants A / B','A','B','Effective weight','Contribution Δ','Explore'],fs.map(f=>{const sa=ta.evals.find(x=>x.name===f.name),sb=tb.evals.find(x=>x.name===f.name),n=a.filter(r=>r.eval===f.name).length,m=b.filter(r=>r.eval===f.name).length,w=sa.weight;return '<tr>'+td(f.name)+td(f.metric)+'<td class="num">'+n+' / '+m+'</td>'+num(sa.aggregateScore)+num(sb.aggregateScore)+'<td class="num">'+fmt(w*100,3)+'%</td>'+delta(valid&&sa.contribution!==null&&sb.contribution!==null?sa.contribution-sb.contribution:null,4)+'<td>'+button('Variants','data-evals',f.name)+'</td></tr>';}),[2,3,4,5,6]);
  html+='<p class="caption">Effective weights and eval scores reflect the selected aggregate. Contributions sum to the category contribution. An eval represented on both sides can have different weights for its English and other-language variants.</p>';
  return html;
 }
 function renderBreakdown(shown){
  const isLanguage=state.view==='languages';
  let html='<div class="section-heading"><div><h2>'+(isLanguage?'Languages':'Categories')+'</h2><p>'+(isLanguage?'Languages → categories → evals':'Categories → evals → languages')+'. Expand a row to inspect its components.</p></div></div>';
  let tree=buildBreakdownTree(shown,metadata,isLanguage?'language':'category',$('language').value,$('direction').value);
  if(isLanguage)tree=sortBreakdownTree(tree,state.languageSort,state.languageOrder);
  function branch(n,depth,parent=[]){
   const path=[...parent,[n.kind,n.label,n.detail||'']];
   const label=n.kind==='language'?languageLabel(n.label):n.label;
   const cells='<span class="tree-label" style="padding-left:'+depth*18+'px"><span class="tree-chevron">'+(n.children.length?'▸':'·')+'</span><span>'+esc(label)+(n.detail?'<small>'+esc(n.detail)+'</small>':'')+'</span></span><span class="tree-count">'+n.count+'</span><span class="tree-number">'+fmt(n.a)+'</span><span class="tree-number">'+fmt(n.b)+'</span><span class="tree-number '+(n.delta>0?'positive':n.delta<0?'negative':'')+'">'+fmt(n.delta)+'</span>';
   const attr=' data-kind="'+n.kind+'" data-label="'+esc(n.label)+'" data-node-key="'+esc(JSON.stringify(path))+'"';
   return n.children.length?'<details class="breakdown-node"'+attr+'><summary class="tree-row">'+cells+'</summary>'+n.children.map(c=>branch(c,depth+1,path)).join('')+'</details>':'<div class="tree-row tree-leaf"'+attr+'>'+cells+'</div>';
  }
  const headers=[[(isLanguage?'Language':'Category')+' / details','label'],['Variants','count'],['Raw A','a'],['Raw B','b'],['A − B','delta']].map(([label,field])=>{
   if(!isLanguage)return '<span>'+label+'</span>';
   const active=state.languageSort===field,order=active?state.languageOrder:'none';
   return '<span role="columnheader" aria-sort="'+order+'"><button class="sort-header" data-language-sort="'+field+'" title="Sort by '+esc(label)+'">'+label+(active?(order==='ascending'?' ↑':' ↓'):' ↕')+'</button></span>';
  }).join('');
  html+='<div class="breakdown-scroll"><div class="breakdown-tree'+(isLanguage?' sortable':'')+'"><div class="tree-row tree-head"'+(isLanguage?' role="row"':'')+'>'+headers+'</div>'+tree.map(n=>branch(n,0)).join('')+'</div></div>';
  if(isLanguage)html+='<p class="caption">Click a column heading to sort; click again to reverse. Sorting applies within each level of the hierarchy and keeps expanded sections open.</p>';
  html+='<p class="caption">Each aggregate averages variants within an eval, then represented evals equally. Counts and means use distinct measurements. Translation is expandable under either endpoint, then From / To, then language pairs; repeated branches do not add weight. Language scores are descriptive because eval coverage differs.</p>';
  return html;
 }
 function renderComparisons(shown,reference,valid){
  let html='<div class="section-heading"><div><h2>Delta comparisons</h2><p>One horizontal bar per row. Left favors B; right favors A.</p></div></div><div class="view-controls">'+control('compareGroup','Rows',[['eval','Evals · all languages grouped'],['variant','All eval language variants'],['category','Categories']],state.group)+control('compareMeasure','Bars',[['raw','Raw A − B'],['weighted','Weighted contribution Δ']],state.measure)+control('compareSort','Order',[['descending','Descending'],['absolute','Largest absolute difference'],['ascending','Ascending'],['name','Eval name']],state.sort)+'</div>';
  if(state.measure==='weighted'&&!valid)return html+'<p class="notice">Weighted differences require shared scores, valid language assignments, and category weights that sum to 1.</p>';
  const items=comparisonRows(shown,reference,scheme,weights,state.group,state.measure,state.sort,state.sortBy,metadata,state.aggregate,englishWeights),expanded=state.group==='eval'?comparisonRows(shown.filter(r=>state.expandedComparisons.has(r.eval)),reference,scheme,weights,'variant',state.measure,state.sort,state.sortBy,metadata,state.aggregate,englishWeights):[],max=Math.max(0,...items.concat(expanded).map(i=>Math.abs(i.delta)));
  html+='<p class="caption">'+items.length+' rows · '+esc(languageCountLabel(languageCoverage(shown,metadata)))+' languages · '+(state.measure==='weighted'?'Full-data weights are retained when filtering. Sum of shown contributions: '+fmt(items.reduce((s,i)=>s+i.weightedDelta,0),4)+' index points.':'Differences in score points. Eval/category rows average their components.')+'</p>';
  function chartRow(i,child=false){
   const m=metadata.get(i.task),language=m?(m.scope==='translation'?m.source_language+' → '+m.target_language:languageLabel(m.language||'Unknown')):'';
   const label='<td class="'+(child?'comparison-child':'')+'">'+esc(i.label)+(language?'<small class="variant-language">'+esc(language)+'</small>':'')+'</td>';
   const action=i.task?'':state.group==='category'?button('Evals','data-category',i.category):button(state.expandedComparisons.has(i.eval)?'Collapse':'Expand languages','data-expand-eval',i.eval);
   return '<tr class="comparison-row'+(child?' comparison-detail':'')+'" data-chart-eval="'+esc(i.eval)+'">'+label+td(i.category)+num(i.a)+num(i.b)+delta(i.rawDelta)+delta(valid?i.weightedDelta:null,4)+'<td class="num language-count">'+esc(languageCountLabel(languageCoverage(i.tasks.map(task=>({task})),metadata)))+'</td><td class="chart-cell">'+rowBar(i.delta,max)+'</td><td>'+action+'</td></tr>';
  }
  let rows=[];for(const i of items){rows.push(chartRow(i));if(state.group==='eval'&&state.expandedComparisons.has(i.eval)){const children=comparisonRows(shown.filter(r=>r.eval===i.eval),reference,scheme,weights,'variant',state.measure,state.sort,state.sortBy,metadata,state.aggregate,englishWeights);rows.push(...children.map(c=>chartRow(c,true)));}}
  const active=state.sort==='name'?'label':state.sortBy==='delta'?(state.measure==='raw'?'rawDelta':'weightedDelta'):state.sortBy;
  const columns=[[state.group==='variant'?'Eval / language variant':'Eval / group','label'],['Category','category'],['Raw A','a'],['Raw B','b'],['Raw A − B','rawDelta'],['Weighted Δ','weightedDelta'],['Languages','languageCount']],sortHeaders={};
  const headers=columns.map(([label,field],index)=>{const selected=field===active,order=state.sort==='name'?'ascending':state.sort;
   if(selected)sortHeaders[index]=order==='absolute'?'other':order;
   return '<button class="sort-header" data-sort-column="'+field+'" title="Sort by '+esc(label)+'">'+esc(label)+(selected?(order==='ascending'?' ↑':order==='absolute'?' |Δ| ↓':' ↓'):' ↕')+'</button>';});
  html+=table([...headers,'B ← 0 → A',''],rows,[2,3,4,5,6],7,sortHeaders);
  html+='<p class="caption">Language counts use distinct codes among shown variants, including both translation endpoints. Pooled language groups are listed separately.</p>';
  if(state.group==='eval')html+='<p class="caption">Eval rows average their language variants. Expand a row to compare its variants, or choose “All eval language variants” to sort every variant together. Expanded details are components of the parent, not extra contributions.</p>';

  return html;
 }
 function normalizationInfo(e){
  const n=e.normalize||{min:0,max:1,clip:true},baseline=Number(n.min.toPrecision(6)),fraction=e.score.scale===1?'value':'value / '+e.score.scale;
  const formula='score = 100 × ('+fraction+' − random_score) / ('+n.max+' − random_score)';
  const explanation=n.min===0?(n.basis==='unresolved'?'Baseline unresolved; no chance correction is currently applied.':'No chance correction is applied. Zero is a configured floor, not a measured random-model score.'):'Chance baseline used for this eval.';
  return '<div class="normalization-info"><strong>Score calculation</strong><p><code>'+esc(formula)+'</code></p><p><code>random_score '+(baseline===n.min?'=':'≈')+' '+baseline+'</code> ('+fmt(n.min*100,2)+'%). '+esc(explanation)+'</p><p class="caption">'+(n.clip===false?'Scores are not clipped.':'The result is clipped to 0–100.')+' The source value is shown in the scoring details below.</p>'+(e.warning?'<p class="missing-field">Warning: '+esc(e.warning)+'</p>':'')+'<details class="baseline-rationale"><summary>Baseline rationale and sources</summary><p>'+esc(n.note||'The baseline is set by normalize.min in the YAML config.')+'</p><p class="caption">random_score is normalize.min in the YAML config; the upper bound is normalize.max.</p>'+((n.sources||[]).length?'<p>'+n.sources.map((url,i)=>'<a target="_blank" rel="noopener" href="'+esc(url)+'">Source '+(i+1)+'</a>').join(' · ')+'</p>':'')+'</details></div>';
 }
 function renderWarnings(){const warnings=activeWarnings();return '<div class="section-heading"><div><h2>Warnings</h2><p>Coverage for the selected comparison, scoring consistency, and config caveats. A named eval set checks required measurements; unused global catalogue rules are allowed.</p></div></div>'+(warnings.length?table(['Warning','Eval / task','Model','Details'],warnings.map(w=>'<tr>'+td(w.type)+td(w.name)+td(w.model)+'<td>'+esc(w.detail)+(w.variants?'<details><summary>All affected variants</summary>'+w.variants.map(v=>'<p><strong>'+esc(v.settings)+'</strong><br>'+v.tasks.map(esc).join('<br>')+'</p>').join('')+'</details>':'')+'</td></tr>')):'<p>No warnings. The selected comparison has no detected data or configuration issues.</p>');}
 function scoringOptions(e,rows){
  const used=rows.filter(r=>r.selected),values=(rr,key)=>[...new Set(rr.map(r=>String(r[key])))].sort((a,b)=>key==='n_shot'?Number(a)-Number(b):a.localeCompare(b));
  const shots=values(used,'n_shot'),otherMetrics=values(rows,'metric').filter(m=>m!==e.metric),otherShots=values(rows,'n_shot').filter(n=>!shots.includes(n)),otherFilters=values(rows,'filter').filter(f=>f!==e.filter);
  return '<strong>Selected: '+esc(e.metric)+'</strong>'+(e.metric==='python_pass@1'?'<small>Python solutions passing tests on one attempt.</small>':'')+'<small>'+(shots.length===1&&shots[0]==='0'?'0-shot · no examples in the prompt':shots.length?'Shots used: '+esc(shots.join(', '))+' · examples in the prompt':'No selected scores')+'</small>'+(e.filter&&e.filter!=='none'?'<small>Answer extraction: '+esc(e.filter)+'</small>':'')+(otherMetrics.length?'<small>Other available metrics: '+esc(otherMetrics.join(', '))+'</small>':'')+(otherShots.length?'<small>Other available shot settings: '+esc(otherShots.join(', '))+'</small>':'')+(otherFilters.length?'<small>Other answer extraction settings: '+esc(otherFilters.map(f=>f||'not specified').join(', '))+'</small>':'');
 }
 function selectionInfo(e){
  return '<p class="caption"><strong>Selection rule:</strong> use metric <code>'+esc(e.metric)+'</code>; '+(e.filter?'answer extraction setting <code>'+esc(e.filter)+'</code>':'the CSV extraction-filter field must be blank')+'; '+('shots'in e?'require '+e.shots+' examples in the prompt':'accept any shot count found in the export')+'. A shot is one example provided in the prompt. Other metrics and shot settings remain available for inspection below.</p>';
 }
 function taskDetails(f,t,missing){
  const m=metadata.get(t.name)||{};
  const warning=missing.filter(w=>w.name===t.name).map(w=>'<p class="missing-field">'+esc(w.model+': '+w.detail)+'</p>').join('');
  const info='<p>'+esc(m.provenance||'No language assignment available.')+(m.evidence?' <a target="_blank" rel="noopener" href="'+esc(m.evidence)+'">Source</a>':'')+'</p><p class="caption">'+esc(f.category)+' · language assignment: '+esc(m.status||'unknown')+'. Selected metrics use the eval’s score calculation above.</p>';
  return warning+info+'<p class="caption"><strong>English-balance group:</strong> '+esc(englishAssignment({task:t.name},metadata))+'. Used in both English-balance modes when this category’s English share is non-zero.</p><p class="caption">Raw source scores are shown for every metric. The 0–100 columns apply to selected scores only.</p>'+table(['Model','Metric','Filter','Shots','Raw source score','Raw / 100','Normalized / 100','Use','Reason','Harness / backend'],t.rows.map(r=>'<tr class="catalogue-metric">'+td(r.checkpoint)+td(r.metric)+td(r.filter||'Not specified')+'<td class="num">'+esc(r.n_shot)+'</td><td class="num source-score">'+esc(r.value)+'</td>'+num(r.raw_score_100)+num(r.score_100)+'<td class="'+(r.selected?'positive':'muted')+'">'+(r.selected?(inSuite(r,suite)?'Selected':'Outside eval set'):'Excluded')+'</td>'+td(r.selected&&!inSuite(r,suite)?'Excluded by '+suite.name:r.decision)+td(r.harness+' / '+r.backend)+'</tr>'),[3,4,5,6]);
 }
 function catalogueTasks(f,missing){
  return table(['Variant / scoring details','Language(s)','Selected metric','Other metrics'],f.tasks.map(t=>{
   const m=metadata.get(t.name)||{},selected=[...new Set(t.rows.filter(r=>r.selected).map(r=>r.metric))],other=[...new Set(t.rows.filter(r=>!r.selected).map(r=>r.metric))],hasMissing=missing.some(w=>w.name===t.name);
   const language=m.source_language?m.source_language+' → '+m.target_language:languageLabel(m.language||'Unknown');
   return '<tr class="catalogue-task'+(hasMissing?' has-missing-field':'')+'"><td><details class="catalogue-variant" data-task="'+esc(t.name)+'"><summary>'+esc(t.name)+'</summary><div class="task-details"></div></details></td>'+td(language)+'<td>'+esc(selected.join(', ')||'Excluded')+(hasMissing?'<small class="missing-field">Missing configured field/settings</small>':'')+'</td>'+td(other.join(', ')||'—')+'</tr>';
  }));
 }
 function populateCatalogue(details){
  if(!details?.isConnected)return;
  const entry=catalogueGroups.get(details.closest('.catalogue-eval')?.dataset.eval);if(!entry)return;
  if(details.matches('.catalogue-eval')){const box=details.querySelector('.catalogue-tasks');if(!box.dataset.loaded){box.innerHTML=catalogueTasks(entry.f,entry.missing);box.dataset.loaded='true';}}
  else if(details.matches('.catalogue-variant')){const box=details.querySelector('.task-details');if(!box.dataset.loaded){const task=entry.f.tasks.find(t=>t.name===details.dataset.task);box.innerHTML=taskDetails(entry.f,task,entry.missing);box.dataset.loaded='true';}}
 }
 function renderConfig(){
  const all=[...sourceAudits.values()].flat(),filtered=all.filter(filters),groups=buildCatalogue(filtered,catalogue),warnings=activeWarnings();
  $('filterStatus').textContent=new Set(filtered.map(r=>r.task)).size+' of '+new Set(all.map(r=>r.task)).size+' task names · '+filtered.length+' metric rows · all loaded real exports; comparison exclusions appear in Warnings';
  let html='<div class="section-heading"><div><h2>Eval configuration</h2><p>Category, language, and scoring field for every eval. Expand an eval to inspect its variants.</p></div></div><div class="catalogue-head"><span>Eval</span><span>Category</span><span>Scoring options</span><span>Languages</span><span>Normalization</span></div>';
  catalogueGroups=new Map();
  html+=groups.map(f=>{const allRows=all.filter(r=>r.eval===f.name),missing=warnings.filter(w=>w.eval===f.name&&['Missing scoring field','Missing scoring setting'].includes(w.type)),inconsistent=warnings.filter(w=>w.eval===f.name&&w.type==='Inconsistent scoring settings');catalogueGroups.set(f.name,{f,missing});const langs=[...new Set(f.tasks.flatMap(t=>languages(t.rows[0]).map(languageLabel)))].sort();return '<details class="catalogue-eval"'+(groups.length===1?' open':'')+' data-eval="'+esc(f.name)+'"><summary class="catalogue-summary"><span>'+esc(f.name)+' <small>('+f.tasks.length+')</small></span><span>'+esc(f.category)+'</span><span class="scoring-options">'+scoringOptions(f,allRows)+(missing.length?'<small class="missing-field">'+missing.length+' missing scoring field/settings</small>':'')+(inconsistent.length?'<small class="missing-field">Inconsistent scoring settings</small>':'')+'</span><small>'+esc(langs.length>4?langs.slice(0,3).join(', ')+' + '+(langs.length-3)+' more':langs.join(', '))+'</small><small>'+esc(normalizationLabel(f))+(f.warning?'<span class="missing-field">Config warning</span>':'')+'</small></summary>'+selectionInfo(f)+normalizationInfo(f)+inconsistent.map(w=>'<p class="notice">'+esc(w.model+': '+w.detail)+'</p>').join('')+'<div class="catalogue-tasks"'+(groups.length===1?' data-loaded="true"':'')+'>'+(groups.length===1?catalogueTasks(f,missing):'')+'</div>'+'</details>';}).join('');
  if(!groups.length)html+='<p>No evals match the filters.</p>';
  html+='<details><summary>Scoring assumptions and source files</summary><ol>'+(scheme.notes||[]).map(n=>'<li>'+esc(n)+'</li>').join('')+'</ol><p><a href="row-audit.csv">Source row audit</a> · <a href="language-metadata.csv">Language assignments</a> · <a href="analysis.json">Analysis JSON</a></p><p class="caption">'+esc(DATA.source)+' · SHA-256 '+esc(DATA.sha256)+'</p></details>';
  const configControls='<details open><summary>Global eval catalogue</summary><p>The catalogue defines matching, categories, scoring fields, normalization, and language assignments for every known eval. It does not require models to run all those evals.</p><p><strong>Normalization:</strong> each eval lists its baseline, formula, and sources below. Chance correction affects weighted scores; raw scores stay unchanged. <code>acc_norm</code> is length-normalized answer scoring, not chance correction.</p><div class="view-controls"><button id="exportConfig">Export catalogue YAML</button><label>Load catalogue<input id="configFile" type="file" accept=".yaml,.yml"></label></div><p class="caption">Active catalogue: '+esc(catalogue.name)+' · '+catalogue.languages.reduce((n,g)=>n+g.tasks.length,0)+' explicit task language assignments.</p></details><details><summary>Weighting profile and optional eval set</summary><p>Weights apply independently of the eval set. <strong>Any available</strong> compares shared recognized measurements and warns on differences. A named set also warns about missing requirements and excludes extra measurements. An incomplete named-set score uses the shared subset with redistributed weights.</p><div class="view-controls"><button id="exportWeights">Export weights YAML</button><label>Load weights<input id="weightsFile" type="file" accept=".yaml,.yml"></label><button id="exportSuite">Export eval set YAML</button><label>Load eval set<input id="suiteFile" type="file" accept=".yaml,.yml"></label></div><p class="caption">Active eval set: '+esc(suite.name)+(suite.exclude?.length?' · Explicitly excluded: '+suite.exclude.map(esc).join(', '):'')+'.</p><p class="caption">All imports are temporary and stay in your browser. Exports save the three inputs separately. Weight exports include your edits and active score calculation.</p></details>';
  html=html.replace('<div class="catalogue-head">',configControls+'<div class="catalogue-head">');

  return html;
 }
 function render(){
  const weightOpen=$('weightEditor')?.open,englishOpen=$('englishComponents')?.open;
  const {a,b,pairs,shown,onlyA,onlyB,scope}=selected(),ta=totals(a,scheme,weights,state.aggregate,englishWeights,metadata),tb=totals(b,scheme,weights,state.aggregate,englishWeights,metadata),valid=sameCoverage(a,b)&&ta.score!==null&&tb.score!==null;
  const demo=[$('modelA').value,$('modelB').value].some(n=>n===demoModel);
  configOptions();$('cards').hidden=!models.size;document.querySelector('.aggregate-controls').hidden=!models.size;
  $('demo').textContent=!models.size?'Ready for your eval results. Load a CSV to begin.':demo?'Demo comparison: one model has synthetic scores. Replace it with a real eval CSV to compare training methods.':'Real-model comparison · Check evaluation settings and training budgets before drawing a conclusion.';
  document.querySelectorAll('[data-aggregate]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.aggregate===state.aggregate)));
  $('aggregateNote').textContent=state.aggregate!=='standard'?(state.aggregate==='english_eval'?'Balance English and other languages inside each eval, then average evals equally within categories.':'Balance English and other languages across each category. Evals with non-English coverage can receive more weight.')+' Shares are set in the weight editor. Unknown or mixed-language scores count as English for weighting; known non-English pools count as other. Raw views stay unchanged.':'Original aggregate: average variants within each eval, then evals within each category.';
  $('cards').innerHTML=[[$('modelA').value,ta.score,'A · '+(state.aggregate==='english_eval'?'English balance per eval':state.aggregate==='english_category'?'English balance per category':'original weighted score')],[$('modelB').value,tb.score,'B · '+(state.aggregate==='english_eval'?'English balance per eval':state.aggregate==='english_category'?'English balance per category':'original weighted score')],['A − B',valid?ta.score-tb.score:null,'Weighted difference'+(suite.mode==='fixed'&&!scope.complete?' · incomplete set':'')]].map(([name,value,label])=>'<div class="score-card"><small>'+esc(name)+'</small><strong>'+fmt(value)+'</strong><span>'+label+'</span></div>').join('');
  $('coverage').classList.toggle('notice',models.size>0&&suite.mode==='fixed'&&!scope.complete);
  $('coverage').textContent=!models.size?'No models loaded · add your CSV.':(suite.mode==='fixed'?suite.name+' · '+(scope.complete?'Complete':'INCOMPLETE')+' · '+scope.sharedRequired+'/'+scope.required+' requirements shared (A '+scope.presentA+', B '+scope.presentB+') · '+(scope.extrasA+scope.extrasB)+' extra measurements excluded · ':suite.name+' · ')+pairs.length+' matched variants · excluded: '+onlyA.length+' from A, '+onlyB.length+' from B · weights use shared data only'+(valid?'':' · Score unavailable: check weights and language assignments.');
  $('filters').hidden=['score','warnings'].includes(state.view);
  $('filterStatus').textContent=shown.length+' of '+pairs.length+' matched variants · filters do not change the full weighted score';
  const warnings=activeWarnings();$('warningCount').textContent=warnings.length;$('warningCount').classList.toggle('has-warnings',warnings.length>0);
  document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===state.view));
  $('view').innerHTML=state.view==='score'?renderScore(a,b,ta,tb,valid):['categories','languages'].includes(state.view)?renderBreakdown(shown,a,valid):state.view==='comparisons'?renderComparisons(shown,a,valid):state.view==='warnings'?renderWarnings():renderConfig();
  if(weightOpen&&$('weightEditor'))$('weightEditor').open=true;if(englishOpen&&$('englishComponents'))$('englishComponents').open=true;
  markHorizontalScroll();
  if(!shown.length&&['categories','languages','comparisons'].includes(state.view))$('view').insertAdjacentHTML('beforeend','<p>No matched variants pass these filters.</p>');
 }
 function refreshConfig(){state.scoreCategory=Object.keys(weights)[0];filterOptions();clearFilters();languageOptions();}
 function importCatalogue(config){
  validateCatalogue(config);const nextScheme=resolveConfig(config,suite,profile);
  const audits=new Map(),nextModels=new Map(),nextMetadata=new Map();
  for(const [name,rows] of sourceAudits){const audit=auditRows(rows,config);audits.set(name,audit);nextModels.set(name,audit.filter(r=>r.selected));for(const row of audit)if(!nextMetadata.has(row.task))nextMetadata.set(row.task,taskLanguage(row.task,config));}
  if(nextModels.size)nextModels.set(demoModel,synthetic([...nextModels.values()][0],config));
  catalogue=config;scheme=nextScheme;sourceAudits=audits;models=nextModels;metadata=nextMetadata;
  weights={...nextScheme.weights,...weights};refreshConfig();
 }
 function importSuite(config,preset='custom'){
  const next=resolveConfig(catalogue,config,profile);suite=config;scheme=next;activeSuite=preset;
  // Changing membership preserves the user's weighting choices and calculation.
  weights={...next.weights,...weights};refreshConfig();
 }
 function importWeights(config,preset='custom'){
  const next=resolveConfig(catalogue,suite,config);profile=config;scheme=next;activeProfile=preset;
  weights={...next.weights};englishWeights={...next.english_weights};state.aggregate=next.aggregate;refreshConfig();
 }
 function exportFile(content,name){const url=URL.createObjectURL(new Blob([content],{type:'application/yaml'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function exportConfig(){exportFile(serializeCatalogue(catalogue),'catalogue.yaml');}
 function exportWeights(){exportFile(serializeWeightProfile({...profile,weights:{...weights},english_weights:{...englishWeights},aggregate:state.aggregate}),'weights.yaml');}
 $('view').onchange=async e=>{try{
  const map={compareGroup:'group',compareMeasure:'measure',compareSort:'sort'};
  if(map[e.target.id]){state[map[e.target.id]]=e.target.value;if(e.target.id==='compareMeasure'||e.target.id==='compareSort'&&['absolute','name'].includes(e.target.value))state.sortBy=e.target.id==='compareSort'&&e.target.value==='name'?'label':'delta';}
  else if(e.target.id==='scoreCategory')state.scoreCategory=e.target.value;
  else if(e.target.dataset.englishWeight){englishWeights[e.target.dataset.englishWeight]=e.target.value===''?NaN:Number(e.target.value);}
  else if(e.target.dataset.weight){weights[e.target.dataset.weight]=e.target.value===''?NaN:Number(e.target.value);}
  else if(e.target.id==='configFile'){const file=e.target.files[0];if(file)importCatalogue(parseCatalogue(await file.text()));}
  else if(e.target.id==='weightsFile'){const file=e.target.files[0];if(file)importWeights(parseWeightProfile(await file.text()));}
  else if(e.target.id==='suiteFile'){const file=e.target.files[0];if(file)importSuite(parseSuite(await file.text()));}
  $('error').textContent='';render();
 }catch(err){$('error').textContent=err.message;}};
 function markHorizontalScroll(){
  // Read dimensions before changing the DOM; the catalogue contains thousands of tables.
  const boxes=[...document.querySelectorAll('.table-scroll,.breakdown-scroll')].map(box=>({box,overflowing:box.clientWidth>0&&box.scrollWidth>box.clientWidth+1}));
  for(const {box,overflowing} of boxes){
   let hint=box.previousElementSibling;
   if(!hint?.classList.contains('scroll-hint')){if(!overflowing)continue;hint=document.createElement('p');hint.className='scroll-hint caption';hint.textContent='Scroll horizontally to see all columns →';box.before(hint);}
   hint.hidden=!overflowing;
  }
 }
 window.addEventListener('resize',markHorizontalScroll);
 let scrollHintFrame;
 $('view').addEventListener('toggle',e=>{if(e.target.open)populateCatalogue(e.target);if(scrollHintFrame)cancelAnimationFrame(scrollHintFrame);scrollHintFrame=requestAnimationFrame(markHorizontalScroll);},true);
 function toggleComparison(name,button){
  const box=button.closest('.table-scroll'),position={x:window.scrollX,y:window.scrollY,top:box.scrollTop,left:box.scrollLeft,rowY:button.closest('tr').getBoundingClientRect().top};
  if(state.expandedComparisons.has(name))state.expandedComparisons.delete(name);else state.expandedComparisons.add(name);
  render();
  const replacement=$('view').querySelector('[data-expand-eval="'+CSS.escape(name)+'"]'),nextBox=replacement.closest('.table-scroll');
  window.scrollTo(position.x,position.y);nextBox.scrollTop=position.top;nextBox.scrollLeft=position.left;
  window.scrollBy(0,replacement.closest('tr').getBoundingClientRect().top-position.rowY);
  replacement.focus({preventScroll:true});
 }
 $('view').onclick=e=>{const d=e.target.dataset;
  const details=e.target.closest('summary')?.parentElement;if(details&&!details.open)populateCatalogue(details);
  if(d.openConfig){state.view='config';render();}
  else if(d.scoreCategory){state.scoreCategory=d.scoreCategory;render();$('view').querySelector('#scoreCategory').scrollIntoView({block:'center'});}
  else if(d.evals||d.category||d.language){clearFilters();if(d.evals)$('eval').value=d.evals;if(d.category)$('category').value=d.category;if(d.language)$('language').value=d.language;if(d.role)$('direction').value=d.role;state.view='comparisons';state.group='variant';render();}
  else if(d.languageSort){
   const opened=new Set([...$('view').querySelectorAll('.breakdown-node[open]')].map(n=>n.dataset.nodeKey));
   const box=e.target.closest('.breakdown-scroll'),position={x:scrollX,y:scrollY,left:box.scrollLeft};
   state.languageOrder=state.languageSort===d.languageSort?(state.languageOrder==='ascending'?'descending':'ascending'):d.languageSort==='label'?'ascending':'descending';
   state.languageSort=d.languageSort;render();
   for(const n of $('view').querySelectorAll('.breakdown-node'))if(opened.has(n.dataset.nodeKey))n.open=true;
   const replacement=$('view').querySelector('[data-language-sort="'+d.languageSort+'"]');
   replacement.closest('.breakdown-scroll').scrollLeft=position.left;window.scrollTo(position.x,position.y);replacement.focus({preventScroll:true});
  }
  else if(d.sortColumn){
   const active=state.sort==='name'?'label':state.sortBy==='delta'?(state.measure==='raw'?'rawDelta':'weightedDelta'):state.sortBy;
   const box=e.target.closest('.table-scroll'),position={x:scrollX,y:scrollY,left:box.scrollLeft};
   state.sort=active===d.sortColumn?(state.sort==='ascending'||state.sort==='name'?'descending':'ascending'):['label','category'].includes(d.sortColumn)?'ascending':'descending';state.sortBy=d.sortColumn;render();
   const replacement=$('view').querySelector('[data-sort-column="'+d.sortColumn+'"]');replacement.closest('.table-scroll').scrollLeft=position.left;window.scrollTo(position.x,position.y);replacement.focus({preventScroll:true});
  }
  else if(d.expandEval)toggleComparison(d.expandEval,e.target);
  else if(e.target.id==='resetWeights'){weights={...scheme.weights};englishWeights={...scheme.english_weights};render();}
  else if(['exportConfig','exportWeights','exportSuite'].includes(e.target.id)){try{if(e.target.id==='exportConfig')exportConfig();else if(e.target.id==='exportWeights')exportWeights();else exportFile(serializeSuite(suite),'eval-set.yaml');$('error').textContent='';}catch(err){$('error').textContent=err.message;}}
 };
 document.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>{state.view=e.dataset.view;render();});
 for(const id of ['modelA','modelB','category','eval','language','direction'])$(id).onchange=render;
 document.querySelectorAll('[data-aggregate]').forEach(button=>button.onclick=()=>{state.aggregate=button.dataset.aggregate;render();});
 $('search').oninput=render;$('clear').onclick=()=>{clearFilters();render();};
 $('swap').onclick=()=>{const value=$('modelA').value;$('modelA').value=$('modelB').value;$('modelB').value=value;render();};
 for(const [id,presets,apply] of [['suitePreset',suites,importSuite],['weightPreset',profiles,importWeights]])$(id).onchange=()=>{const chosen=$(id).value;if(chosen==='custom')return;try{apply(structuredClone(presets[Number(chosen)].config),chosen);$('error').textContent='';render();}catch(err){$('error').textContent=err.message;configOptions();}};
 $('clearModels').onclick=()=>{models=new Map();sourceAudits=new Map();metadata=new Map();modelOptions();clearFilters();languageOptions();state.view='score';$('error').textContent='';render();};
 $('modelFile').onchange=async e=>{try{
  const file=e.target.files[0];if(!file)return;
  const audit=auditRows(parseCSV(await file.text()),catalogue),rows=audit.filter(r=>r.selected),names=[...new Set(audit.map(r=>r.checkpoint))];
  if(!audit.length)throw Error('No measurements in CSV');if(names.some(n=>models.has(n)))throw Error('Checkpoint name already loaded; use a distinct model label.');
  const nextModels=new Map(models),nextAudits=new Map(sourceAudits),nextMetadata=new Map(metadata);
  for(const name of names){nextModels.set(name,rows.filter(r=>r.checkpoint===name));nextAudits.set(name,audit.filter(r=>r.checkpoint===name));}
  for(const r of audit)nextMetadata.set(r.task,taskLanguage(r.task,catalogue));
  if(!nextModels.has(demoModel))nextModels.set(demoModel,synthetic([...nextModels.values()][0],catalogue));
  models=nextModels;sourceAudits=nextAudits;metadata=nextMetadata;
  modelOptions(sourceAudits.size>1?names.at(-1):demoModel);languageOptions();$('error').textContent='';render();
 }catch(err){$('error').textContent=err.message;}finally{e.target.value='';}};
 function filterOptions(){$('category').innerHTML=options([['','All categories'],...[...new Set([...Object.keys(weights),...catalogue.evals.map(e=>e.category)])].map(k=>[k,k])],'');
 $('eval').innerHTML=options([['','All evals'],...catalogue.evals.map(f=>[f.name,f.name])],'');}
 filterOptions();modelOptions();languageOptions();render();
}
