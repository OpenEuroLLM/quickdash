"""Small public-contract fixtures, independent of the private evaluation export."""
import contextlib
import io
import json
import random
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from app.build import build, summarize
from app.config_engine import classify, load_csv, normalize_score, validate_config

ROOT = Path(__file__).resolve().parent.parent


def config():
    return dict(version=1, name='Fixture', weights={'C': 1}, evals=[dict(
        name='Eval', category='C', match={'regex': 'task_.+'}, metric='acc', filter='',
        score={'scale': 1}, normalize={'min': .25, 'max': 1})],
        languages=[dict(tasks=['task_en'], scope='single', language='eng_Latn')])


def row(**patch):
    return dict(dict(checkpoint='Model A', task='task_en', metric='acc', filter='',
                     n_shot='0', harness='test', backend='cpu', value='.625'), **patch)


def javascript(cases, expression):
    script = "const api=require('./app/eval_config.js'),app=require('./app/app.js');const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(cases.map(c=>{try{return {value:" + expression + "}}catch(e){return {error:e.message}}})));"
    return json.loads(subprocess.check_output(['node', '-e', script], input=json.dumps(cases), text=True, cwd=ROOT))


def inputs(folder, c=None):
    c = c or config()
    catalogue = {k:v for k,v in c.items() if k not in ['weights','english_weights','aggregate']}
    profile = {k:v for k,v in c.items() if k in ['version','name','weights','english_weights','aggregate']}
    (folder/'catalogue.yaml').write_text(json.dumps(catalogue))
    (folder/'weights.yaml').write_text(json.dumps(profile))
    return dict(catalogue_path=folder/'catalogue.yaml', weights_path=folder/'weights.yaml', suite_path=ROOT/'configs/sets/any-available.yaml')


class DataContracts(unittest.TestCase):
    def test_independent_directory_defaults_and_explicit_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder);profiles=folder/'profiles';profiles.mkdir()
            p=dict(version=1,name='First',weights={'C':1})
            (profiles/'first.yaml').write_text(json.dumps(p));p['name']='Second'
            (profiles/'second.yml').write_text(json.dumps(p));(profiles/'default.txt').write_text('second.yml\n')
            kw.pop('weights_path')
            with contextlib.redirect_stdout(io.StringIO()):build(None,folder/'out',**kw,weights_dir=profiles)
            data=json.loads((folder/'out/analysis.json').read_text())
            self.assertEqual(data['profile_file'],'second.yml')
            self.assertEqual([p['config']['name'] for p in data['profiles']],['Second','First'])
            self.assertEqual(data['suite']['mode'],'available')
            with contextlib.redirect_stdout(io.StringIO()):build(None,folder/'out',**kw,weights_path=profiles/'first.yaml',weights_dir=profiles)
            self.assertEqual(json.loads((folder/'out/analysis.json').read_text())['profile']['name'],'First')

    def test_invalid_directory_defaults_preserve_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder);kw.pop('weights_path');profiles=folder/'profiles';profiles.mkdir();out=folder/'out';out.mkdir()
            (out/'index.html').write_text('keep')
            for value in [None,'','valid.yaml\nother.yaml','../valid.yaml','/valid.yaml','sub/valid.yaml','sub\\valid.yaml','default.txt','missing.yaml']:
                with self.subTest(default=value):
                    if value is not None:(profiles/'default.txt').write_text(value)
                    with self.assertRaisesRegex(ValueError,'default.txt'):build(None,out,**kw,weights_dir=profiles)
                    self.assertEqual((out/'index.html').read_text(),'keep')

    def test_cli_defaults_to_any_available_and_separate_weight_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['python3','-m','app.build','--output',tmp],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
            data=json.loads((Path(tmp)/'analysis.json').read_text())
            self.assertEqual(data['suite']['mode'],'available')
            self.assertEqual({p['file'] for p in data['suites']},{'any-available.yaml','flagship-1.yaml'})
            self.assertNotIn('weights',data['catalogue']);self.assertNotIn('weights',data['suite']);self.assertNotIn('evals',data['profile'])

    def test_empty_rebuild_removes_stale_generated_scores(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder);out=folder/'out'
            source=folder/'scores.csv';r=row();source.write_text(','.join(r)+'\n'+','.join(r.values()))
            with contextlib.redirect_stdout(io.StringIO()):build(source,out,**kw)
            self.assertEqual(len(list(out.glob('*.csv'))),4)
            (out/'personal-note.txt').write_text('keep')
            with contextlib.redirect_stdout(io.StringIO()):build(None,out,**kw)
            self.assertEqual(list(out.glob('*.csv')),[])
            self.assertEqual((out/'personal-note.txt').read_text(),'keep')
            data=json.loads((out/'analysis.json').read_text());self.assertEqual(data['rows'],[]);self.assertEqual(data['models'],[])

    def test_all_choices_validated_before_output_is_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder);sets=folder/'sets';sets.mkdir();out=folder/'out'
            s=dict(version=1,name='Named',mode='fixed',evals=[dict(name='Eval')])
            (sets/'named.yaml').write_text(json.dumps(s))
            with contextlib.redirect_stdout(io.StringIO()):build(None,out,**kw,sets_dir=sets)
            data=json.loads((out/'analysis.json').read_text());self.assertEqual(len(data['suites']),2)
            previous=(out/'index.html').read_bytes()
            (sets/'duplicate.yaml').write_text(json.dumps(s))
            with self.assertRaisesRegex(ValueError,'duplicate config name'):build(None,out,**kw,sets_dir=sets)
            self.assertEqual((out/'index.html').read_bytes(),previous)
            (sets/'duplicate.yaml').unlink();s['evals'][0]['name']='Unknown';(sets/'named.yaml').write_text(json.dumps(s))
            with self.assertRaisesRegex(ValueError,'no catalogue rule'):build(None,out,**kw,sets_dir=sets)
            self.assertEqual((out/'index.html').read_bytes(),previous)

    def test_available_set_exclusions_apply_in_build_summaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder)
            excluded=dict(version=1,name='Excluded',mode='available',exclude=['Eval'])
            (folder/'set.yaml').write_text(json.dumps(excluded));kw['suite_path']=folder/'set.yaml'
            source=folder/'scores.csv';r=row();source.write_text(','.join(r)+'\n'+','.join(r.values()))
            with contextlib.redirect_stdout(io.StringIO()):build(source,folder/'out',**kw)
            data=json.loads((folder/'out/analysis.json').read_text())
            self.assertEqual(len(data['rows']),1);self.assertTrue(data['rows'][0]['selected'])
            self.assertIsNone(data['models'][0]['score']);self.assertEqual(data['models'][0]['evals'][0]['count'],0)

    def test_named_set_scopes_score_but_keeps_full_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder)
            s=dict(version=1,name='Named',mode='fixed',evals=[dict(name='Eval',variants=[dict(task='task_en',n_shot=0)])])
            (folder/'set.yaml').write_text(json.dumps(s));kw['suite_path']=folder/'set.yaml'
            rows=[row(),row(task='task_fr',value='.25')];source=folder/'scores.csv'
            source.write_text(','.join(rows[0])+'\n'+'\n'.join(','.join(r.values()) for r in rows))
            with contextlib.redirect_stdout(io.StringIO()):build(source,folder/'out',**kw)
            data=json.loads((folder/'out/analysis.json').read_text())
            self.assertEqual(len(data['rows']),2);self.assertEqual(data['models'][0]['score'],50)
            self.assertEqual(data['models'][0]['evals'][0]['count'],1)

    def test_cli_rejects_both_csv_and_results_directory(self):
        result=subprocess.run(['python3','-m','app.build','unused.csv','--results-dir','unused'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2);self.assertIn('not both',result.stderr)

    def test_shared_results_directory_combines_models_and_rejects_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder);results=folder/'results';results.mkdir();out=folder/'out'
            (results/'README.md').write_text('Not a CSV')
            for name in ['B','A']:
                r=row(checkpoint=name);(results/(name+'.csv')).write_text(','.join(r)+'\n'+','.join(r.values()))
            with contextlib.redirect_stdout(io.StringIO()):build(None,out,**kw,results_dir=results)
            data=json.loads((out/'analysis.json').read_text())
            self.assertEqual([m['model'] for m in data['models']],['A','B'])
            self.assertEqual([s['file'] for s in data['sources']],['A.csv','B.csv'])
            self.assertTrue(all(len(s['sha256'])==64 for s in data['sources']))
            previous=(out/'index.html').read_bytes()
            (results/'duplicate.csv').write_text((results/'A.csv').read_text())
            with self.assertRaisesRegex(ValueError,'Duplicate model'):build(None,out,**kw,results_dir=results)
            self.assertEqual((out/'index.html').read_bytes(),previous)

    def test_shared_results_report_bad_filename_and_reject_missing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);kw=inputs(folder)
            with self.assertRaisesRegex(ValueError,'directory'):build(None,folder/'out',**kw,results_dir=folder/'missing')
            results=folder/'results';results.mkdir();r=row(value='NaN');(results/'bad.csv').write_text(','.join(r)+'\n'+','.join(r.values()))
            with self.assertRaisesRegex(ValueError,'bad.csv.*Model A.*task_en'):build(None,folder/'out',**kw,results_dir=results)
            (results/'bad.csv').unlink()
            with contextlib.redirect_stdout(io.StringIO()):build(None,folder/'out',**kw,results_dir=results)
            self.assertEqual(json.loads((folder/'out/analysis.json').read_text())['models'],[])

    def assert_nested_close(self, a, b):
        if isinstance(a, dict):
            self.assertEqual(a.keys(), b.keys())
            for key in a: self.assert_nested_close(a[key], b[key])
        elif isinstance(a, list):
            self.assertEqual(len(a), len(b))
            for x, y in zip(a, b): self.assert_nested_close(x, y)
        elif isinstance(a, (int, float)) and not isinstance(a, bool):
            self.assertAlmostEqual(a, b, places=9)
        else: self.assertEqual(a, b)

    def test_score_validation_and_normalization_parity(self):
        cases = [dict(value=v, eval=config()['evals'][0]) for v in
                 ['', ' ', 'NaN', 'Infinity', '0x1', '0b1', '0o1', '1_0', True, None, -.1, 1.01, {}, []]]
        rng = random.Random(84351)
        for _ in range(200):
            scale = rng.choice([1, 100])
            lo = rng.choice([0, .25, .5]); hi = rng.choice([.75, 1])
            value = rng.random()*scale
            cases.append(dict(value=value, eval=dict(score={'scale': scale}, normalize={'min': lo, 'max': hi, 'clip': rng.choice([True, False])})))
        results = javascript(cases, 'api.normalizeScore(c.value,c.eval)')
        for c, js in zip(cases, results):
            with self.subTest(value=c['value'], config=c['eval']):
                if 'error' in js:
                    with self.assertRaises(ValueError): normalize_score(c['value'], c['eval'])
                else:
                    raw, score = normalize_score(c['value'], c['eval'])
                    self.assert_nested_close(dict(raw_score_100=raw, score_100=score), js['value'])

    def test_config_validation_parity(self):
        mutations = [lambda c: c.update(version=True), lambda c: c.update(name=None),
                     lambda c: c.update(weights={}), lambda c: c.update(weights={'C': -1}),
                     lambda c: c.update(weights={'C': True}), lambda c: c.update(notes=None),
                     lambda c: c.update(notes=[1]), lambda c: c.update(aggregate='wrong'),
                     lambda c: c.update(english_weights={'missing': .5}), lambda c: c.update(evals=[]),
                     lambda c: c['evals'][0].update(category=[]), lambda c: c['evals'][0].update(shots=True),
                     lambda c: c['evals'][0].update(shots=-1), lambda c: c['evals'][0].update(score={'scale': 0}),
                     lambda c: c['evals'][0].update(warning=''), lambda c: c['evals'][0].update(extra='typo'),
                     lambda c: c['evals'][0].update(normalize={'min': 1, 'max': 1}),
                     lambda c: c['evals'][0].update(normalize={'min': 0, 'max': 1, 'clip': 'yes'}),
                     lambda c: c['evals'][0].update(normalize={'min': 0, 'max': 1, 'sources': ['javascript:alert(1)']}),
                     lambda c: c['evals'][0].update(match={'name': 'x', 'regex': 'x'}),
                     lambda c: c['evals'][0].update(match={'regex': '(?<named>x)'}),
                     lambda c: c['languages'][0].update(language='en'),
                     lambda c: c['languages'][0].update(language='mul'),
                     lambda c: c['languages'][0].update(source_language='eng_Latn'),
                     lambda c: c['languages'][0].update(evidence='file:///tmp/x'),
                     lambda c: c['languages'][0].update(tasks=[]),
                     lambda c: c['languages'].append(c['languages'][0])]
        cases = []
        for mutate in mutations:
            c = config(); mutate(c); cases.append(c)
        for c, js in zip(cases, javascript(cases, 'api.validateConfig(c)')):
            with self.subTest(config=c):
                self.assertIn('error', js)
                with self.assertRaises(ValueError): validate_config(c)

    def test_row_validation_parity_and_errors(self):
        invalid = []
        for field in row():
            r = row(task='unconfigured'); del r[field]; invalid.append(r)
        for field in ['checkpoint', 'task', 'metric', 'harness', 'backend']:
            invalid.extend(row(**{field: value}) for value in ['', ' ', None, 1])
        invalid.extend(row(n_shot=value) for value in ['', '-1', '1.5', 'NaN', '00', '1e1', True, None])
        invalid.extend([row(filter=None), row(value=True), row(checkpoint='SYNTHETIC demo — perturbed')])
        cases = [dict(rows=[r], config=config()) for r in invalid]
        for c, js in zip(cases, javascript(cases, 'api.auditRows(c.rows,c.config)')):
            with self.subTest(row=c['rows']):
                self.assertIn('error', js)
                with self.assertRaises(ValueError): classify(c['rows'], c['config'])
        with self.assertRaisesRegex(ValueError, 'Model A.*task_en.*acc.*score'):
            classify([row(value='NaN')], config())

    def test_all_modes_python_browser_parity_with_incomplete_data(self):
        rng = random.Random(5231); cases = []
        for trial in range(40):
            c = config(); c['weights']={'C': .6, 'D': .4}; c['english_weights']={'C': [0,.5,1][trial%3], 'D': .2}; c['evals']=[]; c['languages']=[]
            rows=[]
            for i in range(6):
                e=deepcopy(config()['evals'][0]);e.update(name=f'E{i}',category='C' if i<3 else 'D',match={'regex':f'task_{i}_.+'});c['evals'].append(e)
                for j,language in enumerate(['eng_Latn','fra_Latn','mul',None]):
                    task=f'task_{i}_{j}'
                    if language:c['languages'].append(dict(tasks=[task],scope='pooled' if language=='mul' else 'single',language=language))
                    if rng.random()>.3:rows.append(row(task=task,value=str(rng.random())))
            for mode in ['standard','english_eval','english_category']:cases.append(dict(config=c,rows=rows,mode=mode))
        results=javascript(cases,"(()=>{const t=app.totals(api.auditRows(c.rows,c.config).filter(r=>r.selected),c.config,c.config.weights,c.mode);return {score:t.score,evals:t.evals.map(e=>({name:e.name,weight:e.weight,contribution:e.contribution,aggregateScore:e.aggregateScore})),categories:t.categories.map(e=>({name:e.name,score:e.score,weight:e.weight}))}})()")
        for c,js in zip(cases,results):
            self.assertNotIn('error',js)
            result=summarize(classify(c['rows'],c['config']),c['config'],c['mode'])[0]
            expected=dict(score=result['score'],evals=[{k:e[k] for k in ['name','weight','contribution','aggregateScore']} for e in result['evals']],categories=[{k:e[k] for k in ['name','score','weight']} for e in result['categories']])
            self.assert_nested_close(expected,js['value'])

    def test_invalid_builds_do_not_replace_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);target=folder/'out';target.mkdir();(target/'index.html').write_text('keep me')
            kw=inputs(folder)
            header=','.join(row())+'\n'
            for source in ['', header, 'a,a\n1,2', header+'too,few', header+','.join(row(value='NaN').values())]:
                path=folder/'input.csv';path.write_text(source)
                with self.subTest(source=source), self.assertRaises(ValueError):build(path,target,**kw)
                self.assertEqual((target/'index.html').read_text(),'keep me')
                self.assertEqual(len(list(target.iterdir())),1)

    def test_build_embeds_data_safely_and_uses_custom_categories(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);c=config();c['name']='</script><script>bad()</script>';kw=inputs(folder,c)
            path=folder/'input.csv';path.write_text('\ufeff'+','.join(row())+'\r\n'+','.join(row().values()))
            self.assertEqual(load_csv(path),[row()])
            with contextlib.redirect_stdout(io.StringIO()):build(path,folder/'out',**kw)
            html=(folder/'out/index.html').read_text();self.assertNotIn(c['name'],html)
            self.assertIn('\\u003c/script>',html)
            payload=json.loads((folder/'out/analysis.json').read_text())
            self.assertEqual(payload['models'][0]['score'],50)
            self.assertEqual(payload['scheme']['weights'],{'C':1})


if __name__=='__main__':unittest.main()
