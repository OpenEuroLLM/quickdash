"""Build a private, offline OELLM score review with local Python and Node.js."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from statistics import mean
from config_engine import classify, task_language, load_config, load_csv

ROOT = Path(__file__).resolve().parent



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


def build(source, output, config_path=ROOT/"eval-config.yaml"):
    config = load_config(config_path)
    rows = load_csv(source)
    audit = classify(rows, config)
    aggregates = {mode: summarize(audit, config, mode) for mode in ['standard', 'english_eval', 'english_category']}
    summary = aggregates[config.get('aggregate', 'standard')]
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output/'row-audit.csv', audit)
    write_csv(output/'eval-scores.csv', [dict(model=m['model'], **f) for m in summary for f in m['evals']])
    write_csv(output/'category-scores.csv', [dict(model=m['model'], **c) for m in summary for c in m['categories']])
    metadata = [task_language(task, config) for task in sorted({r['task'] for r in rows})]
    write_csv(output/'language-metadata.csv', metadata)
    payload = dict(config_file=config_path.name, metadata=metadata, scheme=config, models=summary, aggregates=aggregates, rows=audit, source=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest())
    (output/'eval-config.yaml').write_text(config_path.read_text())
    (output/'analysis.json').write_text(json.dumps(payload, indent=2))
    template = (ROOT/'template.html').read_text()
    (output/'index.html').write_text(template.replace('__APP__', (ROOT/'vendor/js-yaml.js').read_text()+'\n'+(ROOT/'eval_config.js').read_text()+'\n'+(ROOT/'app.js').read_text()).replace('__PAYLOAD__', json.dumps(payload).replace('<', '\\u003c')))
    print(json.dumps(dict(models=summary, rows=len(audit), selected=sum(r['selected'] for r in audit)), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT/'output')
    parser.add_argument('--config', type=Path, default=ROOT/'eval-config.yaml')
    args = parser.parse_args()
    build(args.csv, args.output, args.config)
