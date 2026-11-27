const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:3737'); await p.waitForTimeout(4000);
await p.evaluate(()=>setGlobalVersion('all')); await p.waitForTimeout(8000);
const rows=await p.evaluate(()=>buildReportSessions().map(u=>{
  const c=laneAbortCategory(u);
  const g=u.tries.flatMap(t=>t.group);
  const end=Math.max(...u.tries.map(t=>t.end||0));
  const exits=u.tries.flatMap(t=>deriveAbortExits(t.group).aborts).map(a=>({step:a.step,wait:a.waitSec,to:a.toTs,from:a.fromTs}));
  return {fk:u.fk||'', key:u.key, user:(g.find(e=>e.user_id_base)||{}).user_id_base||'', start:u.start, end, dur:Math.round((end-u.start)/1000),
    outcome:u.finalOutcome, possibly:u.tries.some(t=>isPossiblyApproveSession(t.group,t.fk)), cat:c.key, label:c.label,
    app:(g.find(e=>e.app_version)||{}).app_version||'', tries:u.tries.map(t=>t.start).filter(Boolean), tf:[...new Set(g.flatMap(e=>(e.logs||[]).filter(l=>/retry Step: .*Step\.twoFactor/.test(l.msg||'')).map(l=>l.rawTs)).filter(Boolean))], env:envOfGroup(g)||'prod', nTries:u.tries.length, exits};
}));
fs.writeFileSync(process.argv[2],JSON.stringify(rows));console.log(rows.length);await b.close();})();
