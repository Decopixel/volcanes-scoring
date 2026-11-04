/* WA Scoring — detector de nuevas versiones PWA v0.6.4.10.
   No usa Firebase ni toca IndexedDB. Cambia de versión SOLO con autorización. */
(() => {
  'use strict';
  const CURRENT_VERSION='0.6.4.10';
  const sw=navigator.serviceWorker;
  const supported=Boolean(sw && (location.protocol==='https:' || location.hostname==='localhost'));
  const banner=document.getElementById('wa-update-banner');
  const title=document.getElementById('wa-update-title');
  const description=document.getElementById('wa-update-description');
  const applyBtn=document.getElementById('wa-update-apply');
  const laterBtn=document.getElementById('wa-update-later');
  let registration=null, waiting=null, availableVersion='', later=false, applying=false;
  let reloadOnChange=false, checking=null, started=false;

  // La app de puntuación informa si se está anotando o guardando información.
  const safe = () => typeof window.WAUpdateMayApply === 'function'
    && window.WAUpdateMayApply() === true;
  function refresh(){
    if (!banner) return;
    const visible=Boolean(waiting && !later && !applying && safe());
    banner.hidden=!visible;
    if(!visible)return;
    title.textContent=availableVersion && availableVersion!==CURRENT_VERSION
      ? `WA Scoring v${availableVersion} disponible` : 'Nueva versión de WA Scoring';
    description.textContent='Ya está descargada. Actualiza desde una pantalla segura; tus datos locales se conservan.';
    applyBtn.disabled=false;
  }
  function queryVersion(worker){
    return new Promise(resolve => {
      if(!worker || typeof MessageChannel==='undefined')return resolve('');
      const channel=new MessageChannel();
      const timeout=setTimeout(() => {channel.port1.close();resolve('');},1300);
      channel.port1.onmessage=event => {
        clearTimeout(timeout); channel.port1.close();
        resolve(event.data?.type==='WA_SW_VERSION'?String(event.data.version||''):'');
      };
      try{worker.postMessage({type:'WA_GET_VERSION'},[channel.port2]);}
      catch(_){clearTimeout(timeout);channel.port1.close();resolve('');}
    });
  }
  async function showWaiting(worker){
    if(!worker || worker.state==='redundant')return;
    if(waiting!==worker){later=false;availableVersion='';}
    waiting=worker;
    refresh();
    const version=await queryVersion(worker);
    if(waiting!==worker)return;
    availableVersion=version;
    refresh();
  }
  function watchInstalling(worker){
    if(!worker)return;
    const onChange=()=>{
      if(worker.state==='installed' && sw.controller && registration?.waiting)
        showWaiting(registration.waiting);
    };
    worker.addEventListener('statechange',onChange);
    onChange();
  }
  async function check(userInitiated=false){
    if(!registration)return;
    if(userInitiated){later=false;refresh();}
    if(!navigator.onLine){ if(userInitiated)announce('Sin conexión. La búsqueda se hará al recuperar internet.');return; }
    if(checking)return checking;
    checking=registration.update().catch(()=>{}).then(async()=>{
      if(registration.waiting)await showWaiting(registration.waiting);
      else if(userInitiated)announce('No se encontró una actualización pendiente.');
    }).finally(()=>{checking=null;});
    return checking;
  }
  function announce(message){
    const status=document.getElementById('wa-update-status');
    if(status)status.textContent=message;
  }
  async function start(){
    if(started || !supported)return;
    started=true;
    try{
      registration=await sw.register('./sw.js',{updateViaCache:'none'});
      registration.addEventListener('updatefound',()=>watchInstalling(registration.installing));
      watchInstalling(registration.installing);
      if(registration.waiting && sw.controller)await showWaiting(registration.waiting);
      // Sin recargar: inspeccionar cuando abre la PWA y al volver a ella.
      await check();
      document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='visible'){refresh();check();}
      });
      window.addEventListener('online',()=>check());
      window.setInterval(()=>{if(document.visibilityState==='visible')check();},60*60*1000);
      sw.addEventListener('controllerchange',()=>{
        if(!reloadOnChange)return; // Primer arranque de PWA: nunca recargar.
        reloadOnChange=false;
        applying=false;
        // Verificar nuevamente: nunca recargar una tanda que empezó mientras se activaba.
        if(safe())location.reload();
        else {waiting=null;banner.hidden=true;}
      });
    }catch(_){started=false;}
  }
  laterBtn?.addEventListener('click',()=>{later=true;refresh();});
  applyBtn?.addEventListener('click',()=>{
    if(!waiting || applying || !safe()){refresh();return;}
    applying=true;
    reloadOnChange=true;
    banner.hidden=true;
    waiting.postMessage({type:'WA_APPLY_UPDATE'});
  });
  document.addEventListener('click',evt=>{
    const btn=evt.target.closest('[data-action="wa-check-updates"]');
    if(btn){check(true);announce('Comprobando actualizaciones…');}
  });
  window.WAUpdates={start,refresh,check};
})();
