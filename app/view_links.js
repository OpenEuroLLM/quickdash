'use strict';
const QuickdashViewLinks=(()=>{
 const enums={view:['score','categories','languages','comparisons','config','warnings'],matching:['strict','relaxed'],aggregate:['standard','english_eval','english_category'],direction:['','eval','to','from'],group:['eval','variant','category'],measure:['raw','weighted'],sort:['ascending','descending','absolute','name'],sortBy:['delta','label','category','a','b','rawDelta','weightedDelta','languageCount'],languageSort:['label','count','a','b','delta','componentShare','componentA','componentB'],languageOrder:['ascending','descending'],local:['1']};
 const strings=['modelA','modelB','suite','profile','category','eval','language','search','scoreCategory'];
 const lists=['expandedComparisons','open'],maps=['weights','englishWeights'];
 const fields=[...Object.keys(enums),...strings,...lists,...maps];
 function validate(key,value){
  if(Object.hasOwn(enums,key)){if(!enums[key].includes(value))throw Error('Invalid link setting: '+key);}
  else if(strings.includes(key)){if(typeof value!=='string')throw Error('Invalid link label: '+key);}
  else if(lists.includes(key)){if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw Error('Invalid link list: '+key);}
  else if(maps.includes(key)){if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1))throw Error('Invalid link weights: '+key);}
  else throw Error('Unknown link setting: '+key);
 }
 function parseViewHash(hash){
  if(!hash||hash==='#')return {};
  // Reject malformed escapes rather than silently replacing characters in model labels.
  decodeURIComponent(hash);
  const params=new URLSearchParams(hash.replace(/^#/,'')),result={},seen=new Set();
  for(const [key,text] of params){
   if(seen.has(key))throw Error('Repeated link setting: '+key);seen.add(key);
   if(key==='v'){if(text!=='1')throw Error('Unsupported view link version');continue;}
   const value=lists.includes(key)||maps.includes(key)?JSON.parse(text):text;
   validate(key,value);result[key]=value;
  }
  return result;
 }
 function serializeViewHash(state){
  for(const [key,value] of Object.entries(state))validate(key,value);
  const params=new URLSearchParams({v:'1'});
  for(const key of fields)if(Object.hasOwn(state,key)){
   const value=state[key];
   if(value===''||Array.isArray(value)&&!value.length)continue;
   params.set(key,lists.includes(key)||maps.includes(key)?JSON.stringify(value):value);
  }
  return '#'+params.toString();
 }
 return {parseViewHash,serializeViewHash};
})();
if(typeof module!=='undefined')module.exports=QuickdashViewLinks;
