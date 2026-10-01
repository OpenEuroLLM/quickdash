"""Declarative eval matching, explicit language assignments and score normalization."""
import math
import re
import json
import subprocess
from pathlib import Path


def shared_config(mode, path=None, value=None):
    """Use bundled browser parsers and set validation during builds."""
    result = subprocess.run(["node", str(Path(__file__).with_name("config_io.cjs")), str(path) if path else "-", mode],
                            input=json.dumps(value) if path is None else None, capture_output=True, text=True)
    if result.returncode: raise ValueError(result.stderr.strip())
    return json.loads(result.stdout)


def load_catalogue(path):
    return validate_catalogue(shared_config('catalogue', path))


def load_csv(path):
    return shared_config('csv', path)


LANGUAGE_CODE = re.compile(r'(?:[a-z]{3}_[A-Z][a-z]{3}|mul)')
DECIMAL = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')


def object_keys(value, allowed, required=()):
    if not isinstance(value, dict) or set(value)-set(allowed) or set(required)-set(value):
        raise ValueError(f'Invalid config fields; allowed {sorted(allowed)}, required {sorted(required)}')


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_match(rule):
    object_keys(rule, {'name','regex'})
    if len(rule)!=1 or not isinstance(next(iter(rule.values())),str) or not next(iter(rule.values())):
        raise ValueError('A match needs exactly one nonempty name or regex')
    if 'regex' in rule:
        # Numeric captures use the shared Python/JavaScript regex subset.
        if '(?P' in rule['regex'] or '(?<' in rule['regex']:
            raise ValueError('Use numeric capture groups in portable regexes')
        re.compile(rule['regex'])


def match_task(rule, task):
    if 'name' in rule:return [task] if task==rule['name'] else None
    match=re.fullmatch(rule['regex'],task)
    return [match.group(0),*match.groups()] if match else None


def validate_config(config):
    object_keys(config,{'version','name','weights','evals','languages','notes','aggregate','english_weights'}, {'version','name','weights','evals','languages'})
    if config['version']!=1 or isinstance(config['version'],bool):raise ValueError('Unsupported config version')
    if not isinstance(config['name'],str) or not config['name']:raise ValueError('Config name is required')
    weights=config['weights']
    if not isinstance(weights,dict) or not weights or any(not k or not number(v) or v<0 for k,v in weights.items()) or abs(sum(weights.values())-1)>1e-8:
        raise ValueError('Category weights must be nonnegative and sum to 1')
    if config.get('aggregate','standard') not in ['standard','english_eval','english_category']:raise ValueError('Aggregate must be standard, english_eval, or english_category')
    if 'english_weights' in config:
        object_keys(config['english_weights'],set(weights))
        if any(not number(v) or v<0 or v>1 for v in config['english_weights'].values()):raise ValueError('English weights must be between 0 and 1')
    validate_rules(config)
    if any(e['category'] not in weights for e in config['evals']):raise ValueError('Eval category has no weight')
    return config


def validate_catalogue(config):
    object_keys(config, {'version','name','evals','languages','notes'}, {'version','name','evals','languages'})
    return validate_rules(config)


def validate_rules(config):
    if config['version'] != 1 or isinstance(config['version'], bool):raise ValueError('Unsupported config version')
    if not isinstance(config['name'], str) or not config['name'].strip():raise ValueError('Config name is required')
    if not isinstance(config.get('notes',[]),list) or any(not isinstance(n,str) for n in config.get('notes',[])):raise ValueError('Notes must be strings')
    if not isinstance(config['evals'],list) or not config['evals']:raise ValueError('At least one eval is required')
    names=set();categories=set()
    for e in config['evals']:
        object_keys(e,{'name','category','match','metric','filter','shots','select','score','normalize','warning'}, {'name','category','match','metric','filter','score'})
        if not isinstance(e['name'],str) or not e['name'] or e['name'] in names:raise ValueError('Eval names must be unique and nonempty')
        names.add(e['name'])
        if not isinstance(e['category'],str) or not e['category'].strip():raise ValueError('Eval category must be text')
        categories.add(e['category'])
        if not isinstance(e['metric'],str) or not e['metric'] or not isinstance(e['filter'],str):raise ValueError('Metric and filter must be strings')
        validate_match(e['match'])
        if 'select' in e:validate_match(e['select'])
        if 'shots' in e and (not isinstance(e['shots'],int) or isinstance(e['shots'],bool) or e['shots']<0):raise ValueError('shots must be a nonnegative integer')
        object_keys(e['score'],{'scale'},{'scale'})
        if not number(e['score']['scale']) or e['score']['scale']<=0:raise ValueError('Score scale must be positive')
        if 'warning' in e and (not isinstance(e['warning'],str) or not e['warning'].strip()):raise ValueError('Eval warning must be nonempty text')
        if 'normalize' in e:
            n=e['normalize'];object_keys(n,{'min','max','clip','basis','note','sources'},{'min','max'})
            if not number(n['min']) or not number(n['max']) or not 0<=n['min']<n['max']<=1:raise ValueError('Normalization needs 0 <= min < max <= 1')
            if 'clip' in n and not isinstance(n['clip'],bool):raise ValueError('Normalization clip must be boolean')
            if 'basis' in n and n['basis'] not in ['uniform_choice','uniform_integer','not_applicable','unresolved']:raise ValueError('Invalid normalization basis')
            if 'note' in n and not isinstance(n['note'],str):raise ValueError('Normalization note must be text')
            if 'sources' in n and (not isinstance(n['sources'],list) or any(not isinstance(u,str) or not re.match(r'^https?://',u) for u in n['sources'])):raise ValueError('Normalization sources must be HTTP(S) URLs')
    seen=set()
    if not isinstance(config['languages'],list):raise ValueError('languages must be a list')
    for group in config['languages']:
        object_keys(group,{'tasks','scope','language','source_language','target_language','evidence','note'},{'tasks','scope'})
        tasks=group['tasks']
        if not isinstance(tasks,list) or not tasks or any(not isinstance(t,str) or not t for t in tasks):raise ValueError('Language groups need exact task names')
        for task in tasks:
            if task in seen:raise ValueError('Duplicate language assignment: '+task)
            seen.add(task)
        scope=group['scope']
        if scope not in ['single','pooled','translation']:raise ValueError('Invalid language scope')
        fields=['source_language','target_language'] if scope=='translation' else ['language']
        forbidden=['language'] if scope=='translation' else ['source_language','target_language']
        if any(k in group for k in forbidden):raise ValueError('Use language for single/pooled; source and target for translation')
        for field in fields:
            value=group.get(field)
            if not isinstance(value,str) or not LANGUAGE_CODE.fullmatch(value) or (value=='mul' and scope!='pooled'):raise ValueError('Use canonical language codes, such as eng_Latn')
        for field in ['note','evidence']:
            if field in group and not isinstance(group[field],str):raise ValueError(field+' must be a string')
        if group.get('evidence') and not re.match(r'^https?://',group['evidence']):raise ValueError('Evidence links must use HTTP or HTTPS')
    return config


def normalize_score(value,e):
    if not number(value) and (not isinstance(value,str) or not DECIMAL.fullmatch(value.strip())):raise ValueError('Invalid score: expected a finite decimal number')
    raw=float(value)/e['score']['scale']
    if not math.isfinite(raw) or not 0<=raw<=1:raise ValueError('Score outside the configured source scale')
    n=e.get('normalize',{'min':0,'max':1})
    adjusted=(raw-n['min'])/(n['max']-n['min'])
    if n.get('clip',True):adjusted=max(0,min(1,adjusted))
    if not math.isfinite(adjusted*100):raise ValueError('Invalid score: normalization overflow')
    return raw*100,adjusted*100


def eval_for_task(task,config):
    matches=[(e,match_task(e['match'],task)) for e in config['evals']]
    matches=[(e,m) for e,m in matches if m is not None]
    if len(matches)>1:raise ValueError('Ambiguous eval config for task: '+task)
    return matches[0] if matches else (None,None)


def task_language(task,config):
    result=dict(task=task,language='',source_language='',target_language='',scope='unknown',status='unknown',evidence='',provenance='No explicit language assignment for this task.')
    for group in config['languages']:
        if task in group['tasks']:
            result.update({k:group.get(k,'') for k in ['language','source_language','target_language','scope','evidence']})
            result.update(status='resolved',provenance=group.get('note','Explicit language assignment in eval config.'))
            break
    return result


def classify(rows,config):
    (validate_config if 'weights' in config else validate_catalogue)(config);audit=[];seen=set()
    for index,source in enumerate(rows):
        r=dict(source)
        for field in ['checkpoint','task','metric','filter','n_shot','harness','backend','value']:
            if field not in r:raise ValueError('Missing CSV column: '+field)
        for field in ['checkpoint','task','metric','harness','backend']:
            if not isinstance(r[field],str) or not r[field].strip():raise ValueError(f'CSV row {index+2}: {field} must be nonempty text')
        if r['checkpoint']=='SYNTHETIC demo — perturbed':raise ValueError('Checkpoint name is reserved for the synthetic demo')
        if not isinstance(r['filter'],str):raise ValueError(f'CSV row {index+2}: filter must be text (blank is allowed)')
        shots=str(r['n_shot'])
        if not re.fullmatch(r'(?:0|[1-9][0-9]*)',shots) or int(shots)>2**53-1:raise ValueError(f'CSV row {index+2}: n_shot must be a nonnegative integer')
        r['n_shot']=shots
        e,_=eval_for_task(r['task'],config)
        if e is None:
            r.update(category='',eval='',selected=False,raw_score_100=None,score_100=None,decision='No eval config; excluded from scoring')
            audit.append(r);continue
        decision='Selected for the weighted score'
        if 'select' in e and match_task(e['select'],r['task']) is None:decision='Excluded summary level or alternate protocol; see eval selection rule'
        elif r['metric']!=e['metric']:decision='Alternate metric; using '+e['metric']
        elif r['filter']!=e['filter']:decision='Alternate extraction filter; using '+(e['filter'] or '(empty)')
        elif 'shots' in e and str(r['n_shot'])!=str(e['shots']):decision='Alternate shot setting; using '+str(e['shots'])+' shots'
        selected=decision=='Selected for the weighted score';raw=adjusted=None
        if selected:
            try:raw,adjusted=normalize_score(r['value'],e)
            except (ValueError,OverflowError) as error:raise ValueError(f"CSV row {index+2} · {r['checkpoint']} · {r['task']} · {r['metric']}: Invalid score: {error}") from error
            key=tuple(r[k] for k in ['checkpoint','task','metric','filter','n_shot','harness','backend'])
            if key in seen:raise ValueError('Duplicate selected measurement: '+str(key))
            seen.add(key)
        r.update(category=e['category'],eval=e['name'],selected=selected,raw_score_100=raw,score_100=adjusted,decision=decision)
        audit.append(r)
    return audit
