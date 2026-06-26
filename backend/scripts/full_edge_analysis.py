#!/usr/bin/env python3
import json

with open('backend/data/kalshi-feature-snapshots.jsonl') as f:
    feats = [json.loads(l) for l in f if l.strip()]
with open('backend/data/kalshi-labeled-snapshots.json') as f:
    labeled = json.load(f)

feat_full = {r['snapshot_id']: r for r in feats}
real_labeled = [r for r in labeled if 'DEMO' not in r.get('snapshotId','')]

for r in real_labeled:
    snap_id = r.get('snapshotId')
    feat = feat_full.get(snap_id, {})
    r['settlement_outcome'] = feat.get('settlement_outcome')
    r['feat_btc']      = feat.get('btc_price') or r.get('btcPrice', 0)
    r['feat_target']   = feat.get('target_price') or r.get('targetPrice', 0)
    r['feat_dist_usd'] = feat.get('distance_usd') or r.get('distanceUsd', 0)
    r['feat_dist_bps'] = feat.get('distance_bps') or r.get('distanceBps', 0)
    r['feat_mins']     = feat.get('minutes_remaining') or r.get('minutesRemaining', 10)
    r['feat_mom_1m']   = feat.get('momentum_1min_bps') or 0
    r['feat_mom_5m']   = feat.get('momentum_5min_bps') or 0
    r['feat_imbal']    = feat.get('orderbook_imbalance') or 0.5

settled = [r for r in real_labeled if r.get('settlement_outcome') in ('YES','NO')]
STAKE = 5.0

def build_trades(records, min_edge=0.0):
    trades = []
    for r in records:
        edge   = r.get('bestAdjustedEdge') or 0
        side   = r.get('bestSide') or 'YES'
        outcome= r.get('settlement_outcome')
        model_p= r.get('modelYesProbability') or 50
        mkt_p  = r.get('yesMarketProbability') or 50
        mins   = r.get('feat_mins') or 10
        dist_u = r.get('feat_dist_usd') or 0
        btc    = r.get('feat_btc') or 0
        target = r.get('feat_target') or 0
        mom_1m = r.get('feat_mom_1m') or 0
        mom_5m = r.get('feat_mom_5m') or 0
        imbal  = r.get('feat_imbal') or 0.5

        if edge < min_edge: continue
        if outcome is None: continue

        won = (side == 'YES' and outcome == 'YES') or (side == 'NO' and outcome == 'NO')
        cost_pct = (mkt_p/100) if side=='YES' else ((100-mkt_p)/100)
        cost_pct = max(0.01, min(0.99, cost_pct))
        pnl    = STAKE*(1/cost_pct - 1) if won else -STAKE
        risked = STAKE

        signed_dist = (target - btc) if side=='YES' else (btc - target)
        crossed     = signed_dist <= 0
        within_5bps = 0 <= signed_dist/btc*10000 <= 5 if btc else False

        trades.append(dict(
            side=side, won=won, edge=edge, pnl=pnl, risked=risked,
            modelP=model_p, marketP=mkt_p,
            mins=mins, signed_dist=signed_dist, dist_u=dist_u,
            crossed=crossed, within_5bps=within_5bps,
            mom_1m=mom_1m, mom_5m=mom_5m, imbal=imbal,
            btc=btc, target=target, outcome=outcome,
            ticker=r.get('marketTicker','?')
        ))
    return trades

def analyze(trades, label=''):
    n = len(trades)
    if n == 0: return None
    wins = sum(1 for t in trades if t['won'])
    total_pnl  = sum(t['pnl']    for t in trades)
    total_risk = sum(t['risked'] for t in trades)
    wr  = wins/n*100
    roi = total_pnl/total_risk*100 if total_risk else 0
    gw  = sum(t['pnl'] for t in trades if t['pnl'] > 0)
    gl  = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
    pf  = gw/gl if gl else float('inf')
    wl  = [t['pnl'] for t in trades if t['pnl'] > 0]
    ll  = [t['pnl'] for t in trades if t['pnl'] < 0]
    aw  = sum(wl)/len(wl) if wl else 0
    al  = sum(ll)/len(ll) if ll else 0
    exp = (wr/100)*aw + ((100-wr)/100)*al
    peak, cum, mdd = 0, 0, 0
    for t in trades:
        cum += t['pnl']
        peak = max(peak, cum)
        mdd  = max(mdd, peak-cum)
    return dict(label=label,n=n,wins=wins,wr=wr,roi=roi,pnl=total_pnl,
                risk=total_risk,pf=pf,aw=aw,al=al,exp=exp,mdd=mdd)

def srow(s):
    pf_str = '{:.2f}'.format(s['pf']) if s['pf'] != float('inf') else 'inf'
    return [
        s['label'], s['n'], s['wins'],
        '{:.1f}%'.format(s['wr']),
        '${:.2f}'.format(s['pnl']),
        '{:.1f}%'.format(s['roi']),
        '${:.2f}'.format(s['aw']),
        '${:.2f}'.format(s['al']),
        pf_str,
        '${:.3f}'.format(s['exp']),
        '${:.2f}'.format(s['mdd'])
    ]

def print_table(cols, rows):
    ws = [max(len(str(c)), max((len(str(r[i])) for r in rows), default=0)) for i, c in enumerate(cols)]
    def sep(a,b,c): return a+b.join('-'*(w+2) for w in ws)+c
    def frow(r): return '| '+' | '.join(str(v).ljust(w) for v, w in zip(r, ws))+' |'
    print(sep('+','+','+'))
    print(frow(cols))
    print(sep('+','+','+'))
    for r in rows: print(frow(r))
    print(sep('+','+','+'))

COLS = ['Group','N','W','WinRate','TotalPnL','ROI%','AvgWin','AvgLoss','PF','Expect','MaxDD']
SEP  = '='*74

print()
print(SEP)
print('  EDGE BUCKET ANALYSIS — 142 REAL LABELED SNAPSHOTS  (joined with settlement)')
print(SEP)
print('  Total settled records : {}'.format(len(settled)))

all_trades = build_trades(settled, 0)
t5  = build_trades(settled, 5)
t10 = build_trades(settled, 10)
t20 = build_trades(settled, 20)
t30 = build_trades(settled, 30)

print('  Edge>=0  tradeable : {}'.format(len(all_trades)))
print('  Edge>=5% tradeable : {}'.format(len(t5)))
print()

print('--- MIN EDGE THRESHOLD COMPARISON ---')
baselines = [analyze(g, lbl) for g, lbl in [
    (all_trades, 'edge >= 0%'),
    (t5,  'edge >= 5%'),
    (t10, 'edge >= 10%'),
    (t20, 'edge >= 20%'),
    (t30, 'edge >= 30%'),
] if g]
print_table(COLS, [srow(s) for s in baselines if s])

print()
print('--- EDGE BUCKETS (Does higher edge = higher ROI?) ---')
edge_groups = [
    ('Edge  0-10%',  0,  10),
    ('Edge 10-20%', 10,  20),
    ('Edge 20-30%', 20,  30),
    ('Edge 30-50%', 30,  50),
    ('Edge  50%+',  50, 999),
]
eg = [analyze([t for t in all_trades if lo<=t['edge']<hi], lbl) for lbl,lo,hi in edge_groups]
eg = [s for s in eg if s]
print_table(COLS, [srow(s) for s in eg])

rois = [s['roi'] for s in eg]
mono = all(rois[i] <= rois[i+1] for i in range(len(rois)-1))
best = max(eg, key=lambda s: s['roi'])
print('\n  VERDICT: Monotonic={} | Best bucket={} (ROI={:.1f}%, n={})'.format(mono, best['label'], best['roi'], best['n']))

print()
print('--- HYPOTHESIS TEST: BTC crossed target + time filter ---')
hyp_groups = [
    ('No filter (edge>=5%)', t5),
    ('Crossed target',       [t for t in t5 if t['crossed']]),
    ('Dist <= $15 to tgt',   [t for t in t5 if t['signed_dist'] <= 15]),
    ('Mins <= 5',            [t for t in t5 if t['mins'] <= 5]),
    ('Mins <= 3',            [t for t in t5 if t['mins'] <= 3]),
    ('Mins <= 1',            [t for t in t5 if t['mins'] <= 1]),
    ('* Crossed + <=5min',   [t for t in t5 if t['crossed'] and t['mins'] <= 5]),
    ('* Dist<=15 + <=5min',  [t for t in t5 if t['signed_dist'] <= 15 and t['mins'] <= 5]),
    ('** Crossed + <=3min',  [t for t in t5 if t['crossed'] and t['mins'] <= 3]),
    ('** Cross+<=3+edge>=20',[t for t in t5 if t['crossed'] and t['mins'] <= 3 and t['edge'] >= 20]),
]
hyp_results = [analyze(g, lbl) for lbl, g in hyp_groups if g]
print_table(COLS, [srow(s) for s in hyp_results if s])

print()
print('--- TIME-TO-EXPIRY BUCKETS ---')
time_bkts = [('{} min'.format(m),m,m+1) for m in range(1,15)]
tr = [analyze([t for t in all_trades if lo<=t['mins']<hi], lbl) for lbl,lo,hi in time_bkts]
print_table(COLS, [srow(s) for s in tr if s])

print()
print('--- SIGNED DISTANCE TO TARGET (USD, negative = already crossed) ---')
dist_bkts = [
    ('< -$100 (far crossed)', -9999, -100),
    ('-$100 to -$10 crossed', -100,  -10),
    ('-$10 to $0 (just cross)', -10,   0),
    ('$0 to $10 (very near)',    0,   10),
    ('$10 to $50',             10,   50),
    ('$50 to $150',            50,  150),
    ('> $150 (far away)',     150, 9999),
]
dr = [analyze([t for t in all_trades if lo<=t['signed_dist']<hi], lbl) for lbl,lo,hi in dist_bkts]
print_table(COLS, [srow(s) for s in dr if s])

print()
print('--- MOMENTUM AT ENTRY (1-min bps) ---')
mom_bkts = [
    ('Strong up >10bps',   10, 999),
    ('Up 5-10bps',          5,  10),
    ('Flat 0-5bps',         0,   5),
    ('Down -5 to 0',       -5,   0),
    ('Strong dn <-5bps', -999,  -5),
]
mr = [analyze([t for t in all_trades if lo<=t['mom_1m']<hi], lbl) for lbl,lo,hi in mom_bkts]
print_table(COLS, [srow(s) for s in mr if s])

print()
print('--- YES vs NO SIDE ---')
yes_s = analyze([t for t in all_trades if t['side']=='YES'], 'YES side')
no_s  = analyze([t for t in all_trades if t['side']=='NO'],  'NO side')
print_table(COLS, [srow(s) for s in [yes_s, no_s] if s])

print()
print('--- MODEL CALIBRATION (ModelP vs Actual Win Rate) ---')
cal_bkts = [
    ('0-20%',   0,  20),
    ('20-35%', 20,  35),
    ('35-50%', 35,  50),
    ('50-65%', 50,  65),
    ('65-80%', 65,  80),
    ('80-100%',80, 101),
]
cal_cols = ['Bucket','N','AvgModelP','ActualWR','CalibGap','ROI%']
cal_rows = []
for lbl, lo, hi in cal_bkts:
    g = [t for t in all_trades if lo <= t['modelP'] < hi]
    if not g: continue
    wins   = sum(1 for t in g if t['won'])
    wr     = wins/len(g)*100
    avg_mp = sum(t['modelP'] for t in g)/len(g)
    roi    = sum(t['pnl'] for t in g)/sum(t['risked'] for t in g)*100
    gap    = wr - avg_mp
    cal_rows.append([lbl, len(g),
                     '{:.1f}%'.format(avg_mp),
                     '{:.1f}%'.format(wr),
                     '{:+.1f}pp'.format(gap),
                     '{:.1f}%'.format(roi)])
if cal_rows:
    ws2 = [max(len(str(c)), max((len(str(r[i])) for r in cal_rows), default=0)) for i, c in enumerate(cal_cols)]
    def sep2(a,b,c): return a+b.join('-'*(w+2) for w in ws2)+c
    def frow2(r): return '| '+' | '.join(str(v).ljust(w) for v, w in zip(r, ws2))+' |'
    print(sep2('+','+','+'))
    print(frow2(cal_cols))
    print(sep2('+','+','+'))
    for r in cal_rows: print(frow2(r))
    print(sep2('+','+','+'))

print()
print(SEP)
print('  FINAL BUILDER DIAGNOSIS')
print(SEP)
base_all = analyze(all_trades, 'all')
base5_s  = analyze(t5, 'e>=5')
hyp_best = analyze([t for t in t5 if t['crossed'] and t['mins'] <= 5], 'hyp')
if base_all:
    print('  All trades       : WR={:.1f}% | ROI={:.1f}% | PF={:.2f} | exp=${:.4f}'.format(
        base_all['wr'], base_all['roi'],
        base_all['pf'] if base_all['pf']!=float('inf') else 999,
        base_all['exp']))
if base5_s:
    print('  Edge >= 5%       : WR={:.1f}% | ROI={:.1f}% | PF={:.2f} | exp=${:.4f}'.format(
        base5_s['wr'], base5_s['roi'],
        base5_s['pf'] if base5_s['pf']!=float('inf') else 999,
        base5_s['exp']))
if hyp_best:
    print('  Crossed+<=5min   : WR={:.1f}% | ROI={:.1f}% | PF={:.2f} | exp=${:.4f} | N={}'.format(
        hyp_best['wr'], hyp_best['roi'],
        hyp_best['pf'] if hyp_best['pf']!=float('inf') else 999,
        hyp_best['exp'], hyp_best['n']))
print(SEP)
print()
