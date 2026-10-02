// Filesystem loading for Node consumers; the browser receives the assembled catalogue.
const fs=require('node:fs'),path=require('node:path');
const yaml=require('./vendor/js-yaml.js');
const {parseCatalogue,assembleCatalogue}=require('./eval_config.js');
function loadCatalogue(filename){
 try{
  const text=fs.readFileSync(filename,'utf8'),config=yaml.load(text,{schema:yaml.CORE_SCHEMA});
  if(!config||typeof config!=='object'||!Object.hasOwn(config,'evals_dir'))return parseCatalogue(text);
  if(Object.keys(config).some(k=>!['version','name','notes','evals_dir'].includes(k)))throw Error('Invalid catalogue manifest fields');
  const {evals_dir,...metadata}=config;
  if(typeof evals_dir!=='string'||!evals_dir.trim())throw Error('evals_dir must be a nonempty directory path');
  const directory=path.resolve(path.dirname(filename),evals_dir);
  const files=fs.readdirSync(directory).filter(name=>/\.ya?ml$/i.test(name)&&fs.statSync(path.join(directory,name)).isFile()).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  const definitions=files.map(name=>{
   const source=path.join(directory,name);
   try{const definition=yaml.load(fs.readFileSync(source,'utf8'),{schema:yaml.CORE_SCHEMA});assembleCatalogue(metadata,[definition]);return definition;}
   catch(error){throw Error(source+': '+error.message);}
  });
  return assembleCatalogue(metadata,definitions);
 }catch(error){throw Error(filename+': '+error.message);}
}
module.exports={loadCatalogue};
