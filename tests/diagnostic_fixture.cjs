// Turn the small audited-row fixtures into inputs for the production diagnostic pass.
const {reportDiagnostics,componentCoverage}=require('../app/analysis.js');
const {resolveConfig,scopeRows}=require('../app/suite_config.js');
function diagnosticsFor(audits,config,aggregate='standard',english_weights={},suite={version:1,name:'Available',mode:'available'}){
 const catalogue=Object.fromEntries(Object.entries(config).filter(([k])=>['version','name','evals','languages','notes'].includes(k)));
 const categories=[...new Set(catalogue.evals.map(e=>e.category))];
 const profile={version:1,name:'Fixture weights',weights:config.weights||Object.fromEntries(categories.map(c=>[c,1/categories.length])),aggregate,english_weights};
 const bundle={catalogue,profile,suite},scheme=resolveConfig(catalogue,suite,profile);
 const included=new Map([...audits].map(([m,rr])=>[m,componentCoverage(scopeRows(rr,suite).rows,scheme).rows]));
 return reportDiagnostics(audits,bundle,included);
}
module.exports={diagnosticsFor};
