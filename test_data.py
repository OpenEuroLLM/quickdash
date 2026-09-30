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

from build import build, summarize
from config_engine import classify, load_csv, normalize_score, validate_config

ROOT = Path(__file__).resolve().parent


def config():
    return dict(version=1, name='Fixture', weights={'C': 1}, evals=[dict(
        name='Eval', category='C', match={'regex': 'task_.+'}, metric='acc', filter='',
        score={'scale': 1}, normalize={'min': .25, 'max': 1})],
        languages=[dict(tasks=['task_en'], scope='single', language='eng_Latn')])


def row(**patch):
    return dict(dict(checkpoint='Model A', task='task_en', metric='acc', filter='',
                     n_shot='0', harness='test', backend='cpu', value='.625'), **patch)


def javascript(cases, expression):
    script = "const api=require('./eval_config.js'),app=require('./app.js');const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(cases.map(c=>{try{return {value:" + expression + "}}catch(e){return {error:e.message}}})));"
    return json.loads(subprocess.check_output(['node', '-e', script], input=json.dumps(cases), text=True, cwd=ROOT))


class DataContracts(unittest.TestCase):
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
            cfg=folder/'config.yaml';cfg.write_text(json.dumps(config()))
            header=','.join(row())+'\n'
            for source in ['', header, 'a,a\n1,2', header+'too,few', header+','.join(row(value='NaN').values())]:
                path=folder/'input.csv';path.write_text(source)
                with self.subTest(source=source), self.assertRaises(ValueError):build(path,target,cfg)
                self.assertEqual((target/'index.html').read_text(),'keep me')
                self.assertEqual(len(list(target.iterdir())),1)

    def test_build_embeds_data_safely_and_uses_custom_categories(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);cfg=folder/'config.yaml';c=config();c['name']='</script><script>bad()</script>';cfg.write_text(json.dumps(c))
            path=folder/'input.csv';path.write_text('\ufeff'+','.join(row())+'\r\n'+','.join(row().values()))
            self.assertEqual(load_csv(path),[row()])
            with contextlib.redirect_stdout(io.StringIO()):build(path,folder/'out',cfg)
            html=(folder/'out/index.html').read_text();self.assertNotIn(c['name'],html)
            self.assertIn('\\u003c/script>',html)
            payload=json.loads((folder/'out/analysis.json').read_text())
            self.assertEqual(payload['models'][0]['score'],50)
            self.assertEqual(payload['scheme']['weights'],{'C':1})


if __name__=='__main__':unittest.main()
