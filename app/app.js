'use strict';
const {compareAudits,selectRows,buildCatalogue,comparisonRows,weightingLanguage,scoreLanguage,englishAssignment,componentCoverage,evalDistribution,totals,pairRows,sampleCount,comparisonCoverage,synthetic,syntheticOptions,isDemoModel,languageRoles,matchesLanguage,languageCoverage,languageCountLabel,languageLabel,sortBreakdownTree,breakdownAggregate,buildBreakdownTree,protocolWarning,normalizationLabel,sameCoverage,key,avg,fmt,esc,parseCSV,parseCatalogue,serializeCatalogue,validateCatalogue,normalizeScore,taskLanguage,auditRows,matchTask,demoModel,parseSuite,serializeSuite,parseWeightProfile,serializeWeightProfile,resolveConfig,inSuite,suiteCoverage}=QuickdashAnalysis;
if(typeof document!=='undefined')start();

function start(){
 const $=id=>document.getElementById(id);let catalogue=DATA.catalogue,suite=DATA.suite,profile=DATA.profile,scheme=DATA.scheme,weights={...scheme.weights},englishWeights={...scheme.english_weights};
 const suites=DATA.suites,profiles=DATA.profiles;let activeSuite='0',activeProfile='0';
 let catalogueGroups=new Map();
 let models=new Map(),sourceAudits=new Map(),metadata=new Map(DATA.metadata.map(r=>[r.task,r]));
 for(const m of DATA.models){const audit=auditRows(DATA.rows.filter(r=>r.checkpoint===m.model),catalogue);sourceAudits.set(m.model,audit);models.set(m.model,audit.filter(r=>r.selected));}
 function addSynthetic(target,config){if(!target.size)return;const rows=[...target.values()][0];for(const option of syntheticOptions)target.set(option.name,synthetic(rows,config,option));}
 addSynthetic(models,catalogue);
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
 let comparisonCache=null;
 function selected(){
  if(!comparisonCache){
   const a=$('modelA').value,b=$('modelB').value;
   comparisonCache=compareAudits(sourceAudits.get(a)||models.get(a)||[],sourceAudits.get(b)||models.get(b)||[],{catalogue,suite,profile},a,b);
  }
  return {...comparisonCache,shown:comparisonCache.pairs.filter(filters)};
 }
 function activeWarnings(){
  if(!models.size)return [];
  const coverage=selected(),warnings=coverage.result.diagnostics.filter(w=>!isDemoModel(w.model)&&(w.code!=='no_category_weight'||weights[w.category]===0));
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

  let html='<div class="section-heading"><div><h2>Weighted score</h2><p>Follow selected variants through eval means and category weights.</p></div></div><div class="formula"><span>Normalize variant scores to 0–100</span><b>→</b><span>Combine configured components within each language / protocol</span><b>→</b><span>'+(state.aggregate==='english_eval'?'Balance languages within each eval':'Mean within each eval')+'</span><b>→</b><span>'+(state.aggregate==='english_category'?'Balance languages across each category':'Average evals equally within each category')+'</span><b>→</b><span>Apply category weights</span></div>';
  html+=table(['Category','Weight','A','B','A contribution','B contribution','Contribution Δ','Explore'],ta.categories.map((c,i)=>{const d=tb.categories[i],w=c.weight,ca=c.excluded?0:c.score===null?null:c.score*w,cb=d.excluded?0:d.score===null?null:d.score*w;return '<tr><td>'+esc(c.name)+(state.aggregate!=='standard'?'<small class="variant-language">'+esc(state.aggregate==='english_eval'?(c.englishShare?fmt(c.englishShare*100,0)+'% English within each eval':'Original · split off'):englishShareLabel(c))+'</small>':'')+(c.excluded?'<small class="missing-field">Excluded · no shared scores</small>':c.excludedEvals.length?'<small class="variant-language">'+c.excludedEvals.length+' eval(s) excluded</small>':'')+(c.issue?'<small class="missing-field">'+esc(c.issue)+'</small>':'')+'</td><td class="num">'+fmt(w*100,3)+'%</td>'+num(c.score)+num(d.score)+num(ca,4)+num(cb,4)+delta(valid&&ca!==null&&cb!==null?ca-cb:null,4)+'<td>'+button('Evals','data-score-category',c.name)+'</td></tr>';}),[1,2,3,4,5,6]);
  html+='<details id="weightEditor"><summary>Adjust category weights and English shares</summary><p class="notice">English shares apply only when <strong>either English-balance option</strong> is selected in <strong>Score calculation</strong> above. '+(state.aggregate!=='standard'?'They are active now: '+(state.aggregate==='english_eval'?'inside each eval':'across each category')+'.':'They are saved but inactive while Original weighted score is selected.')+'</p><p class="caption">Category weights sum to 1. English share gives English and other languages 0.5 each at a 50/50 setting. It is applied inside each eval or across the category, according to the selected calculation. A group with only one language side keeps its full weight automatically. Set 0 to disable the split.</p><div id="weights">'+table(['Category','Category weight','English share'],Object.entries(weights).map(([c,w])=>'<tr data-weight-category="'+esc(c)+'"><td>'+esc(c)+'</td><td class="num"><input aria-label="'+esc(c)+' category weight" type="number" step="any" min="0" max="1" data-weight="'+esc(c)+'" value="'+w+'"></td><td class="num"><input aria-label="'+esc(c)+' English share" type="number" step="0.05" min="0" max="1" data-english-weight="'+esc(c)+'" value="'+(Object.hasOwn(englishWeights,c)?englishWeights[c]:0)+'"></td></tr>'),[1,2])+'</div><p id="weightSum">Total category weight: '+fmt(Object.values(weights).reduce((s,w)=>s+w,0),6)+' · must equal 1.</p><button id="resetWeights">Reset profile weights</button></details>';

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
 function renderBreakdown(shown,reference){
  const isLanguage=state.view==='languages';
  let html='<div class="section-heading"><div><h2>'+(isLanguage?'Languages':'Categories')+'</h2><p>'+(isLanguage?'Languages → categories → evals':'Categories → evals → languages')+'. Expand a row to inspect its components.</p></div></div>';
  const hasComponents=shown.some(r=>scheme.evals.find(e=>e.name===r.eval)?.aggregation);
  let tree=buildBreakdownTree(shown,metadata,isLanguage?'language':'category',$('language').value,$('direction').value,scheme,reference);
  if(isLanguage)tree=sortBreakdownTree(tree,state.languageSort,state.languageOrder);
  function branch(n,depth,parent=[]){
   const path=[...parent,[n.kind,n.label,n.detail||'']];
   const label=n.kind==='language'?languageLabel(n.label):n.label;
   let cells='<span class="tree-label" style="padding-left:'+depth*18+'px"><span class="tree-chevron">'+(n.children.length?'▸':'·')+'</span><span>'+esc(label)+(n.detail?'<small>'+esc(n.detail)+'</small>':'')+(n.componentAggregate&&n.children.length?'<small>Calculated component score</small>':'')+(n.componentShare!==undefined?'<small>Normalized A '+fmt(n.componentNormalizedA)+' · B '+fmt(n.componentNormalizedB)+'</small>':'')+'</span></span><span class="tree-count">'+n.count+'</span><span class="tree-number">'+fmt(n.a)+'</span><span class="tree-number">'+fmt(n.b)+'</span><span class="tree-number '+(n.delta>0?'positive':n.delta<0?'negative':'')+'">'+fmt(n.delta)+'</span>';
   if(hasComponents)cells+='<span class="tree-number">'+(n.componentShare!==undefined?esc(n.componentRelativeWeight)+' · '+fmt(n.componentShare*100,2)+'%':'—')+'</span><span class="tree-number">'+fmt(n.componentA,3)+'</span><span class="tree-number">'+fmt(n.componentB,3)+'</span>';
   const attr=' data-kind="'+n.kind+'" data-label="'+esc(n.label)+'" data-node-key="'+esc(JSON.stringify(path))+'"';
   return n.children.length?'<details class="breakdown-node"'+attr+'><summary class="tree-row">'+cells+'</summary>'+n.children.map(c=>branch(c,depth+1,path)).join('')+'</details>':'<div class="tree-row tree-leaf"'+attr+'>'+cells+'</div>';
  }
  const headers=[[(isLanguage?'Language':'Category')+' / details','label'],['Variants','count'],[hasComponents?'A score':'Raw A','a'],[hasComponents?'B score':'Raw B','b'],['A − B','delta'],...(hasComponents?[['Relative weight / share','componentShare'],['Group contribution A','componentA'],['Group contribution B','componentB']]:[])].map(([label,field])=>{
   if(!isLanguage)return '<span>'+label+'</span>';
   const active=state.languageSort===field,order=active?state.languageOrder:'none';
   return '<span role="columnheader" aria-sort="'+order+'"><button class="sort-header" data-language-sort="'+field+'" title="Sort by '+esc(label)+'">'+label+(active?(order==='ascending'?' ↑':' ↓'):' ↕')+'</button></span>';
  }).join('');
  html+='<div class="breakdown-scroll"><div class="breakdown-tree'+(isLanguage?' sortable':'')+(hasComponents?' with-components':'')+'"><div class="tree-row tree-head"'+(isLanguage?' role="row"':'')+'>'+headers+'</div>'+tree.map(n=>branch(n,0)).join('')+'</div></div>';
  if(isLanguage)html+='<p class="caption">Click a column heading to sort; click again to reverse. Sorting applies within each level of the hierarchy and keeps expanded sections open.</p>';
  if(hasComponents)html+='<p class="notice">Configured component evals show their calculated, normalized score when collapsed. Leaves show raw scores; component weights apply to normalized scores. Group contributions are points toward one language/protocol score, before language and category weights. Other evals retain raw averages. A filtered, incomplete component set shows — instead of a partial score.</p>';
  html+='<p class="caption">For evals without component rules, each aggregate averages variants within an eval, then represented evals equally. Counts and means use distinct measurements. Translation is expandable under either endpoint, then From / To, then language pairs; repeated branches do not add weight. Language scores are descriptive because eval coverage differs.</p>';
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
 function aggregationInfo(e){
  const a=e.aggregation;if(!a)return '';
  const total=a.components.reduce((sum,c)=>sum+c.relative_weight,0);
  return '<div class="normalization-info component-info"><strong>Component aggregation</strong><p><code>group score = sum(relative_weight × normalized score) / '+esc(total)+'</code></p>'+table(['Component','Task match','Relative weight','Share of group'],a.components.map(c=>'<tr>'+td(c.name)+td(c.match.name??c.match.regex)+num(c.relative_weight,3)+'<td class="num">'+fmt(c.relative_weight/total*100,2)+'%</td></tr>'),[2,3])+'<p>All components are required within the same language and scoring protocol. Missing, ambiguous, or duplicate components exclude that group from both comparison scores. Complete groups are averaged within the eval, with the selected English balance applied afterward.</p>'+(a.note?'<p>'+esc(a.note)+'</p>':'')+(a.sources?.length?'<p>'+a.sources.map((u,i)=>'<a target="_blank" rel="noopener" href="'+esc(u)+'">Aggregation source '+(i+1)+'</a>').join(' · ')+'</p>':'')+'</div>';
 }
 function renderWarnings(){const warnings=activeWarnings();return '<div class="section-heading"><div><h2>Warnings</h2><p>Coverage for the selected comparison, scoring consistency, and config caveats. A named eval set checks required measurements; unused global catalogue rules are allowed.</p></div></div>'+(warnings.length?table(['Warning','Eval / task','Model','Details'],warnings.map(w=>'<tr>'+td(w.type)+td(w.name)+td(w.model)+'<td>'+esc(w.detail)+(w.variants?'<details><summary>All affected variants</summary>'+w.variants.map(v=>'<p><strong>'+esc(v.settings)+'</strong><br>'+v.tasks.map(esc).join('<br>')+'</p>').join('')+'</details>':'')+'</td></tr>')):'<p>No warnings. The selected comparison has no detected data or configuration issues.</p>');}
 function scoringOptions(e,rows){
  const used=rows.filter(r=>r.selected),values=(rr,key)=>[...new Set(rr.map(r=>String(r[key])))].sort((a,b)=>key==='n_shot'?Number(a)-Number(b):a.localeCompare(b));
  const shots=values(used,'n_shot'),otherMetrics=values(rows,'metric').filter(m=>m!==e.metric),otherShots=values(rows,'n_shot').filter(n=>!shots.includes(n)),otherFilters=values(rows,'filter').filter(f=>f!==e.filter);
  return '<strong>Selected: '+esc(e.metric)+'</strong>'+(e.aggregation?'<small>Weighted components · expand for weights</small>':'')+(e.metric==='python_pass@1'?'<small>Python solutions passing tests on one attempt.</small>':'')+'<small>'+(shots.length===1&&shots[0]==='0'?'0-shot · no examples in the prompt':shots.length?'Shots used: '+esc(shots.join(', '))+' · examples in the prompt':'No selected scores')+'</small>'+(e.filter&&e.filter!=='none'?'<small>Answer extraction: '+esc(e.filter)+'</small>':'')+(otherMetrics.length?'<small>Other available metrics: '+esc(otherMetrics.join(', '))+'</small>':'')+(otherShots.length?'<small>Other available shot settings: '+esc(otherShots.join(', '))+'</small>':'')+(otherFilters.length?'<small>Other answer extraction settings: '+esc(otherFilters.map(f=>f||'not specified').join(', '))+'</small>':'');
 }
 function selectionInfo(e){
  return '<p class="caption"><strong>Selection rule:</strong> use metric <code>'+esc(e.metric)+'</code>; '+(e.filter?'answer extraction setting <code>'+esc(e.filter)+'</code>':'the CSV extraction-filter field must be blank')+'; '+('shots'in e?'require '+e.shots+' examples in the prompt':'accept any shot count found in the export')+'. A shot is one example provided in the prompt. Other metrics and shot settings remain available for inspection below.</p>';
 }
 function taskDetails(f,t,missing){
  const m=metadata.get(t.name)||{};
  const warning=missing.filter(w=>w.tasks.includes(t.name)).map(w=>'<p class="missing-field">'+esc(w.model+': '+w.detail)+'</p>').join('');
  const info='<p>'+esc(m.provenance||'No language assignment available.')+(m.evidence?' <a target="_blank" rel="noopener" href="'+esc(m.evidence)+'">Source</a>':'')+'</p><p class="caption">'+esc(f.category)+' · language assignment: '+esc(m.status||'unknown')+'. Selected metrics use the eval’s score calculation above.</p>';
  const cc=f.aggregation?.components.filter(c=>matchTask(c.match,t.name))||[],component=cc.length===1?cc[0]:null;
  const componentInfo=component?'<p class="caption">Component: <strong>'+esc(component.name)+'</strong> · relative weight '+esc(component.relative_weight)+' / '+f.aggregation.components.reduce((sum,c)=>sum+c.relative_weight,0)+'. Applied after normalization, before language and category weights.</p>':'';
  const coverage=selected(),used=new Map([[$('modelA').value,new Set(coverage.a.map(key))],[$('modelB').value,new Set(coverage.b.map(key))]]);
  const use=r=>!r.selected?['Excluded',r.decision]:!inSuite(r,suite)?['Outside eval set','Excluded by '+suite.name]:used.has(r.checkpoint)&&!used.get(r.checkpoint).has(key(r))?['Excluded from comparison','No complete shared component group or matching A/B measurement; see Warnings.']:['Selected',r.decision];
  return warning+info+componentInfo+'<p class="caption"><strong>English-balance group:</strong> '+esc(englishAssignment({task:t.name},metadata))+'. Used in both English-balance modes when this category’s English share is non-zero.</p><p class="caption">Raw source scores are shown for every metric. The 0–100 columns apply to selected scores only.</p>'+table(['Model','Metric','Filter','Shots','Raw source score','Raw / 100','Normalized / 100','Use','Reason','Harness / backend'],t.rows.map(r=>'<tr class="catalogue-metric">'+td(r.checkpoint)+td(r.metric)+td(r.filter||'Not specified')+'<td class="num">'+esc(r.n_shot)+'</td><td class="num source-score">'+esc(r.value)+'</td>'+num(r.raw_score_100)+num(r.score_100)+'<td class="'+(use(r)[0]==='Selected'?'positive':'muted')+'">'+esc(use(r)[0])+'</td>'+td(use(r)[1])+td(r.harness+' / '+r.backend)+'</tr>'),[3,4,5,6]);
 }
 function catalogueTasks(f,missing){
  return table(['Variant / scoring details','Language(s)','Selected metric','Other metrics'],f.tasks.map(t=>{
   const m=metadata.get(t.name)||{},selected=[...new Set(t.rows.filter(r=>r.selected).map(r=>r.metric))],other=[...new Set(t.rows.filter(r=>!r.selected).map(r=>r.metric))],hasMissing=missing.some(w=>w.tasks.includes(t.name));
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
  html+=groups.map(f=>{const allRows=all.filter(r=>r.eval===f.name),missing=warnings.filter(w=>w.eval===f.name&&['Missing scoring field','Missing scoring setting'].includes(w.type)),inconsistent=warnings.filter(w=>w.eval===f.name&&w.type==='Inconsistent scoring settings');catalogueGroups.set(f.name,{f,missing});const langs=[...new Set(f.tasks.flatMap(t=>languages(t.rows[0]).map(languageLabel)))].sort();return '<details class="catalogue-eval"'+(groups.length===1?' open':'')+' data-eval="'+esc(f.name)+'"><summary class="catalogue-summary"><span>'+esc(f.name)+' <small>('+f.tasks.length+')</small></span><span>'+esc(f.category)+'</span><span class="scoring-options">'+scoringOptions(f,allRows)+(missing.length?'<small class="missing-field">'+missing.length+' missing scoring field/settings</small>':'')+(inconsistent.length?'<small class="missing-field">Inconsistent scoring settings</small>':'')+'</span><small>'+esc(langs.length>4?langs.slice(0,3).join(', ')+' + '+(langs.length-3)+' more':langs.join(', '))+'</small><small>'+esc(normalizationLabel(f))+(f.warning?'<span class="missing-field">Config warning</span>':'')+'</small></summary>'+selectionInfo(f)+normalizationInfo(f)+aggregationInfo(f)+inconsistent.map(w=>'<p class="notice">'+esc(w.model+': '+w.detail)+'</p>').join('')+'<div class="catalogue-tasks"'+(groups.length===1?' data-loaded="true"':'')+'>'+(groups.length===1?catalogueTasks(f,missing):'')+'</div>'+'</details>';}).join('');
  if(!groups.length)html+='<p>No evals match the filters.</p>';
  html+='<details><summary>Scoring assumptions and source files</summary><ol>'+(scheme.notes||[]).map(n=>'<li>'+esc(n)+'</li>').join('')+'</ol><p><a href="row-audit.csv">Source row audit</a> · <a href="language-metadata.csv">Language assignments</a> · <a href="analysis.json">Analysis JSON</a></p><p class="caption">'+esc(DATA.source)+' · SHA-256 '+esc(DATA.sha256)+'</p></details>';
  const configControls='<details open><summary>Global eval catalogue</summary><p>The catalogue defines matching, categories, scoring fields, normalization, and language assignments for every known eval. It does not require models to run all those evals.</p><p><strong>Normalization:</strong> each eval lists its baseline, formula, and sources below. Chance correction and component aggregation affect calculated scores; individual raw scores stay unchanged. <code>acc_norm</code> is length-normalized answer scoring, not chance correction.</p><div class="view-controls"><button id="exportConfig">Export catalogue YAML</button><label>Load catalogue<input id="configFile" type="file" accept=".yaml,.yml"></label></div><p class="caption">Catalogue export includes every eval and language in one portable YAML file.</p><p class="caption">Active catalogue: '+esc(catalogue.name)+' · '+catalogue.languages.reduce((n,g)=>n+g.tasks.length,0)+' explicit task language assignments.</p></details><details><summary>Weighting profile and optional eval set</summary><p>Weights apply independently of the eval set. <strong>Any available</strong> compares shared recognized measurements and warns on differences. A named set also warns about missing requirements and excludes extra measurements. An incomplete named-set score uses the shared subset with redistributed weights.</p><div class="view-controls"><button id="exportWeights">Export weights YAML</button><label>Load weights<input id="weightsFile" type="file" accept=".yaml,.yml"></label><button id="exportSuite">Export eval set YAML</button><label>Load eval set<input id="suiteFile" type="file" accept=".yaml,.yml"></label></div><p class="caption">Active eval set: '+esc(suite.name)+(suite.exclude?.length?' · Explicitly excluded: '+suite.exclude.map(esc).join(', '):'')+'.</p><p class="caption">All imports are temporary and stay in your browser. Exports save the three inputs separately. Weight exports include your edits and active score calculation.</p></details>';
  html=html.replace('<div class="catalogue-head">',configControls+'<div class="catalogue-head">');

  return html;
 }
 function render(){
  comparisonCache=null;
  const weightOpen=$('weightEditor')?.open,englishOpen=$('englishComponents')?.open;
  const {a,b,pairs,shown,excludedA,excludedB,scope}=selected(),ta=totals(a,scheme,weights,state.aggregate,englishWeights,metadata),tb=totals(b,scheme,weights,state.aggregate,englishWeights,metadata),valid=sameCoverage(a,b)&&ta.score!==null&&tb.score!==null;
  const demo=[$('modelA').value,$('modelB').value].some(isDemoModel);
  configOptions();$('cards').hidden=!models.size;document.querySelector('.aggregate-controls').hidden=!models.size;
  const sample=[$('modelA').value,$('modelB').value].some(n=>(DATA.sample_models||[]).includes(n));
  $('demo').textContent=!models.size?'Ready for your eval results. Load a CSV to begin.':demo?'Demo comparison: synthetic scores are seeded perturbations of the first loaded model (2-point standard deviation; higher/lower options add/subtract 3 raw score points, clipped to 0–100). For exploration only.':sample?'Sample dataset for exploring Quickdash. Add your own CSVs to compare training methods.':'Real-model comparison · Check evaluation settings and training budgets before drawing a conclusion.';
  document.querySelectorAll('[data-aggregate]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.aggregate===state.aggregate)));
  $('aggregateNote').textContent=state.aggregate!=='standard'?(state.aggregate==='english_eval'?'Balance English and other languages inside each eval, then average evals equally within categories.':'Balance English and other languages across each category. Evals with non-English coverage can receive more weight.')+' Shares are set in the weight editor. Unknown or mixed-language scores count as English for weighting; known non-English pools count as other. Raw views stay unchanged.':'Original aggregate: combine configured components within each language/protocol; average those groups within the eval. Other evals average variants. Then average evals within each category.';
  $('cards').innerHTML=[[$('modelA').value,ta.score,'A · '+(state.aggregate==='english_eval'?'English balance per eval':state.aggregate==='english_category'?'English balance per category':'original weighted score')],[$('modelB').value,tb.score,'B · '+(state.aggregate==='english_eval'?'English balance per eval':state.aggregate==='english_category'?'English balance per category':'original weighted score')],['A − B',valid?ta.score-tb.score:null,'Weighted difference'+(suite.mode==='fixed'&&!scope.complete?' · incomplete set':'')]].map(([name,value,label])=>'<div class="score-card"><small>'+esc(name)+'</small><strong>'+fmt(value)+'</strong><span>'+label+'</span></div>').join('');
  $('coverage').classList.toggle('notice',models.size>0&&suite.mode==='fixed'&&!scope.complete);
  $('coverage').textContent=!models.size?'No models loaded · add your CSV.':(suite.mode==='fixed'?suite.name+' · '+(scope.complete?'Complete':'INCOMPLETE')+' · '+scope.sharedRequired+'/'+scope.required+' requirements shared (A '+scope.presentA+', B '+scope.presentB+') · '+(scope.extrasA+scope.extrasB)+' extra measurements excluded · ':suite.name+' · ')+pairs.length+' matched variants · excluded: '+excludedA.length+' from A, '+excludedB.length+' from B · weights use shared data only'+(valid?'':' · Score unavailable: check weights and language assignments.');
  $('filters').hidden=['score','warnings'].includes(state.view);
  $('filterStatus').textContent=shown.length+' of '+pairs.length+' matched variants · filters do not change the full weighted score';
  const warnings=activeWarnings();$('warningCount').textContent=warnings.length;$('warningCount').classList.toggle('has-warnings',warnings.length>0);
  document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===state.view));
  $('view').innerHTML=state.view==='score'?renderScore(a,b,ta,tb,valid):['categories','languages'].includes(state.view)?renderBreakdown(shown,pairs):state.view==='comparisons'?renderComparisons(shown,a,valid):state.view==='warnings'?renderWarnings():renderConfig();
  if(weightOpen&&$('weightEditor'))$('weightEditor').open=true;if(englishOpen&&$('englishComponents'))$('englishComponents').open=true;
  markHorizontalScroll();
  if(!shown.length&&['categories','languages','comparisons'].includes(state.view))$('view').insertAdjacentHTML('beforeend','<p>No matched variants pass these filters.</p>');
 }
 function refreshConfig(){state.scoreCategory=Object.keys(weights)[0];filterOptions();clearFilters();languageOptions();}
 function importCatalogue(config){
  validateCatalogue(config);const nextScheme=resolveConfig(config,suite,profile);
  const audits=new Map(),nextModels=new Map(),nextMetadata=new Map();
  for(const [name,rows] of sourceAudits){const audit=auditRows(rows,config);audits.set(name,audit);nextModels.set(name,audit.filter(r=>r.selected));for(const row of audit)if(!nextMetadata.has(row.task))nextMetadata.set(row.task,taskLanguage(row.task,config));}
  addSynthetic(nextModels,config);
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
  if(!nextModels.has(demoModel))addSynthetic(nextModels,catalogue);
  models=nextModels;sourceAudits=nextAudits;metadata=nextMetadata;
  modelOptions(sourceAudits.size>1?names.at(-1):demoModel);languageOptions();$('error').textContent='';render();
 }catch(err){$('error').textContent=err.message;}finally{e.target.value='';}};
 function filterOptions(){$('category').innerHTML=options([['','All categories'],...[...new Set([...Object.keys(weights),...catalogue.evals.map(e=>e.category)])].map(k=>[k,k])],'');
 $('eval').innerHTML=options([['','All evals'],...catalogue.evals.map(f=>[f.name,f.name])],'');}
 filterOptions();modelOptions();languageOptions();render();
}
