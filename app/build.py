"""Build a standalone Quickdash page from optional CSV results and YAML configs."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from statistics import mean
from .config_engine import classify, task_language, load_config, load_csv

APP = Path(__file__).resolve().parent
ROOT = APP.parent



def summarize(audit, config, aggregate=None):
    aggregate = aggregate or config.get('aggregate', 'standard')
    metadata = {task: group for group in config['languages'] for task in group['tasks']}
    def side(row):
        language = metadata.get(row['task'], {})
        code = language.get('target_language') if language.get('scope') == 'translation' else language.get('language') if language.get('scope') in ['single', 'pooled'] else None
        return 'english' if not code or code in ['eng_Latn', 'mul'] else 'other'
    result = []
    for model in sorted({r['checkpoint'] for r in audit}):
        selected = [r for r in audit if r['checkpoint'] == model and r['selected']]
        eval_rows = {e['name']: [r for r in selected if r['eval'] == e['name']] for e in config['evals']}
        evals = [dict(name=e['name'], category=e['category'], metric=e['metric'], count=len(eval_rows[e['name']]),
                      score=mean(r['score_100'] for r in eval_rows[e['name']]) if eval_rows[e['name']] else None,
                      weight=0, contribution=None if eval_rows[e['name']] else 0, aggregateScore=None, excluded=not eval_rows[e['name']], englishShare=0, effectiveEnglishShare=None, englishScore=None, otherScore=None, issue='') for e in config['evals']]
        available_weight = sum(weight for category, weight in config['weights'].items() if any(e['category'] == category and e['count'] for e in evals))
        categories = []
        for category, weight in config['weights'].items():
            configured = [e for e in evals if e['category'] == category]
            ff = [e for e in configured if e['count']]
            effective_weight = weight/available_weight if ff and available_weight else 0
            share = config.get('english_weights', {}).get(category, 0) if aggregate != 'standard' else 0
            c = dict(name=category, weight=effective_weight, excluded=not ff, excludedEvals=[e['name'] for e in configured if not e['count']], score=None, evals=len(ff), englishShare=share, effectiveEnglishShare=None, englishScore=None, otherScore=None, issue='')
            coefficients = {}
            if not ff:
                categories.append(c)
                continue
            if not share:
                c['score'] = mean(e['score'] for e in ff)
                for e in ff:
                    for r in eval_rows[e['name']]: coefficients[id(r)] = effective_weight / len(ff) / len(eval_rows[e['name']])
            elif aggregate == 'english_eval':
                for e in ff:
                    rr = eval_rows[e['name']]
                    e['englishShare'] = share
                    groups = [[r for r in rr if side(r) == group] for group in ['english', 'other']]
                    e['englishScore'], e['otherScore'] = [mean(r['score_100'] for r in group) if group else None for group in groups]
                    e['effectiveEnglishShare'] = 0 if e['englishScore'] is None else 1 if e['otherScore'] is None else share
                    parts = [e['effectiveEnglishShare'], 1-e['effectiveEnglishShare']]
                    e['aggregateScore'] = parts[0]*(e['englishScore'] or 0)+parts[1]*(e['otherScore'] or 0)
                    for part, group in zip(parts, groups):
                        for r in group: coefficients[id(r)] = effective_weight/len(ff)*part/len(group)
                if not c['issue']: c['score'] = mean(e['aggregateScore'] for e in ff)
            else:
                groups = [[variants for e in ff if (variants := [r for r in eval_rows[e['name']] if side(r) == group])] for group in ['english', 'other']]
                c['englishScore'], c['otherScore'] = [mean(mean(r['score_100'] for r in variants) for variants in group) if group else None for group in groups]
                if not c['issue']:
                    c['effectiveEnglishShare'] = 0 if c['englishScore'] is None else 1 if c['otherScore'] is None else share
                    parts = [c['effectiveEnglishShare'], 1-c['effectiveEnglishShare']]
                    c['score'] = parts[0]*(c['englishScore'] or 0) + parts[1]*(c['otherScore'] or 0)
                    for part, group in zip(parts, groups):
                        for variants in group:
                            for r in variants: coefficients[id(r)] = effective_weight * part / len(group) / len(variants)
            for e in ff:
                e['weight'] = sum(coefficients.get(id(r), 0) for r in eval_rows[e['name']])
                e['contribution'] = sum(r['score_100']*coefficients.get(id(r), 0) for r in eval_rows[e['name']]) if c['score'] is not None else None
                e['aggregateScore'] = e['contribution']/e['weight'] if c['score'] is not None and e['weight'] else None
            categories.append(c)
        complete = available_weight > 0 and all(c['score'] is not None for c in categories if not c['excluded'])
        result.append(dict(model=model, evals=evals, categories=categories, score=sum(c['score']*c['weight'] for c in categories if not c['excluded']) if complete else None))
    return result


def write_csv(path, rows):
    with path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def directory_files(directory, suffixes):
    if not directory.is_dir():raise ValueError(f'Required directory does not exist: {directory}')
    return sorted(path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in suffixes)


def default_config(directory):
    """Resolve the filename selected by a config directory's default.txt."""
    selection = directory/'default.txt'
    try:
        name = selection.read_text().strip()
    except OSError as error:
        raise ValueError(f'{selection}: cannot read default config selection') from error
    if not name or len(name.splitlines()) != 1 or '/' in name or '\\' in name or Path(name).suffix.lower() not in {'.yaml', '.yml'}:
        raise ValueError(f'{selection}: expected one YAML filename in this directory')
    path = directory/name
    if not path.is_file():
        raise ValueError(f'{selection}: selected config {name!r} does not exist')
    return path


def build(source, output, config_path=None, results_dir=None, configs_dir=None):
    if source is not None and results_dir is not None:raise ValueError('Choose a CSV or --results-dir, not both')
    if config_path is None:
        configs_dir = configs_dir if configs_dir is not None else ROOT/'configs'
        config_path = default_config(configs_dir)
    config = load_config(config_path)
    configurations=[dict(file=config_path.name,config=config)]
    if configs_dir is not None:
        for path in directory_files(configs_dir,{'.yaml','.yml'}):
            if path.resolve()==config_path.resolve():continue
            try:alternative=load_config(path)
            except ValueError as error:raise ValueError(f'{path.name}: {error}') from error
            if any(c['config']['name']==alternative['name'] for c in configurations):raise ValueError(f'{path.name}: duplicate config name {alternative["name"]!r}; use distinct names')
            configurations.append(dict(file=path.name,config=alternative))
    paths=[source] if source is not None else directory_files(results_dir,{'.csv'}) if results_dir is not None else []
    rows=[];audit=[];sources=[];owners={}
    for path in paths:
        try:
            rr=load_csv(path)
            classified=classify(rr,config)
        except ValueError as error:raise ValueError(f'{path.name}: {error}') from error
        for model in {r['checkpoint'] for r in rr}:
            if model in owners:raise ValueError(f'Duplicate model name {model!r} in {owners[model]} and {path.name}; combine its results in one file or rename the checkpoint')
            owners[model]=path.name
        rows.extend(rr);audit.extend(classified)
        sources.append(dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    for alternative in configurations[1:]:
        try:classify(rows,alternative['config'])
        except ValueError as error:raise ValueError(f'{alternative["file"]}: {error}') from error
    aggregates = {mode: summarize(audit, config, mode) for mode in ['standard', 'english_eval', 'english_category']}
    summary = aggregates[config.get('aggregate', 'standard')]
    output.mkdir(parents=True, exist_ok=True)
    if audit:
        write_csv(output/'row-audit.csv', audit)
        write_csv(output/'eval-scores.csv', [dict(model=m['model'], **f) for m in summary for f in m['evals']])
        write_csv(output/'category-scores.csv', [dict(model=m['model'], **c) for m in summary for c in m['categories']])
    else:
        for name in ['row-audit.csv', 'eval-scores.csv', 'category-scores.csv', 'language-metadata.csv']:
            (output/name).unlink(missing_ok=True)
    metadata = [task_language(task, config) for task in sorted({r['task'] for r in rows})]
    if metadata:write_csv(output/'language-metadata.csv', metadata)
    payload = dict(config_file=config_path.name, configurations=configurations, metadata=metadata, scheme=config, models=summary, aggregates=aggregates, rows=audit, sources=sources, source=source.name if source else results_dir.name if results_dir else '', sha256=sources[0]['sha256'] if len(sources)==1 else None)
    (output/'eval-config.yaml').write_text(config_path.read_text())
    (output/'analysis.json').write_text(json.dumps(payload, indent=2))
    template = (APP/'template.html').read_text()
    (output/'index.html').write_text(template.replace('__APP__', (APP/'vendor/js-yaml.js').read_text()+'\n'+(APP/'eval_config.js').read_text()+'\n'+(APP/'app.js').read_text()).replace('__PAYLOAD__', json.dumps(payload).replace('<', '\\u003c')))
    print(json.dumps(dict(models=summary, rows=len(audit), selected=sum(r['selected'] for r in audit)), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path, nargs='?', help='CSV to embed; omit to start without results')
    parser.add_argument('--results-dir', type=Path, help='Embed all CSV files directly inside this directory')
    parser.add_argument('--configs-dir', type=Path, help='Offer YAML configs from this directory; default: repository configs/ when --config is omitted')
    parser.add_argument('--output', type=Path, default=ROOT/'output')
    parser.add_argument('--config', type=Path, help='Use this config instead of the filename in configs/default.txt; used alone, embed only this config')
    args = parser.parse_args()
    if args.csv is not None and args.results_dir is not None:parser.error('Choose a CSV or --results-dir, not both')
    build(args.csv, args.output, args.config, args.results_dir, args.configs_dir)
