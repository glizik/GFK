import json,os,collections,datetime,re
import sys
r=json.load(open(sys.argv[1]))
STEP={'deepfake-detection':'Deepfake-nél elakad','voice-liveness-check':'Voice-liveness-nél elakad','customerPortrait':'Arcképnél elakad',
 'idFront':'Igazolvány előlapnál elakad','idBack':'Igazolvány hátlapnál elakad','hologram':'Hologramnál elakad','id-back-video':'Hátlap-videónál elakad','twoFactor':'2FA-nál elakad'}
def fmt(ms): return datetime.datetime.fromtimestamp(ms/1000).strftime('%m-%d %H:%M')
def dur(s):
  s=max(0,int(round(s)))
  return '—' if s==0 else f"{s//60}:{s%60:02d}"
OUT={'approve':'Approved','aborted':'Abort','failed':'Elutasítva','reject':'Elutasítva','other':'?'}
def note_final(x):
  c=x['cat']; o=x['outcome']
  if o=='approve': return '≈ jóváhagyás csak következtetett (2FA után nincs záró report)' if x['possibly'] else ''
  if c.startswith('abort:') or c.startswith('quit:'):
    st=c.split(':',1)[1]; return STEP.get(st, 'kilépett (lépés ismeretlen)' if st=='?' else f'{st}-nél kilép')
  return {'nologs':'nincs breadcrumb (Crashlytics nem adta át)','unexpected':'Unexpected error (SDK)'}.get(c, x['label'])
segs=[]
for x in r:
  ex=sorted([e for e in x['exits'] if e.get('to')], key=lambda e:e['to'])
  prev=x['start']
  # An attempt starts at the previous abort, or at the Firebase session it lives in if the user
  # came back later (otherwise an overnight pause counts as attempt length).
  def st(t): return max([prev]+[ts for ts in x['tries'] if ts<=t])
  for e in ex:
    w=e.get('wait'); s0=st(e['to']); segs.append(dict(user=x['user'] or x['key'],fk=x['fk'] or '(nincs FaceKom id)',start=s0,dur=(e['to']-s0)/1000,
      out='Abort',note=STEP.get(e['step'],e['step']+'-nél elakad')+(f" (várt {dur(w)})" if w else ''),app=x['app'].split(' ')[0]))
    prev=e['to']
  if x['outcome']!='aborted' or not ex:
    s0=st(x['end']); segs.append(dict(user=x['user'] or x['key'],fk=x['fk'] or '(nincs FaceKom id)',start=s0,dur=(x['end']-s0)/1000,
      out=OUT.get(x['outcome'],x['outcome']),note=note_final(x),app=x['app'].split(' ')[0]))
def tf_in(x,a,b): return sum(1 for t in x['tf'] if a<=t<=b)
segs2=[]
for x in r:
  mine=[sg for sg in segs if sg['fk']==(x['fk'] or '(nincs FaceKom id)') and sg['user']==(x['user'] or x['key'])]
  for sg in mine:
    n=tf_in(x, sg['start'], sg['start']+sg['dur']*1000)
    if sg['note'].startswith('2FA-nál elakad'): sg['note']=f"2FA-nál elakad (SMS-kód {n}× újrakérve)" if n else '2FA-nál elakad'
    elif n>=2: sg['note']=(sg['note']+'; ' if sg['note'] else '')+f"előtte 2FA-n SMS-kód {n}× újrakérve"
byu=collections.defaultdict(list)
for s in segs: byu[s['user']].append(s)
users=sorted(byu.values(), key=lambda L:min(s['start'] for s in L))
def table(users):
  out=["| # | FaceKom azonosító | Kezdete | Hossza | Átment? | Megjegyzés | App |","|---|---|---|---|---|---|---|"]; n=0
  for L in users:
    L.sort(key=lambda s:s['start'])
    for k,sg in enumerate(L):
      if k==0: n+=1
      o=sg['out'] if k==0 else f"x{k+1} {sg['out']}"
      out.append(f"| {n if k==0 else ''} | `{sg['fk']}` | {fmt(sg['start'])} | {dur(sg['dur'])} | {o} | {sg['note']} | {sg['app']} |")
  return "\n".join(out)
new=[L for L in users if L[0]['app']=='3.9.0']; old=[L for L in users if L[0]['app']!='3.9.0']
att=[sg for L in new for sg in L]
nok=sum(1 for L in new if L[-1]['out']=='Approved')
stall=collections.Counter(re.sub(r' \(.*','',sg['note']) for sg in att if sg['out']!='Approved' and sg['note'])
summ="\n".join(f"- {k}: **{v}** ({round(100*v/len(att))}%)" for k,v in stall.most_common())
md=f"""# FaceKom azonosítások az új prod backend (1.9.11.44) óta — 2026-11-18 17:00 → 11-26

## Régi appok (3.9.0 előtt)

{table(old)}

## 3.9.0

{table(new)}

**3.9.0 összesen: {len(new)} user, ebből {nok} jutott át ({round(100*nok/len(new))}%).**
**{len(att)} próbálkozásból (sessionből) {nok} ment át: {round(100*nok/len(att))}%-os ráta.**

Elakadások (a {len(att)} próbálkozás %-ában):

{summ}
"""
open(sys.argv[2],'w').write(md); print(sys.argv[2])
