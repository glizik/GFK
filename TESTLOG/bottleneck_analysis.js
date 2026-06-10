// Ad-hoc bottleneck analysis — replicate the dashboard's lane/outcome/stuck-step logic
// to answer: how many never-passed FaceKom sessions are blocked at each step?
const fs = require('fs');

// ---- helpers copied/adapted from index.html ----
function normalizeOutcome(o){
  if(o==='approve'||o==='finished')return'approve';
  if(o==='reject')return'reject';
  if(o==='aborted'||o==='user closed')return'aborted';
  if(o==='failed')return'failed';
  return'other';
}
function deriveOutcome(ev){
  const csv=(ev.outcome||'').trim();
  if(csv&&csv!=='—')return csv;
  const desc=(ev.nslocalized_description||'').trim();
  const st=desc.match(/:\s*(finished|aborted|expired|failed)\b/i);
  if(st){const s=st[1].toLowerCase();if(s==='finished')return'finished';if(s==='aborted')return'aborted';return'failed';}
  let outcome='';
  for(const log of ev.logs||[]){const msg=log.msg||'';
    if(msg.includes('finished with type:'))outcome=msg.split('finished with type:')[1].trim();
    else if(!outcome&&msg.includes('finished with state: finished'))outcome='finished';
    else if(!outcome&&msg.includes('finished with state: aborted'))outcome='aborted';
    else if(!outcome&&msg.includes('finished with state: failed'))outcome='failed';
    else if(!outcome&&msg.includes('user initiated closing'))outcome='user closed';
  }
  return outcome||'—';
}
function deriveSessionOutcome(group){
  const o=group.map(ev=>normalizeOutcome(deriveOutcome(ev)));
  if(o.includes('approve'))return'approve';
  if(o.includes('failed'))return'failed';
  if(o.includes('aborted'))return'aborted';
  return o.find(x=>x!=='other')||'other';
}
function getEndReason(group){
  for(const ev of group)for(const log of ev.logs||[]){const msg=log.msg||'';
    if(!msg.includes('FaceKom nextStep:')||!msg.includes('end('))continue;
    if(msg.includes('reason = "'))return msg.split('reason = "')[1].split('"')[0];}
  return null;
}
function facekomSessionId(ev){
  if(ev.user_id_base)return ev.user_id_suffix?`${ev.user_id_base}-${ev.user_id_suffix}`:ev.user_id_base;
  const link=ev.identification_link||'';const m=link.match(/\/identification\/([^/?#\s]+)/);
  return m?m[1]:'';
}
function fkBase(fk){return fk||'';}
function stepFromMsg(m){
  let mm;
  if((mm=m.match(/nextStep:\s*custom\(type:\s*"([^"]+)"/)))return mm[1];
  if((mm=m.match(/StepMessage:\s*\w+\(step:\s*"([^"]+)"/)))return mm[1];
  if((mm=m.match(/handleNewMessageStep:.*?currentStep:\s*([A-Za-z0-9\-]+)/))&&mm[1]!=='end')return mm[1];
  if((mm=m.match(/nextStep:\s*([A-Za-z0-9]+)\(/))&&mm[1]!=='end'&&mm[1]!=='custom')return mm[1];
  return null;
}
function mergeGroupLogs(group){
  const seen=new Set(),out=[];
  for(const ev of group)for(const l of(ev.logs||[])){const k=l.rawTs+'|'+l.msg;if(seen.has(k))continue;seen.add(k);out.push(l);}
  return out.sort((a,b)=>a.rawTs-b.rawTs);
}
function deriveStuckStep(ev){
  const logs=ev.logs||[];
  const skip=/user initiated closing|enter background|SelfService stopped|status changed|finished with state|stopStream|aborted state|disconnected/;
  for(let i=logs.length-1;i>=0;i--){const m=logs[i].msg||'';if(skip.test(m))continue;let mm;
    if((mm=m.match(/nextStep:\s*custom\(type:\s*"([^"]+)"/)))return mm[1];
    if((mm=m.match(/StepMessage:\s*\w+\(step:\s*"([^"]+)"/)))return mm[1];
    if((mm=m.match(/handleNewMessageStep:.*?currentStep:\s*([A-Za-z0-9\-]+)/))&&mm[1]!=='end')return mm[1];
    if((mm=m.match(/nextStep:\s*([A-Za-z0-9\-]+)/))&&mm[1]!=='end')return mm[1];}
  return null;
}
function deriveAbortExits(group){
  const logs=mergeGroupLogs(group);
  const isExit=/user initiated closing|enter background|SelfService stopped|status changed|stopStream|aborted state|finished with state|disconnected/;
  let lastRealTs=null,lastRealStep=null,lastDet=null;const aborts=[],bg={};
  for(let i=0;i<logs.length;i++){const m=logs[i].msg||'',ts=logs[i].rawTs;
    if(/nextStep:\s*end\(status:\s*"aborted"/.test(m)){
      let exitTs=ts,isVideo=null,step=lastRealStep;
      for(let j=i-1;j>=0&&(ts-logs[j].rawTs)<=8000;j--){const mj=logs[j].msg||'';
        const b=mj.match(/did enter background at step:\s*([^,]+),\s*isVideoStep:\s*(true|false)/);
        if(b){exitTs=logs[j].rawTs;isVideo=b[2]==='true';break;}
        if(/user initiated closing, isAlreadyClosed:\s*false/.test(mj)){exitTs=logs[j].rawTs;break;}}
      const waitSec=(lastRealTs&&exitTs)?Math.max(0,Math.round((exitTs-lastRealTs)/1000)):null;
      aborts.push({step:step||'?',waitSec,isVideo,det:lastDet});
      lastRealTs=null;lastRealStep=null;lastDet=null;continue;}
    const b=m.match(/did enter background at step:\s*([^,.]+),\s*isVideoStep:\s*(true|false)/);
    if(b){if(b[2]==='false'){const s=b[1].trim();bg[s]=(bg[s]||0)+1;}continue;}
    if(isExit.test(m))continue;
    const s=stepFromMsg(m);
    if(s&&s!=='end'){const isTransition=/nextStep:|handleNewMessageStep:/.test(m);
      if(isTransition&&s!==lastRealStep&&ts)lastRealTs=ts;
      if(s!==lastRealStep)lastDet=null;lastRealStep=s;}
    const dm=m.match(/detection:status:(\w+)/);if(dm)lastDet=dm[1];}
  return{aborts,bg:Object.entries(bg).map(([step,count])=>({step,count}))};
}

// furthest step a group reached (any breadcrumb), in flow order
const FLOW=['voice-liveness-check','voice-liveness','deepfake-detection','deepfake','customerPortrait','customer-portrait','idFront','id-front','idBack','id-back','hologram','id-back-video','idBackVideo','twoFactor','two-factor','2fa'];
function flowRank(step){
  if(!step)return -1;
  const s=step.toLowerCase();
  for(let i=0;i<FLOW.length;i++){if(s===FLOW[i].toLowerCase()||s.includes(FLOW[i].toLowerCase()))return i;}
  return -1;
}
function furthestStep(group){
  let best=null,bestRank=-2;
  for(const ev of group)for(const l of(ev.logs||[])){const s=stepFromMsg(l.msg||'');if(!s)continue;const r=flowRank(s);if(r>bestRank){bestRank=r;best=s;}}
  return best;
}

function analyze(file,label){
  const events=JSON.parse(fs.readFileSync(file,'utf8'));
  // group by firebase session
  const fbMap=new Map();
  for(const ev of events){const k=ev.session_id_base||ev.event_id||'?';if(!fbMap.has(k))fbMap.set(k,[]);fbMap.get(k).push(ev);}
  // group firebase groups into facekom lanes
  const laneMap=new Map();
  for(const[k,evs]of fbMap){
    const fk=fkBase(evs.map(facekomSessionId).find(Boolean)||'');
    const laneKey=fk?'fk:'+fk:'fb:'+k;
    if(!laneMap.has(laneKey))laneMap.set(laneKey,[]);
    laneMap.get(laneKey).push(evs);// each entry is a firebase group (a "try")
  }
  let total=0,approved=0,neverPassed=0;
  const blockHist={};      // furthest stuck step among never-passed lanes
  const abortStepHist={};  // abort-exit steps among never-passed lanes
  for(const[laneKey,tries]of laneMap){
    total++;
    const passed=tries.some(g=>deriveSessionOutcome(g)==='approve');
    if(passed){approved++;continue;}
    neverPassed++;
    // furthest verification step reached across all tries
    let best=null,bestRank=-2;
    for(const g of tries){const s=furthestStep(g);const r=flowRank(s);if(r>bestRank){bestRank=r;best=s;}
      for(const a of deriveAbortExits(g).aborts){abortStepHist[a.step]=(abortStepHist[a.step]||0)+1;}}
    const key=best||'(no step reached)';
    blockHist[key]=(blockHist[key]||0)+1;
  }
  console.log(`\n===== ${label} =====`);
  console.log(`lanes(FaceKom sessions): ${total} · approved(ever): ${approved} (${(approved/total*100).toFixed(1)}%) · never-passed: ${neverPassed} (${(neverPassed/total*100).toFixed(1)}%)`);
  console.log(`\n-- never-passed lanes by FURTHEST step reached (blocking step) --`);
  for(const[s,c]of Object.entries(blockHist).sort((a,b)=>b[1]-a[1]))
    console.log(`  ${String(c).padStart(4)}  ${(c/neverPassed*100).toFixed(1).padStart(5)}% of never-passed | ${(c/total*100).toFixed(1).padStart(5)}% of all  ::  ${s}`);
  console.log(`\n-- abort-exit steps (video-step aborts) among never-passed --`);
  for(const[s,c]of Object.entries(abortStepHist).sort((a,b)=>b[1]-a[1]))
    console.log(`  ${String(c).padStart(4)}  ${s}`);
  return{total,approved,neverPassed,blockHist};
}

analyze('data/events_3.7.1.json','3.7.1');
analyze('data/events_3.7.0.json','3.7.0');
