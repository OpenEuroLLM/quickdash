"""Build a standalone Quickdash page from optional CSV results and YAML configs."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from quickdash.io import load_csv
from quickdash.config import classify, task_language, load_catalogue, serialize_catalogue, load_profile, load_suite, resolve_config, resolve_inputs, scope_rows
from quickdash.analysis import totals, component_coverage, diagnostic, analyze

APP = Path(__file__).resolve().parent
ROOT = APP.parent



def summarize(audit, config, aggregate=None):
    """Summarize each model independently using the native Python engine."""
    config={**config,'aggregate':aggregate or config.get('aggregate','standard')}
    result=[]
    for model in sorted({r['checkpoint'] for r in audit}):
        rows=[r for r in audit if r['checkpoint']==model and r['selected']]
        t=totals(rows,config)
        excluded=component_coverage(rows,config)['excluded']
        diagnostics=[diagnostic('incomplete_components',model,name,[r for r in excluded if r['eval']==name],'Incomplete component group; excluded from scoring.','excluded') for name in dict.fromkeys(r['eval'] for r in excluded)]
        result.append(dict(model=model,score=t['score'],warnings=diagnostics,evals=t['evals'],categories=[{**c,'evals':sum(e['category']==c['name'] and not e['excluded'] for e in t['evals'])} for c in t['categories']]))
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


def config_choices(path, directory, kind, default_directory):
    if path is None:
        directory = directory or default_directory
        path = default_config(directory)
    choices = [dict(file=path.name, config={"weights":load_profile,"suite":load_suite}[kind](path))]
    if directory is not None:
        for candidate in directory_files(directory, {'.yaml', '.yml'}):
            if candidate.resolve() == path.resolve(): continue
            try: config = {"weights":load_profile,"suite":load_suite}[kind](candidate)
            except ValueError as error: raise ValueError(f'{candidate.name}: {error}') from error
            if any(p['config']['name'] == config['name'] for p in choices):
                raise ValueError(f'{candidate.name}: duplicate config name {config["name"]!r}; use distinct names')
            choices.append(dict(file=candidate.name, config=config))
    return path, choices


def build(source, output, catalogue_path=None, results_dir=None, *, weights_path=None, weights_dir=None, suite_path=None, sets_dir=None, sample_csv=None):
    if source is not None and results_dir is not None: raise ValueError('Choose a CSV or --results-dir, not both')
    if sample_csv is not None and results_dir is None: raise ValueError('--sample-csv requires --results-dir')
    catalogue_path = catalogue_path or ROOT/'configs/catalogue.yaml'
    catalogue = load_catalogue(catalogue_path)
    weights_path, profiles = config_choices(weights_path, weights_dir, 'weights', ROOT/'configs/weights')
    suite_path, suites = config_choices(suite_path, sets_dir, 'suite', ROOT/'configs/sets')
    # Every offered combination must resolve before any output is replaced.
    for profile in profiles:
        for entry in suites:
            try: resolve_config(catalogue, entry['config'], profile['config'])
            except ValueError as error: raise ValueError(f'{entry["file"]} / {profile["file"]}: {error}') from error
    suite, profile = suites[0]['config'], profiles[0]['config']
    resolved = resolve_inputs(catalogue, suite, profile)
    config, interpretation, selection = (resolved[k] for k in ("scheme", "catalogue", "suite"))
    paths=[source] if source is not None else directory_files(results_dir,{'.csv'}) if results_dir is not None else []
    using_sample = not paths and sample_csv is not None
    if using_sample: paths = [sample_csv]
    rows=[];audit=[];sources=[];owners={}
    for path in paths:
        try:
            rr=load_csv(path)
            classified=classify(rr,interpretation)
        except ValueError as error:raise ValueError(f'{path.name}: {error}') from error
        for model in {r['checkpoint'] for r in rr}:
            if model in owners:raise ValueError(f'Duplicate model name {model!r} in {owners[model]} and {path.name}; combine its results in one file or rename the checkpoint')
            owners[model]=path.name
        rows.extend(rr);audit.extend(classified)
        sources.append(dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    scoped = scope_rows(audit, selection)['rows']
    identities = {tuple(r[k] for k in ['checkpoint','task','metric','filter','n_shot','harness','backend']) for r in scoped}
    included = {id(r) for r in audit if tuple(r[k] for k in ['checkpoint','task','metric','filter','n_shot','harness','backend']) in identities}
    scoped_audit = [dict(r, selected=r['selected'] and id(r) in included) for r in audit]
    aggregates = {mode: summarize(scoped_audit, config, mode) for mode in ['standard', 'english_eval', 'english_category']}
    summary = aggregates[config.get('aggregate', 'standard')]
    diagnostics = analyze(rows,dict(catalogue=catalogue,suite=suite,profile=profile)).diagnostics
    output.mkdir(parents=True, exist_ok=True)
    if audit:
        write_csv(output/'row-audit.csv', audit)
        write_csv(output/'eval-scores.csv', [dict(model=m['model'], **f) for m in summary for f in m['evals']])
        write_csv(output/'category-scores.csv', [dict(model=m['model'], **c) for m in summary for c in m['categories']])
    else:
        for name in ['row-audit.csv', 'eval-scores.csv', 'category-scores.csv', 'language-metadata.csv']:
            (output/name).unlink(missing_ok=True)
    metadata = [task_language(task, catalogue) for task in sorted({r['task'] for r in rows})]
    if metadata:write_csv(output/'language-metadata.csv', metadata)
    payload = dict(diagnostics=diagnostics,catalogue=catalogue, catalogue_file=catalogue_path.name, suite=suite, suite_file=suite_path.name,
                   profile=profile, profile_file=weights_path.name, suites=suites, profiles=profiles,
                   sample_models=sorted(owners) if using_sample else [], metadata=metadata, scheme=config, models=summary, aggregates=aggregates, rows=audit, sources=sources,
                   source=source.name if source else results_dir.name if results_dir else '', sha256=sources[0]['sha256'] if len(sources)==1 else None)
    (output/'catalogue.yaml').write_text(serialize_catalogue(catalogue))
    (output/'weights.yaml').write_text(weights_path.read_text())
    (output/'eval-set.yaml').write_text(suite_path.read_text())
    (output/'analysis.json').write_text(json.dumps(payload, indent=2))
    template = (APP/'template.html').read_text()
    (output/'index.html').write_text(template.replace('__APP__', (APP/'vendor/js-yaml.js').read_text()+'\n'+(APP/'eval_config.js').read_text()+'\n'+(APP/'suite_config.js').read_text()+'\n'+(APP/'analysis.js').read_text()+'\n'+(APP/'app.js').read_text()).replace('__PAYLOAD__', json.dumps(payload).replace('<', '\\u003c')))
    print(json.dumps(dict(models=summary, rows=len(audit), selected=sum(r['selected'] for r in scoped_audit)), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path, nargs='?', help='CSV to embed; omit to start without results')
    parser.add_argument('--results-dir', type=Path, help='Embed all CSV files directly inside this directory')
    parser.add_argument('--sample-csv', type=Path, help='Fallback CSV when --results-dir contains no CSVs')
    parser.add_argument('--catalogue', type=Path, help='Catalogue YAML or per-eval manifest; default: configs/catalogue.yaml')
    parser.add_argument('--weights', type=Path, help='Default weighting profile YAML; used alone, embed only this profile')
    parser.add_argument('--weights-dir', type=Path, help='Offer weighting profiles from this directory (default: configs/weights)')
    parser.add_argument('--eval-set', type=Path, help='Default named eval set YAML; used alone, embed only this set')
    parser.add_argument('--sets-dir', type=Path, help='Offer eval sets from this directory (default: configs/sets)')
    parser.add_argument('--output', type=Path, default=ROOT/'output')
    args = parser.parse_args()
    if args.csv is not None and args.results_dir is not None: parser.error('Choose a CSV or --results-dir, not both')
    build(args.csv, args.output, args.catalogue, args.results_dir, weights_path=args.weights, weights_dir=args.weights_dir, suite_path=args.eval_set, sets_dir=args.sets_dir, sample_csv=args.sample_csv)
