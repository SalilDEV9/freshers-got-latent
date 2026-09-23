"""Pure scoring and event rules. No transport or database dependencies."""
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction

ROLES = {'super_admin', 'event_admin', 'controller', 'backstage', 'host', 'judge', 'audience'}
ADMIN = {'super_admin', 'event_admin'}
CREW = ADMIN | {'controller', 'backstage', 'host'}
STAGES = ['REGISTERED', 'CHECKED_IN', 'BACKSTAGE', 'READY', 'ON_STAGE', 'PERFORMING', 'JUDGING', 'REVEAL', 'COMPLETED']
ACTIVE = {'ON_STAGE', 'PERFORMING', 'JUDGING', 'REVEAL'}
MODES = {'exact', 'nearest', 'quarter', 'half'}


def initial_event():
    return {'title': 'Freshers Got Latent', 'club': 'MindQuest · IIIT Kottayam',
            'phase': 'DRAFT', 'registration_open': False, 'judge_names': {}, 'timer_remaining': None, 'revision': 0, 'announcement': '', 'participants': [],
            'judges': [], 'votes': {}, 'voting_open': False, 'timer_end': None,
            'rules': {'minimum': 1, 'maximum': 10, 'step': 1, 'mode': 'exact'}}


def score_value(value, rules):
    if isinstance(value, bool):
        raise ValueError('Enter a numeric score.')
    n = Decimal(str(value))
    lo, hi, step = (Decimal(str(rules[k])) for k in ('minimum', 'maximum', 'step'))
    if not n.is_finite() or n < lo or n > hi or (n - lo) % step:
        raise ValueError(f'Score must be {lo}–{hi}, in steps of {step}.')
    return float(n)


def validate_rules(rules):
    if set(rules) != {'minimum', 'maximum', 'step', 'mode'}:
        raise ValueError('Incomplete scoring rules.')
    lo, hi, step = (Decimal(str(rules[k])) for k in ('minimum', 'maximum', 'step'))
    if not all(x.is_finite() for x in (lo, hi, step)) or not 0 <= lo < hi <= 100 or step not in (Decimal('1'), Decimal('.5'), Decimal('.25'), Decimal('.1')):
        raise ValueError('Use a 0–100 range and a step of 1, 0.5, 0.25, or 0.1.')
    if (hi - lo) % step or rules['mode'] not in MODES:
        raise ValueError('Invalid score range or matching mode.')


def result_for(participant, rules):
    # Fraction avoids floating-point errors and rounding-dependent exact matches.
    values = [Fraction(str(s['value'])) for s in participant['scores'].values()]
    if not values or participant.get('self_score') is None:
        raise ValueError('Scores are incomplete.')
    average = sum(values) / len(values)
    prediction = Fraction(str(participant['self_score']))
    difference = abs(average - prediction)
    mode = rules['mode']
    rounded = (Decimal(average.numerator) / Decimal(average.denominator)).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
    match = difference == 0 if mode == 'exact' else (Fraction(rounded) == prediction if mode == 'nearest' else difference <= Fraction(1, 4 if mode == 'quarter' else 2))
    return {'average': float(average), 'self_score': float(prediction), 'difference': float(difference), 'match': match}


def public_event(event, user=None):
    role = user.role if user else 'audience'
    data = {k: event[k] for k in ('title', 'club', 'phase', 'revision', 'announcement', 'rules', 'voting_open', 'timer_end')}
    data['registration_open'] = event.get('registration_open', False)
    data['timer_remaining'] = event.get('timer_remaining')
    data['judge_names'] = event.get('judge_names', {}) if role in CREW | {'judge'} else {}
    data['participants'] = []
    data['my_registration'] = None
    for p in event['participants']:
        if user and p.get('registered_by') == user.id:
            data['my_registration'] = {'id': p['id'], 'name': p['name'], 'state': p['state']}
        if p['state'] == 'PENDING' and role not in CREW:
            continue
        item = {k: p[k] for k in ('id', 'name', 'category', 'bio', 'state', 'position')}
        item['members'] = p.get('members', [])
        if p['state'] == 'VOID' and role in CREW:
            item['void_reason'] = p.get('void_reason', '')
        revealed = p['state'] in {'REVEAL', 'COMPLETED'}
        if role in CREW | {'judge'}:
            item['panel'] = p.get('panel', event['judges'])
            item['self_locked'] = p.get('self_score') is not None
            item['submitted'] = list(p['scores'])
        if user and role == 'judge':
            item['my_score'] = p['scores'].get(str(user.id))
        if revealed:
            item['result'] = result_for(p, event['rules'])
            item['scores'] = p['scores']
        data['participants'].append(item)
    data['judges'] = event['judges'] if role in CREW | {'judge'} else []
    data['my_vote'] = event['votes'].get(str(user.id)) if user else None
    if event['phase'] == 'ENDED':
        data['audience_results'] = {p['id']: list(event['votes'].values()).count(p['id']) for p in event['participants'] if p['state'] == 'COMPLETED'}
    return data
