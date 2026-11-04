/* WA Scoring 0.6.4.10 PILOTO (avisos de actualización controlada): organizador asigna solo teléfono y parapeto; modalidad automática en Firestore según fase y elección inicial en anotador. */
(()=>{'use strict';
const app=document.querySelector('#app');
const formats={indoor18:{name:'Indoor · 18 metros',faceCm:40,perEnd:3,maxEnds:20,distance:'18 m',max:600},barebow50:{name:'Barebow · 50 metros',faceCm:122,perEnd:6,maxEnds:12,distance:'50 m',max:720},recurve70:{name:'Recurvo Olímpico · 70 metros',faceCm:122,perEnd:6,maxEnds:12,distance:'70 m',max:720}};
const view={editShot:null,disputeVisible:false,correctionVisible:false,page:'home',active:null,detailTab:'planilla',impactScope:'all',impactEnd:1,period:'all',statsSection:'resumen',showAll:false,activePersonal:null,spectatorNumber:null,spectatorFilter:'all',activeEvent:null,eventTab:'roster',elimGroup:null,elimMatch:null,elimTaskId:null,elimSide:'a',spectatorMatchId:null,spectatorLiveFilter:'all',activeTarget:1,activePosition:'A',categoryFilter:'all',busy:false,notice:'',error:false,zoom:1,panX:0,panY:0,trainingScrollY:0,trainingLastSession:null,trainingLastCount:-1};
let sessions=[],events=[],personal=[], db;
const publicState={rooms:[],room:null,scores:[],brackets:[],live:[],error:'',loading:false,stopList:null,stopRoom:null,roomId:''};
// Sincronización en nube (piloto): módulo desacoplado del historial local de entrenamientos.
const cloudState={api:null,configured:false,connected:false,error:'',role:null,roomId:'',target:0,localId:'',room:null,cards:[],brackets:{},tasks:[],tasksFromCache:true,fromCache:true,revisions:new Map(),requests:[],members:[],memberName:'',ready:false,pending:false,stop:null,admissionStop:null,syncQueue:Promise.resolve(),publicRoom:null,publicStop:null};
// 0.6.4.5: no retroceder un marcador de eliminatorias ya CONFIRMADO por Firebase.
// El listener puede recibir instantáneas antiguas entre dos pulsaciones del tanteador.
// Cuando un encuentro desaparece de la consulta (revocación o reasignación),
// NO lo conservamos: la autorización se respeta inmediatamente.
function reconcileEliminationTasks(previous,incoming){
 const old=new Map(previous.map(task=>[task.id,task]));
 return incoming.map(task=>{
  const prior=old.get(task.id);
  return prior&&Number.isInteger(prior.revision)&&Number.isInteger(task.revision)&&prior.revision>task.revision?prior:task;
 });
}
function retainConfirmedEliminationTask(saved){
 cloudState.tasks=reconcileEliminationTasks(cloudState.tasks,[...cloudState.tasks.filter(task=>task.id!==saved.id),saved]);
}
// No reenvía flechas de forma automática: una repetición ciega puede duplicarlas.
async function explainEliminationConflict(error,id){
 if(!String(error?.message||'').startsWith('CONFLICTO:'))return null;
 try{
  const fresh=await cloudState.api.fetchEliminationTask(cloudState.roomId,id);
  retainConfirmedEliminationTask(fresh);
  const a=fresh.current?.aShots?.length||0,b=fresh.current?.bShots?.length||0;
  return `Marcador actualizado desde Firebase (revisión ${fresh.revision}; tanda actual: A ${a}/3, B ${b}/3; tandas cerradas: ${(fresh.ends||[]).length}). COMPRUEBA si esa flecha ya figura antes de volver a anotarla. No se repitió el guardado automáticamente.`;
 }catch(syncError){
  cloudState.tasksFromCache=true;
  return `No se confirmó el estado del encuentro con Firebase (${syncError.message}). NO repitas flechas hasta recuperar la conexión y comprobar el marcador.`;
 }
}
const spectatorURL=room=>`${location.origin}${location.pathname}?waSpectate=${encodeURIComponent(room)}`;
const cloudRoomURL=(room,target)=>`${location.origin}${location.pathname}?waRoom=${encodeURIComponent(room)}&waTarget=${Number(target)}`;
function cloudStatusText(){return !cloudState.configured?'No configurado':cloudState.error?'Error de conexión':cloudState.ready&&!cloudState.fromCache?'Conectado en vivo':cloudState.pending?'Esperando autorización':'Preparando conexión';}
async function initCloud(){
 if(cloudState.connected)return cloudState.api;
 const mod=await import('./cloud.js?v=0.6.4.5');cloudState.api=mod;cloudState.configured=mod.isConfigured;
 if(!cloudState.configured)throw Error('Falta configurar Firebase. Revisa INSTALACION_FIREBASE.md antes de activar el modo en red.');
 await mod.initialize();cloudState.connected=true;return mod;
}
function cloudMenu(){return `<section class="card gap"><div class="row"><h2>Competencias en red · Piloto</h2><span class="pill ${cloudState.ready?'good':'warn'}">${e(cloudStatusText())}</span></div><p class="small muted">Organiza desde tu iPhone y conecta anotadores mediante un enlace o QR. El organizador debe aprobar cada teléfono y su parapeto antes de permitir anotaciones. Requiere internet y Firebase configurado.</p>${cloudState.configured||cloudState.connected?`<button class="btn primary block" data-action="cloud-join-page">Unirme como anotador a una competencia</button>`:`<div class="notice">La versión de GitHub Pages sigue funcionando localmente. Para habilitar Firebase debes completar el archivo <strong>firebase-config.js</strong> y publicar las reglas de seguridad.</div><button class="btn block" data-action="cloud-connect">Comprobar conexión Firebase</button>`}</section>`}
function joinPage(){if(cloudState.role==='scorer'&&cloudState.room){return `<section class="card gap"><h2>Teléfono anotador autorizado</h2><span class="pill ${cloudState.room.status==='running'?'good':'warn'}">${cloudState.room.status==='running'?'Competencia iniciada':'Esperando inicio del organizador'}</span><p class="small muted">Parapeto ${cloudState.target}. La conexión está activa; el registro de flechas se habilitará automáticamente cuando el organizador comience.</p><button class="btn primary block" data-action="elim-remote-open">🏹 Abrir eliminatorias remotas</button></section>`;}const params=new URLSearchParams(location.search),room=params.get('waRoom')||'',target=params.get('waTarget')||'1';return `<section class="card gap"><h2>Unirse como anotador</h2><p class="small muted">El organizador te entregará el código o QR y aprobará tu ingreso. Mantén esta misma aplicación abierta mientras te autoriza.</p><form id="cloudJoinForm" class="gap"><div class="field"><label>Código de sala (20 caracteres)</label><input name="room" required maxlength="24" minlength="20" autocomplete="off" value="${e(room)}" placeholder="Pega el código"></div><div class="field"><label>Número de parapeto</label><input name="target" required type="number" min="1" max="500" value="${e(target)}"></div><div class="field"><label>Tu nombre como anotador</label><input name="name" required maxlength="90" minlength="3" placeholder="Nombre y apellido"></div><button type="submit" class="btn primary block">Solicitar acceso al organizador</button></form>${cloudState.pending?'<div class="notice">Solicitud enviada. El organizador debe aprobar tu teléfono y parapeto. No cierres la aplicación hasta conectarte.</div>':''}<button class="btn block" data-action="nav" data-value="competitions">← Competencias</button></section>`}
function chosenMode(ev){return ev?.annotationMode || (ev?.cloudRoomId?'cloud':ev?.status==='running'?'local':'');}
function roomWaiting(ev){return !!ev?.cloudRoomId&&cloudState.roomId===ev.cloudRoomId&&cloudState.room?.status==='waiting';}
function cloudTargetsReady(ev){const approved=new Set(cloudState.members.map(m=>Number(m.target)));return eventTargets(ev).every(t=>approved.has(t));}
function eventPhase(ev){
 if(eventState(ev)==='running')return 'En curso';
 if(ev.cloudRoomId){if(roomWaiting(ev))return cloudState.ready&&cloudTargetsReady(ev)?'Lista para comenzar':'Esperando anotadores';return 'Esperando conexión';}
 return ev.locked?(chosenMode(ev)?'Configurando anotadores':'Elegir anotación'):'Configurando';
}
function cloudRoomPanel(ev){
 if(!ev?.cloudRoomId)return `<section class="card gap"><h3>2. Conectar teléfonos</h3><p class="small muted">Publica la competencia después del sorteo. Los anotadores escanearán un QR y tú aprobarás su parapeto. Los disparos seguirán bloqueados hasta que pulses «Iniciar competencia».</p>${cloudState.configured||cloudState.connected?`<button class="btn primary block" data-action="cloud-publish" ${!ev.locked||eventState(ev)!=='setup'?'disabled':''}>☁ Publicar sala y generar códigos QR</button>`:'<div class="notice">Firebase no está configurado; revisa firebase-config.js.</div>'}</section>`;
 const active=ev.cloudRoomId===cloudState.roomId && cloudState.ready&&!cloudState.fromCache;
 const room=ev.cloudRoomId,waiting=roomWaiting(ev);
 const readyTargets=new Set(cloudState.members.map(m=>Number(m.target)));
 const targets=eventTargets(ev),isOrganizer=active&&cloudState.role==='organizer';
 return `<section class="card gap"><div class="row"><h3>Sincronización en vivo</h3><span class="pill ${active?'good':'warn'}">${e(cloudStatusText())}</span></div><div class="soft gap"><strong>Código de sala</strong><code class="room-code">${e(room)}</code><button class="btn block" data-action="cloud-copy-room">Copiar código de sala</button></div>${!active?`<button class="btn primary block" data-action="cloud-reconnect">Conectar con Firebase</button><div class="notice">No registres flechas hasta confirmar conexión e inicio.</div>`:''}${isOrganizer?`<div class="notice ${waiting?'':'success'}"><strong>${waiting?'Esperando anotadores':'Competencia en curso'}</strong><p class="small">${waiting?'La sala ya está publicada. Puedes conectar y aprobar los teléfonos sin comenzar las tandas.':'El organizador ya habilitó el registro de flechas.'}</p></div><h3>Parapetos y accesos</h3><p class="small muted">Cada QR abre una solicitud para ese parapeto. Revisa quién se conecta antes de aprobar.</p>${targets.map(t=>{const link=cloudRoomURL(room,t);const member=cloudState.members.find(m=>Number(m.target)===t);return `<div class="soft gap"><div class="row"><strong>Parapeto ${t}</strong><span class="pill ${readyTargets.has(t)?'good':'warn'}">${readyTargets.has(t)?'Autorizado':'Sin teléfono autorizado'}</span></div>${member?`<small>${e(member.name||'Anotador autorizado')}</small>`:''}<div class="qr-box">${window.WA_QR_SVG?window.WA_QR_SVG(link):''}</div><small class="muted" style="overflow-wrap:anywhere">${e(link)}</small><button class="btn small" data-action="cloud-copy-link" data-value="${t}">Copiar enlace · Parapeto ${t}</button></div>`}).join('')}<h3>Solicitudes de anotadores</h3>${cloudState.requests.length?cloudState.requests.map(r=>`<div class="entry"><div class="gap-xs" style="flex:1"><strong>${e(r.name)}</strong><small class="muted">Parapeto ${Number(r.target)} · ${e(r.uid.slice(0,10))}…</small></div><button class="btn primary small" data-action="cloud-approve" data-value="${e(r.uid)}">Autorizar</button></div>`).join(''):'<div class="soft">Todavía no hay solicitudes pendientes.</div>'}${waiting?`<div class="soft gap"><h3>3. Iniciar competencia</h3><div class="row"><span class="small">Parapetos con anotador autorizado</span><strong>${targets.filter(t=>readyTargets.has(t)).length}/${targets.length}</strong></div><button class="btn primary block" data-action="cloud-start" ${!cloudState.ready||!cloudTargetsReady(ev)?'disabled':''}>▶ Iniciar competencia y habilitar flechas</button><p class="small muted">Solo tú puedes iniciar. Hasta ese momento los teléfonos esperan y Firebase rechaza cualquier impacto.</p></div>`:''}`:''}<p class="small muted">Piloto: si se pierde internet, se pausa la anotación. Exporta respaldos .wascore desde el organizador.</p></section>`;
}
async function publishCloudEvent(){
 const ev=events.find(x=>x.id===view.activeEvent);
 if(!ev||ev.cloudRoomId||!ev.locked||chosenMode(ev)!=='cloud'||eventState(ev)!=='setup')throw Error('Confirma el sorteo y elige anotación en red antes de publicar.');
 if(!confirmAction('¿Publicar la competencia en la nube? Desde entonces será necesario estar conectado para anotar. Exporta primero un .wascore de respaldo.'))return;
 const mod=await initCloud();const roomId=await mod.publish(ev);
 const copy=structuredClone(ev);copy.cloudRoomId=roomId;copy.cloudRole='organizer';await persistEvent(copy);
 cloudState.localId=ev.id;listenCloudRoom(roomId,'organizer',0);render();
}
function listenCloudRoom(roomId,role,target){
 cloudState.stop?.();cloudState.admissionStop?.();cloudState.publicStop?.();cloudState.publicStop=null;cloudState.publicRoom=null;cloudState.admissionStop=null;
 cloudState.role=role;cloudState.roomId=roomId;cloudState.target=target;cloudState.ready=false;cloudState.fromCache=true;cloudState.room=null;cloudState.cards=[];cloudState.brackets={};cloudState.tasks=[];cloudState.tasksFromCache=true;cloudState.revisions.clear();cloudState.requests=[];cloudState.members=[];cloudState.error='';
 cloudState.stop=cloudState.api.watchRoom(roomId,target,role==='organizer',{
  onRoom:room=>{cloudState.room=room;queueCloudSync();},
  onCards:(rows,fromCache)=>{
   // Una instantánea demorada no puede retroceder la revisión ya confirmada.
   // Las revisiones avanzan exclusivamente en el servidor; ninguna sobrescritura local.
   const incoming=new Map(rows);
   for(const [key,previous] of cloudState.revisions){
    const next=incoming.get(key);
    if(next && Number.isInteger(previous?.revision) && Number.isInteger(next?.revision) && previous.revision>next.revision)incoming.set(key,previous);
   }
   cloudState.cards=[...incoming];cloudState.revisions=incoming;cloudState.fromCache=fromCache;cloudState.ready=!fromCache;queueCloudSync();
  },
  onBrackets:groups=>{cloudState.brackets=groups;queueCloudSync();},
  onTasks:(tasks,fromCache)=>{cloudState.tasks=reconcileEliminationTasks(cloudState.tasks,tasks);cloudState.tasksFromCache=fromCache;if(view.page==='elim-remote'||view.page==='event-detail')render();},
  onRequests:reqs=>{cloudState.requests=reqs;render();},
  onMembers:members=>{cloudState.members=members;queueCloudSync();render();},
  onError:err=>{cloudState.error=err.message;cloudState.ready=false;alertMsg('Error de sincronización: '+err.message,true);}
 });
 if(role==='organizer')cloudState.publicStop=cloudState.api.watchSpectatorSettings(roomId,info=>{cloudState.publicRoom=info;if(view.page==='event-detail')render()},err=>{cloudState.error='Publicación pública: '+err.message;if(view.page==='event-detail')render()});
}
function queueCloudSync(){
 cloudState.syncQueue=cloudState.syncQueue.then(async()=>{
  const room=cloudState.room;if(!room||!cloudState.cards.length)return;
  const id=cloudState.role==='organizer'?cloudState.localId:`cloud-${cloudState.roomId}`;
  const old=events.find(x=>x.id===id);if(!id)return;
  const fresh=old?structuredClone(old):{id,createdAt:timestamp(),results:{}};
  Object.assign(fresh,{name:room.name,date:room.date,formatId:room.formatId,entries:room.entries,draw:room.draw,scorers:cloudState.role==='organizer'?cloudState.members.map(m=>({target:m.target,name:m.name||'Anotador autorizado'})):room.scorers,preferLeft:room.preferLeft,locked:true,status:room.status==='running'?'running':'setup',annotationMode:'cloud',cloudRoomId:cloudState.roomId,cloudRole:cloudState.role,cloudTarget:cloudState.target});
   if(cloudState.role==='scorer')fresh.scorers=[...(fresh.scorers||[]).filter(x=>x.target!==cloudState.target),{target:cloudState.target,name:cloudState.memberName||'Anotador'}];
  fresh.results ||= {};
  for(const [key,data] of cloudState.cards)fresh.results[key]=cardResult(data);
  if(cloudState.role==='organizer')fresh.eliminations={groups:structuredClone(cloudState.brackets||{})};
  await persistEvent(fresh);
  if(cloudState.role==='scorer'){view.activeEvent=id;view.activeTarget=cloudState.target;const positions=room.draw.filter(x=>x.target===view.activeTarget);if(positions.length&&!positions.some(s=>s.position===view.activePosition))view.activePosition=positions[0].position;if(!['elim-remote','event-score'].includes(view.page))view.page=room.status==='running'?'event-score':'cloud-join';}
  if(cloudState.role==='organizer'&&!view.activeEvent)view.activeEvent=id;
  render();
 }).catch(err=>{cloudState.error=err.message;alertMsg('No se pudo guardar la copia local: '+err.message,true)});
}
function cardResult(card){return {ends:card.ends||[],current:card.current||[],status:card.status||'active',validation:card.validation,revisions:card.revisions||[]};}
async function applyCloudChange(mutator){
 const current=events.find(x=>x.id===view.activeEvent);
 if(!current||current.cloudRoomId!==cloudState.roomId||!cloudState.ready||cloudState.fromCache)throw Error('Sin conexión confirmada: no registres flechas hasta volver a sincronizar.');
 const working=structuredClone(current);working.results ||= {};
 // Se aplica sobre la última revisión recibida del servidor y NO sobre una copia antigua del navegador.
 for(const [number,card] of cloudState.revisions)working.results[number]=cardResult(card);
 const before=structuredClone(working);mutator(working);
 const changed=[...new Set([...Object.keys(before.results),...Object.keys(working.results)])].filter(key=>JSON.stringify(before.results[key])!==JSON.stringify(working.results[key]));
 if(changed.length!==1)throw Error('En modo red solo se modifica una planilla a la vez.');
 const fixed=structuredClone(before);fixed.results=working.results;
 // El resto de la estructura del torneo es inmutable tras publicación.
 if(JSON.stringify({...fixed,results:{}})!==JSON.stringify({...working,results:{}}))throw Error('Los datos generales del evento están bloqueados tras publicar.');
 const key=changed[0],prior=cloudState.revisions.get(key);
 if(!prior)throw Error('Esta planilla aún no se recibió desde la nube.');
 if(cloudState.role==='scorer'&&prior.target!==cloudState.target)throw Error('No puedes modificar otro parapeto.');
 const saved=await cloudState.api.updateCard(cloudState.roomId,key,prior.revision,working.results[key]);
 cloudState.revisions.set(key,saved);
 const updated=structuredClone(current);updated.results ||= {};updated.results[key]=cardResult(saved);await persistEvent(updated);
}
async function cloudReconnect(ev){
 const mod=await initCloud(),room=ev.cloudRoomId;
 if(!room)throw Error('Competencia sin sala en línea.');
 cloudState.localId=ev.cloudRole==='organizer'?ev.id:`cloud-${room}`;
 if(ev.cloudRole==='organizer')listenCloudRoom(room,'organizer',0);
 else {const expected=ev.cloudTarget;cloudState.admissionStop=mod.watchAdmission(room,mem=>{
  if(mem.role==='scorer'&&mem.target===expected){cloudState.memberName=mem.name||'Anotador';cloudState.admissionStop?.();cloudState.admissionStop=null;listenCloudRoom(room,'scorer',expected)}
 },err=>alertMsg('No se pudo recuperar tu autorización: '+err.message,true));}
}
async function joinCloud(room,target,name){
 const mod=await initCloud();cloudState.pending=true;cloudState.roomId=room;cloudState.target=target;
 await mod.requestJoin(room,target,name);
 cloudState.admissionStop?.();cloudState.admissionStop=mod.watchAdmission(room,member=>{
  if(member.role!=='scorer'||member.target!==target)return;
  cloudState.pending=false;cloudState.memberName=member.name||name;cloudState.localId=`cloud-${room}`;listenCloudRoom(room,'scorer',target);
 },err=>{cloudState.pending=false;alertMsg('No se pudo verificar la autorización: '+err.message,true)});
 alertMsg('Solicitud enviada. Espera a que el organizador apruebe tu parapeto.');
}

const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatNum=v=>Number(v).toLocaleString('es-CL',{maximumFractionDigits:2});
const money=n=>Number(n).toFixed(2).replace('.',',');
const timestamp=()=>new Date().toISOString();
const uid=()=>self.crypto?.randomUUID?.()||`wa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fmt=s=>formats[s.formatId]||formats.indoor18;
const shots=s=>s.ends.flat().concat(s.current||[]);
const sum=arr=>arr.reduce((a,v)=>a+(v.score==='M'?0:Number(v.score)),0);
const total=s=>sum(shots(s));
const scoreText=x=>x.score==='M'?'M':x.xRing?'X':x.score;
// Los colores siguen los anillos WA. La X se distingue visualmente del 10.
const scoreColor=x=>!x?'empty':x.score==='M'?'ring-miss':x.score>=9?'ring-yellow':x.score>=7?'ring-red':x.score>=5?'ring-blue':x.score>=3?'ring-black':'ring-white';
const scoreClass=x=>`${scoreColor(x)}${x?.xRing?' x-ring':''}`;
const archersLength=s=>shots(s).length;
const get=()=>view.page==='personal-detail'?personal.find(s=>s.id===view.activePersonal):sessions.find(s=>s.id===view.active);
const escapeFilename=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9-_]+/g,'-').slice(0,60).replace(/^-|-$/g,'')||'sesion';
function alertMsg(msg,error=false){view.notice=msg;view.error=error;render()}
function makeDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('wa-scoring-trainings',3);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('sessions'))d.createObjectStore('sessions',{keyPath:'id'});if(!d.objectStoreNames.contains('events'))d.createObjectStore('events',{keyPath:'id'});if(!d.objectStoreNames.contains('personal'))d.createObjectStore('personal',{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});}
function dbCall(mode,work,storeName='sessions'){return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),store=tx.objectStore(storeName);let out;try{out=work(store)}catch(err){reject(err);return}tx.oncomplete=()=>resolve(out?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transacción cancelada'))})}
async function refresh(){sessions=(await dbCall('readonly',store=>store.getAll())).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));events=(await dbCall('readonly',store=>store.getAll(),'events')).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));personal=(await dbCall('readonly',store=>store.getAll(),'personal')).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));}
async function persistEvent(event){event.updatedAt=timestamp();await dbCall('readwrite',store=>store.put(event),'events');await refresh();}
async function persist(s){s.updatedAt=timestamp();await dbCall('readwrite',store=>store.put(s));await refresh();}
function autoClosePendingEnd(s){const f=fmt(s);if(s.status==='active'&&s.current.length===f.perEnd&&s.ends.length<f.maxEnds){s.ends.push(s.current);s.current=[];if(s.ends.length===f.maxEnds)s.status='finished';return true}return false}
async function migrateUnclosedEnds(){const older=sessions.filter(s=>s.status==='active'&&s.current.length===fmt(s).perEnd&&s.ends.length<fmt(s).maxEnds);for(const s of older){const copy=structuredClone(s);if(autoClosePendingEnd(copy))await dbCall('readwrite',store=>store.put(copy))}if(older.length)await refresh()}
async function destroy(id){await dbCall('readwrite',store=>store.delete(id));await refresh()}
function getSub(){return view.page==='elim-remote'?'Anotación remota de eliminatorias': view.page==='score'?'Registro de flechas':view.page==='detail'?'Resultados de la sesión':view.page==='new'?'Crear sesión':view.page==='history'?'Sesiones guardadas':view.page.startsWith('personal')?'Mis competencias':view.page.startsWith('spectator')?'Espectadores':['competitions','event-new','event-detail','event-score','cloud-join','elim-remote'].includes(view.page)?'Competencias' :view.page==='settings'?'Datos y respaldos':'Entrenamiento WA'}
function modeForPage(){return ['competitions','event-new','event-detail','event-score','cloud-join','elim-remote','personal-history','personal-detail','spectator','spectator-event','spectator-detail'].includes(view.page)?'competition':'training'}
function base(inner){const nav=[['home','🎯','Entrenar'],['history','🕘','Historial'],['competitions','🏆','Competir'],['spectator','👀','Espectador'],['settings','⚙️','Ajustes']];const at=view.page==='new'||view.page==='score'?'home':view.page==='detail'?'history':view.page==='personal-detail'?'competitions':['event-new','event-detail','event-score','cloud-join','elim-remote','personal-history'].includes(view.page)?'competitions':['spectator-event','spectator-detail'].includes(view.page)?'spectator':view.page;
const badge=modeForPage()==='competition'&&cloudState.role&&cloudState.ready&&!cloudState.fromCache?'Firebase · en vivo':navigator.onLine?'Datos locales':'Sin conexión · local';
return `<div class="screen"><header class="top"><div><div class="eyebrow">WORLD ARCHERY · ${modeForPage()==='competition'?'COMPETENCIA':'ENTRENAMIENTO'}</div><h1>WA Scoring</h1><div class="sub">${getSub()} · ${badge} · v0.6.4.10 piloto</div></div><div class="mark">◎</div></header><main class="content">${view.notice?`<div class="notice ${view.error?'':'success'}" role="status">${e(view.notice)} <button type="button" class="btn ghost small" data-action="clear-notice" aria-label="Cerrar aviso">×</button></div>`:''}${inner}</main></div><nav class="nav" aria-label="Secciones principales">${nav.map(([id,ico,label])=>`<button type="button" data-action="nav" data-value="${id}" class="${at===id?'active':''}"><span class="ico">${ico}</span>${label}</button>`).join('')}</nav><section id="print-sheet"></section>`;}
function metrics(arr,arrLen){const pts=sum(arr),max=arrLen||arr.length;return `<div class="stats"><div class="stat"><b>${pts}</b><small>Puntos</small></div><div class="stat"><b>${arr.length}</b><small>Flechas</small></div><div class="stat"><b>${arr.length?money(pts/arr.length):'—'}</b><small>Promedio</small></div></div>`}

function publicStatSession(number){
 const info=publicState.room?.participants?.find(x=>x.number===number);
 const r=publicState.scores.find(x=>x.number===number);
 if(!info||!r?.validated||!Array.isArray(r.detailedEnds))return null;
 const ends=r.detailedEnds.map(x=>x.shots);
 if(!ends.every(x=>Array.isArray(x)))return null;
 return {id:`spectator-${number}`,archerName:info.name,title:publicState.room.name,
  formatId:publicState.room.formatId,status:'finished',ends,current:[],createdAt:publicState.room.date+'T00:00:00',updatedAt:r.updatedAt};
}
function publicGroup(p){return [p.division,p.age,p.level,p.gender].join(' / ')}
function spectatorList(){
 return `<section class="card gap"><h2>👀 Modo espectador</h2><p class="small muted">Consulta competencias publicadas en Firebase. No necesitas estar en la misma red Wi-Fi. Solo puedes ver resultados deportivos, nunca firmas ni acceso de anotadores.</p><div class="field"><label>Código público o enlace del evento</label><form id="spectatorJoinForm" class="btn-row"><input name="room" placeholder="Código público" maxlength="24" required><button class="btn primary" type="submit">Abrir</button></form></div><div class="row"><h3>Competencias públicas</h3><span class="pill">${publicState.rooms.length}</span></div>${publicState.error?`<div class="notice">${e(publicState.error)}</div>`:''}<div class="sessions">${publicState.rooms.map(r=>`<button class="session" data-action="spectator-open" data-value="${e(r.id)}"><div class="row"><strong>${e(r.name)}</strong><span class="pill good">En vivo</span></div><small class="muted">${e(r.date)} · ${e(formats[r.formatId]?.name||'Competencia')}</small></button>`).join('')||'<div class="empty">No hay competencias públicas disponibles por ahora.</div>'}</div></section>`;
}
function publicLiveEliminations(room){
 const tasks=publicState.live||[];if(!tasks.length)return '';
 const name=n=>(room.participants||[]).find(x=>x.number===n)?.name||`#${n}`;
 const categories=[...new Set(tasks.map(t=>t.category))].sort(),filtered=tasks.filter(t=>view.spectatorLiveFilter==='all'||t.category===view.spectatorLiveFilter);
 const playing=filtered.filter(t=>t.status==='active'),submitted=filtered.filter(t=>t.status==='submitted'),finished=filtered.filter(t=>t.status==='closed');
 return `<section class="card gap"><div class="row"><h3>🏹 Enfrentamientos en vivo</h3><span class="pill good">${playing.length} activos</span></div><p class="small muted">Los puntajes se actualizan flecha por flecha, sin recargar. Los resultados son provisionales hasta su validación.</p>${categories.length>1?`<label class="field"><span>Filtrar encuentros por categoría</span><select id="spectatorLiveFilter"><option value="all">Todas las categorías</option>${categories.map(c=>`<option value="${e(c)}" ${view.spectatorLiveFilter===c?'selected':''}>${e(c)}</option>`).join('')}</select></label>`:''}
 ${[...playing,...submitted,...finished].map((t,i)=>{const res=eliminationTaskStatus(t),expanded=view.spectatorMatchId===t.id||(view.spectatorMatchId===null&&i===0);
 return `<div class="elim-public-match"><button type="button" class="elim-public-trigger" data-action="spectator-match" data-value="${e(t.id)}" aria-expanded="${expanded}"><div><strong>${e(name(t.a))} vs. ${e(name(t.b))}</strong><small>Parapeto ${t.target} · ${e(t.matchId)} · ${e(t.category)}</small></div><span class="elim-public-score">${res.a??0}–${res.b??0}</span><span aria-hidden="true">${expanded?'−':'+'}</span></button>${expanded?eliminationVisualScore(t,name(t.a),name(t.b)):''}</div>`;
 }).join('')}</section>`;
}
function publicEliminationSummary(room){
 const groups=publicState.brackets||[];if(!groups.length)return `<section class="card gap"><h3>Eliminatorias y podio</h3><p class="small muted">Aún no hay llaves publicadas para esta competencia.</p></section>`;
 const name=n=>n?(room.participants||[]).find(x=>x.number===n)?.name||'#'+n:'—';
 return groups.map(g=>{let pod;try{pod=window.WA_ELIM.podium(g)}catch{return '<section class="card"><p>Llave pendiente de revisión.</p></section>'}
 return `<section class="card gap"><h3>Llave · ${e(g.category)}</h3><p class="small muted">${g.mode==='sets'?'Puntuación por sets':'Puntuación acumulativa'} · ${g.size} posiciones</p><div class="elim-rounds">${[...new Set(g.matches.map(x=>x.round))].map(r=>`<div class="elim-round"><h3>${r===Math.log2(g.size)-1?'Final oro':r===Math.log2(g.size)-2?'Semifinales':'Ronda '+(r+1)}</h3>${g.matches.filter(x=>x.round===r).map(m=>{const x=window.WA_ELIM.matchResult(g,m);return `<div class="elim-spectator-match"><small>${e(name(m.a))} · ${x.a??'—'} / ${e(name(m.b))} · ${x.b??'—'}</small><strong>${x.winner?e(name(x.winner)):x.bye?'Pase libre':'Pendiente'}</strong></div>`}).join('')}</div>`).join('')}<div class="elim-round"><h3>Bronce</h3><div class="elim-spectator-match">${e(name(g.bronze.a))} vs ${e(name(g.bronze.b))}<strong>${pod.bronze?e(name(pod.bronze)):'Pendiente'}</strong></div></div></div><h3>Podio</h3><div class="entry">🥇 ${e(name(pod.gold))}</div><div class="entry">🥈 ${e(name(pod.silver))}</div><div class="entry">🥉 ${e(name(pod.bronze))}</div></section>`;
 }).join('');
}
function spectatorEvent(){
 const r=publicState.room;
 if(!r)return `<section class="card gap"><h2>Abriendo competencia pública</h2><p class="small muted">${e(publicState.error||'Conectando con Firebase…')}</p><button class="btn" data-action="nav" data-value="spectator">← Eventos públicos</button></section>`;
 const entries=(r.participants||[]).map(p=>({...p,score:publicState.scores.find(x=>x.number===p.number)}));
 const cats=[...new Set(entries.map(publicGroup))].sort();
 const filtered=entries.filter(x=>view.spectatorFilter==='all'||publicGroup(x)===view.spectatorFilter)
   .sort((a,b)=>(b.score?.points||0)-(a.score?.points||0)||(b.score?.arrows||0)-(a.score?.arrows||0)||a.number-b.number);
 const validated=publicState.scores.filter(s=>s.validated).length;
 return `<section class="card gap"><div class="eyebrow">RESULTADOS PÚBLICOS · SOLO LECTURA</div><h2>${e(r.name)}</h2><p class="small muted">${e(r.date)} · ${e(formats[r.formatId]?.name||'')}</p><div class="stats"><div class="stat"><b>${entries.length}</b><small>Arqueros</small></div><div class="stat"><b>${validated}</b><small>Validadas</small></div><div class="stat"><b>●</b><small>En vivo</small></div></div><button class="btn block" data-action="spectator-share">Compartir evento</button><button class="btn block" data-action="nav" data-value="spectator">← Todas las competencias</button></section>${publicLiveEliminations(r)}<section class="card gap"><h3>Clasificación en vivo</h3><p class="small muted">Resultados provisionales mientras algunos arqueros tengan menos flechas. Los empates requieren revisión oficial.</p><div class="field"><label for="spectatorFilter">División y categoría</label><select id="spectatorFilter"><option value="all">Todas las categorías</option>${cats.map(c=>`<option value="${e(c)}" ${view.spectatorFilter===c?'selected':''}>${e(c)}</option>`).join('')}</select></div><div class="sessions">${filtered.map((p,i)=>`<div class="session"><div class="row"><strong>${i+1}. ${e(p.name)}</strong><strong>${p.score?.points??0} puntos</strong></div><div class="row"><small class="muted">${e(publicGroup(p))} · #${p.number} · ${p.target}${e(p.position)}</small><span class="pill ${p.score?.validated?'good':'warn'}">${p.score?.arrows??0}/${fmt(r).maxEnds*fmt(r).perEnd} ${p.score?.validated?'✓ Validada':''}</span></div>${p.score?.validated?`<button class="btn small" data-action="spectator-archer" data-value="${p.number}">Ver estadísticas y agrupación</button>`:''}</div>`).join('')||'<div class="empty">No hay resultados publicados.</div>'}</div></section>${publicEliminationSummary(r)}`;
}
function spectatorDetail(){
 const s=publicStatSession(view.spectatorNumber);
 if(!s)return `<section class="card gap"><h2>Estadísticas no disponibles</h2><p>La planilla debe estar completa y validada.</p><button class="btn" data-action="spectator-back">← Resultados</button></section>`;
 return `<section class="card gap"><div class="eyebrow">ESTADÍSTICAS PÚBLICAS · VALIDADA</div><h2>${e(s.archerName)}</h2><p class="small muted">${e(s.title)} · ${e(fmt(s).name)}</p>${metrics(shots(s))}<button class="btn block" data-action="spectator-back">← Resultados en vivo</button></section><div class="tabs"><button class="${view.detailTab==='planilla'?'active':''}" data-action="detail-tab" data-value="planilla">Planilla</button><button class="${view.detailTab==='impactos'?'active':''}" data-action="detail-tab" data-value="impactos">Impactos</button><button class="${view.detailTab==='estadisticas'?'active':''}" data-action="detail-tab" data-value="estadisticas">Estadísticas</button></div>${view.detailTab==='planilla'?detailSheet(s):view.detailTab==='impactos'?detailImpacts(s):`<section class="card gap"><div class="tabs"><button class="${view.statsSection==='resumen'?'active':''}" data-action="stats-section" data-value="resumen">Resumen</button><button class="${view.statsSection==='distribucion'?'active':''}" data-action="stats-section" data-value="distribucion">Puntuaciones</button><button class="${view.statsSection==='agrupacion'?'active':''}" data-action="stats-section" data-value="agrupacion">Agrupación</button><button class="${view.statsSection==='evolucion'?'active':''}" data-action="stats-section" data-value="evolucion">Tandas</button></div>${statsHeader()+statsSection(s)}</section>`}`;
}
function stopPublicFeeds(){publicState.stopList?.();publicState.stopRoom?.();publicState.stopList=null;publicState.stopRoom=null;}
async function openSpectatorList(){
 stopPublicFeeds();publicState.room=null;publicState.scores=[];publicState.live=[];publicState.error='';publicState.rooms=[];view.page='spectator';render();
 try{const api=await initCloud();publicState.stopList=api.watchPublicDirectory(rooms=>{publicState.rooms=rooms;if(view.page==='spectator')render()},err=>{publicState.error=err.message;if(view.page==='spectator')render()});}
 catch(err){publicState.error=err.message;render()}
}
async function openSpectatorRoom(room){
 if(!/^[\w-]{20,24}$/.test(room))throw Error('El código público tiene un formato incorrecto.');
 stopPublicFeeds();publicState.error='';publicState.room=null;publicState.scores=[];publicState.brackets=[];publicState.live=[];view.spectatorMatchId=null;view.spectatorLiveFilter='all';publicState.roomId=room;view.spectatorFilter='all';view.page='spectator-event';render();
 try{const api=await initCloud();publicState.stopRoom=api.watchPublicEvent(room,{
  onRoom:r=>{publicState.room=r;if(view.page.startsWith('spectator'))render()},
  onScores:s=>{publicState.scores=s;if(view.page.startsWith('spectator'))render()},
  onBrackets:groups=>{publicState.brackets=groups;if(view.page.startsWith('spectator'))render()},
  onLive:tasks=>{publicState.live=tasks;if(view.page==='spectator-event')render()},
  onError:err=>{publicState.error=err.message;publicState.room=null;if(view.page.startsWith('spectator'))render()}
 });}catch(err){publicState.error=err.message;render()}
}
async function shareSpectatorLink(room){
 const url=spectatorURL(room),name=publicState.room?.name||events.find(x=>x.cloudRoomId===room)?.name||'Competencia WA Scoring';
 if(navigator.share){try{await navigator.share({title:name,text:'🏹 Sigue la clasificación y resultados en vivo en WA Scoring',url});return;}catch(err){if(err.name==='AbortError')return;}}
 try{await navigator.clipboard.writeText(url);alertMsg('Enlace público copiado. Puedes pegarlo en WhatsApp o Facebook.');}
 catch(err){alertMsg('Comparte este enlace: '+url);}
}
function home(){const active=sessions.filter(s=>s.status==='active');return `<section class="card gap"><h2>¿Qué quieres hacer?</h2><div class="actions"><button class="action" data-action="new"><span class="ico">🎯</span><strong>Nuevo entrenamiento</strong><span>Indoor 18 m, Barebow 50 m y Recurvo 70 m</span></button><button class="action" data-action="nav" data-value="history"><span class="ico">🗂️</span><strong>Historial</strong><span>Planillas, impactos y estadísticas</span></button><button class="action" data-action="nav" data-value="spectator"><span class="ico">👀</span><strong>Espectador</strong><span>Resultados en vivo de competencias públicas</span></button></div></section>${active.length?`<section class="card gap"><div class="row"><h2>Continuar entrenamiento</h2><span class="pill">${active.length} en curso</span></div><div class="sessions">${active.slice(0,4).map(s=>sessionCard(s)).join('')}</div></section>`:''}<section class="card gap"><h2>Tu información permanece en el teléfono</h2><p class="small muted">Cada flecha se guarda en la base local antes de permitir la siguiente. Exporta copias de seguridad para protegerte si se pierde el dispositivo o se borran los datos del navegador.</p><button class="btn block" data-action="nav" data-value="settings">Respaldar o importar sesiones</button></section><div class="footer-note">Versión funcional inicial · Entrenamiento individual · Sin servidor</div>`}
// Preferencia de entrenamiento SOLO local. No es un perfil de Firebase ni modifica sesiones existentes.
const LAST_TRAINING_ARCHER_KEY='wa-scoring-training-last-archer-v1';
function lastTrainingArcherName(){
 try{
  const remembered=localStorage.getItem(LAST_TRAINING_ARCHER_KEY);
  if(typeof remembered==='string' && remembered.trim())return remembered.trim().slice(0,90);
 }catch(_){ /* Safari puede restringir localStorage: continuar con historial local. */ }
 // Al actualizar desde una versión antigua, recuperar el último entrenamiento guardado.
 const previous=sessions.find(s=>s.kind==='training' && typeof s.archerName==='string' && s.archerName.trim());
 return previous ? previous.archerName.trim().slice(0,90) : '';
}
function rememberTrainingArcherName(name){
 try{localStorage.setItem(LAST_TRAINING_ARCHER_KEY,String(name).trim().slice(0,90));}
 catch(_){ /* El entrenamiento sigue guardado en IndexedDB y sirve como respaldo. */ }
}
function newSession(){return `<section class="card gap"><h2>Nuevo entrenamiento</h2><p class="small muted">Las modalidades siguen el formato World Archery. Incluye Indoor 18 m, Barebow 50 m y Recurvo Olímpico 70 m.</p><form id="createForm" class="gap"><div class="field"><label for="archer">Nombre del arquero</label><input id="archer" name="archer" value="${e(lastTrainingArcherName())}" maxlength="90" autocomplete="name" placeholder="Nombre y apellido" required></div><div class="field"><label for="sessionTitle">Nombre del entrenamiento</label><input id="sessionTitle" name="sessionTitle" value="Entrenamiento Barebow" maxlength="90" required></div><div class="field"><label for="format">Formato</label><select id="format" name="format"><option value="indoor18">Indoor · 18 m · 60 flechas / 20 tandas de 3</option><option value="barebow50">Barebow · 50 m · 72 flechas / 12 tandas de 6</option><option value="recurve70">Recurvo Olímpico · 70 m · 72 flechas / 12 tandas de 6</option></select></div><button type="submit" class="btn primary block">Crear y comenzar a anotar</button></form><button type="button" class="btn ghost block" data-action="nav" data-value="home">Volver</button></section>`}
function sessionCard(s){const f=fmt(s),n=archersLength(s),fin=s.status==='finished';return `<button class="session" data-action="open" data-value="${e(s.id)}"><div class="row"><strong>${e(s.title)}</strong><span class="pill ${fin?'good':'warn'}">${fin?'Finalizado':'En curso'}</span></div><div class="row"><div class="gap-xs"><small class="muted">${e(s.archerName)} · ${e(f.distance)}</small><small class="muted">${new Date(s.updatedAt).toLocaleDateString('es-CL')} · ${n}/${f.maxEnds*f.perEnd} flechas</small></div><div style="text-align:right"><div class="score">${total(s)}</div><small class="muted">puntos</small></div></div></button>`}
function history(){return `<section class="card gap"><div class="row"><h2>Mis entrenamientos</h2><span class="pill">${sessions.length} sesiones</span></div><input type="search" id="historySearch" placeholder="Buscar por nombre, modalidad o fecha" aria-label="Buscar sesiones"><div class="sessions" id="historyList">${sessions.length?sessions.map(sessionCard).join(''):`<div class="empty"><div class="ico">🗂️</div><strong>Aún no hay entrenamientos</strong><p class="small muted">Crea el primero y todas las flechas quedarán registradas en el historial.</p><button class="btn primary" data-action="new">Nuevo entrenamiento</button></div>`}</div></section>`}
function targetSvg(s,live=true,includeOnly=null){const all=includeOnly||shots(s),start=s.ends.flat().length;
const rings=['#ffffff','#ffffff','#141414','#141414','#138fd8','#138fd8','#ed3b37','#ed3b37','#fce83b','#fce83b'];
const circles=rings.map((c,i)=>`<circle cx="200" cy="200" r="${180-i*18}" fill="${c}" stroke="${i===0?'#333':'#3c4240'}" stroke-width="${i===0?2:1}"/>`).join('');
const marks=all.map((shot,i)=>{if(!Number.isFinite(shot.x)||!Number.isFinite(shot.y))return '';let x=200+shot.x*180,y=200+shot.y*180;return shot.score==='M'?`<path d="M${x-4} ${y-4}l8 8m0 -8l-8 8" fill="none" stroke="#b9402b" stroke-width="3"/>`:`<circle cx="${x}" cy="${y}" r="${live&&i>=start?4:3}" fill="#33e968" stroke="#145d2d" stroke-width="1.2"/>`}).join('');
return `<svg xmlns="http://www.w3.org/2000/svg" id="${live?'targetSvg':'statsTarget'}" class="target" viewBox="0 0 400 400" aria-label="Diana con impactos"><g id="${live?'targetContent':'statsTargetContent'}"><rect x="0" y="0" width="400" height="400" fill="#afb7b3"/>${circles}<circle cx="200" cy="200" r="9" fill="none" stroke="#967c20" stroke-width=".8"/><path d="M195 200h10 M200 195v10" stroke="#967c20" stroke-width=".8"/>${marks}</g></svg>`}
function scoreBoxes(s){const f=fmt(s);return `<div class="score-grid">${Array.from({length:f.perEnd},(_,i)=>{const hit=(s.status==='finished'&&s.current.length===0?s.ends.at(-1)||[]:s.current)[i];return `<div class="score-box ${scoreClass(hit)}"><span>${hit?scoreText(hit):'—'}</span></div>`}).join('')}</div>`}
/* v0.6.4.10: pantalla compacta SOLO para entrenamientos. Competencias conservan liveFullSheet. */
function compactTrainingSheet(s){
 const f=fmt(s),selection=correctionSelection(s,'training',null),active=Math.min(s.ends.length,f.maxEnds-1);
 let cumulative=0;
 const rows=Array.from({length:f.maxEnds},(_,i)=>{
  const end=s.ends[i]||(i===s.ends.length?s.current:[]);
  const current=s.status==='active'&&i===s.ends.length;
  const ordered=end.map((shot,index)=>({shot,index})).sort((a,b)=>(b.shot.score==='M'?0:b.shot.score)-(a.shot.score==='M'?0:a.shot.score));
  cumulative+=sum(end);
  const slots=Array.from({length:f.perEnd},(_,j)=>{
   const arrow=ordered[j];if(!arrow)return '<span class="training-arrow training-empty">—</span>';
   const {shot,index}=arrow,selected=selection?.endIndex===i&&selection.shotIndex===index;
   const label=`Tanda ${i+1}, flecha registrada ${index+1}: ${scoreText(shot)}. Tocar para corregir.`;
   return `<button type="button" class="training-arrow score-box score-editable ${scoreClass(shot)} ${selected?'score-edit-selected':''}" data-action="select-shot-edit" data-value="${i}:${index}" aria-pressed="${selected?'true':'false'}" aria-label="${e(label)}">${scoreText(shot)}<small>F${index+1}</small></button>`;
  }).join('');
  const registered=end.length>0;
  return `<div class="training-compact-grid training-end-row ${current?'training-current-row':''}" data-end-index="${i}"><span class="training-index">${i+1}</span>${slots}<span class="training-subtotal">${registered?sum(end):'—'}</span><span class="training-cumulative">${registered?cumulative:'—'}</span></div>`;
 });
 return `<div class="training-sheet"><div class="training-sheet-title"><h3>Planilla de puntuación</h3><span class="small muted">↕ Desliza con el dedo</span></div><div class="training-compact-grid training-compact-head" style="--training-columns:${f.perEnd}"><span>T</span>${Array.from({length:f.perEnd},(_,i)=>`<span>F${i+1}</span>`).join('')}<span>Σ</span><span>Total</span></div><div id="trainingCompactScroll" class="training-compact-scroll" role="region" tabindex="0" aria-label="Planilla desplazable: ${f.maxEnds} tandas, cuatro visibles"><div class="training-compact-rows" style="--training-columns:${f.perEnd}">${rows.join('')}</div></div><div class="training-sheet-tip small muted">Toca una puntuación para corregirla en la diana · La tanda activa es ${active+1}</div></div>`;
}
function compactTrainingMetrics(s){
 const f=fmt(s),n=archersLength(s),lost=n*10-total(s),max=f.max-lost;
 const current=s.status==='finished'&&s.current.length===0?s.ends.at(-1)||[]:s.current;
 return `<section class="training-reachable" aria-label="Cuenta atrás de puntuación"><div class="training-reachable-top"><span>Máximo alcanzable</span><strong>${max}<small> / ${f.max}</small></strong></div><div class="training-mini-metrics"><div><small>Suma anotados tanda</small><strong>${sum(current)}</strong></div><div><small>Puntos perdidos</small><strong>${lost}</strong></div><div><small>Flechas restantes</small><strong>${f.maxEnds*f.perEnd-n}</strong></div></div></section>`;
}
function scorePage(s){
 const f=fmt(s),n=archersLength(s),done=s.status==='finished',currentEnd=Math.min(s.ends.length+1,f.maxEnds);
 const selection=correctionSelection(s,'training',null);
 return `<section class="card gap training-compact-page"><div class="training-compact-top"><div><div class="eyebrow">${e(f.name)}</div><h2>${e(s.archerName)}</h2><small class="muted">${e(s.title)}</small></div><div class="training-top-score"><small class="muted">${done?'Ronda finalizada':`Tanda ${currentEnd}/${f.maxEnds}`}</small><strong>${total(s)}</strong><small class="muted">puntos acumulados</small></div></div>${selection?`<div class="shot-edit-banner"><strong>Corrigiendo tanda ${selection.endIndex+1} · flecha F${selection.shotIndex+1}</strong><span>Toca la posición correcta en la diana; se reemplazará el valor anterior sin añadir otra flecha.</span><button type="button" class="btn small" data-action="cancel-shot-edit">Cancelar corrección</button></div>`:''}<div class="training-target"><div class="target-wrap">${targetSvg(s)}<div class="target-controls"><span class="small muted">${selection?'Modo corrección activo':done?'Sesión cerrada':'Toca la diana para anotar · fuera = M'}</span><button class="btn small" data-action="reset-zoom">Centrar</button></div><div class="footer-note">Pellizca para zoom · arrastra al ampliar (hasta 4×)</div></div></div>${compactTrainingSheet(s)}${compactTrainingMetrics(s)}<div class="training-secondary-actions"><button class="btn block" data-action="undo" ${!n||view.busy?'disabled':''}>↶ Deshacer última flecha</button>${done?`<div class="notice success">Entrenamiento finalizado. Puedes deshacer la última flecha si necesitas corregirla.</div>`:`<button class="btn ghost block" data-action="finish">Finalizar entrenamiento anticipadamente</button>`}</div></section><div class="btn-row"><button class="btn" data-action="open-detail">Ver resultados</button><button class="btn" data-action="nav" data-value="history">Historial</button></div>`;
}
function attachTrainingCompactSheet(s){
 const el=document.getElementById('trainingCompactScroll');if(!el)return;
 const n=archersLength(s),newSession=view.trainingLastSession!==s.id,changed=newSession||n!==view.trainingLastCount;
 // Solo seguir automáticamente la tanda activa al registrar/deshacer flechas o abrir otra sesión.
 // Una selección/corrección histórica no cambia el número de flechas y conserva el scroll manual.
 if(changed){const current=Math.min(s.ends.length,fmt(s).maxEnds-1);el.scrollTop=Math.max(0,current-3)*52;}
 else el.scrollTop=view.trainingScrollY;
 view.trainingScrollY=el.scrollTop;view.trainingLastSession=s.id;view.trainingLastCount=n;
 el.addEventListener('scroll',()=>{view.trainingScrollY=el.scrollTop},{passive:true});
}
function liveFullSheet(s,{scope='training',number=null,editable=true}={}){
 const f=fmt(s),selection=correctionSelection(s,scope,number),full=scope==='competition'||scope==='training';let cumulative=0;
 return `<div class="live-sheet">${Array.from({length:f.maxEnds},(_,i)=>{
  const end=s.ends[i]||(i===s.ends.length?s.current:[]);
  const isCompleted=i<s.ends.length;
  const isCurrent=!isCompleted&&i===s.ends.length&&s.status==='active';
  // Mostrar en orden WA de mayor a menor, pero conservar el índice REAL de cada impacto.
  const ordered=end.map((shot,index)=>({shot,index})).sort((a,b)=>(b.shot.score==='M'?0:b.shot.score)-(a.shot.score==='M'?0:a.shot.score));
  cumulative+=sum(end);
  return `<div class="live-end ${isCurrent?'live-end-current':''} ${isCompleted?'live-end-completed':''}"><div class="live-end-head"><strong>Tanda ${i+1}${isCurrent?' · Actual':''}</strong><span class="small muted">${isCompleted||isCurrent?`Subtotal ${sum(end)} · Acum. ${cumulative}`:'Pendiente'}</span></div><div class="live-end-scores" style="--arrows:${f.perEnd}">${Array.from({length:f.perEnd},(_,j)=>{
   const arrow=ordered[j];if(!arrow)return '<span class="score-box empty">—</span>';
   const {shot,index}=arrow,selected=selection?.endIndex===i&&selection.shotIndex===index;
   const label=`Tanda ${i+1}, flecha registrada ${index+1}: ${scoreText(shot)}`;
   return editable?`<button type="button" class="score-box score-editable ${scoreClass(shot)} ${selected?'score-edit-selected':''}" data-action="select-shot-edit" data-value="${i}:${index}" aria-pressed="${selected?'true':'false'}" aria-label="${e(label)}. Tocar para corregir">${scoreText(shot)}<small>F${index+1}</small></button>`:`<span class="score-box ${scoreClass(shot)}" aria-label="${e(label)}">${scoreText(shot)}</span>`;
  }).join('')}</div></div>`;
 }).join('')}</div>`;
}
function endMini(end,n){return `<div class="soft row"><span class="small">Tanda ${n}</span><span class="mini-score-list">${end.map(a=>`<span class="mini-score ${scoreClass(a)}">${scoreText(a)}</span>`).join('')}</span><span class="small muted">${sum(end)} pts</span></div>`}
function detail(s){const f=fmt(s),arr=shots(s);const tab=view.detailTab;return `<section class="card gap"><div class="row"><div><div class="eyebrow">HISTORIAL · ${e(f.distance)}</div><h2>${e(s.title)}</h2><small class="muted">${e(s.archerName)} · ${new Date(s.updatedAt).toLocaleDateString('es-CL')}</small></div><span class="pill ${s.status==='finished'?'good':'warn'}">${s.status==='finished'?'Finalizado':'En curso'}</span></div>${metrics(arr)}<div class="btn-row"><button class="btn" data-action="nav" data-value="history">← Historial</button>${s.status==='active'?'<button class="btn primary" data-action="resume">Continuar anotando</button>':'<button class="btn" data-action="print">Guardar PDF / imprimir</button>'}</div></section><div class="tabs"><button class="${tab==='planilla'?'active':''}" data-action="detail-tab" data-value="planilla">Planilla</button><button class="${tab==='impactos'?'active':''}" data-action="detail-tab" data-value="impactos">Impactos</button><button class="${tab==='estadisticas'?'active':''}" data-action="detail-tab" data-value="estadisticas">Estadísticas</button></div>${tab==='planilla'?detailSheet(s):tab==='impactos'?detailImpacts(s):detailStats(s)}<section class="card gap"><h3>Exportar o administrar</h3><div class="btn-row"><button class="btn" data-action="export-session">↓ Archivo .wascore</button><button class="btn" data-action="export-csv">↓ CSV</button></div><div class="btn-row"><button class="btn" data-action="print">PDF / Imprimir</button><button class="btn danger" data-action="delete">Eliminar sesión</button></div></section>`}
function detailSheet(s){const f=fmt(s);const full=s.ends.map((end,i)=>({end,i,partial:false}));if(s.current.length)full.push({end:s.current,i:full.length,partial:true});const visible=view.showAll?full:full.slice(0,5);let cum=0;
return `<section class="card gap"><div class="row"><h2>Planilla individual</h2><span class="pill">${s.ends.length}/${f.maxEnds} tandas cerradas</span></div><p class="small muted">Toca una tanda para mostrar sus impactos en la diana. Puntuaciones ordenadas de mayor a menor; las posiciones originales de impacto se conservan.</p>${visible.map(x=>{cum=sum(s.ends.slice(0,x.i+1).flat())+(x.partial?sum(s.current):0);return `<button class="end" data-action="show-end" data-value="${x.i+1}"><div class="row"><strong>Tanda ${x.i+1}${x.partial?' · En curso':''}</strong><small class="muted">Tanda: ${sum(x.end)} · Total: ${cum} ›</small></div><div class="score-grid">${[...x.end].sort((a,b)=>(b.score==='M'?0:b.score)-(a.score==='M'?0:a.score)).map(a=>`<span class="score-box ${scoreClass(a)}">${scoreText(a)}</span>`).join('')}${Array.from({length:f.perEnd-x.end.length},()=>'<span class="score-box empty">—</span>').join('')}</div></button>`}).join('')||'<div class="empty"><p class="small muted">Aún no se han disparado flechas.</p></div>'}${full.length>5?`<button class="btn block" data-action="toggle-ends">${view.showAll?'Mostrar menos':`Mostrar las ${full.length} tandas`}</button>`:''}</section>`}
function detailImpacts(s){const f=fmt(s),arr=shots(s);const maxEnd=Math.max(1,Math.ceil(arr.length/f.perEnd));const show=view.impactScope==='all'?arr:arr.filter((a,i)=>Math.floor(i/f.perEnd)+1===view.impactEnd);const centroid=meanXY(show);
return `<section class="card gap"><h2>Mapa de impactos</h2><div class="field"><label for="impactChoice">Mostrar impactos</label><select id="impactChoice" data-action="impact-change"><option value="all" ${view.impactScope==='all'?'selected':''}>Todos (${arr.length} impactos)</option>${Array.from({length:maxEnd},(_,i)=>`<option value="${i+1}" ${view.impactScope==='end'&&view.impactEnd===i+1?'selected':''}>Tanda ${i+1}</option>`).join('')}</select></div><div class="target-wrap">${targetSvg(s,false,show)}<div class="footer-note">${show.length} impactos · Verde = posición de la flecha</div></div><div class="metric-list"><div class="metric"><span>Centro medio horizontal</span><strong>${direction(centroid.x,1,f.faceCm)}</strong></div><div class="metric"><span>Centro medio vertical</span><strong>${direction(centroid.y,0,f.faceCm)}</strong></div></div><p class="small muted">Las distancias se calculan desde las posiciones que marcaste en la pantalla. Son estimaciones visuales, no mediciones físicas exactas.</p></section>`}
function meanXY(arr){return {x:arr.reduce((s,a)=>s+a.x,0)/Math.max(1,arr.length),y:arr.reduce((s,a)=>s+a.y,0)/Math.max(1,arr.length)}}
function direction(v,h,cm){if(!Number.isFinite(v))return '—';return `${money(Math.abs(v)*cm/2)} cm ${Math.abs(v)<.005?'del centro':h?(v>=0?'a la derecha':'a la izquierda'):(v>=0?'abajo':'arriba')}`}
function statsSelected(s){const arr=shots(s),f=fmt(s);const boundary=Math.floor(f.maxEnds*f.perEnd/2);return view.period==='first'?arr.slice(0,boundary):view.period==='second'?arr.slice(boundary):arr}
function statsHeader(){return `<div class="tabs"><button class="${view.period==='all'?'active':''}" data-action="period" data-value="all">Completo</button><button class="${view.period==='first'?'active':''}" data-action="period" data-value="first">1.ª mitad</button><button class="${view.period==='second'?'active':''}" data-action="period" data-value="second">2.ª mitad</button></div>`}
function metric(l,val){return `<div class="metric"><span>${e(l)}</span><strong>${e(val)}</strong></div>`}
function statsSection(s){const arr=statsSelected(s),f=fmt(s),pts=sum(arr),counts=[10,9,8,7,6,5,4,3,2,1,'M'].map(v=>({value:v,count:arr.filter(a=>a.score===v).length})),n=arr.length,x=arr.filter(a=>a.xRing).length;
const ends=Array.from({length:Math.ceil(n/f.perEnd)},(_,i)=>{const end=arr.slice(i*f.perEnd,i*f.perEnd+f.perEnd);return {number:i+1+(view.period==='second'?f.maxEnds/2:0),arrows:end,total:sum(end)}});
const avg=ends.length?ends.reduce((a,v)=>a+v.total,0)/ends.length:0,endsDev=ends.length?Math.sqrt(ends.reduce((s,v)=>s+(v.total-avg)**2,0)/ends.length):0;
if(view.statsSection==='resumen')return `<div class="stats">${[['Puntos',pts],['Flechas',n],['Promedio',n?money(pts/n):'—']].map(([l,v])=>`<div class="stat"><b>${v}</b><small>${l}</small></div>`).join('')}</div><div class="metric-list">${metric('Máximo posible',n*10)}${metric('Rendimiento',n?`${money(pts/n*10)} %`:'—')}${metric('Dieces',counts[0].count)}${metric('X (incluidas en los dieces)',x)}${metric('Nueves',counts[1].count)}${metric('M (0 puntos)',counts[10].count)}${metric('Amarillo (9–10)',arr.filter(a=>a.score>=9).length)}${metric('Rojo (7–8)',arr.filter(a=>a.score>=7&&a.score<=8).length)}${metric('Azul (5–6)',arr.filter(a=>a.score>=5&&a.score<=6).length)}${metric('Negro y blanco (1–4)',arr.filter(a=>Number(a.score)>=1&&Number(a.score)<=4).length)}</div>`;
if(view.statsSection==='distribucion')return `<h3>Distribución completa de 10 a M</h3><table class="distribution"><thead><tr><th>Zona</th><th>Distribución</th><th class="num">Flechas</th><th class="num">%</th></tr></thead><tbody>${counts.map(c=>`<tr><td><strong>${c.value}</strong></td><td style="width:38%"><div class="bar"><span style="width:${c.count/Math.max(1,...counts.map(x=>x.count))*100}%"></span></div></td><td class="num">${c.count}</td><td class="num">${n?money(c.count/n*100):'0'}%</td></tr>`).join('')}</tbody></table><p class="small muted">Las X forman parte de los dieces: no suman puntos adicionales.</p>`;
if(view.statsSection==='agrupacion'){
const centroid=meanXY(arr),h=arr.length?Math.sqrt(arr.reduce((v,a)=>v+(a.x-centroid.x)**2,0)/n)*f.faceCm/2:0,v=arr.length?Math.sqrt(arr.reduce((v,a)=>v+(a.y-centroid.y)**2,0)/n)*f.faceCm/2:0;let diameter=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)diameter=Math.max(diameter,Math.hypot(arr[i].x-arr[j].x,arr[i].y-arr[j].y)*f.faceCm/2);const radial=n?arr.reduce((v,a)=>v+Math.hypot(a.x-centroid.x,a.y-centroid.y),0)/n*f.faceCm/2:0;
const qs=[['Arriba izquierda',arr.filter(a=>a.x<0&&a.y<0).length],['Arriba derecha',arr.filter(a=>a.x>=0&&a.y<0).length],['Abajo izquierda',arr.filter(a=>a.x<0&&a.y>=0).length],['Abajo derecha',arr.filter(a=>a.x>=0&&a.y>=0).length]];
return `<h3>Precisión y agrupación</h3><div class="target-wrap">${targetSvg(s,false,arr)}<div class="footer-note">${n} impactos del período seleccionado</div></div><div class="metric-list">${metric('Centro promedio horizontal',direction(centroid.x,1,f.faceCm))}${metric('Centro promedio vertical',direction(centroid.y,0,f.faceCm))}${metric('Desviación horizontal (DE)',`${money(h)} cm`)}${metric('Desviación vertical (DE)',`${money(v)} cm`)}${metric('Distancia radial media',`${money(radial)} cm`)}${metric('Diámetro máximo de agrupación',`${money(diameter)} cm`)}</div><h3>Cuadrantes</h3><div class="quadrants">${qs.map(([k,val])=>`<div class="stat"><b>${val}</b><small>${k}</small></div>`).join('')}</div><p class="small muted">El eje horizontal y vertical se calculan según dónde toques la diana; no son mediciones con una regla sobre el blanco físico.</p>`}
if(view.statsSection==='evolucion')return `<h3>Resultados por tanda</h3><div class="metric-list">${metric('Mejor tanda',ends.length?`${Math.max(...ends.map(e=>e.total))} puntos`:'—')}${metric('Peor tanda',ends.length?`${Math.min(...ends.map(e=>e.total))} puntos`:'—')}${metric('Promedio por tanda',ends.length?money(avg):'—')}${metric('Variación de puntaje (DE)',ends.length?money(endsDev):'—')}</div><p class="small muted">Toca una tanda para destacar sus impactos.</p><div class="gap">${ends.map(end=>`<button class="session" data-action="show-end" data-value="${end.number}"><div class="row"><small>Tanda ${end.number}</small><strong>${end.total} / ${f.perEnd*10}</strong></div><div class="bar"><span style="width:${end.total/(f.perEnd*10)*100}%"></span></div></button>`).join('')}</div><h3>Comparación de mitades</h3>${metric('Primera mitad',`${sum(shots(s).slice(0,f.maxEnds*f.perEnd/2))} puntos`)}${metric('Segunda mitad',`${sum(shots(s).slice(f.maxEnds*f.perEnd/2))} puntos`)}`;
return '';
}
function detailStats(s){const tabs=[['resumen','Resumen'],['distribucion','Puntuaciones'],['agrupacion','Agrupación'],['evolucion','Por tandas'],['comparacion','Comparar']];return `<section class="card gap"><h2>Estadísticas completas</h2><div class="tabs" style="grid-template-columns:repeat(2,1fr)">${tabs.map(([id,label])=>`<button class="${view.statsSection===id?'active':''}" data-action="stats-section" data-value="${id}">${label}</button>`).join('')}</div>${view.statsSection==='comparacion'?compareSessions(s):statsHeader()+statsSection(s)}</section>`}
function compareSessions(s){const f=fmt(s),sim=sessions.filter(x=>x.formatId===s.formatId&&x.status==='finished').sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));return `<p class="small muted">Se comparan solamente sesiones finalizadas del mismo formato (${e(f.distance)} y ${f.maxEnds*f.perEnd} flechas). Las sesiones incompletas no se mezclan con ellas.</p>${sim.length<2?'<div class="notice">Necesitas al menos dos entrenamientos finalizados de este mismo formato para comparar su evolución.</div>':''}<div class="gap">${sim.map(item=>`<div class="soft gap-xs"><div class="row"><strong>${e(item.title)}</strong><strong>${total(item)} pts</strong></div><small class="muted">${new Date(item.createdAt).toLocaleDateString('es-CL')} · ${archersLength(item)} flechas · ${money(total(item)/Math.max(1,archersLength(item)))} promedio</small><div class="bar"><span style="width:${total(item)/fmt(item).max*100}%"></span></div></div>`).join('')}</div>${sim.length>=2?`<div class="metric-list">${metric('Primera sesión',`${total(sim[0])} puntos`)}${metric('Última sesión',`${total(sim[sim.length-1])} puntos`)}${metric('Variación',`${total(sim[sim.length-1])-total(sim[0])} puntos`)}</div>`:''}`}

function personalHistory(){
 return `<section class="card gap"><div class="row"><h2>Mis competencias</h2><span class="pill">${personal.length} rondas</span></div><p class="small muted">Importa tu archivo individual .wascore. Se guarda en este teléfono como copia privada de solo lectura y NO modifica las planillas oficiales.</p><div class="field"><label for="importPersonal">Importar mi competencia (.wascore)</label><input id="importPersonal" type="file" aria-label="Archivo individual de competencia"></div><div class="sessions">${personal.length?personal.map(p=>`<button class="session" data-action="open-personal" data-value="${e(p.id)}"><div class="row"><strong>${e(p.title)}</strong><strong>${total(p)} pts</strong></div><div class="row"><small class="muted">${e(p.archerName)} · ${e(fmt(p).distance)} · ${e(p.eventDate||'')}</small><span class="pill good">Validada</span></div></button>`).join(''):'<div class="empty"><strong>Aún no tienes competencias importadas</strong><p class="small muted">Solicita al organizador tu archivo individual después de validar tu planilla.</p></div>'}</div></section>`;
}
function personalCompare(p){
 const list=personal.filter(x=>x.formatId===p.formatId).sort((a,b)=>new Date(a.eventDate||a.createdAt)-new Date(b.eventDate||b.createdAt));
 return `<section class="card gap"><h3>Comparar mis competencias · ${e(fmt(p).distance)}</h3><p class="small muted">Solo se comparan rondas validadas del mismo formato. No se mezclan distancias ni número de flechas.</p>${list.length<2?'<div class="notice">Importa otra competencia del mismo formato para comparar tu evolución.</div>':''}<div class="gap">${list.map(r=>`<div class="soft gap-xs"><div class="row"><strong>${e(r.title)}</strong><strong>${total(r)} puntos</strong></div><small class="muted">${e(r.eventDate||'')} · ${archersLength(r)} flechas</small><div class="bar"><span style="width:${Math.max(0,Math.min(100,total(r)/fmt(r).max*100))}%"></span></div></div>`).join('')}</div>${list.length>=2?`<div class="metric-list">${metric('Variación entre primera y última',`${total(list.at(-1))-total(list[0])} puntos`)}</div>`:''}</section>`;
}
function personalDetail(p){
 if(!p)return personalHistory();
 const tab=view.detailTab;
 return `<section class="card gap"><div class="eyebrow">MI COMPETENCIA · SOLO LECTURA</div><h2>${e(p.title)}</h2><p class="small muted">${e(p.archerName)} · ${e(p.eventDate||'')} · ${e(fmt(p).name)}</p>${metrics(shots(p))}<button class="btn block" data-action="nav" data-value="personal-history">← Mis competencias</button></section><div class="tabs"><button data-action="detail-tab" data-value="planilla" class="${tab==='planilla'?'active':''}">Planilla</button><button data-action="detail-tab" data-value="impactos" class="${tab==='impactos'?'active':''}">Impactos</button><button data-action="detail-tab" data-value="estadisticas" class="${tab==='estadisticas'?'active':''}">Estadísticas</button></div>${tab==='planilla'?detailSheet(p):tab==='impactos'?detailImpacts(p):view.statsSection==='comparacion'?personalCompare(p):detailStats(p)}<section class="card gap"><h3>Archivo personal</h3><p class="small muted">Esta copia no permite corregir ni firmar la planilla oficial.</p><div class="btn-row"><button class="btn" data-action="personal-export">↓ Guardar copia</button><button class="btn danger" data-action="personal-delete">Eliminar copia local</button></div></section>`;
}
// Un archivo individual solo contiene los impactos y datos deportivos de UNA persona.
function individualRecord(ev,number){
 const slot=ev.draw.find(d=>d.number===number),archer=eventParticipant(ev,number),r=slotResult(ev,number),f=fmt(ev);
 if(!slot||!archer||r.status!=='finished'||currentApproval(r).status!=='validated'
  ||(r.ends||[]).length!==f.maxEnds||(r.current||[]).length||slotAllShots(r).length!==f.perEnd*f.maxEnds)
  throw Error('El arquero debe completar y validar todas las tandas antes de exportar.');
 const record={id:uid(),kind:'personal-competition',archerName:archer.name,title:ev.name,formatId:ev.formatId,
  status:'finished',ends:structuredClone(r.ends),current:[],number,category:[archer.division,archer.age,archer.level,archer.gender].join(' / '),
  sourceEventId:ev.id,sourceRoomId:ev.cloudRoomId||null,eventDate:ev.date,
  createdAt:timestamp(),updatedAt:timestamp()};
 validateSession(record);return record;
}
function personalJson(p){const copy=structuredClone(p);delete copy.validation;delete copy.revisions;return JSON.stringify({fileType:'wa-scoring-personal-competition',schemaVersion:1,exportedAt:timestamp(),record:copy},null,2)}
async function exportIndividual(ev,number){
 if(ev.cloudRoomId&&(ev.cloudRole!=='organizer'||!cloudState.ready||cloudState.fromCache||cloudState.roomId!==ev.cloudRoomId))
  throw Error('Exporta únicamente desde el organizador con Firebase sincronizado.');
 const record=individualRecord(ev,number),name=`${escapeFilename(ev.name)}-${escapeFilename(record.archerName)}.wascore`;
 const json=personalJson(record),file=new File([json],name,{type:'application/json'});
 if(navigator.canShare?.({files:[file]})&&navigator.share){
  try{await navigator.share({files:[file],title:`Resultados ${record.archerName}`});return;}
  catch(err){if(err.name==='AbortError')return;}
 }
 download(name,json,'application/json');alertMsg('Archivo individual descargado. Puedes enviarlo mediante WhatsApp, AirDrop o Archivos.');
}
async function importPersonalFile(file){
 if(!file)return;
 if(file.size>6*1024*1024)return alertMsg('Archivo personal demasiado grande (máximo 6 MB).',true);
 try{
  const data=JSON.parse(await file.text());
  if(data?.fileType!=='wa-scoring-personal-competition'||data.schemaVersion!==1||!data.record)
    throw Error('Este archivo no es una ronda individual. Pide al organizador «Compartir estadísticas».');
  const p=structuredClone(data.record);validateSession(p);
  if(p.kind!=='personal-competition'||p.status!=='finished'||p.current.length||p.ends.length!==fmt(p).maxEnds||
    archersLength(p)!==fmt(p).maxEnds*fmt(p).perEnd||!Number.isInteger(p.number)||p.number<1||!p.sourceEventId)
    throw Error('La ronda individual está incompleta o tiene un formato incompatible.');
  // No aceptar firmas, autorizaciones ni resultados de terceros dentro del archivo personal.
  const allowed=['id','kind','archerName','title','formatId','status','ends','current','number','category','sourceEventId','sourceRoomId','eventDate','createdAt','updatedAt'];
  if(Object.keys(p).some(k=>!allowed.includes(k)))throw Error('El archivo individual contiene campos que no corresponden.');
  if(personal.some(x=>x.sourceEventId===p.sourceEventId&&x.number===p.number&&x.eventDate===p.eventDate))
    throw Error('Ya importaste esa planilla individual.');
  p.id=uid();p.createdAt=p.createdAt||timestamp();p.updatedAt=timestamp();
  await dbCall('readwrite',store=>store.put(p),'personal');await refresh();view.activePersonal=p.id;
  view.page='personal-detail';view.detailTab='estadisticas';view.statsSection='resumen';alertMsg('Ronda importada. Sus estadísticas están disponibles sin conexión.');
 }catch(err){alertMsg('No se pudo importar la competencia individual: '+err.message,true)}
}
const divisions=['Barebow','Recurvo Olímpico','Compuesto','Tradicional'];
const ages=['Open','U21','U18','Máster +50'];
const levels=['General','Novatos'];
function eventFormatOptions(){return Object.values(formats).map(f=>`<option value="${e(Object.entries(formats).find(([,x])=>x===f)[0])}">${e(f.name)} · ${f.maxEnds*f.perEnd} flechas</option>`).join('')}
function competition(){return cloudMenu()+`<section class="card gap"><div class="row"><h2>Competencias</h2><span class="pill">${events.length} eventos</span></div><p class="small muted">Competiciones locales y modo piloto en red. Después del sorteo elige anotación local o en red. Para la red, conecta y autoriza los teléfonos antes de iniciar. No modifiques un evento simultáneamente fuera de la sala Firebase.</p><button class="btn primary block" data-action="event-new">+ Crear competencia</button><div class="field"><label for="importEvent">Importar respaldo WA Scoring (.wascore / .json)</label><input id="importEvent" type="file"><small class="muted">Selecciona archivos .wascore o .json. En iPhone aparecen todos los archivos; WA Scoring comprueba su contenido después de elegirlos.</small></div></section><section class="card gap"><button class="btn primary block" data-action="nav" data-value="personal-history">📊 Mis competencias · estadísticas personales</button></section>${events.length?`<section class="card gap"><h3>Competencias guardadas</h3><div class="sessions">${events.map(v=>`<button class="session" data-action="open-event" data-value="${e(v.id)}"><div class="row"><strong>${e(v.name)}</strong><span class="pill ${v.locked?'good':'warn'}">${e(eventPhase(v))}</span></div><div class="row"><small class="muted">${e(v.date)} · ${e(formats[v.formatId]?.name||'Formato')}</small><strong>${v.entries.filter(x=>!x.vacant).length} arqueros ›</strong></div></button>`).join('')}</div></section>`:''}<section class="card gap"><h3>Importante: versión piloto</h3><p class="small muted">Los torneos publicados requieren conexión a Firebase para registrar flechas. No hay cola de puntuaciones sin internet; la anotación por impacto de eliminatorias sigue pendiente; las eliminatorias admiten anotación remota por flechas numéricas y por set, con validación del organizador. Exporta respaldos .wascore.</p></section>`}
function newEvent(){return `<section class="card gap"><h2>Crear competencia</h2><form id="eventCreateForm" class="gap"><div class="field"><label for="eventName">Nombre del evento</label><input id="eventName" name="eventName" maxlength="120" required placeholder="Ej.: Torneo Club Volcanes"></div><div class="field"><label for="eventDate">Fecha</label><input id="eventDate" name="date" type="date" value="${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}" required></div><div class="field"><label for="eventFormat">Formato de clasificación</label><select id="eventFormat" name="format">${eventFormatOptions()}</select></div><label class="checkrow test-mode-option"><input type="checkbox" id="testMode" name="testMode" value="yes"><span><strong>🧪 Competencia de prueba</strong><strong class="test-mode-state" id="testModeState" aria-live="polite">DESACTIVADO</strong><small class="muted">Permite generar planillas clasificatorias simuladas para probar las eliminatorias. No apta para resultados oficiales.</small></span></label><button type="submit" class="btn primary block">Crear competencia</button></form><button class="btn ghost block" data-action="nav" data-value="competitions">Cancelar</button></section>`}
// Etapa local: se registra un anotador RESPONSABLE por parapeto, sin conectar cuentas ni telefonos.
function eventState(ev){return ev.status==='running'?'running':'setup'}
function eventTargets(ev){return [...new Set((ev.draw||[]).map(d=>d.target))].sort((a,b)=>a-b)}
function assignedScorer(ev,target){return (ev.scorers||[]).find(x=>x.target===target)}
function eventParticipant(ev,number){return (ev.entries||[]).find(x=>x.number===number&&!x.vacant)}
function slotResult(ev,number){return ev.results?.[String(number)]||{ends:[],current:[],status:'active'}}
function scoreForSlot(ev,slot){const a=eventParticipant(ev,slot.number),r=slotResult(ev,slot.number);return {id:`${ev.id}:${slot.number}`,kind:'competition',archerName:a?.name||'Arquero',title:ev.name,formatId:ev.formatId,status:r.status==='finished'?'finished':'active',ends:r.ends||[],current:r.current||[]}}
function ensureSlotResult(ev,number){ev.results ||= {};const key=String(number);if(!ev.results[key])ev.results[key]={ends:[],current:[],status:'active'};return ev.results[key]}
// Estado individual de revisión; compatible con resultados guardados en la versión 0.3.0.
function currentApproval(result){return result.validation||{status:'pending',decision:null,archerSignature:null,scorerSignature:null}}
function isDemoQualification(ev,r){return ev?.testMode===true&&r?.status==='finished'&&r?.validation?.simulated===true&&r?.validation?.status==='pending'}
function isQualifiedForSeeding(ev,r){return r?.status==='finished'&&(currentApproval(r).status==='validated'||isDemoQualification(ev,r))}
function testEligibleSlots(ev){if(!ev?.testMode||ev.cloudRole==='scorer'||eventState(ev)!=='running')return [];return (ev.draw||[]).filter(slot=>{const r=slotResult(ev,slot.number),v=currentApproval(r);return (r.ends||[]).length===0&&(r.current||[]).length===0&&r.status==='active'&&!v.archerSignature&&!v.scorerSignature&&v.status==='pending'&&!r.revisions?.length})}
// Stable sample scores: distinct totals within a category, used ONLY for test brackets.
function simulatedQualification(ev,slot,rank){
 const f=fmt(ev),count=f.maxEnds*f.perEnd;
 let deficit=12+rank*2;
 if(deficit>count*9)throw Error('La categoría es demasiado grande para simular puntuaciones únicas.');
 const points=Array(count).fill(10),number=slot.number;
 for(let i=0;i<deficit;i++)points[(i*7+number)%count]--;
 const hits=points.map((score,i)=>{
  const radius=score===10?0.063:(10.5-score)/10;
  const theta=i*2.399963229728653+number*0.61803398875;
  return {score,x:Number((radius*Math.cos(theta)).toFixed(6)),y:Number((radius*Math.sin(theta)).toFixed(6)),xRing:false};
 });
 return {ends:Array.from({length:f.maxEnds},(_,i)=>hits.slice(i*f.perEnd,(i+1)*f.perEnd)),current:[],status:'finished',
 validation:{status:'pending',decision:null,archerSignature:null,scorerSignature:null,simulated:true,simulatedAt:timestamp()},revisions:[]};
}
async function simulateQualifyingRound(){
 const ev=events.find(x=>x.id===view.activeEvent);
 if(!ev?.testMode||ev.cloudRole==='scorer'||eventState(ev)!=='running')return alertMsg('Este atajo solo existe en competencias creadas como PRUEBA.',true);
 if(Object.keys(ev.eliminations?.groups||{}).length)return alertMsg('Ya existe una llave. No se puede modificar la clasificación simulada después de generarla.',true);
 const slots=testEligibleSlots(ev);if(!slots.length)return alertMsg('No hay planillas vacías disponibles. Las ya anotadas o firmadas nunca se modifican.',true);
 const f=fmt(ev),rankByNumber=new Map();
 for(const category of new Set(slots.map(x=>eliminationCategory(eventParticipant(ev,x.number))))) {
  const all=(ev.draw||[]).filter(x=>eliminationCategory(eventParticipant(ev,x.number))===category).map(x=>x.number).sort((a,b)=>a-b);
  all.forEach((number,rank)=>rankByNumber.set(number,rank));
 }
 if(!confirmAction(`🧪 SOLO PRUEBAS. ¿Generar ${f.maxEnds*f.perEnd} flechas simuladas para ${slots.length} arqueros y habilitar sus llaves de prueba? NO se inventan firmas reales. Las planillas con flechas o firmas existentes se conservarán. NO UTILIZAR COMO RESULTADO OFICIAL.`))return;
 view.busy=true;render();let done=0;
 try{
  if(ev.cloudRoomId){
   if(ev.cloudRole!=='organizer'||cloudState.roomId!==ev.cloudRoomId||!cloudState.ready||cloudState.fromCache||cloudState.role!=='organizer')throw Error('Conecta Firebase como organizador antes de simular.');
   for(const slot of slots){
    const prior=cloudState.revisions.get(String(slot.number));
    if(!prior)throw Error(`No se ha recibido la planilla #${slot.number} del servidor.`);
    if(prior.status!=='active'||prior.ends?.length||prior.current?.length||prior.validation?.status==='validated'||prior.validation?.status==='disputed'||prior.validation?.archerSignature||prior.validation?.scorerSignature)continue;
    const next=simulatedQualification(ev,slot,rankByNumber.get(slot.number));
    const saved=await cloudState.api.updateCard(ev.cloudRoomId,String(slot.number),prior.revision,next);
    cloudState.revisions.set(String(slot.number),saved);done++;
    const fresh=events.find(x=>x.id===ev.id);if(fresh){const copy=structuredClone(fresh);copy.results||={};copy.results[String(slot.number)]=cardResult(saved);await persistEvent(copy);}
   }
  }else{
   const latest=events.find(x=>x.id===ev.id),copy=structuredClone(latest);
   for(const slot of slots){const r=slotResult(copy,slot.number);if(r.ends.length||r.current.length||r.validation?.status==='validated')continue;
    copy.results[String(slot.number)]=simulatedQualification(copy,slot,rankByNumber.get(slot.number));done++;
   }
   if(done)await persistEvent(copy);
  }
  view.busy=false;view.eventTab='eliminations';alertMsg(`🧪 ${done} planillas simuladas. Ya puedes generar la llave en «5. Eliminatorias». Las puntuaciones NO son oficiales.`);
 }catch(err){view.busy=false;alertMsg(`Simulación interrumpida después de ${done} planillas. Puedes repetirla: solo completará las vacías. Detalle: ${err.message}`,true);}
}
function approvalPill(result){const v=currentApproval(result);return v.simulated?'🧪 Puntuación simulada':v.status==='validated'?'✓ Firmada y validada':v.status==='disputed'?'⚠ En desacuerdo':result.status==='finished'?'Pendiente de firmas':'En anotación'}
function slotAllShots(r){return (r.ends||[]).flat().concat(r.current||[])}
function canEditRecordedShot(ev,number){
 const r=slotResult(ev,number),v=currentApproval(r);
 return eventState(ev)==='running'&&!['validated','disputed'].includes(v.status)&&!v.archerSignature&&!v.scorerSignature;
}
function getRecordedShot(r,endIndex,shotIndex){
 if(!Number.isInteger(endIndex)||endIndex<0||!Number.isInteger(shotIndex)||shotIndex<0)return null;
 const end=endIndex<(r.ends||[]).length?r.ends[endIndex]:endIndex===(r.ends||[]).length?r.current:null;
 return Array.isArray(end)?end[shotIndex]||null:null;
}
function sameRecordedShot(a,b){return a&&b&&a.score===b.score&&a.x===b.x&&a.y===b.y&&!!a.xRing===!!b.xRing;}
function correctionSelection(s,scope,number){
 const chosen=view.editShot;
 return chosen&&chosen.scope===scope&&chosen.number===number&&chosen.id===s.id?chosen:null;
}

function resetApproval(result){result.validation={status:'pending',decision:null,archerSignature:null,scorerSignature:null,archerSignedAt:null,scorerSignedAt:null};}
function auditPanel(r){const revisions=r.revisions||[];return revisions.length?`<div class="soft gap"><h3>Historial de correcciones (${revisions.length})</h3>${revisions.map((a,i)=>`<div class="audit-entry"><strong>Versión ${i+1} conservada</strong><small class="muted">${e(a.at)} · Autorizó: ${e(a.actor)} · ${e(a.reason)} · ${a.score} puntos</small><button class="btn small" data-action="print-audit" data-value="${i}">Imprimir versión anterior</button></div>`).join('')}</div>`:''}
function signatureSection(label,kind,signature){return `<div class="signature-field"><div class="row"><strong>${label}</strong>${signature?'<span class="pill good">Firma registrada ✓</span>':'<span class="pill warn">Sin firma</span>'}</div>${signature?`<img class="signature-preview" src="${e(signature)}" alt="${e(label)} registrada">`:`<canvas class="signature-canvas" id="signature-${kind}" width="620" height="170" aria-label="Espacio para firmar: ${e(label)}"></canvas><small class="muted">Firma con el dedo o un lápiz sobre el recuadro blanco.</small>`}<div class="btn-row">${signature?`<button class="btn" data-action="clear-event-signature" data-value="${kind}">Volver a firmar</button>`:`<button class="btn primary" data-action="save-event-signature" data-value="${kind}">Guardar firma</button><button class="btn" data-action="clear-signature-canvas" data-value="${kind}">Borrar trazos</button>`}</div></div>`}
function validationPanel(ev,slot,s){const r=slotResult(ev,slot.number),v=currentApproval(r),done=r.status==='finished';if(v.simulated)return '<section class="card gap"><div class="notice">🧪 Planilla generada automáticamente para PRUEBAS. No corresponde firmarla ni usarla como resultado oficial. Puedes continuar a eliminatorias desde el organizador.</div></section>';const scorer=assignedScorer(ev,slot.target),archer=eventParticipant(ev,slot.number);if(!done&&!['validated','disputed'].includes(v.status))return '<div class="notice">La revisión y las firmas se habilitarán al completar todas las flechas de este arquero. Los otros arqueros pueden continuar anotando.</div>';
const intro=`<div class="row start"><div><h3>Revisión y firmas individuales</h3><small class="muted">${e(archer?.name||'Arquero')} · Parapeto ${slot.target}${slot.position} · ${total(s)} puntos</small></div><span class="pill ${v.status==='validated'?'good':'warn'}">${approvalPill(r)}</span></div>`;
const notes=`<p class="small muted">Firmas dibujadas en este dispositivo y almacenadas ${ev.cloudRoomId?'en Firebase y en la copia local':'localmente'}. No constituyen firmas electrónicas avanzadas. Para un uso oficial deben aplicarse los controles y reglamentos correspondientes.</p>`;
if(v.status==='validated')return `<section class="card gap" id="validationSection">${intro}<div class="notice success">Planilla cerrada y firmada por arquero y anotador. No se pueden agregar ni deshacer flechas sin registrar una revisión.</div><div class="metric-list"><div class="metric"><span>Arquero</span><strong>${e(archer?.name)}</strong></div><div class="metric"><span>Anotador</span><strong>${e(v.scorerName||scorer?.name)}</strong></div><div class="metric"><span>Validada</span><strong>${e(new Date(v.validatedAt).toLocaleString('es-CL'))}</strong></div></div><div class="signature-pair">${['archer','scorer'].map(k=>`<div class="signature-field"><small>${k==='archer'?'Firma del arquero':'Firma del anotador'}</small><img class="signature-preview" src="${e(k==='archer'?v.archerSignature:v.scorerSignature)}" alt="Firma ${k}"></div>`).join('')}</div><button class="btn primary block" data-action="print-event-scorecard">Imprimir / Guardar PDF de planilla firmada</button><button class="btn block" data-action="export-event-scorecard-csv">Exportar flechas CSV</button><button class="btn block" data-action="event-correction-form">Solicitar corrección autorizada</button>${view.correctionVisible?correctionForm():''}${auditPanel(r)}${notes}</section>`;
if(v.status==='disputed')return `<section class="card gap" id="validationSection">${intro}<div class="notice">El arquero indicó «En desacuerdo». Motivo: ${e(v.reason||'Sin detalle')}. Esta planilla NO se puede validar ni modificar sin dejar constancia de la corrección.</div><button class="btn block" data-action="event-correction-form">Registrar corrección autorizada</button>${view.correctionVisible?correctionForm():''}${auditPanel(r)}${notes}</section>`;
return `<section class="card gap" id="validationSection">${intro}${auditPanel(r)}<p class="small muted">Revisa la planilla completa y los puntajes antes de elegir una opción. Solo este arquero queda pendiente de aprobación.</p>${v.decision!=='agree'?`<div class="btn-row"><button class="btn primary" data-action="event-agree">✓ De acuerdo</button><button class="btn danger" data-action="event-disagree-form">En desacuerdo</button></div>${view.disputeVisible?`<form id="eventDisputeForm" class="gap"><div class="field"><label>Motivo del desacuerdo</label><textarea name="reason" maxlength="350" required rows="3" placeholder="Describe qué puntuación debe revisarse"></textarea></div><button class="btn danger block" type="submit">Registrar desacuerdo</button></form>`:''}`:`<div class="notice success">El arquero está de acuerdo con la planilla. Faltan las firmas y la confirmación final.</div>${signatureSection('Firma del arquero','archer',v.archerSignature)}${signatureSection('Firma del anotador · '+(scorer?.name||''),'scorer',v.scorerSignature)}<button class="btn primary block" data-action="event-validate" ${v.archerSignature&&v.scorerSignature?'':'disabled'}>✓ Validar y bloquear planilla</button><button class="btn ghost block" data-action="event-reset-decision">Cambiar decisión y retirar firmas</button>`}${notes}</section>`}
function correctionForm(){return `<form id="eventCorrectionForm" class="gap"><div class="notice">Esta operación conserva copia de la planilla anterior, sus firmas y el motivo. La identidad del autorizante se declara manualmente: aún no existen cuentas con permisos verificables.</div><div class="field"><label>Nombre del juez u organizador que autoriza</label><input name="actor" maxlength="100" minlength="3" required placeholder="Nombre y apellido"></div><div class="field"><label>Motivo de corrección</label><textarea name="reason" maxlength="350" minlength="8" required rows="3" placeholder="Explica qué se corregirá y por qué"></textarea></div><button class="btn danger block" type="submit">Registrar autorización y permitir corrección</button></form>`}
function attachSignatureCanvases(){document.querySelectorAll('canvas.signature-canvas').forEach(canvas=>{const ctx=canvas.getContext('2d');if(!ctx)return;ctx.strokeStyle='#172238';ctx.lineWidth=3.2;ctx.lineCap='round';ctx.lineJoin='round';let active=null;function pt(evt){const b=canvas.getBoundingClientRect();return{x:(evt.clientX-b.left)*canvas.width/b.width,y:(evt.clientY-b.top)*canvas.height/b.height}}canvas.addEventListener('pointerdown',evt=>{evt.preventDefault();if(active!==null)return;active=evt.pointerId;try{canvas.setPointerCapture(evt.pointerId)}catch{}const p=pt(evt);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.03,p.y+.03);ctx.stroke();canvas.dataset.ink='yes'});canvas.addEventListener('pointermove',evt=>{if(evt.pointerId!==active)return;evt.preventDefault();const p=pt(evt);ctx.lineTo(p.x,p.y);ctx.stroke()});function end(evt){if(evt.pointerId===active){active=null;ctx.closePath()}}canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end)})}
function getScorecardPrint(ev,slot,override){const a=eventParticipant(ev,slot.number),raw=override||slotResult(ev,slot.number),s={...scoreForSlot(ev,slot),ends:raw.ends||[],current:raw.current||[],status:raw.status},f=fmt(s),v=currentApproval(raw);let cumulative=0;const lines=(raw.ends||[]).map((end,i)=>{cumulative+=sum(end);const sorted=[...end].sort((x,y)=>(Number(y.score)||0)-(Number(x.score)||0));return `<tr><td>${i+1}</td>${Array.from({length:f.perEnd},(_,j)=>`<td class="print-arrow ${scoreClass(sorted[j])}">${sorted[j]?scoreText(sorted[j]):''}</td>`).join('')}<td>${sum(end)}</td><td>${cumulative}</td></tr>`}).join('');const signed=v.status==='validated';return `<h1>WA Scoring · Planilla de competencia</h1><p class="print-meta">${e(ev.name)} · ${e(ev.date)}<br>${e(a?.name||'Arquero')} · Inscripción #${slot.number} · Parapeto ${slot.target}${slot.position}<br>${e(f.name)} · ${e(f.distance)} · ${f.faceCm} cm<br><strong>${sum(slotAllShots(raw))} / ${f.max} puntos · ${slotAllShots(raw).length}/${f.perEnd*f.maxEnds} flechas</strong><br>Estado: ${signed?'FIRMADA Y VALIDADA':v.status==='disputed'?'EN DESACUERDO':'SIN VALIDAR'}</p><table><thead><tr><th>Tanda</th>${Array.from({length:f.perEnd},(_,i)=>`<th>F${i+1}</th>`).join('')}<th>Subtotal</th><th>Acumulado</th></tr></thead><tbody>${lines}</tbody></table>${signed?`<div class="print-signatures"><div><strong>Firma del arquero</strong><img src="${e(v.archerSignature)}" alt="Firma del arquero"></div><div><strong>Firma del anotador: ${e(v.scorerName||'')}</strong><img src="${e(v.scorerSignature)}" alt="Firma del anotador"></div></div><p>Validación local: ${e(new Date(v.validatedAt).toLocaleString('es-CL'))}</p>`:'<p>Planilla provisional: no consta validación final con ambas firmas.</p>'}<small>Documento emitido localmente desde WA Scoring. No se ha verificado una firma digital criptográfica.</small>`}
function exportEventScorecardCsv(ev,slot){const a=eventParticipant(ev,slot.number),r=slotResult(ev,slot.number),f=fmt(ev),v=currentApproval(r),lines=[['Competencia','Arquero','N.º','Parapeto','Posición','Tanda','Flecha','Puntos','X','Estado validación']];slotAllShots(r).forEach((shot,i)=>lines.push([ev.name,a?.name||'',slot.number,slot.target,slot.position,Math.floor(i/f.perEnd)+1,i%f.perEnd+1,shot.score,shot.xRing?'Sí':'No',v.status]));download(`${escapeFilename(ev.name)}-${escapeFilename(a?.name||'planilla')}.csv`,lines.map(line=>line.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8')}
function recordCompetitionShot(shot){
 const number=selectedCompetitionSlot()?.number;if(!number)return;
 return changeEvent(ev=>{
  if(eventState(ev)!=='running')throw Error('La competencia no está iniciada');
  const slot=ev.draw.find(d=>d.number===number&&d.target===view.activeTarget&&d.position===view.activePosition);
  if(!slot)throw Error('Posición de anotación modificada');
  const r=ensureSlotResult(ev,number),f=fmt(ev),v=currentApproval(r);
  if(!Array.isArray(r.ends)||!Array.isArray(r.current))throw Error('Estructura de planilla incompatible. No se guardó la flecha; solicita revisión al organizador.');
  const registered=slotAllShots(r).length,maximum=f.maxEnds*f.perEnd;
  // Las firmas y disputas válidas JAMÁS se reabren automáticamente.
  if(['validated','disputed'].includes(v.status)||v.archerSignature||v.scorerSignature)
   throw Error('Esta planilla está firmada o en revisión. No se registró ninguna flecha; solicita autorización al organizador.');
  if(registered>=maximum||r.ends.length>=f.maxEnds)
   throw Error(`Planilla completa: ${registered}/${maximum} flechas. Selecciona otro arquero.`);
  if(r.ends.some(end=>!Array.isArray(end)||end.length!==f.perEnd)||r.current.length>f.perEnd)
   throw Error(`Tandas inconsistentes en la nube (${registered}/${maximum} flechas). No se guardó el impacto; revisa la planilla con el organizador.`);
  // Recuperación segura: una interrupción puede dejar una tanda entera sin cerrar.
  if(r.current.length===f.perEnd){r.ends.push(r.current);r.current=[];}
  // Una planilla sin firmas NO puede estar terminada antes de alcanzar su máximo.
  if(r.status==='finished'&&registered<maximum)r.status='active';
  if(r.status!=='active')throw Error(`Estado de planilla no reconocido: ${String(r.status)} (${registered}/${maximum}). No se guardó el impacto.`);
  r.current.push(shot);
  if(r.current.length===f.perEnd){r.ends.push(r.current);r.current=[];if(r.ends.length===f.maxEnds)r.status='finished';}
 });
}
async function correctCompetitionShot(shot){
 const chosen=view.editShot,slot=selectedCompetitionSlot();
 if(!chosen||chosen.scope!=='competition'||!slot||chosen.number!==slot.number)return;
 const ok=await changeEvent(ev=>{
  if(!canEditRecordedShot(ev,slot.number))throw Error('La planilla está firmada o bloqueada; solicita una revisión autorizada.');
  const r=ensureSlotResult(ev,slot.number),prior=getRecordedShot(r,chosen.endIndex,chosen.shotIndex);
  if(!sameRecordedShot(prior,chosen.original))throw Error('La flecha cambió en otro teléfono. Selecciónala de nuevo antes de corregir.');
  const row=chosen.endIndex<r.ends.length?r.ends[chosen.endIndex]:r.current;
  row[chosen.shotIndex]=shot;
  // Una conformidad provisional ya no sirve si cambian los puntos. Firmas no se tocan.
  if(currentApproval(r).decision)resetApproval(r);
 });
 if(ok){view.editShot=null;render();}
}
async function correctTrainingShot(shot){
 const chosen=view.editShot,s=get();if(!s||chosen?.scope!=='training'||chosen.id!==s.id)return;
 const ok=await mutate(copy=>{
  const prior=getRecordedShot(copy,chosen.endIndex,chosen.shotIndex);
  if(!sameRecordedShot(prior,chosen.original))throw Error('La flecha cambió. Vuelve a seleccionarla.');
  const row=chosen.endIndex<copy.ends.length?copy.ends[chosen.endIndex]:copy.current;
  row[chosen.shotIndex]=shot;
 });
 if(ok){view.editShot=null;render();}
}
function selectedCompetitionSlot(){const ev=events.find(v=>v.id===view.activeEvent);return ev?.draw?.find(d=>d.target===view.activeTarget&&d.position===view.activePosition)}
function eventScorersPanel(ev){
 const targets=eventTargets(ev),running=eventState(ev)==='running',mode=chosenMode(ev),allLocal=targets.every(t=>assignedScorer(ev,t)?.name);
 if(!ev.locked)return `<section class="card gap"><h2>3. Sistema de anotación</h2><div class="notice">Primero debes realizar y confirmar el sorteo A/B/C/D.</div></section>`;
 const choices=!mode?`<section class="card gap"><h2>3. ¿Cómo se anotarán los disparos?</h2><p class="small muted">Elige un sistema antes de asignar anotadores. No se iniciará la competencia todavía.</p><div class="soft gap"><strong>📱 Anotación local</strong><p class="small muted">Registra los anotadores manualmente y utiliza este dispositivo para puntuar.</p><button class="btn primary block" data-action="choose-score-mode" data-value="local">Seleccionar anotación local</button></div><div class="soft gap"><strong>☁ Anotación en red · Firebase</strong><p class="small muted">Publica una sala, conecta los teléfonos por QR y autoriza cada parapeto desde el organizador.</p><button class="btn primary block" data-action="choose-score-mode" data-value="cloud">Seleccionar anotación en red</button></div></section>`:'';
 if(!mode)return choices;
 const header=`<section class="card gap"><div class="row"><h2>3. ${mode==='cloud'?'Anotación en red':'Anotación local'}</h2><span class="pill ${running?'good':'warn'}">${e(eventPhase(ev))}</span></div>${!running&&!ev.cloudRoomId?`<button class="btn ghost" data-action="change-score-mode">← Cambiar sistema de anotación</button>`:''}</section>`;
 if(mode==='cloud')return header+cloudRoomPanel(ev);
 return header+`<section class="card gap"><h3>Asignar responsables por parapeto</h3><p class="small muted">Anotación desde este dispositivo. Un anotador responsable por parapeto.</p>${targets.length?`<div class="sessions">${targets.map(t=>`<div class="entry"><span class="entry-number">${t}</span><div class="gap-xs" style="flex:1"><strong>Parapeto ${t}</strong><small class="muted">${e(assignedScorer(ev,t)?.name||'Sin anotador')}</small></div><span class="pill ${assignedScorer(ev,t)?'good':'warn'}">${assignedScorer(ev,t)?'Asignado':'Pendiente'}</span></div>`).join('')}</div>`:''}${!running?`<form id="scorerForm" class="gap"><div class="field"><label>Parapeto</label><select name="target">${targets.map(t=>`<option value="${t}">Parapeto ${t}</option>`).join('')}</select></div><div class="field"><label>Nombre del anotador</label><input name="name" required maxlength="90"></div><button type="submit" class="btn primary block">Guardar anotador</button></form>`:''}<div class="soft gap"><h3>4. Inicio de la competencia</h3><div class="row"><span class="small">Anotadores asignados</span><strong>${targets.filter(t=>assignedScorer(ev,t)?.name).length}/${targets.length}</strong></div>${running?`<span class="pill good">Competencia iniciada</span><button class="btn primary block" data-action="open-target" data-value="${targets[0]||1}">Abrir anotación local</button>`:`<button class="btn primary block" data-action="start-event" ${!allLocal||!targets.length?'disabled':''}>▶ Iniciar competencia</button><p class="small muted">No se habilitan flechas hasta iniciar.</p>`}</div></section>`;
}
// v0.6.3: cuadros individuales, separados de los impactos de clasificación y sus firmas.
function eliminationCategory(a){return [a.division,a.age,a.level,a.gender].join(' / ');}
function eliminationKey(category){return 'g_'+encodeURIComponent(category).replace(/%/g,'_');}
function eliminationParticipants(ev){
 const groups=new Map();for(const d of ev.draw||[]){const a=eventParticipant(ev,d.number);if(!a)continue;
  const key=eliminationCategory(a),r=slotResult(ev,d.number),hits=slotAllShots(r);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({number:a.number,name:a.name,points:sum(hits),tens:hits.filter(x=>x.score===10).length,nines:hits.filter(x=>x.score===9).length,
    validated:isQualifiedForSeeding(ev,r)});
 }
 return groups;
}
function seedingIsCurrent(ev,g){
 if(!Array.isArray(g.qualification))return false;
 const current=(eliminationParticipants(ev).get(g.category)||[]),a=new Map(current.map(x=>[x.number,x]));
 return current.length===g.qualification.length&&g.qualification.every(x=>a.get(x.number)?.validated&&a.get(x.number).points===x.points);
}
function eliminationName(ev,number){return number?eventParticipant(ev,number)?.name||`#${number}`:'Por definir';}
function eliminationGroupForView(ev){const groups=ev.eliminations?.groups||{};const keys=Object.keys(groups);if(!keys.length)return null;
 if(!keys.includes(view.elimGroup))view.elimGroup=keys[0];return groups[view.elimGroup];}
function eliminationMatchTile(ev,g,m){const eng=window.WA_ELIM,r=m.id==='BRONZE'?eng.result(m,g.mode):eng.matchResult(g,m),selected=view.elimMatch===m.id;
 const label=m.id==='BRONZE'?'Bronce':m.round===Math.log2(g.size)-1?'Final oro':m.round===Math.log2(g.size)-2?'Semifinal':m.round===0?`Primera ronda · ${m.index+1}`:`Ronda ${m.round+1} · ${m.index+1}`;
 return `<button class="elim-match ${selected?'selected':''}" type="button" data-action="elim-select-match" data-value="${e(m.id)}"><span class="small muted">${e(label)}</span><span>${m.a?'#'+m.a+' '+e(eliminationName(ev,m.a)):'—'} <strong>${r.a??''}</strong></span><span>${m.b?'#'+m.b+' '+e(eliminationName(ev,m.b)):'—'} <strong>${r.b??''}</strong></span><small class="${r.winner?'elim-winner':'muted'}">${r.bye?'Pase libre':r.winner?'Ganador: '+e(eliminationName(ev,r.winner)):r.needShootOff?'Pendiente de desempate':'Pendiente'}</small></button>`;
}
function eliminationMatchEditor(ev,g,m){if(!m)return '';
 const r=m.id==='BRONZE'?window.WA_ELIM.result(m,g.mode):window.WA_ELIM.matchResult(g,m),canEdit=!!m.a&&!!m.b;
 if(!canEdit)return `<section class="soft gap"><h3>${e(m.id)}</h3><p class="small muted">Este enfrentamiento todavía no tiene dos arqueros. Los pases libres avanzan automáticamente.</p></section>`;
 const decidedAt=(()=>{let pa=0,pb=0;for(let i=0;i<(m.ends||[]).length;i++){const x=m.ends[i];pa+=x.a>x.b?2:x.a===x.b?1:0;pb+=x.b>x.a?2:x.a===x.b?1:0;if(g.mode==='sets'&&(pa>=6||pb>=6))return i;}return -1;})();
 const remoteActive=ev.cloudRoomId&&cloudState.tasks.some(t=>t.groupKey===view.elimGroup&&t.matchId===m.id&&t.status==='active');
 const cells=Array.from({length:5},(_,i)=>{const row=m.ends[i],blocked=decidedAt>=0&&i>decidedAt;return `<div class="elim-score-row" data-set-row="${i}" ${blocked?'hidden':''}><strong>${g.mode==='sets'?'Set':'Tanda'} ${i+1}</strong><input inputmode="numeric" name="a${i}" type="number" min="0" max="30" value="${row?.a??''}" ${blocked?'disabled':''} placeholder="—" aria-label="${e(eliminationName(ev,m.a))} ${i+1}"><input inputmode="numeric" name="b${i}" type="number" min="0" max="30" value="${row?.b??''}" ${blocked?'disabled':''} placeholder="—" aria-label="${e(eliminationName(ev,m.b))} ${i+1}"></div>`}).join('');
 return remoteActive?`<div class="notice">Este enfrentamiento tiene un anotador remoto activo. Registra las flechas desde ese teléfono y valida el resultado en el panel del organizador.</div>`:`<section class="soft gap"><h3>Anotar enfrentamiento · ${e(m.id)}</h3><p class="small muted">${e(eliminationName(ev,m.a))} vs. ${e(eliminationName(ev,m.b))}. Ingresa el subtotal de 3 flechas por arquero en cada ${g.mode==='sets'?'set':'tanda'} (0–30). ${g.mode==='sets'?'Se necesitan 6 puntos de set para ganar.':'Se suman cinco tandas (15 flechas).'} No se registran las posiciones X/Y de estas flechas en este piloto.</p><form id="eliminationScoreForm" class="gap"><input type="hidden" name="matchId" value="${e(m.id)}"><div class="elim-score-head"><strong>Set / tanda</strong><strong>${e(eliminationName(ev,m.a))}</strong><strong>${e(eliminationName(ev,m.b))}</strong></div>${cells}<div id="elimLiveEnd" class="notice">Un encuentro por sets se termina al alcanzar 6 puntos.</div><div class="field"><label>Desempate de una flecha — decisión oficial del juez</label><select name="shootOff"><option value="">Sin desempate</option><option value="${m.a}" ${m.shootOff===m.a?'selected':''}>Gana ${e(eliminationName(ev,m.a))}</option><option value="${m.b}" ${m.shootOff===m.b?'selected':''}>Gana ${e(eliminationName(ev,m.b))}</option></select><small class="muted">Usar únicamente cuando hay 5–5 en sets o igualdad tras 15 flechas. La cercanía al centro debe ser determinada por el juez.</small></div><button class="btn primary block" type="submit" ${ev.cloudRoomId&&!cloudState.ready?'disabled':''}>Guardar enfrentamiento</button></form><span class="pill ${r.winner?'good':'warn'}">${r.winner?'Ganador: '+e(eliminationName(ev,r.winner)):r.needShootOff?'Requiere flecha de desempate':'Aún no definido'}</span></section>`;
}

// 0.6.3 — Un teléfono puede atender varios encuentros independientes. Cada
// reasignación incrementa la revisión de la tarea, invalidando escrituras antiguas.
function eliminationTaskFor(groupKey,matchId){return cloudState.tasks.find(t=>t.groupKey===groupKey&&t.matchId===matchId);}
function scorerActiveCount(uid,excludingTaskId=''){return cloudState.tasks.filter(t=>t.assigneeUid===uid&&t.status==='active'&&t.id!==excludingTaskId).length;}
function eliminationAssignError(err){
 const message=String(err?.message||err||'Error desconocido');
 if(err?.code==='permission-denied'||/missing or insufficient permissions|permission.denied/i.test(message))
  return 'Firebase rechazó la asignación (permisos). No se asignó el encuentro. Comprueba las reglas publicadas de Firestore contra el archivo REGLAS_FIRESTORE_BASE_0_6_3.txt del paquete; un QR autorizado NO sustituye esta autorización. Si ya coinciden, detén la prueba y revisa la operación con el emulador.';
 return message;
}
function eliminationTaskStatus(task){return window.WA_ELIM.result({a:task.a,b:task.b,ends:task.ends||[],shootOff:task.shootOff||null},task.mode);}
function eliminationTaskRows(task){return (task.ends||[]).map((row,i)=>`<div class="soft gap-xs"><div class="row"><strong>${task.mode==='sets'?'Set':'Tanda'} ${i+1}</strong><strong>${row.a}–${row.b}</strong></div><small class="muted">A: ${e((row.aShots||[]).join(' · '))} | B: ${e((row.bShots||[]).join(' · '))}</small></div>`).join('');}

function eliminationAssignmentsOverview(ev){
 if(!ev.cloudRoomId||cloudState.role!=='organizer')return '';
 const active=cloudState.tasks.filter(t=>t.status==='active'),members=cloudState.members.filter(x=>x.role==='scorer'),busy=active.length;
 return `<section class="card gap"><div class="row"><h3>📱 Gestión de anotadores</h3><span class="pill">${busy} encuentros activos</span></div><p class="small muted">Los teléfonos no quedan ligados a un parapeto fijo. Cada uno admite hasta 3 encuentros activos en este piloto. Al validar uno, ese encuentro se libera; el organizador asigna los siguientes.</p>
 ${members.map(m=>{const mine=active.filter(t=>t.assigneeUid===m.uid);return `<div class="entry"><div class="gap-xs"><strong>${e(m.name)}</strong><small class="muted">${mine.length?mine.map(t=>`Parapeto ${t.target} · ${e(t.matchId)}`).join(' | '):'Sin encuentros activos · disponible'}</small></div><span class="pill ${mine.length?'warn':'good'}">${mine.length}/3 cupos</span></div>`;}).join('')||'<div class="notice">Todavía no se han autorizado teléfonos.</div>'}
 ${members.length>1&&active.length?`<form id="elimTransferAllForm" class="soft gap"><strong>Reasignación de emergencia de todos los encuentros</strong><div class="field"><label>Teléfono que falló</label><select name="oldUid" required><option value="">Seleccionar</option>${members.filter(m=>active.some(t=>t.assigneeUid===m.uid)).map(m=>`<option value="${e(m.uid)}">${e(m.name)}</option>`).join('')}</select></div><div class="field"><label>Nuevo teléfono autorizado</label><select name="newUid" required><option value="">Seleccionar</option>${members.map(m=>`<option value="${e(m.uid)}">${e(m.name)} · ${scorerActiveCount(m.uid)}/3 activos</option>`).join('')}</select></div><button class="btn block" type="submit" ${!cloudState.ready||cloudState.tasksFromCache?'disabled':''}>Transferir todos los encuentros activos</button><p class="small muted">El teléfono averiado pierde todos esos permisos. Cada planilla continúa con sus flechas y sets ya sincronizados.</p></form>`:''}</section>`;
}
function eliminationsRemoteOrganizer(ev,g,m){
 if(!ev?.cloudRoomId||cloudState.role!=='organizer'||!m?.a||!m?.b)return '';
 const key=view.elimGroup,task=eliminationTaskFor(key,m.id),members=cloudState.members.filter(x=>x.role==='scorer'),ownerReady=cloudState.ready&&!cloudState.fromCache&&!cloudState.tasksFromCache;
 const active=task?.status==='active',pending=task?.status==='submitted';const live=task?eliminationTaskStatus(task):null;
 const member=task?members.find(x=>x.uid===task.assigneeUid):null;
 const defaultTarget=task?.target||m.index+1;
 // La asignación obtiene la modalidad por la ronda. El organizador solo asigna teléfono/parapeto.
 const link=cloudRoomURL(ev.cloudRoomId,eventTargets(ev)[0]||1);
 return `<section class="card gap"><h3>📱 Anotador remoto · ${e(m.id)}</h3><p class="small muted">Cada encuentro se anota por separado. Puedes asignar varios encuentros al mismo teléfono y transferirlos si se queda sin batería. El tanteador confirma el resultado al terminar; el organizador ratifica el avance oficial.</p>
 ${task?`<div class="notice ${task.status==='closed'?'success':''}"><strong>${active?'Asignado':pending?'Entregado · por ratificar':'Finalizado'}:</strong> ${e(member?.name||'Teléfono anterior')} · parapeto ${task.target} · revisión ${task.revision}</div>${eliminationVisualScore(task,eliminationName(ev,task.a),eliminationName(ev,task.b))}${live?`<span class="pill ${live.final?'good':'warn'}">${live.final?'Resultado decidido':'En curso'} · ${live.a||0}–${live.b||0}${task.mode==='sets'?' puntos de set':''}</span>`:''}`:'<div class="notice">Aún no hay teléfono asignado a este enfrentamiento.</div>'}
 ${(!task||active)&&!m.winner?`<form id="elimAssignForm" class="gap"><input type="hidden" name="groupKey" value="${e(key)}"><input type="hidden" name="matchId" value="${e(m.id)}"><div class="field"><label>${task?'Reasignar / cambiar parapeto':'Asignar teléfono'}</label><select name="scorerUid" required><option value="">Selecciona teléfono autorizado</option>${members.map(x=>{const count=scorerActiveCount(x.uid,task?.id||'');return `<option value="${e(x.uid)}" ${x.uid===task?.assigneeUid?'selected':''} ${count>=3?'disabled':''}>${e(x.name)} · ${count}/3 activos${count>=3?' · SIN CUPO':''}</option>`;}).join('')}</select></div><div class="field"><label>Número de parapeto para este encuentro</label><input name="target" type="number" inputmode="numeric" min="1" max="500" value="${defaultTarget}" required></div>
 ${task?'<small class="muted">Se conserva el estado y el orden de tiro que ya tenga este encuentro.</small>':'<small class="muted">El orden de tiro lo configura WA Scoring automáticamente según la fase. Cuando corresponda, el tanteador preguntará quién inicia antes de registrar flechas.</small>'}
 <button class="btn primary block" type="submit" ${!ownerReady||!members.length?'disabled':''}>${task?'Transferir asignación':'Asignar encuentro'}</button></form>`:''}
 ${active||pending?`<div class="soft gap"><h3>Validar encuentro remoto</h3><p class="small muted">Comprueba las flechas y puntajes con los arqueros. Después de confirmar se libera solo este encuentro; el teléfono conserva los demás.</p><form id="elimCloseForm" class="gap"><input type="hidden" name="taskId" value="${e(task.id)}">${live?.needShootOff?`<div class="field"><label>Desempate de una flecha decidido por el juez</label><select name="shootOff" required><option value="">Selecciona ganador</option><option value="${task.a}">${e(eliminationName(ev,task.a))}</option><option value="${task.b}">${e(eliminationName(ev,task.b))}</option></select></div>`:''}<button class="btn primary block" type="submit" ${!ownerReady||(!live?.final&&!live?.needShootOff)?'disabled':''}>✓ Validar resultado y liberar encuentro</button></form></div>`:''}
 ${members.length?'':`<div class="notice">No hay teléfonos autorizados. Abre el QR de ingreso general, conecta y aprueba los dispositivos antes de asignarlos.</div>`}
 <div class="soft gap"><strong>Conectar otro teléfono</strong><small class="muted">Usa el QR existente de clasificación solo para autorizar el dispositivo. Después asígnale aquí el encuentro; no necesitas crear otra sala.</small><div class="qr-box">${window.WA_QR_SVG?window.WA_QR_SVG(link):''}</div><button class="btn small" data-action="elim-copy-join" data-value="${e(link)}">Copiar enlace de ingreso</button></div></section>`;
}

// Tarjeta común para anotador y espectador: mismos sets, misma puntuación del servidor.
function elimArrowTotal(shots){return (shots||[]).reduce((total,v)=>total+(String(v)==='X'?10:String(v)==='M'?0:Number(v)||0),0)}
function elimShotChips(shots){return [0,1,2].map(i=>`<span class="elim-arrow-chip ${i<shots.length?'filled':''}">${e(shots[i]??'–')}</span>`).join('')}
function eliminationShootingOrder(task){
 if((task.shootingMode||'simultaneous')!=='alternating')return {mode:'simultaneous'};
 const initial=task.firstSide;if(!['a','b'].includes(initial))return {mode:'unconfirmed'};
 let pointsA=0,pointsB=0;
 for(const s of task.ends||[]){if(task.mode==='sets'){pointsA+=s.a>s.b?2:s.a===s.b?1:0;pointsB+=s.b>s.a?2:s.a===s.b?1:0;}else{pointsA+=s.a;pointsB+=s.b;}}
 const start=pointsA===pointsB?initial:pointsA<pointsB?'a':'b';
 const current=task.current||{},a=(current.aShots||[]).length,b=(current.bShots||[]).length;
 const next=a===b?start:a>b?'b':'a';
 const valid=(a===b)||(start==='a'&&a===b+1)||(start==='b'&&b===a+1);
 return {mode:'alternating',start,next,valid};
}
function eliminationShootingInfo(task,aName,bName){
 const order=eliminationShootingOrder(task),name=side=>side==='a'?aName:bName;
 if(order.mode==='simultaneous')return '<div class="elim-shoot-info">🏹 Tiro simultáneo · ambos arqueros disparan en la misma tanda.</div>';
 if(order.mode==='unconfirmed')return '<div class="elim-shoot-info">Orden alternado pendiente de confirmar por el tanteador.</div>';
 const startName=e(name(order.start)),nextName=e(name(order.next));
 return `<div class="elim-shoot-info"><strong>🏹 Comienza este ${task.mode==='sets'?'set':'tanda'}: ${startName}</strong><small>Orden alternado · primero dispara ${startName}.</small>${(task.current?.aShots?.length||task.current?.bShots?.length)?`<small>${order.valid?'Siguiente flecha: '+nextName:'Revisar el orden de flechas registradas con el juez o anotador'}</small>`:''}</div>`;
}
function eliminationCurrentArrows(task,aName,bName){
 const current=task.current||{},aShots=current.aShots||[],bShots=current.bShots||[];
 if((task.ends||[]).length>=5)return '';
 return `<div class="elim-current elim-scorer-current"><div class="elim-current-cols"><div><span>${e(aName)}</span><div class="elim-three">${elimShotChips(aShots)}</div><strong>${aShots.length}/3 · ${elimArrowTotal(aShots)} pts</strong></div><div><span>${e(bName)}</span><div class="elim-three">${elimShotChips(bShots)}</div><strong>${bShots.length}/3 · ${elimArrowTotal(bShots)} pts</strong></div></div></div>`;
}
function eliminationFirstSidePrompt(task,aName,bName,readOnly){
 if((task.shootingMode||'simultaneous')!=='alternating'||task.status!=='active'||(task.ends||[]).length||
    (task.current?.aShots||[]).length||(task.current?.bShots||[]).length)return '';
 const owner=task.choiceOwnerSide,firstChoice=owner==='a'?aName:owner==='b'?bName:null;
 const question=firstChoice
   ?`<strong>Antes de comenzar, pregunta a ${e(firstChoice)}:</strong><p>«Por tu posición en la clasificación, puedes elegir quién dispara primero. ¿Prefieres comenzar tú o que comience tu rival?»</p>`
   :`<strong>Antes de comenzar:</strong><p>Confirma con el juez qué arquero tiene mejor clasificación y pregúntale si prefiere disparar primero o segundo.</p>`;
 return `<div class="elim-choice-help"><div class="elim-choice-heading">🏹 ¿Quién dispara primero?</div>${question}<small>Registra la respuesta de la persona que tiene derecho a elegir. Esta elección fija el orden del primer set y de los desempates.</small><div class="elim-first-buttons"><button class="btn ${task.firstSide==='a'?'primary':''}" data-action="elim-remote-first-side" data-value="${e(task.id)}|a" ${readOnly?'disabled':''}>Comienza ${e(aName)}</button><button class="btn ${task.firstSide==='b'?'primary':''}" data-action="elim-remote-first-side" data-value="${e(task.id)}|b" ${readOnly?'disabled':''}>Comienza ${e(bName)}</button></div>${task.firstSide?`<small class="muted">Elección registrada: ${e(task.firstSide==='a'?aName:bName)}. Puedes corregirla antes de la primera flecha.</small>`:'<small class="muted">No se habilitan los puntos hasta confirmar la elección.</small>'}</div>`;
}
function eliminationScorerShootingInfo(task,aName,bName){
 const order=eliminationShootingOrder(task);
 if(order.mode!=='alternating')return '';
 const aCount=(task.current?.aShots||[]).length,bCount=(task.current?.bShots||[]).length;
 if(!order.valid)return '<div class="elim-shoot-info elim-shoot-info-compact"><strong>⚠ Revisar orden de flechas con el juez</strong></div>';
 const first=aCount+bCount===0,label=first?'Comienza este set':'Siguiente flecha';
 const chosen=first?order.start:order.next;
 return `<div class="elim-shoot-info elim-shoot-info-compact"><strong>🏹 ${label}: ${e(chosen==='a'?aName:bName)}</strong></div>`;
}
function eliminationSetHistory(task,aName,bName){
 const sets=task.ends||[];
 if(!sets.length)return '';
 const lines=sets.map((set,i)=>{
  const winner=task.mode==='sets'?(set.a===set.b?'Empate':`Ganó ${e(set.a>set.b?aName:bName)}`):'Tanda completada';
  return `<div class="elim-set-line"><span class="elim-set-label">${task.mode==='sets'?'Set':'Tanda'} ${i+1}</span><strong>${e(set.a)}–${e(set.b)}</strong><span class="elim-set-winner">${winner}</span><small>${e((set.aShots||[]).join(' · '))} / ${e((set.bShots||[]).join(' · '))}</small></div>`;
 }).join('');
 return `<section class="elim-history-below"><strong>${task.mode==='sets'?'Historial de sets':'Tandas registradas'} (${sets.length})</strong><div class="elim-history">${lines}</div></section>`;
}
function eliminationVisualScore(task,aName,bName,options={}){
 const result=eliminationTaskStatus(task),sets=task.ends||[],current=task.current||{aShots:[],bShots:[]},inProgress=(current.aShots||[]).length+(current.bShots||[]).length>0;
 let pa=0,pb=0;
 const history=sets.map((set,i)=>{let winner='';if(task.mode==='sets'){
   const ap=set.a>set.b?2:set.a===set.b?1:0,bp=set.b>set.a?2:set.a===set.b?1:0;pa+=ap;pb+=bp;
   winner=ap===bp?'Set empatado':ap>bp?`Ganó ${e(aName)}`:`Ganó ${e(bName)}`;
  } else {pa+=set.a;pb+=set.b;winner='Tanda completada';}
  return `<div class="elim-set-line"><span class="elim-set-label">${task.mode==='sets'?'Set':'Tanda'} ${i+1}</span><strong>${e(set.a)}–${e(set.b)}</strong><span class="elim-set-winner">${winner}</span><small>${e((set.aShots||[]).join(' · '))} / ${e((set.bShots||[]).join(' · '))}</small></div>`;
 }).join('');
 const currentNum=Math.min(5,sets.length+1),aShots=current.aShots||[],bShots=current.bShots||[],aPartial=elimArrowTotal(aShots),bPartial=elimArrowTotal(bShots);
 const liveStatus=result.final?(task.status==='closed'?'✓ Encuentro validado':task.status==='submitted'?'✓ Confirmado por tanteador · pendiente del organizador':`Encuentro decidido · pendiente de validación`):result.needShootOff?'Empate final · desempate por una flecha':inProgress?(aPartial===bPartial?'Set actual empatado provisionalmente':`Lidera provisionalmente ${e(aPartial>bPartial?aName:bName)}`):sets.length?`Último set: ${sets.at(-1).a>sets.at(-1).b?e(aName):sets.at(-1).a<sets.at(-1).b?e(bName):'empate'}`:'Esperando primeras flechas';
 const label=task.mode==='sets'?'PUNTOS DE SET':'PUNTOS ACUMULADOS';
 // En pantalla de anotador, el marcador se mantiene compacto y de altura fija.
 // Flechas actuales y orden pasan al área de registro; historial DESPUÉS del teclado.
 if(options.compact)return `<div class="elim-board elim-board-compact"><div class="elim-board-label">${label}</div><div class="elim-versus"><div class="elim-side ${result.a>result.b?'leader':''}"><span class="elim-person">${e(aName)}</span><strong>${result.a??0}</strong></div><span class="elim-dash">–</span><div class="elim-side ${result.b>result.a?'leader':''}"><strong>${result.b??0}</strong><span class="elim-person">${e(bName)}</span></div></div></div>`;
 return `<div class="elim-board"><div class="elim-board-label">${label}</div><div class="elim-versus"><div class="elim-side ${result.a>result.b?'leader':''}"><span class="elim-person">${e(aName)}</span><strong>${result.a??0}</strong></div><span class="elim-dash">–</span><div class="elim-side ${result.b>result.a?'leader':''}"><strong>${result.b??0}</strong><span class="elim-person">${e(bName)}</span></div></div>
 <div class="elim-state ${result.final?'is-decided':''}" aria-live="polite">${liveStatus}</div>
 ${!result.final&&!result.needShootOff&&sets.length<5?`<div class="elim-current"><div class="row"><strong>${task.mode==='sets'?'Set':'Tanda'} ${currentNum} en juego</strong><small class="muted">${aShots.length}/3 · ${bShots.length}/3 flechas</small></div><div class="elim-current-cols"><div><span>${e(aName)}</span><div class="elim-three">${elimShotChips(aShots)}</div><strong>Parcial: ${aPartial}</strong></div><div><span>${e(bName)}</span><div class="elim-three">${elimShotChips(bShots)}</div><strong>Parcial: ${bPartial}</strong></div></div></div>`:''}
 ${!result.final?eliminationShootingInfo(task,aName,bName):""}
  ${sets.length?`<div class="elim-history"><strong>${task.mode==='sets'?'Resultados de cada set':'Tandas registradas'}</strong>${history}</div>`:''}</div>`;
}
function eliminationRemotePage(){
 if(cloudState.role!=='scorer')return '<section class="card">Solo los teléfonos anotadores autorizados pueden usar este panel.</section>';
 const ev=events.find(x=>x.id===view.activeEvent),tasks=cloudState.tasks.filter(t=>['active','submitted'].includes(t.status)),active=tasks.find(t=>t.id===view.elimTaskId)||tasks.find(t=>t.status==='active')||tasks[0];
 if(active)view.elimTaskId=active.id;
 let contents='';if(active){
  const state=eliminationTaskStatus(active),readOnly=!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache||view.busy;
  const playerA=ev?eliminationName(ev,active.a):`#${active.a}`,playerB=ev?eliminationName(ev,active.b):`#${active.b}`;
  const partial=active.current||{aShots:[],bShots:[]},aShots=partial.aShots||[],bShots=partial.bShots||[],hasStartingChoice=(active.shootingMode||'simultaneous')!=='alternating'||['a','b'].includes(active.firstSide),canShoot=active.status==='active'&&!readOnly&&!state.final&&!state.needShootOff&&(active.ends||[]).length<5&&hasStartingChoice;
  const recommended=eliminationShootingOrder(active);const shootNext=recommended.mode==='alternating'&&recommended.valid?recommended.next:null;
   const chosen=shootNext&&((shootNext==='a'?aShots:bShots).length<3)?shootNext:(view.elimSide==='b'&&bShots.length<3||aShots.length>=3&&bShots.length<3)?'b':'a';
  const allowed=chosen==='a'?aShots.length<3:bShots.length<3;
  const correctAllowed=(chosen==='a'?aShots:bShots).length>0||(!aShots.length&&!bShots.length&&(active.ends||[]).length>0);
  contents=`<section class="card gap"><div class="row"><h3>Parapeto ${active.target} · ${e(active.matchId)}</h3><span class="pill ${canShoot?'good':'warn'}">${canShoot?'En juego':active.status==='submitted'?'Entregado':state.final?'Decidido':'En espera'}</span></div>
  ${eliminationVisualScore(active,playerA,playerB,{compact:true})}
  ${eliminationFirstSidePrompt(active,playerA,playerB,readOnly)}
  ${canShoot?`<div class="elim-keypad-panel">${eliminationScorerShootingInfo(active,playerA,playerB)}${eliminationCurrentArrows(active,playerA,playerB)}<strong>¿A quién registrarás la siguiente flecha?</strong><div class="elim-pick"><button class="elim-pick-side ${chosen==='a'?'selected':''}" data-action="elim-remote-side" data-value="a" ${aShots.length>=3?'disabled':''}><span>${e(playerA)}</span><small>${aShots.length}/3 flechas</small></button><button class="elim-pick-side ${chosen==='b'?'selected':''}" data-action="elim-remote-side" data-value="b" ${bShots.length>=3?'disabled':''}><span>${e(playerB)}</span><small>${bShots.length}/3 flechas</small></button></div>
  <div class="elim-keypad-title">Flecha ${(chosen==='a'?aShots:bShots).length+1} · ${e(chosen==='a'?playerA:playerB)}</div>
  <div class="elim-arrow-buttons">${['X','10','9','8','7','6','5','4','3','2','1','M'].map(score=>`<button class="btn" data-action="elim-remote-arrow" data-value="${e(active.id)}|${chosen}|${score}" ${!canShoot||!allowed?'disabled':''}>${score}</button>`).join('')}</div><button class="btn block" data-action="elim-remote-correct" data-value="${e(active.id)}|${chosen}" ${!canShoot||!correctAllowed?'disabled':''}>↶ Corregir última flecha de ${e(chosen==='a'?playerA:playerB)}</button></div>`:
  `<div class="notice ${state.final?'success':''}">${active.status==='submitted'?'✓ Resultado confirmado por el tanteador y enviado al organizador. El encuentro ya está liberado.':state.final?'Encuentro decidido. Revisa y confirma el resultado para liberar el encuentro.':!hasStartingChoice?'Confirma la elección de quién inicia antes de registrar flechas.':'El desempate debe resolverlo el juez.'}</div>
   ${active.status==='active'&&(state.final||state.needShootOff)?`<form id="elimScorerConfirmForm" class="soft gap"><input type="hidden" name="taskId" value="${e(active.id)}"><strong>Confirmación del tanteador</strong><p class="small muted">Revisa los sets y flechas con ambos arqueros. Tras confirmar, no se podrán corregir nuevas flechas desde este teléfono; el organizador ratificará el resultado oficial.</p>${state.needShootOff?`<div class="field"><label>Ganador del desempate, según decisión del juez</label><select name="shootOff" required><option value="">Seleccionar</option><option value="${active.a}">${e(playerA)}</option><option value="${active.b}">${e(playerB)}</option></select></div>`:''}<button class="btn primary block" type="submit" ${readOnly?'disabled':''}>✓ Confirmar resultado y liberar encuentro</button></form>`:''}` }
  ${eliminationSetHistory(active,playerA,playerB)}
  <p class="small muted">Cada toque se sincroniza en Firebase. Si un teléfono falla, el organizador puede transferir este encuentro sin borrar lo guardado. Sin internet no se anotan flechas.</p></section>`;
 }
 return `<section class="card gap"><div class="row"><h2>Eliminatorias · Anotador</h2><span class="pill ${cloudState.ready&&!cloudState.tasksFromCache?'good':'warn'}">${cloudState.ready&&!cloudState.tasksFromCache?'En línea':'Sin sincronizar'}</span></div><p class="small muted">Elige el enfrentamiento. Un mismo teléfono puede tener varios parapetos.</p><div class="sessions">${tasks.map(t=>`<button class="session ${active?.id===t.id?'selected':''}" data-action="elim-remote-select" data-value="${e(t.id)}"><strong>${e(eliminationName(ev,t.a))} vs. ${e(eliminationName(ev,t.b))}</strong><small class="muted">${e(t.matchId)} · Parapeto ${t.target} · ${t.status==='submitted'?'Resultado entregado':(t.ends||[]).length+' tandas'}</small></button>`).join('')||'<div class="notice">No tienes enfrentamientos asignados. Espera la asignación del organizador.</div>'}</div><button class="btn block" data-action="elim-to-classification">Volver a clasificación</button></section>${contents}`;
}

function eliminationsPanel(ev){if(eventState(ev)!=='running')return `<section class="card gap"><h2>5. Eliminatorias</h2><p>Primero inicia la ronda clasificatoria.</p></section>`;
 if(ev.cloudRole==='scorer')return `<section class="card gap"><h2>5. Eliminatorias</h2><p>La gestión de llaves está reservada al organizador.</p></section>`;
 const groups=eliminationParticipants(ev),existing=ev.eliminations?.groups||{},g=eliminationGroupForView(ev);
 const create=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([category,players])=>{const key=eliminationKey(category),done=players.filter(x=>x.validated).length,all=done===players.length,has=!!existing[key],ranked=[...players].sort((a,b)=>b.points-a.points||b.tens-a.tens||b.nines-a.nines||a.number-b.number),tie=ranked.some((p,i)=>i&&p.points===ranked[i-1].points),defaultSize=players.length>16?32:players.length>8?16:8;
 return `<div class="soft gap"><div class="row"><strong>${e(category)}</strong><span class="pill ${all?'good':'warn'}">${done}/${players.length} ${ev.testMode?'listas para prueba':'validadas'}</span></div>${has?`<button class="btn block" data-action="elim-select-group" data-value="${e(key)}">Ver llave guardada</button>`:players.length<2?'<small class="muted">Se requieren al menos 2 arqueros.</small>':`<form class="elim-create-form gap" data-category="${e(category)}"><div class="field"><label>Tamaño de llave</label><select name="size">${[8,16,32].map(n=>`<option value="${n}" ${n===defaultSize?'selected':''}>Llave de ${n}</option>`).join('')}</select></div><p class="small muted">Sembrado según la clasificación validada. ${players.length>32?'Máximo 32 plazas; solo avanzan los primeros 32.':''}</p>${tie?`<div class="notice">Hay puntuaciones empatadas. El juez debe confirmar el orden oficial antes de generar la llave.</div><div class="field"><label>Orden oficial de inscripción (separar por coma)</label><input name="officialOrder" value="${ranked.map(p=>p.number).join(', ')}" required><small class="muted">Solo se permite cambiar el orden entre quienes tienen idéntico puntaje total. Revisa los criterios WA para desempate y corte.</small></div><label class="checkrow"><input type="checkbox" name="confirmed" required>El juez / organizador confirmó los empates y el orden oficial</label>`:''}<button type="submit" class="btn primary block" ${!all?'disabled':''}>Generar llave</button></form>`}</div>`}).join('');
 let display='';if(g){const rounds=[...new Set(g.matches.map(m=>m.round))],selected=[...g.matches,g.bronze].find(x=>x.id===view.elimMatch)||g.matches.find(x=>x.a&&x.b)||g.matches[0];
 const pod=window.WA_ELIM.podium(g);display=`${seedingIsCurrent(ev,g)?'':'<div class="notice">⚠ La clasificación cambió desde que se generó la llave. No guardes más enfrentamientos hasta que el juez revise el sembrado.</div>'}<section class="card gap"><div class="row"><h2>Llave: ${e(g.category)}</h2><span class="pill good">${g.size} plazas</span></div><p class="small muted">${g.mode==='sets'?'Barebow / Recurvo: mejor de cinco sets':'Compuesto: cinco tandas acumulativas'}. Los pases libres se calculan automáticamente.</p><div class="elim-rounds">${rounds.map((r,i)=>`<section class="elim-round"><h3>${r===rounds.length-1?'Final oro':r===rounds.length-2?'Semifinales':`Ronda ${i+1}`}</h3>${g.matches.filter(m=>m.round===r).map(m=>eliminationMatchTile(ev,g,m)).join('')}</section>`).join('')}<section class="elim-round"><h3>Final bronce</h3>${eliminationMatchTile(ev,g,g.bronze)}</section></div>${eliminationMatchEditor(ev,g,selected)}${eliminationsRemoteOrganizer(ev,g,selected)}</section><section class="card gap"><h2>Podio</h2>${[['🥇 Oro',pod.gold],['🥈 Plata',pod.silver],['🥉 Bronce',pod.bronze]].map(([label,number])=>`<div class="entry"><strong>${label}</strong><span>${number?e(eliminationName(ev,number)):'Por definir'}</span></div>`).join('')}<span class="pill ${pod.complete?'good':'warn'}">${pod.complete?'Finales registradas':'Pendiente de completar'}</span></section>`;}
 return `<section class="card gap"><h2>5. Eliminatorias individuales · Piloto 0.6.4.5</h2><p class="small muted">Solo se generan llaves con las planillas validadas; en competencias marcadas [PRUEBA] también se admiten planillas simuladas sin firmas. Elige tamaño 8, 16 o 32; si quedan plazas sin arquero habrá pases libres. No modificamos las puntuaciones clasificatorias.</p><div class="sessions">${create}</div></section>${eliminationAssignmentsOverview(ev)}${Object.keys(existing).length?`<section class="card gap"><h3>Llaves existentes</h3><div class="btn-row">${Object.entries(existing).map(([key,group])=>`<button class="btn ${key===view.elimGroup?'primary':''}" data-action="elim-select-group" data-value="${e(key)}">${e(group.category)}</button>`).join('')}</div></section>`:''}${display}`;
}
async function saveEliminationGroup(ev,key,group){if(view.busy)return;view.busy=true;
 try{if(!seedingIsCurrent(ev,group))throw Error('La clasificación fue modificada. Debes revisar los resultados y sembrado antes de continuar.');if(ev.cloudRoomId){if(ev.cloudRole!=='organizer'||cloudState.roomId!==ev.cloudRoomId||!cloudState.ready||cloudState.fromCache)throw Error('Para guardar llaves Firebase debes estar conectado como organizador.');
  const prior=cloudState.brackets?.[key],saved=await cloudState.api.saveElimination(ev.cloudRoomId,key,group,prior?.revision??-1);
  cloudState.brackets={...(cloudState.brackets||{}),[key]:saved};group=saved;
 }
 const copy=structuredClone(events.find(x=>x.id===ev.id));copy.eliminations ||= {groups:{}};copy.eliminations.groups[key]=group;await persistEvent(copy);
 view.elimGroup=key;view.busy=false;alertMsg('Llave y enfrentamientos guardados'+(ev.cloudRoomId?' en Firebase.':' en este dispositivo.'));
 }catch(err){view.busy=false;alertMsg('No se pudo guardar la eliminatoria: '+err.message,true);}
}

function eventResultsPanel(ev){if(eventState(ev)!=='running')return '<section class="card gap"><h2>Clasificación provisional</h2><p class="small muted">Aparecerá cuando inicies la competencia y comiences a anotar las flechas.</p></section>';
 const demoSlots=testEligibleSlots(ev);const demoBlockedReason=Object.keys(ev.eliminations?.groups||{}).length?'Ya existe una llave: simulación bloqueada.':!ev.draw?.length?'Primero debes realizar el sorteo.':eventState(ev)!=='running'?'Primero debes iniciar la competencia.':demoSlots.length===0?'No hay planillas vacías pendientes; las planillas anotadas no se pueden reemplazar.':'Pulsa una vez y confirma para pasar a eliminatorias.';const demoPanel=ev.testMode&&ev.cloudRole!=='scorer'?`<section class="card gap demo-qualifier"><div class="row"><h3>🧪 Acceso rápido a eliminatorias</h3><span class="pill warn">SOLO PRUEBAS</span></div><p class="small muted">Genera la clasificación completa de los arqueros con planilla vacía. No altera flechas ni firmas existentes. Usa puntuaciones simuladas y SIN firmas. Las llaves se habilitarán en la pestaña 5.</p><button class="btn primary block" data-action="simulate-qualification" ${!demoSlots.length||view.busy||Object.keys(ev.eliminations?.groups||{}).length?'disabled':''}>⚡ Simular clasificación de ${demoSlots.length} arqueros</button><p class="small muted">${demoBlockedReason} Nunca usar en un torneo real.</p></section>`:'';
 const participants=(ev.draw||[]).filter(d=>ev.cloudRole!=='scorer'||!ev.cloudRoomId||d.target===ev.cloudTarget).map(d=>{const a=eventParticipant(ev,d.number);const r=slotResult(ev,d.number);return {...d,archer:a,points:sum((r.ends||[]).flat().concat(r.current||[])),arrows:(r.ends||[]).flat().length+(r.current||[]).length,done:r.status==='finished'}}).filter(x=>x.archer);const cats=[...new Set(participants.map(x=>[x.archer.division,x.archer.age,x.archer.level,x.archer.gender].join(' / ')))].sort();const shown=participants.filter(x=>view.categoryFilter==='all'||[x.archer.division,x.archer.age,x.archer.level,x.archer.gender].join(' / ')===view.categoryFilter).sort((a,b)=>b.points-a.points||b.arrows-a.arrows||a.number-b.number);return `${demoPanel}<section class="card gap"><h2>Clasificación provisional · ronda clasificatoria</h2><p class="small muted">La clasificación se calcula con los registros guardados en este dispositivo. Cuando los arqueros llevan distintas cantidades de flechas, la posición NO es definitiva. Empates y validación oficial pendientes.</p><div class="field"><label for="categoryFilter">Filtrar categoría</label><select id="categoryFilter"><option value="all">Todas las categorías</option>${cats.map(c=>`<option value="${e(c)}" ${view.categoryFilter===c?'selected':''}>${e(c)}</option>`).join('')}</select></div>${shown.length?shown.map((a,i)=>`<button class="session" data-action="open-result" data-value="${a.target}:${a.position}"><div class="row"><strong>${i+1}. ${e(a.archer.name)}</strong><strong>${a.points} pts</strong></div><div class="row"><span class="small muted">#${a.number} · Parapeto ${a.target}${a.position} · ${e(a.archer.division)}</span><span class="pill ${a.done?'good':'warn'}">${a.arrows}/${fmt(ev).maxEnds*fmt(ev).perEnd} · ${approvalPill(slotResult(ev,a.number))}</span></div></button>${a.done&&currentApproval(slotResult(ev,a.number)).status==='validated'&&ev.cloudRole!=='scorer'?`<button class="btn block" data-action="export-individual" data-value="${a.number}">↓ Compartir estadísticas de ${e(a.archer.name)}</button>`:''}`).join(''):'<div class="empty"><strong>Sin resultados</strong></div>'}<div class="notice">Estos resultados siguen siendo provisionales. Las firmas locales no sustituyen la revisión de empates ni la publicación oficial. Abre un arquero validado para imprimir su planilla.</div></section>`}
function eventScorePage(){const ev=events.find(x=>x.id===view.activeEvent);if(!ev||eventState(ev)!=='running')return competition();const targets=ev.cloudRoomId&&ev.cloudRole==='scorer'?[ev.cloudTarget]:eventTargets(ev);if(!targets.includes(view.activeTarget))view.activeTarget=targets[0]||1;const assigned=ev.draw.filter(x=>x.target===view.activeTarget),slot=assigned.find(x=>x.position===view.activePosition);if(!slot&&assigned.length)view.activePosition=assigned[0].position;const current=assigned.find(x=>x.position===view.activePosition);if(!current)return `<section class="card gap">Este parapeto no tiene arqueros.</section>`;const s=scoreForSlot(ev,current),f=fmt(s),done=s.status==='finished',n=archersLength(s),scorer=assignedScorer(ev,view.activeTarget);return `<section class="card gap">${ev.cloudRoomId&&!cloudState.ready?`<div class="notice">Esperando sincronización confirmada. No registres flechas todavía. ${e(cloudState.error)}</div>`:''}<div class="row start"><div class="gap-xs"><div class="eyebrow">COMPETENCIA · ${ev.cloudRoomId?'SINCRONIZACIÓN FIREBASE':'REGISTRO LOCAL'}</div><h2>${e(ev.name)}</h2><small class="muted">Parapeto ${view.activeTarget} · Anotador: ${e(scorer?.name||'Sin asignar')}</small></div><span class="pill good">En curso</span></div><div class="btn-row">${ev.cloudRole==='scorer'?'':`<button class="btn" data-action="back-event">← Organizador</button>`}<button class="btn" data-action="event-results">Resultados</button>${ev.cloudRole==='scorer'?'<button class="btn primary" data-action="elim-remote-open">🏹 Anotar eliminatorias</button>':''}</div><div class="field"><label for="targetSelect">Cambiar parapeto</label><select id="targetSelect">${targets.map(t=>`<option value="${t}" ${t===view.activeTarget?'selected':''}>Parapeto ${t} · ${e(assignedScorer(ev,t)?.name||'Sin anotador')}</option>`).join('')}</select></div><p class="small muted">Elige el arquero A/B/C/D antes de tocar la diana. ${ev.cloudRoomId?'Las flechas se confirman en Firebase antes de mostrarse como guardadas.':'Este evento se guarda solo en este teléfono.'}</p><div class="archer-tabs">${assigned.sort((a,b)=>a.position.localeCompare(b.position)).map(d=>{const a=eventParticipant(ev,d.number),r=scoreForSlot(ev,d);return `<button class="archer-tab ${d.position===view.activePosition?'active':''}" data-action="select-position" data-value="${d.position}" aria-pressed="${d.position===view.activePosition}"><strong>${d.position}</strong><span>${e(a?.name||'Vacante')}</span><small>${total(r)} pts · ${archersLength(r)}/${f.maxEnds*f.perEnd}</small><small>${approvalPill(slotResult(ev,d.number))}</small></button>`}).join('')}</div></section><section class="card gap"><div class="row"><div><div class="eyebrow">POSICIÓN ${current.position} · #${current.number}</div><h2>${e(s.archerName)}</h2></div><span class="pill ${done?'good':'warn'}">${done?'Completo':`Tanda ${Math.min(s.ends.length+1,f.maxEnds)}/${f.maxEnds}`}</span></div>${done?`<button class="btn primary block" data-action="scroll-validation">${currentApproval(slotResult(ev,current.number)).status==='validated'?'✓ Ver planilla validada':'✍ Revisar y firmar planilla'}</button>`:''}${metrics(shots(s))}<div class="row"><span class="small muted">${n}/${f.maxEnds*f.perEnd} flechas</span><span class="small muted">${e(f.distance)} · ${f.faceCm} cm</span></div></section><section class="card gap"><div class="row"><h2>Diana</h2><span class="pill">${done?'Terminada':`${s.current.length}/${f.perEnd} flechas de la tanda`}</span></div>${correctionSelection(s,'competition',current.number)?`<div class="shot-edit-banner"><strong>Corrigiendo ${e(current.position)} · tanda ${view.editShot.endIndex+1} · flecha F${view.editShot.shotIndex+1}</strong><span>Ahora toca la ubicación correcta en la diana. La cantidad de flechas no cambiará.</span><button type="button" class="btn small" data-action="cancel-shot-edit">Cancelar corrección</button></div>`:''}<div class="target-wrap">${targetSvg(s)}<div class="target-controls"><span class="small muted">${correctionSelection(s,'competition',current.number)?'Modo corrección activo':done?'Planilla completa':'Toca para anotar · fuera de anillos = M'}</span><button class="btn small" data-action="reset-zoom">Centrar</button></div></div><button class="btn block" data-action="undo-event" ${!n||view.busy||['validated','disputed'].includes(currentApproval(slotResult(ev,current.number)).status)||currentApproval(slotResult(ev,current.number)).archerSignature||currentApproval(slotResult(ev,current.number)).scorerSignature?'disabled':''}>↶ Deshacer última flecha de ${current.position}</button><p class="small muted">Cierre automático de tanda tras ${f.perEnd} flechas. ${ev.cloudRoomId?'Las flechas se confirman primero en Firebase y luego se copian localmente.':'Cada flecha se guarda localmente.'} No existe botón «Aceptar tanda».</p>${!done&&n===f.maxEnds*f.perEnd&&slotResult(ev,current.number).revisions?.length?'<div class="notice">Revisión autorizada: usa «Deshacer última flecha» antes de registrar el nuevo impacto. La planilla firmada anterior se conserva en el historial de correcciones.</div>':''}${done?'<div class="notice success">Todas las flechas registradas. Revisa la planilla completa y valida el resultado individual.</div>':''}</section><section class="card gap"><h3>Planilla completa · ${e(s.archerName)}</h3><p class="small muted">Para corregir una flecha, toca su puntuación (F1, F2…) y luego marca el punto correcto en la diana. Solo se modifica esa flecha; las firmadas permanecen bloqueadas.</p>${liveFullSheet(s,{scope:'competition',number:current.number,editable:canEditRecordedShot(ev,current.number)})}</section>${validationPanel(ev,current,s)}`}
function eventDetail(){const ev=events.find(x=>x.id===view.activeEvent);if(!ev)return competition();const occupied=ev.entries.filter(x=>!x.vacant),vacancies=ev.entries.filter(x=>x.vacant),nextNumber=Math.max(0,...ev.entries.map(a=>a.number))+1,draw=ev.draw||[],running=eventState(ev)==='running',targets=eventTargets(ev);const tab=view.eventTab;const roster=`<section class="card gap"><div class="row"><h3>Listado de participantes</h3><span class="pill">N.º fijo</span></div><p class="small muted">Al retirar al participante 10, su número queda vacante. Los demás conservan sus números.</p>${ev.entries.length?ev.entries.map(a=>`<div class="entry"><span class="entry-number">#${a.number}</span><div class="gap-xs" style="flex:1;min-width:0"><strong class="small">${a.vacant?'Vacante':e(a.name)}</strong>${a.vacant?'':`<small class="muted">${e(a.division)} · ${e(a.age)} · ${e(a.level)} · ${e(a.gender)} · ${e(a.hand)}</small>`}</div>${a.vacant?'':`<button class="btn small danger" data-action="vacate-entry" data-value="${a.number}" ${ev.locked||running?'disabled':''}>Retirar</button>`}</div>`).join(''):'<div class="empty"><strong>Aún no hay inscritos</strong></div>'}</section><section class="card gap"><h3>Inscribir arquero</h3>${ev.locked||running?'<div class="notice">El sorteo está confirmado. No puedes modificar los participantes durante la competencia.</div>':`<form id="eventEntryForm" class="gap"><div class="field"><label for="entryName">Nombre completo</label><input id="entryName" name="name" required maxlength="100"></div><div class="field"><label for="entryNumber">Número de inscripción</label><select id="entryNumber" name="number"><option value="${nextNumber}">Nuevo número #${nextNumber}</option>${vacancies.map(a=>`<option value="${a.number}">Ocupar vacante #${a.number}</option>`).join('')}</select></div><div class="btn-row"><div class="field"><label>División</label><select name="division">${divisions.map(v=>`<option>${e(v)}</option>`).join('')}</select></div><div class="field"><label>Edad</label><select name="age">${ages.map(v=>`<option>${e(v)}</option>`).join('')}</select></div></div><div class="btn-row"><div class="field"><label>Nivel</label><select name="level">${levels.map(v=>`<option>${e(v)}</option>`).join('')}</select></div><div class="field"><label>Categoría</label><select name="gender"><option>Masculina</option><option>Femenina</option></select></div></div><div class="field"><label>Mano de arco</label><select name="hand"><option>Diestro</option><option>Zurdo</option></select></div><button type="submit" class="btn primary block">Guardar inscripción</button></form>`}</section>`;const drawPanel=`<section class="card gap"><div class="row"><h3>Asignación de parapetos</h3><span class="pill">${draw.length} sorteados</span></div><p class="small muted">El sorteo distribuye aleatoriamente A/B/C/D. Priorizar zurdos en B/D es opcional y comienza desactivado.</p><label class="checkrow priority-option ${ev.preferLeft?'priority-on':''}"><input type="checkbox" id="leftPriority" ${ev.preferLeft?'checked':''} ${ev.locked||running?'disabled':''}><span>Priorizar zurdos en B/D <strong class="priority-state">${ev.preferLeft?'ACTIVADO':'DESACTIVADO'}</strong></span></label><div class="btn-row"><button class="btn primary" data-action="draw-event" ${ev.locked||running||!occupied.length?'disabled':''}>🎲 Sortear posiciones</button><button class="btn" data-action="${ev.locked?'unlock-draw':'lock-draw'}" ${running||ev.cloudRoomId||!ev.locked&&!draw.length?'disabled':''}>${ev.locked?'Desbloquear sorteo':'Confirmar sorteo'}</button></div>${draw.length?`<div class="draw-table"><div class="entry heading"><strong>Parapeto</strong><strong>Pos.</strong><strong>Arquero</strong></div>${draw.map(d=>{const a=eventParticipant(ev,d.number);return `<div class="entry"><span>${d.target}</span><span class="entry-number">${d.position}</span><span class="small">#${d.number} · ${e(a?.name||'Vacante')} ${a?.hand==='Zurdo'?'(Z)':''}</span></div>`}).join('')}</div>`:'<div class="empty"><strong>Aún no se ha realizado el sorteo</strong><span class="small muted">Inscribe arqueros y selecciona «Sortear posiciones».</span></div>'}${ev.locked?`<div class="notice success">Sorteo confirmado. ${running?'La competencia ya está en marcha.':'Siguiente paso: elegir anotación local o en red, conectar anotadores y luego iniciar.'}</div><button class="btn primary block" data-action="event-tab" data-value="scorers">${running?'Ver anotadores':'Continuar → Elegir sistema de anotación'}</button>`:''}</section>`;return `<section class="card gap"><div class="row start"><div class="gap-xs"><div class="eyebrow">COMPETENCIA · ${chosenMode(ev)==='cloud'?'FIREBASE':'ORGANIZACIÓN'}</div><h2>${e(ev.name)}</h2><small class="muted">${e(ev.date)} · ${e(formats[ev.formatId]?.name)}</small></div><span class="pill ${running||ev.locked?'good':'warn'}">${e(eventPhase(ev))}</span></div><div class="stats"><div class="stat"><b>${occupied.length}</b><small>Arqueros</small></div><div class="stat"><b>${vacancies.length}</b><small>Vacantes</small></div><div class="stat"><b>${targets.length}</b><small>Parapetos</small></div></div><div class="btn-row"><button class="btn" data-action="nav" data-value="competitions">← Eventos</button><button class="btn" data-action="export-event">↓ Respaldar evento</button></div>${running&&ev.cloudRoomId&&ev.cloudRole==='organizer'?`<section class="soft gap"><h3>👀 Espectadores</h3><p class="small muted">Puedes habilitar la publicación de resultados sin compartir firmas ni permisos de anotadores. Las estadísticas de impactos se publican solamente tras validar cada planilla.</p>${cloudState.publicRoom?`<div class="row"><strong>${cloudState.publicRoom.enabled?'Visible al público':'Publicación pausada'}</strong><span class="pill ${cloudState.publicRoom.enabled?'good':'warn'}">${cloudState.publicRoom.enabled?'ACTIVO':'OCULTO'}</span></div><button class="btn block" data-action="spectator-visibility">${cloudState.publicRoom.enabled?'Ocultar a los espectadores':'Volver a publicar resultados'}</button><div class="qr-box">${window.WA_QR_SVG?window.WA_QR_SVG(spectatorURL(ev.cloudRoomId)):''}</div><button class="btn primary block" data-action="spectator-share">📤 Compartir evento · WhatsApp / Facebook</button><button class="btn block" data-action="spectator-copy">Copiar enlace público</button>`:`<button class="btn primary block" data-action="spectator-publish" ${!cloudState.ready||cloudState.fromCache?'disabled':''}>Habilitar resultados para espectadores</button>`}</section>`:''}${running?`<div class="notice success">Competencia iniciada. Puedes continuar anotando por parapeto y consultar los puntajes provisionales.</div><div class="target-launch">${targets.map(t=>`<button class="btn primary" data-action="open-target" data-value="${t}">🎯 Anotar parapeto ${t}</button>`).join('')}</div>`:''}</section><div class="tabs event-tabs"><button class="${tab==='roster'?'active':''}" data-action="event-tab" data-value="roster">1. Inscripciones</button><button class="${tab==='draw'?'active':''}" data-action="event-tab" data-value="draw">2. Sorteo</button><button class="${tab==='scorers'?'active':''}" data-action="event-tab" data-value="scorers">3. Anotación</button><button class="${tab==='results'?'active':''}" data-action="event-tab" data-value="results">4. Resultados</button><button class="${tab==='eliminations'?'active':''}" data-action="event-tab" data-value="eliminations">5. Eliminatorias</button></div>${tab==='roster'?roster:tab==='draw'?drawPanel:tab==='scorers'?eventScorersPanel(ev):tab==='eliminations'?eliminationsPanel(ev):eventResultsPanel(ev)}`}

function shuffle(arr){const result=[...arr];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result}
function makeDraw(ev){const participants=shuffle(ev.entries.filter(a=>!a.vacant));const n=Math.ceil(participants.length/4)*4;const places=Array.from({length:n},(_,i)=>({target:Math.floor(i/4)+1,position:'ABCD'[i%4],number:null}));if(ev.preferLeft){let left=shuffle(participants.filter(a=>a.hand==='Zurdo'));let rest=shuffle(participants.filter(a=>a.hand!=='Zurdo'));const bd=shuffle(places.filter(s=>s.position==='B'||s.position==='D'));bd.forEach(slot=>{if(left.length)slot.number=left.pop().number});const remaining=shuffle([...left,...rest]);places.filter(s=>s.number===null).forEach(slot=>{if(remaining.length)slot.number=remaining.pop().number})}else{places.forEach((slot,i)=>{if(participants[i])slot.number=participants[i].number})}return places.filter(slot=>slot.number!==null)}
async function changeEvent(fn){if(view.busy)return;const ev=events.find(x=>x.id===view.activeEvent);if(!ev)return;view.busy=true;try{if(ev.cloudRoomId){await applyCloudChange(fn)}else{const copy=structuredClone(ev);copy.scorers ||= [];copy.results ||= {};copy.status ||= 'setup';fn(copy);await persistEvent(copy)}view.busy=false;view.notice='';render();return true}catch(err){view.busy=false;alertMsg(`No se pudo guardar la competencia: ${err.message}`,true);return false}}
function validEvent(ev){if(!ev||typeof ev.id!=='string'||ev.id.length>160||typeof ev.name!=='string'||ev.name.length>120||!formats[ev.formatId]||!Array.isArray(ev.entries)||ev.entries.length>500||!Array.isArray(ev.draw)||ev.draw.length>500||typeof ev.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(ev.date))throw Error('Datos de competencia no válidos');const numbers=new Set();for(const a of ev.entries){if(!Number.isInteger(a.number)||a.number<1||a.number>10000||numbers.has(a.number))throw Error('Número de inscripción repetido');numbers.add(a.number);if(!a.vacant&&(typeof a.name!=='string'||a.name.length>100||!divisions.includes(a.division)||!ages.includes(a.age)||!levels.includes(a.level)||!['Diestro','Zurdo'].includes(a.hand)||!['Masculina','Femenina'].includes(a.gender)))throw Error('Participante inválido')}for(const d of ev.draw)if(!numbers.has(d.number)||!['A','B','C','D'].includes(d.position)||!Number.isInteger(d.target)||d.target<1||d.target>500)throw Error('Sorteo no válido');if(ev.testMode!==undefined&&typeof ev.testMode!=='boolean')throw Error('Modo prueba inválido');if(ev.annotationMode!==undefined&&!['local','cloud'].includes(ev.annotationMode))throw Error('Modo de anotación desconocido');if(ev.status&&!['setup','running'].includes(ev.status))throw Error('Estado de evento no válido');if(ev.status==='running'&&!ev.locked)throw Error('Competencia iniciada sin sorteo confirmado');if(ev.scorers!==undefined){if(!Array.isArray(ev.scorers)||ev.scorers.length>500)throw Error('Anotadores inválidos');const ts=new Set();for(const x of ev.scorers){if(!Number.isInteger(x.target)||!ev.draw.some(d=>d.target===x.target)||typeof x.name!=='string'||!x.name.trim()||x.name.length>90||ts.has(x.target))throw Error('Asignación de anotador inválida');ts.add(x.target)}}if(ev.results!==undefined){if(!ev.results||typeof ev.results!=='object'||Array.isArray(ev.results)||Object.keys(ev.results).length>500)throw Error('Resultados inválidos');for(const [num,r] of Object.entries(ev.results)){if(!/^\d+$/.test(num)||!ev.draw.some(d=>String(d.number)===num)||!r||!Array.isArray(r.ends)||!Array.isArray(r.current)||!['active','finished'].includes(r.status)||r.ends.length>fmt(ev).maxEnds||r.current.length>fmt(ev).perEnd)throw Error('Planilla inválida');for(const end of [...r.ends,r.current]){if(!Array.isArray(end)||end.length>fmt(ev).perEnd)throw Error('Tanda inválida');for(const shot of end){if(!shot||!((Number.isInteger(shot.score)&&shot.score>=1&&shot.score<=10)||shot.score==='M')||typeof shot.x!=='number'||typeof shot.y!=='number'||!Number.isFinite(shot.x)||!Number.isFinite(shot.y)||Math.abs(shot.x)>2||Math.abs(shot.y)>2||typeof shot.xRing!=='boolean')throw Error('Flecha inválida')}}if(r.status==='finished'&&(r.ends.length!==fmt(ev).maxEnds||r.current.length))throw Error('Planilla final incompleta');if(r.validation!==undefined){const v=r.validation;if(!v||!['pending','disputed','validated'].includes(v.status)||![null,undefined,'agree','disagree'].includes(v.decision))throw Error('Estado de validación inválido');for(const signature of [v.archerSignature,v.scorerSignature])if(signature!==null&&signature!==undefined&&!(typeof signature==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature)&&signature.length<=250000))throw Error('Archivo de firma inválido');if(v.status==='validated'&&(r.status!=='finished'||v.decision!=='agree'||!v.archerSignature||!v.scorerSignature||!v.validatedAt))throw Error('Planilla validada incompleta');if(v.status==='disputed'&&(v.decision!=='disagree'||typeof v.reason!=='string'||v.reason.length<6))throw Error('Desacuerdo no documentado')}if(r.revisions!==undefined){if(!Array.isArray(r.revisions)||r.revisions.length>100)throw Error('Registro de correcciones inválido');for(const audit of r.revisions){if(!audit||typeof audit.actor!=='string'||audit.actor.length<3||audit.actor.length>100||typeof audit.reason!=='string'||audit.reason.length<8||audit.reason.length>350||!audit.snapshot||!Array.isArray(audit.snapshot.ends)||!audit.snapshot.validation||!['validated','disputed'].includes(audit.snapshot.validation.status))throw Error('Corrección anterior inválida')}}}}}
async function importEventFile(file){return importWaFile(file)}
function settings(){return `<section class="card gap"><h2>Actualizaciones</h2><p class="small muted">Las nuevas versiones se descargan en segundo plano, pero no se activan mientras anotas. «Más tarde» conserva esta versión hasta que decidas actualizar.</p><button type="button" class="btn block" data-action="wa-check-updates">Buscar actualizaciones</button><p class="small muted" id="wa-update-status" role="status"></p></section><section class="card gap"><h2>Respaldo de datos</h2><p class="small muted">Las sesiones y competencias se almacenan en IndexedDB de este navegador. Si borras los datos del sitio, se pierde la instalación o Safari elimina almacenamiento, podrían desaparecer. Exporta copias periódicamente.</p><div class="soft gap"><strong>${sessions.length} entrenamiento(s) almacenado(s)</strong><p class="small muted">Este respaldo incluye solamente entrenamientos. Exporta cada competencia desde su pantalla «Exportar evento».</p><button class="btn primary block" data-action="backup-all">↓ Respaldar todos los entrenamientos (.wascore)</button></div><div class="field"><label for="importFile">Importar archivo WA Scoring</label><input id="importFile" type="file" aria-label="Seleccionar archivo WA Scoring"><small class="muted">Puedes seleccionar respaldos .wascore o .json, tanto de entrenamientos como de competencias.</small></div><p class="small muted">La importación conserva los originales y añade una copia si encuentra un identificador ya existente. Se validan las flechas y las tandas.</p></section><section class="card gap"><h2>Cómo instalarla</h2><p class="small muted">En iPhone: abre el sitio HTTPS en Safari, toca Compartir y elige «Añadir a pantalla de inicio». En Android: abre el sitio en Chrome y elige «Instalar aplicación».</p><p class="small muted">El modo sin conexión funciona después de cargar el sitio e instalar el contenido mediante el servicio offline. El navegador debe permitir almacenamiento local.</p><div class="notice">Abrir el archivo HTML desde la vista previa de Archivos o desde ChatGPT no habilita necesariamente JavaScript ni la instalación PWA. Se necesita alojar esta carpeta en un sitio HTTPS para usarla en el iPhone.</div></section><section class="card gap"><h2>Alcance de esta versión</h2><p class="small muted">✓ Entrenamiento 18/50/70 m: registro por toque, zoom, planilla, guardado local, reanudación, estadísticas y respaldo.</p><p class="small muted">✓ Competencias locales: inscripción con números fijos, sorteos A/B/C/D y exportación/importación del evento.</p><p class="small muted">✓ Anotación local de competencia: un anotador registrado por parapeto y diana A/B/C/D, con guardado de cada flecha. Validación local con firmas manuscritas por arquero y anotador. Disponible: piloto Firebase con acceso por QR y aprobación del organizador; pendientes: cola offline, cuentas permanentes y certificación para torneo oficial.</p></section>`}
function printHTML(s){const f=fmt(s),all=s.ends.map((end,i)=>({i:i+1,end}));if(s.current.length)all.push({i:all.length+1,end:s.current});let cumulative=0;return `<h1>WA Scoring · Planilla individual</h1><p class="print-meta">${e(s.archerName)} · ${e(s.title)}<br>World Archery · ${e(f.name)} · ${e(f.distance)} · Diana ${f.faceCm} cm<br>${new Date(s.createdAt).toLocaleString('es-CL')} · Estado: ${s.status==='finished'?'Finalizada':'En curso'}<br>Puntos: ${total(s)} / ${f.max} · Flechas: ${archersLength(s)} / ${f.maxEnds*f.perEnd}</p><table><thead><tr><th>Tanda</th>${Array.from({length:f.perEnd},(_,i)=>`<th>F${i+1}</th>`).join('')}<th>Subtotal</th><th>Acumulado</th></tr></thead><tbody>${all.map(x=>{cumulative+=sum(x.end);const ordered=[...x.end].sort((a,b)=>(b.score==='M'?0:b.score)-(a.score==='M'?0:a.score));return `<tr><th>${x.i}</th>${Array.from({length:f.perEnd},(_,i)=>`<td class="print-arrow ${scoreClass(ordered[i])}">${ordered[i]?scoreText(ordered[i]):'—'}</td>`).join('')}<td>${sum(x.end)}</td><td>${cumulative}</td></tr>`}).join('')}</tbody></table><p>Documento generado en el dispositivo. Sin firma de competición, sin certificación oficial.</p>`}
function render(){const trainingScroller=document.getElementById('trainingCompactScroll');if(trainingScroller)view.trainingScrollY=trainingScroller.scrollTop;if(!['event-score','score'].includes(view.page))view.editShot=null;document.body.dataset.mode=modeForPage();const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=modeForPage()==='competition'?'#2E7D32':'#1976D2';const s=get();let inner='';switch(view.page){case 'home':inner=home();break;case 'new':inner=newSession();break;case 'history':inner=history();break;case 'score':inner=s?scorePage(s):home();break;case 'detail':inner=s?detail(s):history();break;case 'competitions':inner=competition();break;case 'personal-history':inner=personalHistory();break;case 'personal-detail':inner=personalDetail(personal.find(x=>x.id===view.activePersonal));break;case 'spectator':inner=spectatorList();break;case 'spectator-event':inner=spectatorEvent();break;case 'spectator-detail':inner=spectatorDetail();break;case 'event-new':inner=newEvent();break;case 'event-detail':inner=eventDetail();break;case 'event-score':inner=eventScorePage();break;case 'elim-remote':inner=eliminationRemotePage();break;case 'cloud-join':inner=joinPage();break;case 'settings':inner=settings();break;default:inner=home()}
app.innerHTML=base(inner);window.WAUpdates?.refresh();document.querySelector('#print-sheet').innerHTML=s?printHTML(s):'';if(view.page==='score'&&s){attachTarget(s);attachTrainingCompactSheet(s);}if(view.page==='event-score'){const ev=events.find(x=>x.id===view.activeEvent),slot=selectedCompetitionSlot();if(ev&&slot&&(!ev.cloudRoomId||cloudState.ready&&!cloudState.fromCache))attachTarget(scoreForSlot(ev,slot),recordCompetitionShot);attachSignatureCanvases()}}
async function setBusy(p){view.busy=true;try{await p}finally{view.busy=false}}
async function mutate(fn){if(view.busy)return;const s=get();if(!s)return;view.busy=true;try{const copy=structuredClone(s);fn(copy);await persist(copy);view.notice='';view.error=false;view.busy=false;render();return true}catch(err){view.busy=false;alertMsg(`No se pudo guardar. No continúes anotando hasta resolverlo: ${err.message}`,true);return false}}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function archive(items){return JSON.stringify({fileType:'wa-scoring',schemaVersion:1,exportedAt:timestamp(),sessions:items},null,2)}
function exportArchive(items,label){download(`${escapeFilename(label)}.wascore`,archive(items),'application/json')}
function exportCsv(s){const lines=[['Sesion','Arquero','Formato','Tanda','Flecha','Puntuacion','Es X','Impacto X relativo','Impacto Y relativo']];const f=fmt(s),arr=shots(s);arr.forEach((shot,i)=>lines.push([s.title,s.archerName,f.name,Math.floor(i/f.perEnd)+1,i%f.perEnd+1,shot.score,shot.xRing?'Sí':'No',shot.x,shot.y]));download(`${escapeFilename(s.title)}.csv`,lines.map(line=>line.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8')}
function confirmAction(text){return window.confirm(text)}
function validateSession(s){if(!s||typeof s!=='object'||typeof s.id!=='string'||s.id.length>160||typeof s.archerName!=='string'||s.archerName.length>90||typeof s.title!=='string'||s.title.length>90||!formats[s.formatId]||!['active','finished'].includes(s.status)||!Array.isArray(s.ends)||!Array.isArray(s.current))throw Error('La sesión contiene datos incorrectos.');const f=fmt(s);if(s.ends.length>f.maxEnds||s.current.length>f.perEnd||s.ends.length===f.maxEnds&&s.current.length)throw Error('Hay demasiadas tandas.');for(const end of [...s.ends,s.current]){if(!Array.isArray(end)||end.length>f.perEnd)throw Error('Una tanda contiene demasiadas flechas.');for(const shot of end){if(!shot||!((Number.isInteger(shot.score)&&shot.score>=1&&shot.score<=10)||shot.score==='M')||typeof shot.x!=='number'||typeof shot.y!=='number'||!Number.isFinite(shot.x)||!Number.isFinite(shot.y)||Math.abs(shot.x)>2||Math.abs(shot.y)>2||typeof shot.xRing!=='boolean')throw Error('El respaldo contiene puntuaciones o coordenadas incorrectas.');}}}
async function importFile(file){return importWaFile(file)}
// No accept= filter: iOS Files/Chrome may disable .wascore as an unknown UTI.
// Recognize the actual file content, not its extension or MIME type.
async function importWaFile(file){
  if(!file)return;
  if(file.size>15*1024*1024){alertMsg('Archivo demasiado grande (máximo: 15 MB).',true);return}
  try{
    const data=JSON.parse(await file.text());
    if(data?.fileType==='wa-scoring-personal-competition'){await importPersonalFile(file);return;}
    if(data?.fileType==='wa-scoring-competition'){
      if(data.schemaVersion!==1||!data.event)throw Error('Versión del respaldo de competencia no compatible.');
      validEvent(data.event);
      const copy=structuredClone(data.event);
      if(events.some(x=>x.id===copy.id)){copy.id=uid();copy.name+=' (copia importada)'}
      await persistEvent(copy);
      view.activeEvent=copy.id;
      view.page='event-detail';
      view.eventTab='roster';
      alertMsg('Competencia importada sin sobrescribir los registros existentes.');
      return;
    }
    if(data?.fileType==='wa-scoring'){
      if(data.schemaVersion!==1||!Array.isArray(data.sessions)||data.sessions.length>1000)throw Error('Versión del respaldo de entrenamientos no compatible.');
      const originals=new Set(sessions.map(s=>s.id));
      const copies=[];
      // Validate *all* sessions before writing any of them.
      for(const s of data.sessions){
        validateSession(s);
        const copy=structuredClone(s);
        if(originals.has(copy.id)||copies.some(c=>c.id===copy.id)){
          copy.id=uid();copy.title=`${copy.title} (importada)`;
        }
        originals.add(copy.id);
        copy.updatedAt=timestamp();
        copies.push(copy);
      }
      for(const c of copies)await dbCall('readwrite',store=>store.put(c));
      await refresh();
      view.page='history';
      alertMsg(`Importación completada: ${copies.length} sesión(es). No se sobrescribieron registros existentes.`);
      return;
    }
    throw Error('El archivo no es un respaldo de entrenamiento ni de competencia de WA Scoring.');
  }catch(err){
    alertMsg(`Importación rechazada: ${err.message}`,true);
  }
}
function resetZoom(){view.zoom=1;view.panX=0;view.panY=0;const g=document.querySelector('#targetContent');if(g)g.removeAttribute('transform')}
function attachTarget(s,onShot=(shot)=>mutate(copy=>{copy.current.push(shot);const round=fmt(copy);if(copy.current.length===round.perEnd){copy.ends.push(copy.current);copy.current=[];if(copy.ends.length===round.maxEnds)copy.status='finished'}})){const svg=document.querySelector('#targetSvg'),g=document.querySelector('#targetContent');if(!svg||!g)return;
const pointers=new Map();let hasMoved=false,startDistance=0,startScale=view.zoom;
function clamp(){view.panX=Math.max(-200*(view.zoom-1),Math.min(200*(view.zoom-1),view.panX));view.panY=Math.max(-200*(view.zoom-1),Math.min(200*(view.zoom-1),view.panY));}
function transform(){clamp();g.setAttribute('transform',`translate(${200+view.panX} ${200+view.panY}) scale(${view.zoom}) translate(-200 -200)`)}
function coords(evt){return {x:evt.clientX,y:evt.clientY}}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
svg.addEventListener('pointerdown',evt=>{evt.preventDefault();try{svg.setPointerCapture(evt.pointerId)}catch{}const p=coords(evt);pointers.set(evt.pointerId,{...p,sx:p.x,sy:p.y});if(pointers.size===2){hasMoved=true;const [a,b]=[...pointers.values()];startDistance=Math.max(1,distance(a,b));startScale=view.zoom}});
svg.addEventListener('pointermove',evt=>{if(!pointers.has(evt.pointerId))return;const old=pointers.get(evt.pointerId),p=coords(evt);pointers.set(evt.pointerId,{...old,x:p.x,y:p.y});if(pointers.size>=2){const [a,b]=[...pointers.values()];view.zoom=Math.max(1,Math.min(4,startScale*distance(a,b)/startDistance));if(view.zoom===1){view.panX=0;view.panY=0}hasMoved=true;transform();}else if(distance(p,{x:old.sx,y:old.sy})>8){hasMoved=true;if(view.zoom>1){const scale=400/svg.getBoundingClientRect().width;view.panX+=(p.x-old.x)*scale;view.panY+=(p.y-old.y)*scale;transform()}}});
function release(evt,canceled){const prev=pointers.get(evt.pointerId);if(!prev)return;const canTap=!canceled&&!hasMoved&&pointers.size===1&&distance(coords(evt),{x:prev.sx,y:prev.sy})<8;pointers.delete(evt.pointerId);if(canTap&&!view.busy&&(view.editShot||s.status==='active'&&s.current.length<fmt(s).perEnd)){const pt=svg.createSVGPoint();pt.x=evt.clientX;pt.y=evt.clientY;const matrix=g.getScreenCTM();if(matrix){const loc=pt.matrixTransform(matrix.inverse());const dx=loc.x-200,dy=loc.y-200,r=Math.hypot(dx,dy);const score=r>=180?'M':Math.max(1,Math.min(10,11-Math.ceil(r/18)));const shot={score,x:Number((dx/180).toFixed(6)),y:Number((dy/180).toFixed(6)),xRing:score===10&&r<=9};if(view.editShot){if(view.editShot.scope==='competition')correctCompetitionShot(shot);else correctTrainingShot(shot);}else onShot(shot);}}if(pointers.size===0)hasMoved=false;}
svg.addEventListener('pointerup',evt=>release(evt,false));svg.addEventListener('pointercancel',evt=>release(evt,true));transform();}
app.addEventListener('click',async evt=>{const el=evt.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action,value=el.dataset.value;const s=get();
if(action==='elim-remote-open'){if(cloudState.role!=='scorer')return alertMsg('Solo teléfonos autorizados.',true);view.page='elim-remote';render();return;}
if(action==='elim-remote-select'){view.elimTaskId=value;view.elimSide='a';render();return;}
if(action==='elim-remote-side'){if(value==='a'||value==='b'){view.elimSide=value;render();}return;}
if(action==='elim-to-classification'){view.page='event-score';render();return;}
if(action==='elim-copy-join'){try{await navigator.clipboard.writeText(value);alertMsg('Enlace de ingreso copiado.')}catch(err){alertMsg('No se pudo copiar el enlace.',true)}return;}
if(action==='elim-remote-first-side'){
 const [id,side]=String(value).split('|'),task=cloudState.tasks.find(t=>t.id===id);
 if(!task||!['a','b'].includes(side)||cloudState.role!=='scorer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache||view.busy)return alertMsg('Sin permiso o sincronización para elegir quién comienza.',true);
 if(!confirmAction(`¿Confirmar que comienza ${side==='a'?eliminationName(events.find(x=>x.id===view.activeEvent),task.a):eliminationName(events.find(x=>x.id===view.activeEvent),task.b)}?`))return;
 try{view.busy=true;const saved=await cloudState.api.chooseEliminationFirstSide(cloudState.roomId,id,task.revision,side);retainConfirmedEliminationTask(saved);view.busy=false;render();alertMsg('Orden de tiro confirmado y sincronizado.');}
 catch(err){const detail=await explainEliminationConflict(err,id);view.busy=false;alertMsg(detail||'No se pudo registrar quién comienza: '+err.message,true)}return;
}
if(action==='elim-remote-arrow'){
 const [id,side,score]=String(value).split('|'),task=cloudState.tasks.find(t=>t.id===id);
 if(!task||cloudState.role!=='scorer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache||view.busy)return alertMsg('Sin permiso o sincronización. Revisa el encuentro.',true);
 view.busy=true;
 try{
  // La transacción devuelve la revisión y las flechas realmente confirmadas.
  // No habilitar la próxima flecha usando un snapshot antiguo.
  const saved=await cloudState.api.writeEliminationArrow(cloudState.roomId,id,task.revision,side,score);
  retainConfirmedEliminationTask(saved);
  if((saved.current?.[side==='a'?'aShots':'bShots']||[]).length>=3)view.elimSide=side==='a'?'b':'a';
  view.notice='';view.busy=false;render();
 }catch(err){
  const detail=await explainEliminationConflict(err,id);
  view.busy=false;
  alertMsg(detail||'Flecha NO guardada: '+err.message,true);
 }
 return;
}
if(action==='elim-remote-correct'){
 const [id,side]=String(value).split('|'),task=cloudState.tasks.find(t=>t.id===id);
 if(!task||cloudState.role!=='scorer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache||view.busy)return alertMsg('Sin permiso o sincronización.',true);
 if(!confirmAction('¿Retirar la última flecha de este arquero? El organizador verá la corrección.'))return;
 try{view.busy=true;const saved=await cloudState.api.undoEliminationArrow(cloudState.roomId,id,task.revision,side);retainConfirmedEliminationTask(saved);view.busy=false;alertMsg('Flecha retirada y sincronizada.');}
 catch(err){const detail=await explainEliminationConflict(err,id);view.busy=false;alertMsg(detail||'No se pudo corregir: '+err.message,true)}return;
}
if(action==='elim-remote-undo'){
 const task=cloudState.tasks.find(t=>t.id===value);
 if(!task||cloudState.role!=='scorer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache)return alertMsg('Tarea no disponible o sin sincronización.',true);
 if(!confirmAction('¿Retirar la última tanda? Este cambio será visible para el organizador.'))return;
 try{view.busy=true;const saved=await cloudState.api.writeEliminationSet(cloudState.roomId,task.id,task.revision,[],[],true);retainConfirmedEliminationTask(saved);view.busy=false;alertMsg('Última tanda retirada y sincronizada.');}
 catch(err){const detail=await explainEliminationConflict(err,task.id);view.busy=false;alertMsg(detail||'No se pudo corregir: '+err.message,true)}return;
}
if(action==='elim-select-group'){view.elimGroup=value;view.elimMatch=null;render();return;}
if(action==='elim-select-match'){view.elimMatch=value;render();return;}
if(action==='select-shot-edit'){
 const [endIndex,shotIndex]=String(value||'').split(':').map(Number);
 const isCompetition=view.page==='event-score';
 const ev=isCompetition?events.find(x=>x.id===view.activeEvent):null;
 const slot=isCompetition?selectedCompetitionSlot():null;
 const source=isCompetition?(slot?scoreForSlot(ev,slot):null):get();
 if(!source)return;
 if(isCompetition&&!canEditRecordedShot(ev,slot.number))return alertMsg('La planilla está firmada o bloqueada. Solicita una revisión autorizada.',true);
 const prior=getRecordedShot(source,endIndex,shotIndex);
 if(!prior)return alertMsg('No existe esa flecha. Vuelve a seleccionar.',true);
 const scope=isCompetition?'competition':'training',number=isCompetition?slot.number:null;
 const selected=correctionSelection(source,scope,number);
 view.editShot=selected?.endIndex===endIndex&&selected?.shotIndex===shotIndex?null:{scope,id:source.id,number,endIndex,shotIndex,original:structuredClone(prior)};
 render();if(view.editShot)document.querySelector('#targetSvg')?.scrollIntoView({behavior:'smooth',block:'center'});
 return;
}
if(action==='cancel-shot-edit'){view.editShot=null;render();return;}

if(action==='open-personal'){view.activePersonal=value;view.page='personal-detail';view.detailTab='estadisticas';view.statsSection='resumen';view.period='all';render();return;}
if(action==='personal-delete'){
 const p=personal.find(x=>x.id===view.activePersonal);if(!p||!confirmAction('¿Eliminar esta copia personal del teléfono? No afectará la competencia oficial.'))return;
 await dbCall('readwrite',store=>store.delete(p.id),'personal');await refresh();view.activePersonal=null;view.page='personal-history';render();return;
}
if(action==='personal-export'){const p=personal.find(x=>x.id===view.activePersonal);if(p)download(`${escapeFilename(p.title)}-${escapeFilename(p.archerName)}.wascore`,personalJson(p),'application/json');return;}
if(action==='simulate-qualification'){await simulateQualifyingRound();return;}
if(action==='export-individual'){const ev=events.find(x=>x.id===view.activeEvent);try{if(ev)await exportIndividual(ev,Number(value));}catch(err){alertMsg('No se pudo compartir la planilla individual: '+err.message,true)}return;}
if(action==='spectator-open'){try{await openSpectatorRoom(value)}catch(err){alertMsg(err.message,true)}return;}
if(action==='spectator-match'){view.spectatorMatchId=view.spectatorMatchId===value?'none':value;render();return;}
if(action==='spectator-back'){view.page='spectator-event';render();return;}
if(action==='spectator-archer'){view.spectatorNumber=Number(value);view.page='spectator-detail';view.detailTab='estadisticas';view.statsSection='resumen';view.period='all';render();return;}
if(action==='spectator-publish'){
 const ev=events.find(x=>x.id===view.activeEvent);
 if(!ev||!cloudState.ready||cloudState.fromCache||cloudState.roomId!==ev.cloudRoomId||cloudState.role!=='organizer')return alertMsg('Conecta el organizador y confirma la sincronización.',true);
 if(!confirmAction('¿Publicar nombres, categorías y puntuaciones en vivo? Los impactos detallados solo serán visibles tras validar las planillas.'))return;
 try{view.busy=true;await cloudState.api.publishSpectatorEvent(ev,cloudState.cards);view.busy=false;alertMsg('Evento disponible para espectadores. Ya puedes compartirlo.');}
 catch(err){view.busy=false;alertMsg('No se pudo publicar para espectadores: '+err.message,true)}return;
}
if(action==='spectator-visibility'){
 const ev=events.find(x=>x.id===view.activeEvent),enabled=!cloudState.publicRoom?.enabled;
 if(!ev?.cloudRoomId||cloudState.role!=='organizer')return;
 if(!confirmAction(enabled?'¿Volver a hacer públicos los resultados?':'¿Ocultar temporalmente los resultados públicos?'))return;
 try{await cloudState.api.setSpectatorVisibility(ev.cloudRoomId,enabled);alertMsg(enabled?'Evento visible para espectadores.':'Evento oculto del Modo espectador.');}catch(err){alertMsg(err.message,true)}return;
}
if(action==='spectator-share'){const room=view.page.startsWith('spectator')?publicState.roomId:events.find(x=>x.id===view.activeEvent)?.cloudRoomId;if(room)await shareSpectatorLink(room);return;}
if(action==='spectator-copy'){const room=events.find(x=>x.id===view.activeEvent)?.cloudRoomId;if(room){try{await navigator.clipboard.writeText(spectatorURL(room));alertMsg('Enlace público copiado.');}catch(err){alertMsg('Enlace: '+spectatorURL(room));}}return;}
if(action==='cloud-connect'){try{await initCloud();cloudState.error='';alertMsg('Firebase configurado. Ahora puedes publicar o unirte a una competencia.')}catch(err){cloudState.error=err.message;alertMsg(err.message,true)}return}
if(action==='cloud-join-page'){view.page='cloud-join';render();return}
if(action==='choose-score-mode'){if(!['cloud','local'].includes(value))return;await changeEvent(ev=>{if(!ev.locked||ev.cloudRoomId||eventState(ev)!=='setup')throw Error('Confirma primero el sorteo');ev.annotationMode=value;});return}
if(action==='change-score-mode'){await changeEvent(ev=>{if(!ev.locked||ev.cloudRoomId||eventState(ev)!=='setup')throw Error('El modo ya está bloqueado');delete ev.annotationMode;});return}
if(action==='cloud-start'){
 const ev=events.find(x=>x.id===view.activeEvent);
 if(!ev||chosenMode(ev)!=='cloud'||!ev.cloudRoomId||!cloudState.ready||cloudState.role!=='organizer'||!roomWaiting(ev))return alertMsg('Primero conecta todos los parapetos en Firebase.',true);
 if(!cloudTargetsReady(ev))return alertMsg('Todavía faltan anotadores autorizados.',true);
 if(!confirmAction('¿Iniciar ahora la competencia? A partir de este momento los teléfonos podrán registrar flechas.'))return;
 try{view.busy=true;await cloudState.api.startRoom(ev.cloudRoomId,eventTargets(ev));view.busy=false;alertMsg('Competencia iniciada. Los anotadores ya pueden registrar flechas.');}catch(err){view.busy=false;alertMsg('No se pudo iniciar: '+err.message,true)}return;
}
if(action==='cloud-publish'){try{view.busy=true;await publishCloudEvent();view.busy=false;alertMsg('Competencia publicada. Comparte los QR de parapeto y aprueba las solicitudes.')}catch(err){view.busy=false;alertMsg('No se pudo publicar: '+err.message,true)}return}
if(action==='cloud-reconnect'){const ev=events.find(x=>x.id===view.activeEvent);try{await cloudReconnect(ev);alertMsg('Reconectando con Firebase…')}catch(err){alertMsg(err.message,true)}return}
if(action==='cloud-copy-room'){try{await navigator.clipboard.writeText(cloudState.roomId||events.find(x=>x.id===view.activeEvent)?.cloudRoomId);alertMsg('Código de sala copiado.')}catch(err){alertMsg('No se pudo copiar; mantén presionado el código.',true)}return}
if(action==='cloud-copy-link'){const room=events.find(x=>x.id===view.activeEvent)?.cloudRoomId;try{await navigator.clipboard.writeText(cloudRoomURL(room,value));alertMsg('Enlace del parapeto '+value+' copiado.')}catch(err){alertMsg('No se pudo copiar el enlace.',true)}return}
if(action==='cloud-approve'){const requested=cloudState.requests.find(x=>x.uid===value);if(!requested)return alertMsg('Solicitud no encontrada',true);if(!confirmAction(`¿Autorizar a ${requested.name} para anotar SOLO en parapeto ${requested.target}? Verifica personalmente quién solicita el acceso.`))return;try{await cloudState.api.approve(cloudState.roomId,requested.uid,Number(requested.target));alertMsg('Anotador autorizado.')}catch(err){alertMsg('No se pudo aprobar: '+err.message,true)}return}
if(action==='clear-notice'){view.notice='';render();return}
if(action==='nav'){view.editShot=null;view.notice='';if(value==='spectator'){await openSpectatorList();return;}if(view.page.startsWith('spectator'))stopPublicFeeds();view.page=value;render();return}
if(action==='event-new'){view.page='event-new';render();return}
if(action==='open-event'){view.activeEvent=value;view.page='event-detail';view.eventTab='roster';render();const selected=events.find(v=>v.id===value);if(selected?.cloudRoomId)cloudReconnect(selected).catch(err=>alertMsg('No se pudo reconectar con Firebase: '+err.message,true));return}
if(action==='event-tab'){view.eventTab=value;render();return}
if(action==='open-target'||action==='open-result'){view.editShot=null;const ev=events.find(x=>x.id===view.activeEvent);if(!ev||eventState(ev)!=='running')return alertMsg('Primero inicia la competencia.',true);const [target,position]=action==='open-result'?value.split(':'):[value,''];view.activeTarget=Number(target);view.disputeVisible=false;view.correctionVisible=false;const slots=ev.draw.filter(d=>d.target===view.activeTarget);if(!slots.length)return alertMsg('Parapeto sin arqueros.',true);view.activePosition=slots.some(d=>d.position===position)?position:slots[0].position;view.disputeVisible=false;view.correctionVisible=false;view.zoom=1;view.panX=0;view.panY=0;view.page='event-score';render();return}
if(action==='back-event'){view.editShot=null;const ev=events.find(x=>x.id===view.activeEvent);if(ev?.cloudRole==='scorer')return alertMsg('Esta opción corresponde al organizador.',true);view.page='event-detail';view.eventTab='scorers';render();return}
if(action==='event-results'){view.editShot=null;view.page='event-detail';view.eventTab='results';view.categoryFilter='all';render();return}
if(action==='select-position'){view.editShot=null;const ev=events.find(x=>x.id===view.activeEvent);if(!ev?.draw?.some(d=>d.target===view.activeTarget&&d.position===value))return;view.activePosition=value;view.disputeVisible=false;view.correctionVisible=false;view.zoom=1;view.panX=0;view.panY=0;render();return}
if(action==='undo-event'){const slot=selectedCompetitionSlot();if(!slot)return;await changeEvent(ev=>{if(eventState(ev)!=='running')throw Error('Competencia no iniciada');const r=ensureSlotResult(ev,slot.number),v=currentApproval(r);if(v.status==='validated'||v.status==='disputed'||v.archerSignature||v.scorerSignature)throw Error('Planilla firmada o en disputa: registra revisión autorizada o retira firmas antes de corregir');if(r.current.length)r.current.pop();else if(r.ends.length){r.current=r.ends.pop();r.current.pop()}if(r.status==='finished'&&r.ends.length<fmt(ev).maxEnds)r.status='active'});return}
if(action==='start-event'){if(!confirmAction('¿Iniciar la competencia? Se bloquearán las inscripciones y las asignaciones de anotadores. La anotación quedará habilitada en este dispositivo.'))return;await changeEvent(ev=>{const targets=eventTargets(ev);if(chosenMode(ev)!=='local'||eventState(ev)!=='setup'||!ev.locked||!targets.length||targets.some(t=>!assignedScorer(ev,t)?.name))throw Error('Falta confirmar sorteo o asignar anotadores');ev.status='running';ev.startedAt=timestamp()});view.eventTab='scorers';return}

if(action==='scroll-validation'){document.querySelector('#validationSection')?.scrollIntoView({behavior:'smooth',block:'start'});return}
if(action==='event-agree'){const slot=selectedCompetitionSlot();if(!slot)return;view.disputeVisible=false;await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number);if(r.status!=='finished'||currentApproval(r).status==='validated')throw Error('Solo puedes aceptar una planilla terminada sin validar');resetApproval(r);r.validation.decision='agree'});return}
if(action==='event-disagree-form'){view.disputeVisible=!view.disputeVisible;render();return}
if(action==='event-reset-decision'){const slot=selectedCompetitionSlot();if(!slot)return;if(!confirmAction('¿Retirar las firmas registradas y volver a elegir acuerdo/desacuerdo?'))return;await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number);if(currentApproval(r).status==='validated')throw Error('Una planilla validada solo puede reabrirse con revisión autorizada');resetApproval(r)});return}
if(action==='clear-signature-canvas'){const canvas=document.querySelector('#signature-'+value);if(canvas){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.dataset.ink=''}return}
if(action==='save-event-signature'){const slot=selectedCompetitionSlot(),canvas=document.querySelector('#signature-'+value);if(!slot||!['archer','scorer'].includes(value)||!canvas||canvas.dataset.ink!=='yes')return alertMsg('Primero dibuja la firma en el recuadro.',true);const signature=canvas.toDataURL('image/png');if(signature.length>250000)return alertMsg('La firma es demasiado grande. Borra los trazos y vuelve a firmar.',true);await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number),v=currentApproval(r);if(r.status!=='finished'||v.status==='validated'||v.decision!=='agree')throw Error('Primero completa y acepta la planilla');r.validation||=v;r.validation[value==='archer'?'archerSignature':'scorerSignature']=signature;r.validation[value==='archer'?'archerSignedAt':'scorerSignedAt']=timestamp();if(value==='scorer')r.validation.scorerName=assignedScorer(ev,slot.target)?.name||'Anotador'});return}
if(action==='clear-event-signature'){const slot=selectedCompetitionSlot();if(!slot)return;if(!confirmAction('¿Eliminar esta firma para volver a registrarla?'))return;await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number);if(currentApproval(r).status==='validated')throw Error('Una firma ya validada no se puede retirar sin revisión');r.validation[value==='archer'?'archerSignature':'scorerSignature']=null;r.validation[value==='archer'?'archerSignedAt':'scorerSignedAt']=null});return}
if(action==='event-validate'){const slot=selectedCompetitionSlot();if(!slot||!confirmAction('¿Validar y bloquear definitivamente esta planilla? Para corregirla después quedará registrada una revisión autorizada.'))return;await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number),v=currentApproval(r),f=fmt(ev);if(r.status!=='finished'||r.ends.length!==f.maxEnds||r.current.length||v.decision!=='agree'||!v.archerSignature||!v.scorerSignature||v.status==='validated')throw Error('La planilla debe estar completa, conforme y con ambas firmas');r.validation.status='validated';r.validation.validatedAt=timestamp();r.validation.totalAtValidation=sum(slotAllShots(r));r.validation.arrowsAtValidation=slotAllShots(r).length});return}
if(action==='event-correction-form'){view.correctionVisible=!view.correctionVisible;render();return}
if(action==='print-event-scorecard'){const ev=events.find(x=>x.id===view.activeEvent),slot=selectedCompetitionSlot();if(!ev||!slot)return;const r=slotResult(ev,slot.number);if(currentApproval(r).status!=='validated')return alertMsg('Solo se exportan como firmadas las planillas ya validadas.',true);document.querySelector('#print-sheet').innerHTML=getScorecardPrint(ev,slot);window.print();return}
if(action==='print-audit'){const ev=events.find(x=>x.id===view.activeEvent),slot=selectedCompetitionSlot();if(!ev||!slot)return;const item=(slotResult(ev,slot.number).revisions||[])[Number(value)];if(!item)return;document.querySelector('#print-sheet').innerHTML=getScorecardPrint(ev,slot,item.snapshot);window.print();return}
if(action==='export-event-scorecard-csv'){const ev=events.find(x=>x.id===view.activeEvent),slot=selectedCompetitionSlot();if(ev&&slot)exportEventScorecardCsv(ev,slot);return}
if(action==='export-event'){const ev=events.find(x=>x.id===view.activeEvent);if(ev?.cloudRoomId&&(ev.cloudRole!=='organizer'||cloudState.roomId!==ev.cloudRoomId||!cloudState.ready))return alertMsg('La competencia en red completa solo se respalda desde el iPhone organizador, estando sincronizado.',true);if(ev){const offline=structuredClone(ev);delete offline.cloudRoomId;delete offline.cloudRole;delete offline.cloudTarget;download(`${escapeFilename(ev.name)}.wascore`,JSON.stringify({fileType:'wa-scoring-competition',schemaVersion:1,exportedAt:timestamp(),event:offline},null,2),'application/json');}return}
if(action==='vacate-entry'){await changeEvent(ev=>{if(ev.locked)throw Error('Sorteo bloqueado');const slot=ev.entries.find(a=>a.number===Number(value));if(slot){ev.entries=ev.entries.map(a=>a.number===slot.number?{number:a.number,vacant:true}:a);ev.draw=[]}});return}
if(action==='draw-event'){await changeEvent(ev=>{if(ev.locked)throw Error('Sorteo bloqueado');ev.draw=makeDraw(ev)});return}
if(action==='lock-draw'){await changeEvent(ev=>{if(!ev.draw.length)throw Error('Primero realiza el sorteo');ev.locked=true});return}
if(action==='unlock-draw'){if(!confirmAction('¿Desbloquear el sorteo? Podrás modificar las inscripciones y realizar un nuevo sorteo.'))return;await changeEvent(ev=>{if(eventState(ev)==='running'||ev.cloudRoomId)throw Error('No se puede desbloquear un sorteo ya publicado o iniciado');ev.locked=false});return}

if(action==='new'){view.page='new';render();return}
if(action==='open'){view.active=value;view.page='detail';view.detailTab='planilla';view.period='all';view.impactScope='all';view.showAll=false;render();return}
if(action==='resume'){view.page='score';render();return}
if(action==='open-detail'){view.page='detail';view.detailTab='planilla';render();return}
if(action==='show-sheet'){view.page='detail';view.detailTab='planilla';view.showAll=true;render();return}
if(action==='detail-tab'){view.detailTab=value;render();return}
if(action==='stats-section'){view.statsSection=value;render();return}
if(action==='period'){view.period=value;render();return}
if(action==='toggle-ends'){view.showAll=!view.showAll;render();return}
if(action==='show-end'){view.impactScope='end';view.impactEnd=Number(value);view.detailTab='impactos';if(!['personal-detail','spectator-detail'].includes(view.page))view.page='detail';render();return}
if(action==='reset-zoom'){resetZoom();return}
if(action==='undo'){await mutate(copy=>{if(copy.current.length)copy.current.pop();else if(copy.ends.length){copy.current=copy.ends.pop();copy.current.pop()}if(copy.status==='finished'&&archersLength(copy)<fmt(copy).maxEnds*fmt(copy).perEnd)copy.status='active'});return}
if(action==='finish'){if(!confirmAction('¿Finalizar el entrenamiento? La planilla quedará en el historial y no aceptará más flechas.'))return;await mutate(copy=>copy.status='finished');view.page='detail';render();return}
if(action==='export-session'&&s){exportArchive([s],s.title);return}
if(action==='export-csv'&&s){exportCsv(s);return}
if(action==='backup-all'){exportArchive(sessions,'WA-Scoring-Respaldo-Completo');return}
if(action==='print'&&s){window.print();return}
if(action==='delete'&&s){if(!confirmAction(`¿Eliminar definitivamente «${s.title}»? Esta acción no se puede deshacer. Exporta antes un respaldo si quieres conservarla.`))return;try{await destroy(s.id);view.active=null;view.page='history';alertMsg('La sesión fue eliminada.')}catch(err){alertMsg(`No se pudo eliminar: ${err.message}`,true)}return}
});
// Actualización inmediata del marcador: tras 6 puntos se deshabilitan los sets posteriores.
app.addEventListener('input',evt=>{
 const form=evt.target.closest('#eliminationScoreForm');if(!form)return;
 const ev=events.find(x=>x.id===view.activeEvent),g=ev?.eliminations?.groups?.[view.elimGroup],id=form.querySelector('[name="matchId"]')?.value;
 const m=id==='BRONZE'?g?.bronze:g?.matches?.find(x=>x.id===id);if(!g||!m)return;
 let pa=0,pb=0,decided=-1;
 for(let i=0;i<5;i++){
  const aa=form.querySelector(`[name="a${i}"]`),bb=form.querySelector(`[name="b${i}"]`);
  if(decided>=0){aa.disabled=true;bb.disabled=true;aa.value='';bb.value='';aa.closest('[data-set-row]').hidden=true;continue;}
  aa.disabled=false;bb.disabled=false;aa.closest('[data-set-row]').hidden=false;
  if(aa.value===''||bb.value==='')break;
  const a=Number(aa.value),b=Number(bb.value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>30||b<0||b>30)break;
  if(g.mode==='sets') {pa+=a>b?2:a===b?1:0;pb+=b>a?2:a===b?1:0;if(pa>=6||pb>=6)decided=i;}
  else{pa+=a;pb+=b;}
 }
 const msg=form.querySelector('#elimLiveEnd');if(msg)msg.textContent=decided>=0?`Resultado decidido en el set ${decided+1}: ${pa}–${pb}. No corresponde otro set.`:g.mode==='sets'?`Puntos parciales de set: ${pa}–${pb}. Se juega hasta 6 o 5–5 con desempate.`:`Marcador acumulado parcial: ${pa}–${pb}.`;
});
app.addEventListener('submit',async evt=>{
if(evt.target.id==='elimTransferAllForm'){
 evt.preventDefault();const ev=events.find(x=>x.id===view.activeEvent),d=new FormData(evt.target),source=String(d.get('oldUid')||''),dest=String(d.get('newUid')||'');
 if(!ev||cloudState.role!=='organizer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache)return alertMsg('Organizador no sincronizado.',true);
 const items=cloudState.tasks.filter(t=>t.status==='active'&&t.assigneeUid===source).map(t=>({id:t.id,revision:t.revision}));
 if(source===dest||!items.length||!cloudState.members.some(m=>m.uid===dest))return alertMsg('Selecciona dos teléfonos diferentes y al menos un encuentro activo.',true);
 if(scorerActiveCount(dest)+items.length>3)return alertMsg('Ese teléfono superaría el máximo de 3 encuentros activos. Elige otro teléfono o reasigna encuentros por separado.',true);
 if(!confirmAction(`¿Transferir ${items.length} encuentro(s) al nuevo teléfono? El anterior perderá el permiso de anotación para todos ellos.`))return;
 try{view.busy=true;const n=await cloudState.api.transferEliminationTasks(ev.cloudRoomId,source,dest,items);view.busy=false;alertMsg(`${n} encuentros transferidos; las puntuaciones se conservaron.`);}
 catch(err){view.busy=false;alertMsg('No se pudo transferir: '+eliminationAssignError(err),true)}return;
}
if(evt.target.id==='elimAssignForm'){
 evt.preventDefault();const ev=events.find(x=>x.id===view.activeEvent),form=new FormData(evt.target);
 if(!ev||cloudState.role!=='organizer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache||view.busy)return alertMsg('El organizador debe estar sincronizado y no tener otra operación pendiente.',true);
 const key=String(form.get('groupKey')||''),matchId=String(form.get('matchId')||''),uid=String(form.get('scorerUid')||''),target=Number(form.get('target'));
 // No se recibe modalidad ni primer tirador desde este formulario.
 if(!cloudState.members.some(m=>m.uid===uid))return alertMsg('El teléfono no está autorizado.',true);
 if(scorerActiveCount(uid,eliminationTaskFor(key,matchId)?.id||'')>=3)return alertMsg('Este teléfono ya tiene 3 encuentros activos. Libera uno o selecciona otro.',true);
 if(!confirmAction('¿Asignar este encuentro al teléfono seleccionado? Si antes lo tenía otro dispositivo, perderá inmediatamente permiso para anotar.'))return;
 try{view.busy=true;await cloudState.api.assignEliminationTask(ev.cloudRoomId,key,matchId,target,uid);view.busy=false;alertMsg('Encuentro asignado; el teléfono verá su planilla.');}
 catch(err){view.busy=false;alertMsg('No se pudo asignar: '+eliminationAssignError(err),true)}return;
}
if(evt.target.id==='elimRemoteScoreForm'){
 evt.preventDefault();const d=new FormData(evt.target),task=cloudState.tasks.find(t=>t.id===String(d.get('taskId')));
 if(!task||cloudState.role!=='scorer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache)return alertMsg('Sin autorización o sincronización confirmada.',true);
 const aShots=[0,1,2].map(i=>String(d.get('a'+i)||'').trim().toUpperCase());
 const bShots=[0,1,2].map(i=>String(d.get('b'+i)||'').trim().toUpperCase());
 try{view.busy=true;const saved=await cloudState.api.writeEliminationSet(cloudState.roomId,task.id,task.revision,aShots,bShots);retainConfirmedEliminationTask(saved);view.busy=false;alertMsg('Tanda sincronizada en Firebase.');}
 catch(err){const detail=await explainEliminationConflict(err,task.id);view.busy=false;alertMsg(detail||'No se guardó: '+err.message,true)}return;
}
if(evt.target.id==='elimScorerConfirmForm'){
 evt.preventDefault();const d=new FormData(evt.target),task=cloudState.tasks.find(t=>t.id===String(d.get('taskId')));
 if(!task||cloudState.role!=='scorer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache||view.busy)return alertMsg('Espera la sincronización de Firebase.',true);
 const shootOff=d.get('shootOff')?Number(d.get('shootOff')):null;
 if(!confirmAction('¿Confirmas con los arqueros el resultado del encuentro? Quedará bloqueado en este teléfono y enviado al organizador para su ratificación.'))return;
 try{view.busy=true;const saved=await cloudState.api.submitEliminationTask(cloudState.roomId,task.id,task.revision,shootOff);retainConfirmedEliminationTask({id:task.id,...saved});view.busy=false;alertMsg('Resultado confirmado por el tanteador. Encuentro liberado; pendiente de ratificación del organizador.');}
 catch(err){const detail=await explainEliminationConflict(err,task.id);view.busy=false;alertMsg(detail||'No se pudo entregar el resultado: '+err.message,true)}return;
}
if(evt.target.id==='elimCloseForm'){
 evt.preventDefault();const ev=events.find(x=>x.id===view.activeEvent),d=new FormData(evt.target),task=cloudState.tasks.find(t=>t.id===String(d.get('taskId')));
 if(!ev||!task||cloudState.role!=='organizer'||!cloudState.ready||cloudState.fromCache||cloudState.tasksFromCache)return alertMsg('Sincronización no confirmada.',true);
 const winner=d.get('shootOff')?Number(d.get('shootOff')):task.shootOff||null,group=cloudState.brackets?.[task.groupKey];
 if(!group||!seedingIsCurrent(ev,group))return alertMsg('La clasificación cambió o la llave no está sincronizada.',true);
 if(!confirmAction('¿Confirmar el marcador oficial? El ganador avanzará, se cerrará la planilla y se liberará este encuentro del teléfono anotador.'))return;
 try{view.busy=true;await cloudState.api.closeEliminationTask(ev.cloudRoomId,task.id,task.revision,group.revision,winner);view.busy=false;alertMsg('Resultado validado. Encuentro liberado y ganador avanzado.');}
 catch(err){view.busy=false;alertMsg('No se pudo validar: '+err.message,true)}return;
}
if(evt.target.classList.contains('elim-create-form')){evt.preventDefault();const ev=events.find(x=>x.id===view.activeEvent),d=new FormData(evt.target),category=evt.target.dataset.category;
 if(!ev||ev.cloudRole==='scorer')return;const players=eliminationParticipants(ev).get(category)||[];
 if(!players.length||players.some(x=>!x.validated))return alertMsg('Todas las planillas de esta categoría deben estar validadas.',true);
 if(players.some((p,i)=>players.some((q,j)=>j<i&&p.points===q.points))&&!d.has('confirmed'))return alertMsg('Confirma primero el orden oficial de los empates.',true);
 try{const key=eliminationKey(category);if(ev.eliminations?.groups?.[key])throw Error('Esta categoría ya tiene una llave creada.');
 const group=window.WA_ELIM.makeGroup(category,players,Number(d.get('size')),String(d.get('officialOrder')||'').trim());await saveEliminationGroup(ev,key,group);
 }catch(err){alertMsg('No se pudo generar la llave: '+err.message,true)}return;}
if(evt.target.id==='eliminationScoreForm'){evt.preventDefault();const ev=events.find(x=>x.id===view.activeEvent),key=view.elimGroup,group=ev?.eliminations?.groups?.[key];
 if(!group)return alertMsg('Selecciona una llave.',true);const d=new FormData(evt.target),id=String(d.get('matchId')||''),match=id==='BRONZE'?group.bronze:group.matches.find(m=>m.id===id);
 if(!match)return alertMsg('Enfrentamiento no encontrado.',true);if(cloudState.tasks.some(t=>t.groupKey===key&&t.matchId===id&&t.status==='active'))return alertMsg('Este encuentro tiene anotador remoto activo. Debes validar su registro desde el panel remoto.',true);const ends=[];let gap=false;
 try{for(let i=0;i<5;i++){const aa=String(d.get('a'+i)||'').trim(),bb=String(d.get('b'+i)||'').trim();if(!aa&&!bb){gap=true;continue;}
 if(gap||aa===''||bb==='')throw Error('Anota ambos subtotales y completa las tandas en orden.');
 const a=Number(aa),b=Number(bb);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>30||b<0||b>30)throw Error('Cada tanda debe sumar entre 0 y 30.');ends.push({a,b});}
 const shootOff=String(d.get('shootOff')||'');const winner=shootOff?Number(shootOff):null;
 if(winner&&![match.a,match.b].includes(winner))throw Error('El ganador de desempate no corresponde al encuentro.');
 const next=window.WA_ELIM.setMatch(group,id,ends,winner);await saveEliminationGroup(ev,key,next);
 }catch(err){alertMsg('No se pudo anotar el enfrentamiento: '+err.message,true)}return;}
if(evt.target.id==='spectatorJoinForm'){evt.preventDefault();const room=String(new FormData(evt.target).get('room')||'').trim();try{await openSpectatorRoom(room)}catch(err){alertMsg(err.message,true)}return}if(evt.target.id==='cloudJoinForm'){evt.preventDefault();const data=new FormData(evt.target);const room=String(data.get('room')||'').trim();const target=Number(data.get('target'));const name=String(data.get('name')||'').trim();try{await joinCloud(room,target,name)}catch(err){cloudState.pending=false;alertMsg('No se pudo enviar la solicitud: '+err.message,true)}return;}
if(evt.target.id==='eventCreateForm'){evt.preventDefault();const data=new FormData(evt.target),name=String(data.get('eventName')||'').trim(),date=String(data.get('date')||''),formatId=String(data.get('format')||'');if(!name||!formats[formatId]||!/^\d{4}-\d\d-\d\d$/.test(date))return alertMsg('Completa los datos de la competencia.',true);const testMode=data.get('testMode')==='yes';const ev={id:uid(),name:testMode?'[PRUEBA] '+name.slice(0,109):name,date,formatId,testMode,createdAt:timestamp(),updatedAt:timestamp(),entries:[],draw:[],locked:false,preferLeft:false,status:'setup',scorers:[],results:{}};try{await persistEvent(ev);view.activeEvent=ev.id;view.page='event-detail';view.eventTab='roster';render()}catch(err){alertMsg(`No se pudo crear la competencia: ${err.message}`,true)}return;}
if(evt.target.id==='eventDisputeForm'){evt.preventDefault();const slot=selectedCompetitionSlot(),reason=String(new FormData(evt.target).get('reason')||'').trim();if(!slot||reason.length<6)return alertMsg('Describe el motivo del desacuerdo.',true);view.disputeVisible=false;await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number);if(r.status!=='finished'||currentApproval(r).status==='validated')throw Error('Planilla no disponible para esta operación');resetApproval(r);r.validation.status='disputed';r.validation.decision='disagree';r.validation.reason=reason;r.validation.disputedAt=timestamp()});return;}
if(evt.target.id==='eventCorrectionForm'){evt.preventDefault();const slot=selectedCompetitionSlot(),d=new FormData(evt.target),actor=String(d.get('actor')||'').trim(),reason=String(d.get('reason')||'').trim();if(!slot||actor.length<3||reason.length<8)return alertMsg('Indica el nombre del autorizante y el motivo (mínimo 8 caracteres).',true);if(!confirmAction('Se archivará la versión anterior íntegra, incluidas sus firmas, y se permitirá corregir la planilla mediante Deshacer. ¿Confirmas?'))return;view.correctionVisible=false;await changeEvent(ev=>{const r=ensureSlotResult(ev,slot.number),v=currentApproval(r);if(!['validated','disputed'].includes(v.status))throw Error('La revisión solo aplica a una planilla validada o en disputa');r.revisions||=[];r.revisions.push({at:timestamp(),actor,reason,score:sum(slotAllShots(r)),snapshot:structuredClone({ends:r.ends,current:r.current,status:r.status,validation:r.validation})});r.status='active';resetApproval(r)});return;}
if(evt.target.id==='scorerForm'){evt.preventDefault();const data=new FormData(evt.target),target=Number(data.get('target')),name=String(data.get('name')||'').trim();if(!name||name.length>90)return alertMsg('Ingresa el nombre del anotador.',true);await changeEvent(ev=>{if(chosenMode(ev)!=='local'||eventState(ev)!=='setup'||!ev.locked||!eventTargets(ev).includes(target))throw Error('Solo puedes registrar anotadores después de confirmar el sorteo y antes de iniciar');ev.scorers=ev.scorers.filter(x=>x.target!==target);ev.scorers.push({target,name})});return;}
if(evt.target.id==='eventEntryForm'){evt.preventDefault();const d=new FormData(evt.target),name=String(d.get('name')||'').trim(),number=Number(d.get('number'));if(!name||name.length>100||!Number.isInteger(number))return alertMsg('Completa correctamente el nombre y número.',true);await changeEvent(ev=>{if(ev.locked)throw Error('Sorteo bloqueado');const participant={number,name,division:String(d.get('division')),age:String(d.get('age')),level:String(d.get('level')),gender:String(d.get('gender')),hand:String(d.get('hand')),vacant:false};if(ev.entries.some(a=>a.number===number&&!a.vacant))throw Error('Número ocupado');const idx=ev.entries.findIndex(a=>a.number===number);if(idx>=0)ev.entries[idx]=participant;else ev.entries.push(participant);ev.entries.sort((a,b)=>a.number-b.number);ev.draw=[];});return;}
});
// Actualización inmediata del marcador: tras 6 puntos se deshabilitan los sets posteriores.
app.addEventListener('input',evt=>{
 const form=evt.target.closest('#eliminationScoreForm');if(!form)return;
 const ev=events.find(x=>x.id===view.activeEvent),g=ev?.eliminations?.groups?.[view.elimGroup],id=form.querySelector('[name="matchId"]')?.value;
 const m=id==='BRONZE'?g?.bronze:g?.matches?.find(x=>x.id===id);if(!g||!m)return;
 let pa=0,pb=0,decided=-1;
 for(let i=0;i<5;i++){
  const aa=form.querySelector(`[name="a${i}"]`),bb=form.querySelector(`[name="b${i}"]`);
  if(decided>=0){aa.disabled=true;bb.disabled=true;aa.value='';bb.value='';aa.closest('[data-set-row]').hidden=true;continue;}
  aa.disabled=false;bb.disabled=false;aa.closest('[data-set-row]').hidden=false;
  if(aa.value===''||bb.value==='')break;
  const a=Number(aa.value),b=Number(bb.value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>30||b<0||b>30)break;
  if(g.mode==='sets') {pa+=a>b?2:a===b?1:0;pb+=b>a?2:a===b?1:0;if(pa>=6||pb>=6)decided=i;}
  else{pa+=a;pb+=b;}
 }
 const msg=form.querySelector('#elimLiveEnd');if(msg)msg.textContent=decided>=0?`Resultado decidido en el set ${decided+1}: ${pa}–${pb}. No corresponde otro set.`:g.mode==='sets'?`Puntos parciales de set: ${pa}–${pb}. Se juega hasta 6 o 5–5 con desempate.`:`Marcador acumulado parcial: ${pa}–${pb}.`;
});
app.addEventListener('submit',async evt=>{if(evt.target.id!=='createForm')return;evt.preventDefault();const form=evt.target,data=new FormData(form),archer=String(data.get('archer')||'').trim(),title=String(data.get('sessionTitle')||'').trim(),formatId=String(data.get('format')||'');if(!archer||!title||!formats[formatId])return;const s={id:uid(),createdAt:timestamp(),updatedAt:timestamp(),kind:'training',archerName:archer,title,formatId,status:'active',ends:[],current:[],revision:1};try{await persist(s);rememberTrainingArcherName(archer);view.active=s.id;view.page='score';view.detailTab='planilla';view.zoom=1;view.panX=0;view.panY=0;view.notice='';render()}catch(err){alertMsg(`No se pudo crear el entrenamiento: ${err.message}`,true)}});
app.addEventListener('change',evt=>{if(evt.target.id==='testMode'){const selected=evt.target.checked;const badge=document.getElementById('testModeState');if(badge)badge.textContent=selected?'ACTIVADO':'DESACTIVADO';evt.target.closest('.test-mode-option')?.classList.toggle('test-mode-on',selected);return}if(evt.target.id==='targetSelect'){view.editShot=null;const ev=events.find(x=>x.id===view.activeEvent);const target=Number(evt.target.value);const slots=ev?.draw?.filter(x=>x.target===target)||[];if(slots.length){view.activeTarget=target;view.activePosition=slots[0].position;view.disputeVisible=false;view.correctionVisible=false;view.zoom=1;view.panX=0;view.panY=0;render()}return}if(evt.target.id==='spectatorFilter'){view.spectatorFilter=evt.target.value;render();return}if(evt.target.id==='spectatorLiveFilter'){view.spectatorLiveFilter=evt.target.value;view.spectatorMatchId=null;render();return}if(evt.target.id==='categoryFilter'){view.categoryFilter=evt.target.value;render();return}if(evt.target.id==='impactChoice'){view.impactScope=evt.target.value==='all'?'all':'end';if(view.impactScope==='end')view.impactEnd=Number(evt.target.value);render();return}if(evt.target.id==='importFile'){importFile(evt.target.files?.[0]);evt.target.value='';return}if(evt.target.id==='importEvent'){importEventFile(evt.target.files?.[0]);evt.target.value='';return}if(evt.target.id==='importPersonal'){importPersonalFile(evt.target.files?.[0]);evt.target.value='';return}if(evt.target.id==='leftPriority'){changeEvent(ev=>{if(ev.locked)throw Error('Sorteo bloqueado');ev.preferLeft=evt.target.checked;ev.draw=[]});return}});
app.addEventListener('input',evt=>{if(evt.target.id==='historySearch'){const val=evt.target.value.toLocaleLowerCase('es');document.querySelectorAll('#historyList>.session').forEach(el=>{el.style.display=el.textContent.toLocaleLowerCase('es').includes(val)?'':'none'})}});

// v0.6.4.10: la actualización es voluntaria, solo en una pantalla segura.
// No cerrar un registro abierto, ni recargar si hay una escritura en curso.
window.WAUpdateMayApply = () => {
 if (view.busy) return false;
 const safePages = ['home','history','detail','competitions','personal-history',
   'personal-detail','spectator','spectator-event','spectator-detail','settings'];
 if (!safePages.includes(view.page)) return false;
 // Un tanteador/organizador conectado a una sala en marcha no debe recargarse.
 if (cloudState.connected && cloudState.room?.status === 'running'
     && (cloudState.role === 'scorer' || cloudState.role === 'organizer')) return false;
 return true;
};

async function boot(){try{db=await makeDB();await refresh();await migrateUnclosedEnds();const params=new URLSearchParams(location.search);if(params.has('waSpectate'))view.page='spectator-event';else if(params.has('waRoom'))view.page='cloud-join';render();window.WAUpdates?.start().catch(()=>{});if(params.has('waSpectate')){openSpectatorRoom(params.get('waSpectate')).catch(err=>alertMsg(err.message,true));}else if(params.has('waRoom')){initCloud().then(()=>render()).catch(err=>{cloudState.error=err.message;alertMsg('Firebase no disponible: '+err.message,true)})}else{import('./cloud.js?v=0.6.4.5').then(mod=>{cloudState.api=mod;cloudState.configured=mod.isConfigured;render()}).catch(()=>{})}}catch(err){app.innerHTML=`<div class="card gap" style="margin-top:25px"><h2>No se pudo iniciar el almacenamiento</h2><p class="small">${e(err.message)}</p><p class="small muted">Abre WA Scoring desde un navegador que permita IndexedDB. No registres flechas hasta resolverlo.</p></div>`}}
boot();
})();
