/** WA Scoring — Firebase pilot 0.6.4.5. Solo datos públicos de configuración; jamás serviceAccount/privateKey. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, updateDoc, getDoc, getDocFromServer, getDocs, query, where, onSnapshot, runTransaction, writeBatch, deleteDoc, limit } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
const config=window.WA_FIREBASE_CONFIG||{};
export const isConfigured=Boolean(config.apiKey&&config.projectId&&config.appId&&config.authDomain);
let app,auth,db;
const root='waRooms';
const publicRoot='waPublicEvents';
// Firestore no permite arrays anidados directamente (ends = [[flechas], ...]).
// Guardamos cada tanda como un mapa {shots:[...]}; en la app permanecen arrays normales.
// El mismo formato se usa dentro de las revisiones históricas firmadas.
function packEnds(ends){
 if(!Array.isArray(ends))throw Error('Formato de tandas incorrecto: se esperaba una lista.');
 return ends.map(end=>{
  const shots=Array.isArray(end)?end:end?.shots;
  if(!Array.isArray(shots))throw Error('Formato de tanda incompatible: no se envió ninguna flecha.');
  return {shots};
 });
}
function unpackEnds(ends){
 if(!Array.isArray(ends))throw Error('La planilla recibida no contiene una lista de tandas válida.');
 return ends.map(end=>{
  const shots=Array.isArray(end)?end:end?.shots;
  if(!Array.isArray(shots))throw Error('Una tanda recibida de Firebase tiene formato desconocido.');
  return shots;
 });
}
function packRevisions(revisions){
 if(!Array.isArray(revisions))throw Error('Historial de revisiones inválido.');
 return revisions.map(r=>r?.snapshot?{...r,snapshot:{...r.snapshot,ends:packEnds(r.snapshot.ends||[])}}:r);
}
function unpackRevisions(revisions){
 if(!Array.isArray(revisions))throw Error('Historial de revisiones recibido inválido.');
 return revisions.map(r=>r?.snapshot?{...r,snapshot:{...r.snapshot,ends:unpackEnds(r.snapshot.ends||[])}}:r);
}
function toFirestoreCard(card){
 return {...card,ends:packEnds(card.ends||[]),revisions:packRevisions(card.revisions||[])};
}
function fromFirestoreCard(card){
 return {...card,ends:unpackEnds(card.ends||[]),revisions:unpackRevisions(card.revisions||[])};
}

function assertReady(){if(!db||!auth?.currentUser)throw Error('Firebase no está conectado. Comprueba internet y configuración.');}
export function currentUid(){return auth?.currentUser?.uid||null}
export async function initialize(){
 if(!isConfigured)throw Error('Falta configurar firebase-config.js (consulta INSTALACION_FIREBASE.md).');
 if(db)return currentUid();
 app=initializeApp(config);auth=getAuth(app);db=getFirestore(app);
 const existing=await new Promise((resolve,reject)=>{let off=()=>{};off=onAuthStateChanged(auth,u=>{off();resolve(u)},reject)});
 if(!existing)await signInAnonymously(auth);
 return currentUid();
}
export async function publish(ev){
 assertReady();if(ev.status!=='setup'||ev.annotationMode!=='cloud'||!ev.locked||!ev.draw?.length)throw Error('Confirma el sorteo y elige Firebase antes de publicar.');
 if(ev.draw.length>180)throw Error('Piloto limitado a 180 arqueros por competencia; se ampliará tras las pruebas.');
 const ref=doc(collection(db,root));const roomId=ref.id;
 const metadata={ownerUid:currentUid(),sourceEventId:ev.id,name:ev.name,date:ev.date,formatId:ev.formatId,entries:ev.entries,draw:ev.draw,scorers:ev.scorers||[],targets:[...new Set(ev.draw.map(x=>x.target))],preferLeft:!!ev.preferLeft,locked:true,status:'publishing',schemaVersion:1,createdAt:new Date().toISOString()};
 if(JSON.stringify(metadata).length>550000)throw Error('La lista de inscripción supera el límite del piloto.');
 await setDoc(ref,metadata);
 // Cada planilla es un documento independiente: no hay escritura del evento completo al anotar.
 const chunks=[];let batch=writeBatch(db),n=0;
 for(const slot of ev.draw){
  const key=String(slot.number),r=ev.results?.[key]||{ends:[],current:[],status:'active'};
  const card={number:slot.number,target:slot.target,position:slot.position,revision:0,ends:r.ends||[],current:r.current||[],status:r.status||'active',validation:r.validation||{status:'pending',decision:null,archerSignature:null,scorerSignature:null},revisions:r.revisions||[],lastWriterUid:currentUid(),updatedAt:new Date().toISOString()};
  if(JSON.stringify(card).length>850000)throw Error(`La planilla ${slot.number} es demasiado grande para Firestore; no se puede publicar.`);
  batch.set(doc(ref,'cards',key),toFirestoreCard(card));n++;if(n===350){chunks.push(batch);batch=writeBatch(db);n=0}
 }
 if(n)chunks.push(batch);
 for(const b of chunks)await b.commit();
 await updateDoc(ref,{status:'waiting'});
 return roomId;
}
export async function requestJoin(roomId,target,name){
 assertReady();if(!/^[\w-]{20,24}$/.test(roomId))throw Error('El código de sala no tiene el formato esperado.');
 if(!Number.isInteger(target)||target<1||target>500)throw Error('Parapeto incorrecto.');
 if(name.trim().length<3||name.trim().length>90)throw Error('Escribe tu nombre (3 a 90 caracteres).');
 const self=doc(db,root,roomId,'requests',currentUid());
 await setDoc(self,{uid:currentUid(),target,name:name.trim(),requestedAt:new Date().toISOString()});
}
export function watchAdmission(roomId,accept,reject){
 assertReady();return onSnapshot(doc(db,root,roomId,'members',currentUid()),snap=>{
  if(snap.exists())accept(snap.data());
 },reject);
}
export function watchRoom(roomId,target,organizer,{onRoom,onCards,onRequests,onMembers,onBrackets,onTasks,onError}){
 assertReady();const stops=[];const ref=doc(db,root,roomId);
 stops.push(onSnapshot(ref,s=>{if(!s.exists())return onError(Error('La sala ya no existe'));onRoom(s.data());},onError));
 const cards=collection(ref,'cards');
 stops.push(onSnapshot(organizer?cards:query(cards,where('target','==',target)),snap=>{
  const rows=[];snap.forEach(x=>rows.push([x.id,fromFirestoreCard(x.data())]));onCards(rows,snap.metadata.fromCache);
 },onError));
 if(organizer)stops.push(onSnapshot(collection(ref,'eliminations'),snap=>{const groups={};snap.forEach(x=>groups[x.id]=x.data());onBrackets(groups);},onError));
 const jobs=collection(ref,'elimTasks');
 stops.push(onSnapshot(organizer?jobs:query(jobs,where('assigneeUid','==',currentUid())),snap=>{
  onTasks(snap.docs.map(d=>({id:d.id,...d.data()})),snap.metadata.fromCache);
 },onError));
 if(organizer)stops.push(onSnapshot(collection(ref,'members'),snap=>{
   const members=[];snap.forEach(x=>members.push({uid:x.id,...x.data()}));onMembers(members);
  },onError));
 if(organizer)stops.push(onSnapshot(collection(ref,'requests'),snap=>{
  const requests=[];snap.forEach(x=>requests.push({uid:x.id,...x.data()}));onRequests(requests);
 },onError));
 return ()=>stops.forEach(stop=>stop());
}
export async function approve(roomId,uid,target){
 assertReady();if(!/^[\w-]{20,24}$/.test(roomId)||!uid||!Number.isInteger(target)||target<1||target>500)throw Error('Autorización incorrecta');
 const reqSnap=await getDoc(doc(db,root,roomId,'requests',uid));
 if(!reqSnap.exists()||reqSnap.data().target!==target)throw Error('La solicitud cambió; actualiza la pantalla.');
 const roomSnap=await getDoc(doc(db,root,roomId));
 if(roomSnap.data()?.ownerUid!==currentUid()||!roomSnap.data().targets.includes(target))throw Error('Sin autorización para asignar este parapeto');
 await setDoc(doc(db,root,roomId,'members',uid),{uid,role:'scorer',target,name:reqSnap.data().name,approvedAt:new Date().toISOString()});
 await deleteDoc(doc(db,root,roomId,'requests',uid));
}
export async function startRoom(roomId,requiredTargets){
 assertReady();const ref=doc(db,root,roomId);
 const snapshot=await getDocs(collection(ref,'members'));
 const approved=new Set(snapshot.docs.filter(x=>x.data().role==='scorer').map(x=>Number(x.data().target)));
 if(!Array.isArray(requiredTargets)||!requiredTargets.length||!requiredTargets.every(t=>approved.has(t)))
  throw Error('Hay parapetos sin anotador aprobado. No se inició la competencia.');
 await runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists()||snap.data().ownerUid!==currentUid()||snap.data().status!=='waiting')throw Error('La sala no está esperando el inicio o no eres el organizador.');
  tx.update(ref,{status:'running'});
 });
}
export async function updateCard(roomId,number,expectedRevision,nextResult){
 assertReady();const ref=doc(db,root,roomId,'cards',String(number));
 const result=structuredClone(nextResult);
 const publicRef=doc(db,publicRoot,roomId),publicCardRef=doc(publicRef,'scores',String(number));
 if(JSON.stringify(result).length>800000)throw Error('La planilla supera el tamaño permitido por Firestore. Exporta un respaldo y consulta al organizador.');
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  const published=await tx.get(publicRef);
  if(!snap.exists())throw Error('Planilla no encontrada en el servidor');
  const previous=snap.data();
  if(previous.revision!==expectedRevision)throw Error('CONFLICTO: la planilla cambió en otro teléfono. Se mostrará la versión más reciente; verifica antes de repetir el toque.');
  const card={...previous,ends:result.ends,current:result.current,status:result.status,validation:result.validation||{status:'pending',decision:null,archerSignature:null,scorerSignature:null},revisions:result.revisions||[],revision:previous.revision+1,lastWriterUid:currentUid(),updatedAt:new Date().toISOString()};
  tx.update(ref,toFirestoreCard(card));
  if(published.exists())tx.set(publicCardRef,publicScore(card));
  return card;
 });
}

// Eliminatorias: SOLO el organizador modifica una llave y solo con revisión confirmada.
// Los enfrentamientos se escriben en una colección independiente; no tocan planillas firmadas.
export async function saveElimination(roomId,key,group,expectedRevision){
 assertReady();if(!/^g_[A-Za-z0-9_.~-]+$/.test(key)||key.length>300)throw Error('Identificador de llave incorrecto.');
 const ref=doc(db,root,roomId,'eliminations',key),publicRef=doc(db,publicRoot,roomId),publicBracket=doc(publicRef,'eliminations',key);
 return runTransaction(db,async tx=>{
  const roomSnap=await tx.get(doc(db,root,roomId)),old=await tx.get(ref),published=await tx.get(publicRef);
  if(!roomSnap.exists()||roomSnap.data().ownerUid!==currentUid()||roomSnap.data().status!=='running')throw Error('Solo el organizador con la competencia iniciada puede editar llaves.');
  const prior=old.exists()?old.data().revision:-1;
  if(prior!==expectedRevision)throw Error('CONFLICTO: la llave fue modificada en otro dispositivo. Revisa la versión más reciente antes de continuar.');
  const data={category:group.category,size:group.size,mode:group.mode,seeds:group.seeds,qualification:group.qualification,matches:group.matches,bronze:group.bronze,
    createdAt:old.exists()?old.data().createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:prior+1};
  if(JSON.stringify(data).length>180000)throw Error('Llave supera el tamaño seguro del piloto.');
  tx.set(ref,data);if(published.exists())tx.set(publicBracket,data);
  return data;
 });
}

// 0.6.2: Los encuentros de eliminación son tareas independientes de las planillas
// de clasificación. Los permisos se comprueban en las reglas y en transacciones.
function taskKey(groupKey,matchId){
 if(!/^g_[A-Za-z0-9_.~-]+$/.test(groupKey)||! /^(R[1-5]M\d{1,2}|BRONZE)$/.test(matchId))throw Error('Identificador de encuentro inválido.');
 return `${groupKey}~${matchId}`;
}
function arrowSubtotal(values){
 if(!Array.isArray(values)||values.length!==3)throw Error('Anota exactamente tres flechas por arquero.');
 return values.reduce((sum,raw)=>{
  const v=String(raw).toUpperCase().trim();
  if(!/^(X|M|10|[0-9])$/.test(v))throw Error('Flecha inválida: escribe X, M o un valor de 0 a 10.');
  return sum+(v==='X'?10:v==='M'?0:Number(v));
 },0);
}
function nextSetResult(task,ends,shootOff=null){
 if(!window.WA_ELIM?.result)throw Error('El motor de eliminatorias no está disponible.');
 return window.WA_ELIM.result({a:task.a,b:task.b,ends,shootOff},task.mode);
}
function taskRecord(task,ends){return {...task,ends,shootOff:null};}
// Proyección deportiva exclusivamente pública. NUNCA incluye UID, permisos, firmas ni revisiones privadas.
function publicEliminationTask(task){
 return {groupKey:task.groupKey,matchId:task.matchId,category:task.category,mode:task.mode,
  a:task.a,b:task.b,target:task.target,status:task.status,shootOff:task.shootOff||null,shootingMode:task.shootingMode||"simultaneous",firstSide:task.firstSide||null,
  ends:(task.ends||[]).map(end=>({a:end.a,b:end.b,aShots:end.aShots||[],bShots:end.bShots||[]})),
  current:{aShots:task.current?.aShots||[],bShots:task.current?.bShots||[]},
  revision:task.revision,updatedAt:task.updatedAt};
}
function publicLiveRef(roomId,id){return doc(db,publicRoot,roomId,'elimLive',id);}

// PILOTO 0.6.4.3: comprobación de cupos. El conteo se revisa nuevamente
// dentro de la transacción para detectar cambios en asignaciones conocidas.
// No constituye garantía de concurrencia contra dos creaciones simultáneas
// por organizadores distintos: requiere control de capacidad en el servidor.
const MAX_ACTIVE_TASKS_PER_SCORER=3;
async function assignedTaskRefs(roomRef,uid){
 const snapshot=await getDocs(query(collection(roomRef,'elimTasks'),where('assigneeUid','==',uid)));
 return snapshot.docs.map(d=>d.ref);
}
async function assertAvailableCapacity(tx,refs,excludedIds,newCount){
 let active=0;
 for(const ref of refs){
  const snap=await tx.get(ref);
  if(snap.exists()&&snap.data().status==='active'&&!excludedIds.has(ref.id))active++;
 }
 if(active+newCount>MAX_ACTIVE_TASKS_PER_SCORER)
  throw Error(`Este teléfono ya tiene ${active} encuentro(s) activo(s). Máximo: ${MAX_ACTIVE_TASKS_PER_SCORER}. Libera otro encuentro o elige otro teléfono.`);
}

// Modo predeterminado aprobado para este piloto: simultáneo hasta octavos,
// alternado desde cuartos (y bronce). Solo se deriva de la llave publicada;
// nunca de un campo del formulario ni del teléfono anotador.
function eliminationShootingModeByStage(group,match,matchId){
 const size=Number(group?.size);
 if(![8,16,32].includes(size))throw Error('El tamaño de llave no permite determinar la modalidad automática.');
 if(matchId==='BRONZE')return 'alternating';
 const maxRound=Math.log2(size)-1;
 if(!Number.isInteger(match?.round)||match.round<0||match.round>maxRound)
  throw Error('La ronda del encuentro no es válida para decidir el orden de tiro.');
 return match.round>=maxRound-2?'alternating':'simultaneous';
}
export async function assignEliminationTask(roomId,groupKey,matchId,target,scorerUid){
 assertReady();if(!Number.isInteger(target)||target<1||target>500||!scorerUid)throw Error('Selecciona parapeto y teléfono autorizado.');
 const id=taskKey(groupKey,matchId),roomRef=doc(db,root,roomId),ref=doc(roomRef,'elimTasks',id);
 const usedRefs=await assignedTaskRefs(roomRef,scorerUid);
 return runTransaction(db,async tx=>{
  const rs=await tx.get(roomRef),gs=await tx.get(doc(roomRef,'eliminations',groupKey)),ms=await tx.get(doc(roomRef,'members',scorerUid)),before=await tx.get(ref),published=await tx.get(doc(db,publicRoot,roomId));
  if(!rs.exists()||rs.data().ownerUid!==currentUid()||rs.data().status!=='running')throw Error('Solo el organizador puede asignar teléfonos con el torneo iniciado.');
  if(!ms.exists()||ms.data().role!=='scorer')throw Error('Teléfono no autorizado: primero apruébalo en la sala.');
  if(!gs.exists())throw Error('No existe esta llave.');
  const group=gs.data(),match=matchId==='BRONZE'?group.bronze:group.matches.find(x=>x.id===matchId);
  if(!match?.a||!match?.b||match.winner)throw Error('Solo puedes asignar encuentros con dos arqueros y sin ganador.');
  const shootingMode=eliminationShootingModeByStage(group,match,matchId);
  const old=before.exists()?before.data():null;
  if(old&&(old.status!=='active'||old.groupKey!==groupKey||old.matchId!==matchId||old.a!==match.a||old.b!==match.b))throw Error('El encuentro cambió o ya fue validado. Actualiza la llave.');
  await assertAvailableCapacity(tx,usedRefs,new Set([id]),1);
  const aRank=group.seeds?.find(item=>item.number===match.a)?.seed;
  const bRank=group.seeds?.find(item=>item.number===match.b)?.seed;
  if(!old&&shootingMode==='alternating'&&(!Number.isInteger(aRank)||!Number.isInteger(bRank)||aRank===bRank))throw Error('No se pudo determinar quién terminó mejor clasificado; revisa la llave.');
  const choiceOwnerSide=old?.choiceOwnerSide||(Number.isInteger(aRank)&&Number.isInteger(bRank)?(aRank<bRank?'a':'b'):null);
  const now=new Date().toISOString();
  const data=old?{...old,target,assigneeUid:scorerUid,revision:old.revision+1,updatedAt:now,lastWriterUid:currentUid()}:
   {groupKey,matchId,category:group.category,mode:group.mode,a:match.a,b:match.b,target,assigneeUid:scorerUid,status:'active',ends:[],current:{aShots:[],bShots:[]},shootOff:null,shootingMode,firstSide:null,choiceOwnerSide,revision:0,createdAt:now,updatedAt:now,lastWriterUid:currentUid()};
  tx.set(ref,data);if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask(data));return {id,...data};
 });
}

// Reasignación de emergencia de TODOS los encuentros activos de un teléfono.
// Es una transacción indivisible: si alguno cambió, se cancela toda la operación.
export async function transferEliminationTasks(roomId,sourceUid,destinationUid,items){
 assertReady();if(!sourceUid||!destinationUid||sourceUid===destinationUid||!Array.isArray(items)||!items.length||items.length>40)
  throw Error('Selecciona teléfonos distintos y al menos un encuentro activo.');
 if(items.some(item=>!/^g_[A-Za-z0-9_.~-]+~(R[1-5]M\d{1,2}|BRONZE)$/.test(item.id)||!Number.isInteger(item.revision)))
  throw Error('Identificador de tarea incorrecto.');
 const ids=items.map(item=>item.id);if(new Set(ids).size!==ids.length)throw Error('Se repite un encuentro.');
 const roomRef=doc(db,root,roomId);
 const destinationRefs=await assignedTaskRefs(roomRef,destinationUid);
 return runTransaction(db,async tx=>{
  const room=await tx.get(roomRef),destination=await tx.get(doc(roomRef,'members',destinationUid)),published=await tx.get(doc(db,publicRoot,roomId));
  if(!room.exists()||room.data().ownerUid!==currentUid()||room.data().status!=='running')throw Error('Solo el organizador puede transferir teléfonos.');
  if(!destination.exists()||destination.data().role!=='scorer')throw Error('El nuevo teléfono no está autorizado.');
  const records=[];
  for(const item of items){const ref=doc(roomRef,'elimTasks',item.id),snap=await tx.get(ref);
   if(!snap.exists()||snap.data().assigneeUid!==sourceUid||snap.data().status!=='active'||snap.data().revision!==item.revision)
    throw Error('Una asignación cambió mientras transferías. Actualiza el panel y repite; no se movió ninguna.');
   records.push({ref,data:snap.data()});
  }
  await assertAvailableCapacity(tx,destinationRefs,new Set(records.map(x=>x.ref.id)),records.length);
  const now=new Date().toISOString();
  for(const {ref,data} of records){const updated={...data,assigneeUid:destinationUid,revision:data.revision+1,lastWriterUid:currentUid(),updatedAt:now};tx.update(ref,{assigneeUid:destinationUid,revision:updated.revision,lastWriterUid:currentUid(),updatedAt:now});if(published.exists())tx.set(publicLiveRef(roomId,ref.id),publicEliminationTask(updated));}
  return records.length;
 });
}
// El tanteador pregunta al mejor clasificado. Puede corregir antes de la primera flecha;
// nunca durante un set ni después de transferido el teléfono.
export async function chooseEliminationFirstSide(roomId,id,expectedRevision,side){
 assertReady();if(!/^g_[A-Za-z0-9_.~-]+~(R[1-5]M\d{1,2}|BRONZE)$/.test(id)||!['a','b'].includes(side))throw Error('Orden de inicio no válido.');
 const ref=doc(db,root,roomId,'elimTasks',id);
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref),published=await tx.get(doc(db,publicRoot,roomId));
  if(!snap.exists())throw Error('Encuentro no disponible.');
  const task=snap.data();
  if(task.shootingMode!=='alternating'||task.status!=='active'||task.assigneeUid!==currentUid())throw Error('No tienes autorización para elegir el orden de este encuentro.');
  if(task.revision!==expectedRevision)throw Error('CONFLICTO: cambió el encuentro. Actualiza antes de elegir.');
  if((task.ends||[]).length||(task.current?.aShots||[]).length||(task.current?.bShots||[]).length)throw Error('No puedes modificar quién comienza después de la primera flecha.');
  const now=new Date().toISOString(),updated={...task,firstSide:side,revision:task.revision+1,lastWriterUid:currentUid(),updatedAt:now};
  tx.update(ref,{firstSide:updated.firstSide,revision:updated.revision,lastWriterUid:updated.lastWriterUid,updatedAt:now});
  if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask(updated));
  return {id,...updated};
 });
}
export async function writeEliminationSet(roomId,id,expectedRevision,shotsA,shotsB,undo=false){
 assertReady();if(!/^g_[A-Za-z0-9_.~-]+~(R[1-5]M\d{1,2}|BRONZE)$/.test(id))throw Error('Encuentro inválido.');
 const ref=doc(db,root,roomId,'elimTasks',id);
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref),published=await tx.get(doc(db,publicRoot,roomId));if(!snap.exists())throw Error('El encuentro no está asignado.');
  const task=snap.data();
  if(task.assigneeUid!==currentUid()||task.status!=='active')throw Error('Este encuentro ya no está asignado a tu teléfono. No anotes más flechas.');
  if(task.revision!==expectedRevision)throw Error('CONFLICTO: cambió el encuentro o su asignación. Revisa la pantalla antes de continuar.');
  const old=task.ends||[];
  if((task.current?.aShots||[]).length||(task.current?.bShots||[]).length)throw Error('Termina o corrige la tanda actual antes de usar la carga por set.');
  if(!undo&&nextSetResult(task,old).final)throw Error('El enfrentamiento está decidido. Espera la validación del organizador.');
  let ends;if(undo){if(!old.length)throw Error('No hay ninguna tanda para retirar.');ends=old.slice(0,-1)}
  else{
   if(old.length>=5)throw Error('Ya se registraron cinco tandas.');
   const aShots=shotsA.map(v=>String(v).trim().toUpperCase()),bShots=shotsB.map(v=>String(v).trim().toUpperCase());
   ends=[...old,{aShots,bShots,a:arrowSubtotal(aShots),b:arrowSubtotal(bShots)}];
   nextSetResult(task,ends); // prohibición de tandas después de 6 puntos de set
  }
  const updated={...task,ends,revision:task.revision+1,lastWriterUid:currentUid(),updatedAt:new Date().toISOString()};
  tx.update(ref,{ends:updated.ends,revision:updated.revision,lastWriterUid:updated.lastWriterUid,updatedAt:updated.updatedAt});
  if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask(updated));
  return {id,...updated};
 });
}

// Anotación por flecha: una transacción por impacto registrado. Una tanda
// se cierra sola tras recibir tres flechas de cada arquero.
export async function writeEliminationArrow(roomId,id,expectedRevision,side,raw){
 assertReady();if(!/^g_[A-Za-z0-9_.~-]+~(R[1-5]M\d{1,2}|BRONZE)$/.test(id)||!['a','b'].includes(side))throw Error('Encuentro o arquero incorrecto.');
 const value=String(raw).trim().toUpperCase();if(!/^(X|M|10|[0-9])$/.test(value))throw Error('Valor inválido: elige X, 10–0 o M.');
 return runTransaction(db,async tx=>{
  const ref=doc(db,root,roomId,'elimTasks',id),snap=await tx.get(ref),published=await tx.get(doc(db,publicRoot,roomId));
  if(!snap.exists())throw Error('Encuentro no disponible.');const task=snap.data();
  if(task.status!=='active'||task.assigneeUid!==currentUid())throw Error('El organizador ya transfirió o cerró este encuentro.');
  if(task.revision!==expectedRevision)throw Error('CONFLICTO: el marcador cambió. Revisa las flechas antes de repetir.');
  if(task.shootingMode==='alternating'&&!['a','b'].includes(task.firstSide))throw Error('Primero debes registrar quién comienza el primer set.');
  if(nextSetResult(task,task.ends||[]).final||task.ends.length>=5)throw Error('No se admiten flechas: el encuentro terminó o necesita desempate.');
  const current=structuredClone(task.current||{aShots:[],bShots:[]}),key=side==='a'?'aShots':'bShots';
  if(current[key].length>=3)throw Error('Ese arquero ya tiene tres flechas en esta tanda.');
  current[key].push(value);
  let ends=[...(task.ends||[])];
  if(current.aShots.length===3&&current.bShots.length===3){
   ends.push({aShots:current.aShots,bShots:current.bShots,a:arrowSubtotal(current.aShots),b:arrowSubtotal(current.bShots)});
   nextSetResult(task,ends);current.aShots=[];current.bShots=[];
  }
  const updated={...task,current,ends,revision:task.revision+1,lastWriterUid:currentUid(),updatedAt:new Date().toISOString()};
  tx.update(ref,{current,ends,revision:updated.revision,lastWriterUid:updated.lastWriterUid,updatedAt:updated.updatedAt});
  if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask(updated));
  return {id,...updated};
 });
}
// Lectura explícita del servidor para diagnosticar conflictos de revisión.
// getDocFromServer evita confundir una copia de caché con flechas guardadas.
export async function fetchEliminationTask(roomId,id){
 assertReady();
 if(!/^g_[A-Za-z0-9_.~-]+~(R[1-5]M\d{1,2}|BRONZE)$/.test(id))throw Error('Encuentro inválido.');
 const snapshot=await getDocFromServer(doc(db,root,roomId,'elimTasks',id));
 if(!snapshot.exists())throw Error('El encuentro ya no existe.');
 return {id,...snapshot.data()};
}
export async function undoEliminationArrow(roomId,id,expectedRevision,side){
 assertReady();if(!/^g_[A-Za-z0-9_.~-]+~(R[1-5]M\d{1,2}|BRONZE)$/.test(id)||!['a','b'].includes(side))throw Error('Encuentro incorrecto.');
 return runTransaction(db,async tx=>{
  const ref=doc(db,root,roomId,'elimTasks',id),snap=await tx.get(ref),published=await tx.get(doc(db,publicRoot,roomId));
  if(!snap.exists())throw Error('Encuentro no encontrado.');const task=snap.data();
  if(task.status!=='active'||task.assigneeUid!==currentUid())throw Error('Ya no tienes permiso de anotación.');
  if(task.revision!==expectedRevision)throw Error('CONFLICTO: hubo otra anotación. Actualiza antes de corregir.');
  const current=structuredClone(task.current||{aShots:[],bShots:[]}),ends=[...(task.ends||[])],key=side==='a'?'aShots':'bShots';
  if(!current[key].length){
   if(current.aShots.length||current.bShots.length||!ends.length)throw Error('No hay flechas de este arquero para deshacer en la tanda actual.');
   const last=ends.pop();current.aShots=[...last.aShots];current.bShots=[...last.bShots];
  }
  if(!current[key].length)throw Error('No hay flecha que corregir.');
  current[key].pop();
  const updated={...task,current,ends,revision:task.revision+1,lastWriterUid:currentUid(),updatedAt:new Date().toISOString()};
  tx.update(ref,{current,ends,revision:updated.revision,lastWriterUid:updated.lastWriterUid,updatedAt:updated.updatedAt});
  if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask(updated));
  return {id,...updated};
 });
}
// Firma de entrega del anotador. Deja el encuentro SIN permiso de nuevas flechas
// y su cupo disponible, pero NO altera la llave hasta la revisión del organizador.
export async function submitEliminationTask(roomId,id,expectedRevision,shootOff=null){
 assertReady();const taskRef=doc(db,root,roomId,'elimTasks',id),roomRef=doc(db,root,roomId),publicRef=doc(db,publicRoot,roomId);
 return runTransaction(db,async tx=>{
  const [room,record,published]=await Promise.all([tx.get(roomRef),tx.get(taskRef),tx.get(publicRef)]);
  if(!room.exists()||room.data().status!=='running'||!record.exists())throw Error('Encuentro no disponible.');
  const task=record.data();
  if(task.assigneeUid!==currentUid()||task.status!=='active'||task.revision!==expectedRevision)throw Error('El encuentro fue cambiado o reasignado. Recarga antes de confirmar.');
  if((task.current?.aShots||[]).length||(task.current?.bShots||[]).length)throw Error('Quedan flechas de la tanda sin terminar.');
  const selected=shootOff||null;
  if(selected&&![task.a,task.b].includes(selected))throw Error('Desempate inválido.');
  const outcome=nextSetResult(task,task.ends||[],selected);
  if(!outcome.final)throw Error('Todavía no hay ganador. Completa los sets o registra el desempate resuelto por el juez.');
  const now=new Date().toISOString();
  const next={...task,status:'submitted',shootOff:selected,revision:task.revision+1,lastWriterUid:currentUid(),updatedAt:now};
  tx.update(taskRef,{status:'submitted',shootOff:selected,revision:next.revision,lastWriterUid:next.lastWriterUid,updatedAt:now});
  if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask(next));
  return next;
 });
}

// Una sola transacción valida el marcador, actualiza la llave, cierra el cupo
// y publica la llave si el organizador habilitó espectadores previamente.
export async function closeEliminationTask(roomId,id,expectedTaskRevision,expectedGroupRevision,shootOff=null){
 assertReady();const cut=id.lastIndexOf('~');if(cut<0)throw Error('Identificador de encuentro inválido.');
 const groupKey=id.slice(0,cut),matchId=id.slice(cut+1);taskKey(groupKey,matchId);
 const roomRef=doc(db,root,roomId),taskRef=doc(roomRef,'elimTasks',id),groupRef=doc(roomRef,'eliminations',groupKey),publicRef=doc(db,publicRoot,roomId),publicGroup=doc(publicRef,'eliminations',groupKey);
 return runTransaction(db,async tx=>{
  const roomSnap=await tx.get(roomRef),t=await tx.get(taskRef),g=await tx.get(groupRef),published=await tx.get(publicRef);
  if(!roomSnap.exists()||roomSnap.data().ownerUid!==currentUid()||roomSnap.data().status!=='running')throw Error('Solo el organizador valida los encuentros.');
  if(!t.exists()||!g.exists())throw Error('El encuentro o la llave no están disponibles.');
  const task=t.data(),group=g.data();
  if(!['active','submitted'].includes(task.status)||task.revision!==expectedTaskRevision||group.revision!==expectedGroupRevision)throw Error('CONFLICTO: el encuentro cambió. Revisa el resultado nuevamente.');
  if((task.current?.aShots||[]).length||(task.current?.bShots||[]).length)throw Error('Hay flechas sin cerrar. Comprueba y completa la tanda antes de validar.');
  const ends=task.ends.map(v=>({a:v.a,b:v.b}));
  shootOff=shootOff||task.shootOff||null;
  const outcome=nextSetResult(task,ends,shootOff);
  if(!outcome.final)throw Error('No hay ganador: faltan sets o desempate oficial.');
  const next=window.WA_ELIM.setMatch(group,matchId,ends,shootOff);
  const now=new Date().toISOString(),data={...next,revision:group.revision+1,createdAt:group.createdAt,updatedAt:now};
  tx.set(groupRef,data);
  tx.update(taskRef,{status:'closed',shootOff:shootOff||null,revision:task.revision+1,lastWriterUid:currentUid(),updatedAt:now});
  if(published.exists())tx.set(publicLiveRef(roomId,id),publicEliminationTask({...task,status:'closed',shootOff:shootOff||null,revision:task.revision+1,updatedAt:now}));
  if(published.exists())tx.set(publicGroup,data);
  return data;
 });
}

// Público: nombre/categoría y resumen para clasificación. Las coordenadas se liberan SOLO tras validación.
function tally(shots){return shots.reduce((n,s)=>n+(s.score==='M'?0:Number(s.score)||0),0);}
function publicScore(card){
 const full=(card.ends||[]).flat().concat(card.current||[]);
 const validated=card.status==='finished'&&card.validation?.status==='validated';
 return {number:card.number,target:card.target,position:card.position,
  points:tally(full),arrows:full.length,complete:card.status==='finished',validated,
  revision:card.revision,updatedAt:card.updatedAt,
  detailedEnds:validated?packEnds(card.ends||[]):[],
  };
}
function safePublicParticipants(ev){
 return (ev.draw||[]).map(d=>{
  const a=ev.entries.find(x=>x.number===d.number&&!x.vacant);
  if(!a)return null;
  return {number:d.number,name:a.name,division:a.division,age:a.age,level:a.level,
    gender:a.gender,target:d.target,position:d.position};
 }).filter(Boolean);
}
// El organizador decide expresamente cuándo publicar. No se añaden firmas ni UID de anotadores.
export async function publishSpectatorEvent(ev,cards){
 assertReady();
 if(!ev?.cloudRoomId||ev.cloudRole!=='organizer')throw Error('Solo el organizador puede compartir resultados.');
 const roomRef=doc(db,root,ev.cloudRoomId),snap=await getDoc(roomRef);
 if(!snap.exists()||snap.data().ownerUid!==currentUid()||snap.data().status!=='running')
  throw Error('Es necesario iniciar la competencia y conectarse como organizador.');
 if(!Array.isArray(cards)||cards.length!==(ev.draw||[]).length)
  throw Error('Todavía no se han sincronizado todas las planillas. Espera y vuelve a intentar.');
 const ref=doc(db,publicRoot,ev.cloudRoomId),already=await getDoc(ref),now=new Date().toISOString();
 const info={roomId:ev.cloudRoomId,name:ev.name,date:ev.date,
  formatId:ev.formatId,enabled:true,status:'running',schemaVersion:1,updatedAt:now,
  createdAt:already.exists()?already.data().createdAt:now,participants:safePublicParticipants(ev)};
 if(!already.exists())await setDoc(ref,info);
 else await updateDoc(ref,{enabled:true,updatedAt:now});
 // No sobrescribir revisiones nuevas: los datos vienen del observador confirmado del servidor.
 // Reglas Firestore: máximo de lecturas de documentos en una escritura por lote.
 // Cada puntuación consulta su planilla original; limitamos el lote a 8 tarjetas.
 for(let i=0;i<cards.length;i+=8){
  const batch=writeBatch(db);
  for(const [key,card] of cards.slice(i,i+8))batch.set(doc(ref,'scores',String(key)),publicScore(card));
  await batch.commit();
 }
 // Copia pública de las llaves existentes. No contiene firmas ni identificadores de cuentas.
 const existingBrackets=await getDocs(collection(roomRef,'eliminations'));
 for(const d of existingBrackets.docs)await setDoc(doc(ref,'eliminations',d.id),d.data());
 const live=await getDocs(collection(roomRef,'elimTasks'));
 // Proyecciones públicas sin UID de anotadores y sin permisos privados.
 for(const t of live.docs)await setDoc(doc(ref,'elimLive',t.id),publicEliminationTask(t.data()));
 return ev.cloudRoomId;
}
export async function setSpectatorVisibility(roomId,enabled){
 assertReady();
 await updateDoc(doc(db,publicRoot,roomId),{enabled:!!enabled,updatedAt:new Date().toISOString()});
}
export function watchSpectatorSettings(roomId,onChange,onError){
 assertReady();return onSnapshot(doc(db,publicRoot,roomId),snap=>onChange(snap.exists()?snap.data():null),onError);
}
export function watchPublicDirectory(onChange,onError){
 assertReady();return onSnapshot(query(collection(db,publicRoot),where('enabled','==',true),limit(30)),snap=>{
  onChange(snap.docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
 },onError);
}
export function watchPublicEvent(roomId,{onRoom,onScores,onBrackets,onLive,onError}){
 assertReady();if(!/^[\w-]{20,24}$/.test(roomId))throw Error('Enlace público incorrecto.');
 const ref=doc(db,publicRoot,roomId);
 const a=onSnapshot(ref,snap=>{
  if(!snap.exists()||snap.data().enabled!==true)onError(Error('Esta competencia no está disponible para espectadores.'));
  else onRoom({id:snap.id,...snap.data()});
 },onError);
 const b=onSnapshot(collection(ref,'scores'),snap=>onScores(snap.docs.map(x=>x.data())),onError);
 const c=onSnapshot(collection(ref,'eliminations'),snap=>onBrackets(snap.docs.map(x=>x.data())),onError);
 const d=onSnapshot(collection(ref,'elimLive'),snap=>onLive?.(snap.docs.map(x=>({id:x.id,...x.data()}))),onError);
 return ()=>{a();b();c();d()};
}
