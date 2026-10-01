import json
import unittest
from pathlib import Path
from app.build import classify, summarize
from app.config_engine import task_language, validate_config, normalize_score, match_task, shared_config, load_catalogue
from copy import deepcopy
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parent.parent
CONFIG=shared_config('resolve',value=[load_catalogue(ROOT/'configs/catalogue.yaml'),shared_config('suite',ROOT/'configs/sets/any-available.yaml'),shared_config('weights',ROOT/'configs/weights/oellm.yaml')])
def resolve_languages(tasks):return [task_language(t,CONFIG) for t in tasks]
DATA=json.loads((ROOT/'output/analysis.json').read_text())
class AnalysisTests(unittest.TestCase):
 def test_english_weighting_language_fallback(self):
  config={'evals':[{'name':'mixed','category':'C','metric':'acc'},{'name':'english','category':'C','metric':'acc'}], 'weights':{'C':1}, 'english_weights':{'C':.5}}
  rows=[dict(task=task,eval=ev,score_100=score,selected=True,checkpoint='A') for task,ev,score in [('en','mixed',80),('fr','mixed',20),('de','mixed',40),('english','english',100)]]
  for code in [None,'mul','hbs_Latn']:
   config['languages']=[{'tasks':['en','english'],'scope':'single','language':'eng_Latn'},{'tasks':['de'],'scope':'single','language':'deu_Latn'}]
   if code:config['languages'].append({'tasks':['fr'],'scope':'pooled','language':code})
   for mode,expected in [('english_eval',77.5 if code=='hbs_Latn' else 72.5),('english_category',60 if code=='hbs_Latn' else 57.5)]:
    result=summarize(rows,config,mode)[0]
    self.assertAlmostEqual(result['score'],expected)
    self.assertAlmostEqual(sum(e['contribution'] for e in result['evals']),expected)

 def test_complete_source_coverage(self):
  self.assertEqual(len(DATA['rows']),2124)
  self.assertTrue(all(r['eval'] for r in DATA['rows']))
  self.assertEqual(len([e for e in DATA['models'][0]['evals'] if not e['excluded']]),45)
 def test_selected_measurements_unique(self):
  rr=[r for r in DATA['rows'] if r['selected']]
  keys=[tuple(r[k] for k in ['task','metric','filter','n_shot','harness','backend']) for r in rr]
  self.assertEqual(len(keys),len(set(keys)))
 def test_summaries_replace_children(self):
  rr=[r for r in DATA['rows'] if r['selected'] and r['eval'] in ['MMLU','Global MMLU','INCLUDE']]
  self.assertTrue(all(r['is_group']=='yes' for r in rr))
  self.assertEqual(sum(r['eval']=='MMLU' for r in rr),1)
  self.assertEqual(sum(r['eval']=='Global MMLU' for r in rr),16)
  self.assertEqual(sum(r['eval']=='INCLUDE' for r in rr),21)
 def test_scale_and_protocol(self):
  rr=[r for r in DATA['rows'] if r['selected']]
  squad=next(r for r in rr if r['task']=='squadv2')
  self.assertEqual(squad['score_100'],float(squad['value']))
  self.assertTrue(all(r['n_shot']=='0' for r in rr if r['eval']=='HellaSwag'))
  self.assertFalse(any('prompted' in r['task'] for r in rr if r['eval']=='PIQA'))
 def test_missing_eval_is_excluded_and_reweighted(self):
  result=summarize([r for r in DATA['rows'] if r['eval']!='IFEval'],CONFIG)
  self.assertIsNotNone(result[0]['score'])
  self.assertTrue(next(c for c in result[0]['categories'] if c['name']=='Instruction following')['excluded'])
 def test_duplicate_rejected(self):
  r=next(r for r in DATA['rows'] if r['selected'])
  with self.assertRaises(ValueError): classify([r,r],CONFIG)
 def test_dataset_languages_and_unknowns(self):
  rows={r['task']:r for r in resolve_languages(['belebele_lvs_Latn','sib200_nob_Latn','flores200:eng_Latn-als_Latn','unknown_de','multiblimp_hbs'])}
  self.assertEqual(rows['belebele_lvs_Latn']['language'],'lav_Latn')
  self.assertEqual(rows['sib200_nob_Latn']['language'],'nor_Latn')
  self.assertEqual(rows['flores200:eng_Latn-als_Latn']['target_language'],'sqi_Latn')
  self.assertEqual(rows['unknown_de']['status'],'unknown')
  self.assertEqual(rows['multiblimp_hbs']['language'],'srp_Latn')
  self.assertEqual(rows['multiblimp_hbs']['scope'],'single')
  self.assertEqual(rows['flores200:eng_Latn-als_Latn']['language'],'')
 def test_original_english_and_pooled_benchmarks(self):
  rows={r['task']:r for r in resolve_languages(['AIME24','mmlu','mmlu_abstract_algebra','hellaswag_sr','include_base_44_north macedonian','bigbench_language_identification_multiple_choice','bigbench_dyck_languages_generate_until'])}
  for task in ['AIME24','mmlu','mmlu_abstract_algebra','bigbench_dyck_languages_generate_until']:
   self.assertEqual(rows[task]['language'],'eng_Latn')
  self.assertEqual(rows['hellaswag_sr']['language'],'srp_Latn')
  self.assertEqual(rows['include_base_44_north macedonian']['language'],'mkd_Cyrl')
  self.assertEqual(rows['bigbench_language_identification_multiple_choice']['language'],'mul')
  self.assertEqual(rows['bigbench_language_identification_multiple_choice']['scope'],'pooled')
 def test_translation_directions_are_separate(self):
  rows=resolve_languages(['flores200:eng_Latn-fin_Latn','flores200:fin_Latn-eng_Latn'])
  self.assertEqual({r['language'] for r in rows},{''})
  self.assertEqual({r['source_language'] for r in rows},{'eng_Latn','fin_Latn'})
 def test_source_metadata_is_resolved_with_evidence(self):
  self.assertTrue(all(r['status']=='resolved' and r['evidence'].startswith('https://') for r in DATA['metadata']))
 def test_normalization_preserves_raw_and_scales(self):
  e={'score':{'scale':1},'normalize':{'min':.25,'max':1}}
  for value,expected in [(.1,0),(.25,0),(.625,50),(1,100)]:
   raw,adjusted=normalize_score(value,e)
   self.assertAlmostEqual(raw,value*100);self.assertAlmostEqual(adjusted,expected)
  e['score']['scale']=100
  self.assertEqual(normalize_score(62.5,e),(62.5,50))
  e['normalize']['clip']=False
  self.assertAlmostEqual(normalize_score(10,e)[1],-20)
  with self.assertRaises(ValueError):normalize_score(101,e)
 def test_invalid_config_rejected(self):
  mutations=[lambda c:c['languages'].append(c['languages'][0]),lambda c:c['languages'][0].update(language='English'),lambda c:c['evals'][0].update(normalize={'min':1,'max':1}),lambda c:c['weights'].update(Code=.2),lambda c:c['evals'][0].update(shots='0'),lambda c:c['evals'][0].update(extra='typo'),lambda c:c['evals'][0].update(warning=12)]
  for mutation in mutations:
   c=deepcopy(CONFIG);mutation(c)
   with self.assertRaises(ValueError):validate_config(c)
 def test_exact_regex_and_ambiguous_matches(self):
  self.assertIsNotNone(match_task({'name':'north macedonian'},'north macedonian'))
  self.assertIsNone(match_task({'name':'eval'},'eval_fr'))
  self.assertIsNotNone(match_task({'regex':'eval_(fr|en)'},'eval_fr'))
  self.assertIsNone(match_task({'regex':'eval_(fr|en)'},'eval_fr_extra'))
  c=deepcopy(CONFIG);c['evals'][0]['match']=c['evals'][1]['match']
  row=next(r for r in DATA['rows'] if r['task']=='HumanEval')
  with self.assertRaisesRegex(ValueError,'[Aa]mbiguous'):classify([row],c)
 def test_explicit_mapping_has_no_suffix_inference(self):
  self.assertEqual(task_language('new_eval_eng_Latn',CONFIG)['status'],'unknown')
  tasks=[t for g in CONFIG['languages'] for t in g['tasks']]
  self.assertEqual(len(tasks),len(set(tasks)))
  self.assertEqual(set(tasks),{r['task'] for r in DATA['rows']})
 def test_alternate_config_build_and_javascript_parity(self):
  c=deepcopy(CONFIG);c['evals'][0]['normalize']={'min':.25,'max':1};c['aggregate']='english_category'
  with tempfile.TemporaryDirectory() as tmp:
   from tests.test_data import inputs
   path=Path(tmp);kw=inputs(path,c)
   subprocess.run(['python3','-m','app.build',str(ROOT/'data/v2zloss_86k.flag-evals-436.tasks.csv'),'--catalogue',str(kw['catalogue_path']),'--weights',str(kw['weights_path']),'--eval-set',str(kw['suite_path']),'--output',str(path/'result')],check=True,capture_output=True)
   data=json.loads((path/'result/analysis.json').read_text())
   self.assertNotEqual(data['models'][0]['score'],DATA['models'][0]['score'])
   script="const fs=require('fs'),e=require('./app/eval_config.js');const d=JSON.parse(fs.readFileSync(process.argv[1]));console.log(JSON.stringify({rows:e.auditRows(d.rows,d.scheme),metadata:d.metadata.map(m=>e.taskLanguage(m.task,d.scheme))}));"
   result=json.loads(subprocess.check_output(['node','-e',script,str(path/'result/analysis.json')],cwd=ROOT))
   self.assertEqual(result['rows'],data['rows']);self.assertEqual(result['metadata'],data['metadata'])
 def test_english_share_coverage(self):
  c=deepcopy(CONFIG);c['aggregate']='english_category'
  self.assertIsNotNone(summarize(DATA['rows'],c)[0]['score'])
  c['english_weights']['Code']=.5
  result=summarize(DATA['rows'],c)[0]
  self.assertIsNotNone(result['score'])
  code=next(x for x in result['categories'] if x['name']=='Code')
  self.assertEqual(code['effectiveEnglishShare'],1)
  self.assertEqual(code['issue'],'')
  c['english_weights']['Code']=1;c['english_weights']['Language']=.5
  self.assertIsNotNone(summarize(DATA['rows'],c)[0]['score'])
  for invalid in [-.1,1.1,'0.5']:
   c['english_weights']['Code']=invalid
   with self.assertRaises(ValueError):validate_config(c)
 def test_unconfigured_rows_are_excluded(self):
  row=dict(DATA['rows'][0],task='new_task_without_config')
  result=classify([row],CONFIG)[0]
  self.assertFalse(result['selected']);self.assertEqual(result['eval'],'')
  self.assertIsNone(result['score_100']);self.assertIn('No eval config',result['decision'])
 def test_chance_baselines_and_raw_score_preservation(self):
  evals={e['name']:e for e in CONFIG['evals']}
  expected={'SIB-200':1/7,'Language ID':1/11,'Social IQa':1/3,'HellaSwag':.25,'PIQA':.5,'CommonsenseQA':.2,'AIME24':0,'AIME25':0,'JEEBench':.105,'ARC Easy':.25}
  for name,chance in expected.items():
   e=evals[name];self.assertEqual(e['normalize']['min'],chance)
   self.assertAlmostEqual(normalize_score(chance*e['score']['scale'],e)[1],0)
   self.assertTrue(e['normalize']['sources'])
  self.assertEqual(evals['ARC Challenge']['normalize']['min'],.25)
  self.assertIn('approximation',evals['ARC Challenge']['normalize']['note'])
  self.assertNotEqual(evals['JEEBench']['normalize'].get('basis'),'unresolved')
  self.assertEqual(evals['AMC23']['normalize']['min'],0)
  c=deepcopy(CONFIG)
  for e in c['evals']:e['normalize']={'min':0,'max':1}
  raw=classify(DATA['rows'],c)
  scoped=shared_config('scope',value=[raw,DATA['suite']])['rows']
  from statistics import mean
  expected_raw=sum(weight*mean(mean(r['raw_score_100'] for r in scoped if r['eval']==e) for e in {r['eval'] for r in scoped if r['category']==category}) for category,weight in c['weights'].items())
  self.assertAlmostEqual(summarize(scoped,c)[0]['score'],expected_raw)
  self.assertLess(DATA['models'][0]['score'],expected_raw)
  self.assertEqual([r['raw_score_100'] for r in raw],[r['raw_score_100'] for r in DATA['rows']])
if __name__=='__main__': unittest.main()
