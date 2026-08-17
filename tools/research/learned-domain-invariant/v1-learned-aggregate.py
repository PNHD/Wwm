#!/usr/bin/env python3
import argparse
import json
import math
import pathlib
import statistics

ap = argparse.ArgumentParser()
ap.add_argument('--root', required=True)
ap.add_argument('--freeze', required=True)
ap.add_argument('--prereg', required=True)
ap.add_argument('--output', required=True)
args = ap.parse_args()
root = pathlib.Path(args.root)
out = pathlib.Path(args.output)
out.mkdir(parents=True, exist_ok=True)
freeze = json.load(open(args.freeze))
prereg = json.load(open(args.prereg))
owner = [x['id'] for x in prereg['controls']['ownerUnique']]
repeat = prereg['controls']['sameLocationDrift']['id']
fang = prereg['controls']['independentValidation']['id']
required = owner + [repeat, fang]

files = {}
for p in root.rglob('*.json'):
    try:
        d = json.load(open(p))
    except Exception:
        continue
    if d.get('schema') == 'wwmsync-learned-v1-control-outcome-v1':
        files[d['controlId']] = d
missing = [c for c in required if c not in files]
if missing:
    raise SystemExit('missing learned control outputs: ' + ','.join(missing))

for cid, d in files.items():
    assert d['status'] == 'PASS', (cid, d.get('error'))
    assert d['conformance']['status'] == 'PASS'
    assert d['conformance']['patchTokenCount'] == 196
    assert d['conformance']['registerTokenCount'] == 4
    assert d['conformance']['registerTokensExcludedFromSimilaritySamples'] is True
    expected_ids = [freeze['controls'][cid]['gt']['candidateId']] + [x['candidateId'] for x in freeze['controls'][cid]['top8']]
    actual_ids = [x['candidateId'] for x in d['candidateResults']]
    assert actual_ids == expected_ids, (cid, actual_ids, expected_ids)
    assert all(len(x['poses']) == 81 for x in d['candidateResults'])


def finite(v):
    return isinstance(v, (int, float)) and math.isfinite(v)


def drift_class(h, r):
    if finite(h) and finite(r) and h > 0 and r > 0:
        return 'DR-STABLE' if abs(h - r) <= prereg['generalDrift']['materialMarginChangeAbs'] else 'DR-PARTIAL'
    if finite(h) and finite(r) and h < 0 and r < 0:
        return 'DR-WRONG-STABLE'
    return 'DR-FLIP'


def stage_summary(head, stage):
    margins = {cid: files[cid]['heads'][head][stage]['margin'] for cid in owner}
    positive = [cid for cid, v in margins.items() if finite(v) and v > 0]
    ties = [cid for cid, v in margins.items() if finite(v) and v == 0]
    negative = [cid for cid, v in margins.items() if finite(v) and v < 0]
    vals = [v for v in margins.values() if finite(v)]
    q = [cid for cid in positive if freeze['controls'][cid]['region'] == 'Qinghe']
    k = [cid for cid in positive if freeze['controls'][cid]['region'] == 'Kaifeng']
    return {
        'margins': margins,
        'positiveCount': len(positive),
        'positiveControls': positive,
        'ties': len(ties),
        'negativeCount': len(negative),
        'qinghePositiveCount': len(q),
        'kaifengPositiveCount': len(k),
        'medianMargin': statistics.median(vals) if vals else None,
        'worstMargin': min(vals) if vals else None,
        'gtRanks': {cid: files[cid]['heads'][head][stage]['gtRank'] for cid in owner},
        'contradictions': negative + ties,
    }

summary = {
    'schema': 'wwmsync-learned-v1-local-final-evidence-v1',
    'status': 'PASS',
    'auditStartingLiveHead': prereg['auditStartingLiveHead'],
    'head': None,
    'prereg': {
        'frozenBeforeLearnedGtWrongOutcomes': prereg['frozenBeforeLearnedGtWrongOutcomes'],
        'learnedOutcomesInspected': prereg['learnedOutcomesInspected'],
    },
    'vf0': prereg['authority']['candidateFreeze'],
    'model': {
        'identity': prereg['modelProvenance']['modelIdentity'],
        'sourceCommit': prereg['modelProvenance']['sourceCommit'],
        'weightSha256': prereg['modelProvenance']['weight']['sha256'],
        'weightByteSize': prereg['modelProvenance']['weight']['byteSize'],
    },
    'productionChange': 'NO',
    'controls': files,
    'heads': {},
    'localSurvivors': [],
    'retrieval': {'status': 'PENDING'},
    'stress40Frame': {'status': 'PENDING'},
    'LR': 'PENDING',
}
heads_seen = {d.get('head') for d in files.values()}
summary['head'] = next(iter(heads_seen)) if len(heads_seen) == 1 else sorted(x for x in heads_seen if x)

for head in ['L1', 'L2', 'L3']:
    locked = stage_summary(head, 'locked')
    pose = stage_summary(head, 'pose81')
    hL = files['general-shrine']['heads'][head]['locked']['margin']
    rL = files[repeat]['heads'][head]['locked']['margin']
    hP = files['general-shrine']['heads'][head]['pose81']['margin']
    rP = files[repeat]['heads'][head]['pose81']['margin']
    drift = {
        'locked': {'historicalMargin': hL, 'repeatMargin': rL, 'class': drift_class(hL, rL)},
        'pose81': {'historicalMargin': hP, 'repeatMargin': rP, 'class': drift_class(hP, rP)},
    }
    fang_locked = files[fang]['heads'][head]['locked']
    fang_pose = files[fang]['heads'][head]['pose81']
    clauses = {
        'ownerLockedAtLeast4of6': locked['positiveCount'] >= 4,
        'ownerPose81AtLeast4of6': pose['positiveCount'] >= 4,
        'lockedIncludesQingheAndKaifeng': locked['qinghePositiveCount'] >= 1 and locked['kaifengPositiveCount'] >= 1,
        'pose81IncludesQingheAndKaifeng': pose['qinghePositiveCount'] >= 1 and pose['kaifengPositiveCount'] >= 1,
        'fangLockedPreferred': bool(fang_locked['positive']),
        'fangPose81Preferred': bool(fang_pose['positive']),
        'generalLockedDriftSafe': drift['locked']['class'] in ('DR-STABLE', 'DR-PARTIAL'),
        'generalPose81DriftSafe': drift['pose81']['class'] in ('DR-STABLE', 'DR-PARTIAL'),
        'vf0Frozen': freeze['verdict'] == 'VF0 — V2 CANDIDATE FREEZE COMPLETE',
        'productionGatesOrBeamChanged': False,
    }
    positive_required = [v for k, v in clauses.items() if k != 'productionGatesOrBeamChanged']
    local_survivor = all(positive_required) and not clauses['productionGatesOrBeamChanged']
    summary['heads'][head] = {
        'lockedOwner': locked,
        'pose81Owner': pose,
        'generalDrift': drift,
        'fang': {
            'locked': fang_locked,
            'pose81': fang_pose,
            'bothPreferred': bool(fang_locked['positive'] and fang_pose['positive']),
        },
        'survivorClauses': clauses,
        'localSurvivor': local_survivor,
    }
    if local_survivor:
        summary['localSurvivors'].append(head)

if summary['localSurvivors']:
    summary['status'] = 'RETRIEVAL_REQUIRED'
    summary['retrieval'] = {'status': 'REQUIRED', 'heads': summary['localSurvivors']}
    summary['stress40Frame'] = {'status': 'BLOCKED_ON_RETRIEVAL'}
    summary['LR'] = 'PENDING_RETRIEVAL'
else:
    summary['retrieval'] = {'status': 'SKIPPED_NO_LOCAL_SURVIVORS', 'heads': []}
    summary['stress40Frame'] = {
        'status': 'SKIPPED_NO_RETRIEVAL_SAFE_SURVIVORS',
        'fixtureSha256': prereg['stress40Frame']['sha256'],
    }
    material = []
    for head in ['L1', 'L2', 'L3']:
        e = summary['heads'][head]
        any_owner = e['lockedOwner']['positiveCount'] > 0 or e['pose81Owner']['positiveCount'] > 0
        any_fang = bool(e['fang']['locked']['positive'] or e['fang']['pose81']['positive'])
        if any_owner or any_fang:
            material.append(head)
    if material:
        summary['LR'] = 'LR2 — PARTIAL LEARNED RESCUE'
        summary['verdictReason'] = 'At least one frozen learned head provides positive GT-vs-WRONG evidence on an owner or Fang evaluation, but no head satisfies the complete common local survivor protocol.'
        summary['materialPartialHeads'] = material
    else:
        summary['LR'] = 'LR0 — LEARNED REPRESENTATION NON-SEPARABLE'
        summary['verdictReason'] = 'None of L1-L3 provides positive generalized GT-vs-WRONG separation sufficient for the preregistered material-partial condition.'
        summary['materialPartialHeads'] = []

json.dump(summary, open(out / 'learned-v1-local-evidence.json', 'w'), indent=2, sort_keys=True)
open(out / 'learned-v1-local-evidence.json', 'a').write('\n')
(out / 'local-survivors.txt').write_text('\n'.join(summary['localSurvivors']) + ('\n' if summary['localSurvivors'] else ''))
lines = [
    '# WWMSync Learned / Domain-Invariant Known-GT Representation Audit V1 — Local Evidence',
    '',
    f"Status: **{summary['status']}**",
    f"Local verdict: **{summary['LR']}**",
    'Production change: **NO**',
    '',
    '## Frozen learned heads',
    '',
    '| Head | Locked owner +/6 | 81-pose owner +/6 | Fang locked/81 | General drift locked/81 | Local survivor |',
    '|---|---:|---:|---|---|---|',
]
for head, e in summary['heads'].items():
    lines.append(f"| {head} | {e['lockedOwner']['positiveCount']}/6 | {e['pose81Owner']['positiveCount']}/6 | {e['fang']['locked']['positive']}/{e['fang']['pose81']['positive']} | {e['generalDrift']['locked']['class']} / {e['generalDrift']['pose81']['class']} | {e['localSurvivor']} |")
lines += ['', '## Survivor clauses', '']
for head, e in summary['heads'].items():
    lines.append(f'### {head}')
    for k, v in e['survivorClauses'].items():
        lines.append(f'- {k}: {v}')
    lines.append('')
lines += [
    '## Conditional phases',
    '',
    f"Retrieval: {summary['retrieval']['status']}",
    f"40-frame stress: {summary['stress40Frame']['status']}",
]
(out / 'learned-v1-local-report.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({'status': summary['status'], 'LR': summary['LR'], 'localSurvivors': summary['localSurvivors']}))
