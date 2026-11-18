/* Local-network stand-in for the claude.ai `db` and `user` capabilities.
   Talks to server.py on the same machine that served this page. */
(function(){
'use strict';
window.CYB_LOCAL=true;
const LS={get(k){try{return localStorage.getItem(k);}catch(_){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(_){}}};
let uid=LS.get('cyb_uid');if(!uid){uid='u'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);LS.set('cyb_uid',uid);}
const pinHdr=()=>{const p=LS.get('cyb_pin');return p?{'X-Edit-Pin':p}:{};};
const err=(code,message)=>{const e=new Error(message||code);e.code=code;return e;};
async function call(method,url,body){
  let r;try{r=await fetch(url,{method,headers:Object.assign({'Content-Type':'application/json'},pinHdr()),body:body?JSON.stringify(body):undefined,cache:'no-store'});}
  catch(_){throw err('unavailable','server not reachable');}
  if(r.status===401){location.href='/login';throw err('revoked','signed out');}
  let j={};try{j=await r.json();}catch(_){}
  if(!r.ok)throw err(j.code||'unavailable',j.message);
  return j;}
const enc=encodeURIComponent;
const meta={fromCache:false,hasPendingWrites:false};
const mkDoc=(id,exists,data)=>{const d=data?Object.freeze(JSON.parse(JSON.stringify(data))):undefined;return {id,exists,data:()=>d,metadata:meta};};

// ---- live updates by polling the server revision
const subs=new Set();let rev=-1;
async function refresh(s){try{s.last=await s.fetch();s.next(s.last);}catch(e){/* keep trying on next poll */}}
async function poll(){try{const j=await call('GET','/api/rev');if(j.rev!==rev){rev=j.rev;subs.forEach(refresh);}setOffline(false);}catch(_){setOffline(true);}}
let pollMs=2500,pollT=null;
function schedule(){clearTimeout(pollT);pollT=setTimeout(async()=>{if(!document.hidden)await poll();schedule();},pollMs);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){poll();}});
getAuthEarly().then(a=>{if(a&&a.cloud)pollMs=15000;schedule();});
async function getAuthEarly(){try{return await (await fetch('/api/auth',{cache:'no-store'})).json();}catch(_){return null;}}
function subscribe(fetchFn,next){const s={fetch:fetchFn,next};subs.add(s);refresh(s);return ()=>subs.delete(s);}

function docRef(path){const id=path.split('/').pop();return {id,path,
  async get(){const j=await call('GET','/api/doc?path='+enc(path));return mkDoc(id,j.exists,j.data);},
  async set(data){await call('PUT','/api/doc?path='+enc(path),data);poll();},
  async update(data){const cur=await this.get();if(!cur.exists)throw err('invalid_argument','document does not exist');await this.set(Object.assign({},cur.data(),data));},
  async delete(){await call('DELETE','/api/doc?path='+enc(path));poll();},
  onSnapshot(next,onErr){return subscribe(()=>this.get(),next);},
  collection(p){return colRef(path+'/'+p);}};}
function colRef(path){const q={path,
  async get(){const j=await call('GET','/api/col?path='+enc(path));const docs=j.docs.map(d=>mkDoc(d.id,true,d.data));return {docs,size:docs.length,empty:!docs.length,docChanges:()=>docs.map((d,i)=>({type:'added',doc:d,oldIndex:-1,newIndex:i})),metadata:meta};},
  onSnapshot(next,onErr){return subscribe(()=>q.get(),next);},
  doc(id){return docRef(path+'/'+(id||('d'+Date.now().toString(36)+Math.random().toString(36).slice(2,8))));},
  async add(data){const r=q.doc();await r.set(data);return r;},
  where(){return q;},orderBy(){return q;},limit(){return q;}};return q;}
const db={doc:docRef,collection:colRef};

// ---- people (names only, no passwords)
let auth=null;
async function getAuth(){if(!auth){try{auth=await call('GET','/api/auth');}catch(_){auth={needPin:false,ok:true};}}return auth;}
const user={
  async id(){return uid;},
  async me(){return {id:uid,name:LS.get('cyb_name')||''};},
  isOwner(){return false;},canEdit(){return false;},
  async can(name){if(name!=='data.write')return null;const a=await getAuth();return !a.needPin||a.ok;},
  async profiles(ids){let people={};try{const j=await call('GET','/api/col?path=people');j.docs.forEach(d=>people[d.id]=d.data);}catch(_){}
    const o={};(ids||[]).forEach(i=>o[i]={id:i,name:(people[i]&&people[i].name)||''});return o;}};

window.claude={async use(name){if(name==='db')return db;if(name==='user')return user;return null;}};

// ---- small UI: name + edit PIN + offline notice
function el(h){const d=document.createElement('div');d.innerHTML=h.trim();return d.firstChild;}
let offEl=null;
function setOffline(on){if(!document.body)return;if(on&&!offEl){offEl=el('<div style="position:fixed;top:0;left:0;right:0;background:#b3261e;color:#fff;text-align:center;padding:6px;font:13px system-ui;z-index:99">Cannot reach the CYB server. Check your network connection, and that the server is running.</div>');document.body.appendChild(offEl);}
  if(!on&&offEl){offEl.remove();offEl=null;}}
function bar(){
  const b=el('<div id="cybLocalBar" style="position:fixed;right:12px;bottom:12px;display:flex;gap:6px;z-index:40;font:13px system-ui"></div>');
  const btn=(t,fn)=>{const x=el(`<button style="border:1px solid var(--line,#ccc);background:var(--panel,#fff);color:var(--ink,#000);border-radius:16px;padding:5px 12px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.12)">${t}</button>`);x.onclick=fn;b.appendChild(x);return x;};
  const nm=LS.get('cyb_name');
  btn(nm?'👤 '+nm.replace(/[<>&]/g,''):'👤 Set your name',async()=>{const v=await ask('Your name','Shown next to the time studies and scenarios you save.',LS.get('cyb_name')||'');if(v!=null){LS.set('cyb_name',v.trim().slice(0,60));try{await db.doc('people/'+uid).set({name:v.trim().slice(0,60)});}catch(_){}location.reload();}});
  getAuth().then(a=>{if(a.login)btn('Sign out',()=>{location.href='/logout';});if(a.needPin){btn(a.ok?'🔓 Editing on':'🔒 Enter edit PIN',async()=>{if(a.ok){if(confirmBox())return;}const v=await ask('Edit PIN','Ask the line engineer for the PIN. Without it you can view but not save.','',true);if(v!=null){LS.set('cyb_pin',v);auth=null;const r=await getAuth();if(r.ok)location.reload();else alertBox('Wrong PIN');}});}});
  document.body.appendChild(b);
  if(nm)db.doc('people/'+uid).get().then(d=>{if(!d.exists||d.data().name!==nm)db.doc('people/'+uid).set({name:nm}).catch(()=>{});}).catch(()=>{});
}
function confirmBox(){LS.set('cyb_pin','');location.reload();return true;}
function alertBox(t){const m=el(`<div style="position:fixed;bottom:60px;right:12px;background:#b3261e;color:#fff;padding:8px 12px;border-radius:6px;font:13px system-ui;z-index:60">${t}</div>`);document.body.appendChild(m);setTimeout(()=>m.remove(),2500);}
function ask(title,text,val,pw){return new Promise(res=>{const d=el(`<div id="cybAsk" style="position:fixed;inset:0;background:rgba(0,0,0,.35);display:grid;place-items:center;z-index:80"><form style="background:var(--panel,#fff);color:var(--ink,#000);border:1px solid var(--line,#ccc);border-radius:8px;padding:16px;width:min(380px,92vw);font:14px system-ui"><h3 style="margin:0 0 6px;font-size:15px">${title}</h3><p style="margin:0 0 10px;color:var(--muted,#666);font-size:13px">${text}</p><input type="${pw?'password':'text'}" style="width:100%;padding:7px 9px;border:1px solid var(--line,#ccc);border-radius:6px;font:inherit;background:var(--panel,#fff);color:inherit"><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" data-c style="padding:6px 12px;border-radius:6px;border:1px solid var(--line,#ccc);background:none;color:inherit">Cancel</button><button style="padding:6px 12px;border-radius:6px;border:0;background:var(--accent,#1f6f8b);color:var(--accent-ink,#fff)">OK</button></div></form></div>`);
  const i=d.querySelector('input');i.value=val||'';d.querySelector('[data-c]').onclick=()=>{d.remove();res(null);};d.querySelector('form').onsubmit=e=>{e.preventDefault();d.remove();res(i.value);};document.body.appendChild(d);setTimeout(()=>i.focus(),20);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bar);else bar();
poll();
})();
