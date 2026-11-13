
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInAnonymously,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,collection,getDoc,getDocs,setDoc,updateDoc,writeBatch,runTransaction,query,where,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const firebaseConfig={
  apiKey:'AIzaSyBc7fJKYOwwoe7qhSBtVpjwr1jZ9vRo1yQ',
  authDomain:'lootjes-182e6.firebaseapp.com',
  projectId:'lootjes-182e6',
  storageBucket:'lootjes-182e6.firebasestorage.app',
  messagingSenderId:'963823887453',
  appId:'1:963823887453:web:67162033f43bd0e9cd99b4'
};
const ADMIN_UID='syp8cPy6njSgtsqLxNSX4nIL5I13';
const app=initializeApp(firebaseConfig);
const auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const eventId=params.get('e'),token=params.get('t');
let activeEvent=null,people=[],myPerson=null,myMember=null,mySecret=null,selectedEvent=null,exclusionSet=new Set(),reservations=[];

const el=(tag,txt,cls)=>{
  const e=document.createElement(tag);
  if(txt!==undefined)e.textContent=txt;
  if(cls)e.className=cls;
  return e;
};
const show=id=>{
  for(const x of ['home','login','admin','participant'])
    $(x).classList.toggle('hidden',x!==id);
};
const status=msg=>{$('status').textContent=msg};
const fail=e=>{
  console.error(e);
  status('Fout: '+(e?.message||String(e)));
};
const rid=()=>Array.from(
  crypto.getRandomValues(new Uint8Array(24)),
  b=>b.toString(16).padStart(2,'0')
).join('');
const names=s=>[...new Set(s.split('\n').map(x=>x.trim()).filter(Boolean))];
const eventRef=id=>doc(db,'trekkingen',id);
const personRef=(id,p)=>doc(db,'trekkingen',id,'personen',p);
const memberRef=(id,uid)=>doc(db,'trekkingen',id,'leden',uid);
const keyRef=(id,t)=>doc(db,'trekkingen',id,'sleutels',t);
const secretRef=(id,t)=>doc(db,'trekkingen',id,'geheimen',t);
const text=(node,content)=>{node.textContent=content};

function loginSetup(){
  $('showLogin').onclick=()=>show('login');
  $('backHome').onclick=()=>show('home');
  $('loginBtn').onclick=async()=>{
    try{
      status('Inloggen…');
      await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);
      await startAdmin();
    }catch(e){fail(e)}
  };
  $('logout').onclick=async()=>{
    await signOut(auth);
    location.href=location.pathname;
  };
  $('createEvent').onclick=createEvent;
  $('saveExclusions').onclick=saveExclusions;
  $('drawBtn').onclick=draw;
}
async function startAdmin(){
  if(auth.currentUser?.uid!==ADMIN_UID){
    show('home');
    status('Alleen de organisator kan hier inloggen.');
    return;
  }
  show('admin');
  status('Beheerdersomgeving');
  await loadEvents();
}
async function loadEvents(){
  const target=$('events');
  target.replaceChildren();
  const snap=await getDocs(query(collection(db,'trekkingen'),where('owner','==',ADMIN_UID)));
  if(snap.empty)target.append(el('p','Nog geen trekkingen.','muted'));
  snap.forEach(d=>{
    const b=el('button',`${d.data().naam} · ${d.data().status==='definitief'?'Definitief':'Concept'}`,'secondary');
    b.onclick=()=>manageEvent(d.id);
    target.append(b);
  });
}
async function createEvent(){
  try{
    const adults=names($('adultNames').value);
    const children=names($('childNames').value);
    if(!$('eventName').value.trim()||adults.length<2)
      throw Error('Vul een naam en minimaal twee deelnemers in.');
    if(new Set([...adults,...children].map(x=>x.toLowerCase())).size!==adults.length+children.length)
      throw Error('Namen moeten uniek zijn.');
    if(adults.length+children.length>70)
      throw Error('Maximaal 70 personen per trekking.');
    const id=rid(),batch=writeBatch(db);
    batch.set(eventRef(id),{
      owner:ADMIN_UID,
      naam:$('eventName').value.trim(),
      datum:$('eventDate').value,
      bedrag:Number($('eventBudget').value)||0,
      info:$('eventInfo').value.trim(),
      status:'concept',
      createdAt:serverTimestamp()
    });
    const entries=[
      ...adults.map(naam=>({naam,kind:false})),
      ...children.map(naam=>({naam,kind:true}))
    ];
    for(const p of entries){
      const pid=rid(),key=rid();
      batch.set(personRef(id,pid),{naam:p.naam,kind:p.kind,wishes:[]});
      batch.set(keyRef(id,key),{participantId:pid,eventId:id});
    }
    batch.set(doc(db,'trekkingen',id,'instellingen','config'),{exclusions:[]});
    await batch.commit();
    status('Trekking aangemaakt.');
    await loadEvents();
    await manageEvent(id);
  }catch(e){fail(e)}
}
async function manageEvent(id){
  try{
    selectedEvent=id;
    const e=await getDoc(eventRef(id));
    if(!e.exists())throw Error('Trekking niet gevonden');
    activeEvent=e.data();
    const ps=await getDocs(collection(db,'trekkingen',id,'personen'));
    people=ps.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>a.naam.localeCompare(b.naam,'nl'));
    const cfg=await getDoc(doc(db,'trekkingen',id,'instellingen','config'));
    exclusionSet=new Set((cfg.data()?.exclusions||[]).map(x=>x.from+'|'+x.to));
    $('manage').classList.remove('hidden');
    text($('manageTitle'),activeEvent.naam);
    text($('manageDetails'),`${activeEvent.datum||'Geen datum'} · € ${activeEvent.bedrag} · ${activeEvent.status}`);
    const ex=$('exclusions');
    ex.replaceChildren();
    const adults=people.filter(x=>!x.kind);
    for(const a of adults){
      const group=el('div',undefined,'item');
      group.append(el('strong',a.naam+' mag niet trekken:'));
      for(const b of adults.filter(x=>x.id!==a.id)){
        const line=el('label');
        const check=el('input');
        check.type='checkbox';
        check.style.width='auto';
        check.checked=exclusionSet.has(a.id+'|'+b.id);
        check.disabled=activeEvent.status==='definitief';
        check.onchange=()=>{
          const k=a.id+'|'+b.id;
          check.checked?exclusionSet.add(k):exclusionSet.delete(k);
        };
        line.append(check,document.createTextNode(' '+b.naam));
        group.append(line);
      }
      ex.append(group);
    }
    $('saveExclusions').disabled=activeEvent.status==='definitief';
    $('drawBtn').disabled=activeEvent.status==='definitief';
    const keys=await getDocs(collection(db,'trekkingen',id,'sleutels'));
    const links=$('links');
    links.replaceChildren();
    for(const k of keys.docs){
      const p=people.find(x=>x.id===k.data().participantId);
      if(!p)continue;
      const url=location.origin+location.pathname+'?e='+encodeURIComponent(id)+'&t='+encodeURIComponent(k.id);
      const box=el('div',undefined,'item');
      box.append(el('strong',p.naam+(p.kind?' (kind)':'')));
      box.append(el('div',url,'linkbox'));
      const copy=el('button','Kopieer link','secondary smallbtn');
      copy.onclick=async()=>{
        try{
          await navigator.clipboard.writeText(url);
          status('Link gekopieerd voor '+p.naam);
        }catch{
          prompt('Kopieer deze link:',url);
        }
      };
      box.append(copy);
      links.append(box);
    }
    $('manage').scrollIntoView({behavior:'smooth'});
  }catch(e){fail(e)}
}
async function saveExclusions(){
  try{
    if(activeEvent.status!=='concept')throw Error('Trekking is definitief.');
    const exclusions=[...exclusionSet].map(s=>{
      const [from,to]=s.split('|');
      return{from,to};
    });
    await setDoc(doc(db,'trekkingen',selectedEvent,'instellingen','config'),{exclusions});
    status('Uitsluitingen opgeslagen.');
  }catch(e){fail(e)}
}
function findDraw(adults,excluded){
  const receivers=[...adults];
  function recurse(i,remaining,output){
    if(i===adults.length)return output;
    const giver=adults[i];
    const options=remaining
      .filter(p=>p.id!==giver.id&&!excluded.has(giver.id+'|'+p.id))
      .sort(()=>Math.random()-.5);
    for(const p of options){
      const result=recurse(i+1,remaining.filter(x=>x.id!==p.id),{
        ...output,[giver.id]:p.id
      });
      if(result)return result;
    }
    return null;
  }
  return recurse(0,receivers,{});
}
async function draw(){
  try{
    if(activeEvent.status!=='concept')throw Error('Deze trekking is al definitief.');
    const adults=people.filter(x=>!x.kind);
    if(adults.length>20)throw Error('Meer dan 20 deelnemers: vraag om een uitgebreidere trekkingfunctie.');
    const assignment=findDraw(adults,exclusionSet);
    if(!assignment)throw Error('Deze uitsluitingen maken een geldige trekking onmogelijk.');
    if(!confirm('LET OP: de trekking wordt definitief. Wil je doorgaan?'))return;
    const keys=await getDocs(collection(db,'trekkingen',selectedEvent,'sleutels'));
    const batch=writeBatch(db);
    for(const k of keys.docs){
      const pid=k.data().participantId;
      const person=people.find(x=>x.id===pid);
      if(person&&!person.kind)
        batch.set(secretRef(selectedEvent,k.id),{
          participantId:pid,recipientId:assignment[pid]
        });
    }
    batch.update(eventRef(selectedEvent),{status:'definitief'});
    await batch.commit();
    status('Trekking definitief vastgelegd!');
    await manageEvent(selectedEvent);
  }catch(e){fail(e)}
}
async function startParticipant(){
  try{
    if(!eventId||!token)throw Error('Persoonlijke link ontbreekt.');
    status('Persoonlijke link openen…');
    const key=await getDoc(keyRef(eventId,token));
    if(!key.exists()||key.data().eventId!==eventId)
      throw Error('Ongeldige persoonlijke link.');
    const ref=memberRef(eventId,auth.currentUser.uid);
    const old=await getDoc(ref);
    if(!old.exists())
      await setDoc(ref,{token,participantId:key.data().participantId,eventId});
    else if(old.data().token!==token)
      throw Error('Je hebt in deze browser al een andere Lootjes-link geopend. Gebruik een andere browser of een nieuw privévenster.');
    myMember={token,participantId:key.data().participantId};
    const event=await getDoc(eventRef(eventId));
    if(!event.exists())throw Error('Trekking bestaat niet.');
    activeEvent=event.data();
    const snap=await getDocs(collection(db,'trekkingen',eventId,'personen'));
    people=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>a.naam.localeCompare(b.naam,'nl'));
    myPerson=people.find(p=>p.id===myMember.participantId);
    if(!myPerson)throw Error('Deelnemer niet gevonden.');
    show('participant');
    const intro=$('eventIntro');
    intro.replaceChildren(
      el('h2',`Hoi ${myPerson.naam}!`),
      el('p',activeEvent.naam),
      el('p',`${activeEvent.datum||'Datum volgt'} · Budget € ${activeEvent.bedrag}`),
      el('p',activeEvent.info||'')
    );
    $('addWish').onclick=addWish;
    $('newWish').onkeydown=e=>{if(e.key==='Enter')addWish()};
    $('revealBtn').onclick=reveal;
    await refreshParticipant();
    status('Welkom, '+myPerson.naam+'!');
  }catch(e){
    fail(e);
    show('home');
  }
}
function cleanLink(value){
  const raw=value.trim();
  if(!raw)return '';
  let u;
  try{u=new URL(raw)}
  catch{throw Error('Gebruik een volledige link die begint met https://')}
  if(u.protocol!=='https:'&&u.protocol!=='http:')
    throw Error('Alleen http- en https-links zijn toegestaan.');
  u.hash='';
  return u.href;
}
function wishContent(w){
  const wrap=el('div');
  wrap.style.minWidth='0';
  wrap.style.overflowWrap='anywhere';
  wrap.append(el('strong',w.text));
  if(w.url){
    wrap.append(el('br'));
    const a=el('a','Bekijk cadeau');
    a.href=w.url;
    a.target='_blank';
    a.rel='noopener noreferrer';
    wrap.append(a);
  }
  return wrap;
}
async function refreshParticipant(){
  const snap=await getDocs(collection(db,'trekkingen',eventId,'personen'));
  people=snap.docs.map(d=>({id:d.id,...d.data()}))
    .sort((a,b)=>a.naam.localeCompare(b.naam,'nl'));
  myPerson=people.find(p=>p.id===myMember.participantId);
  reservations=[];
  const others=people.filter(p=>p.id!==myPerson.id)
    .flatMap(p=>(p.wishes||[]).map(w=>({p,w})));
  const results=await Promise.all(others.map(async ({w})=>{
    try{
      const d=await getDoc(doc(db,'trekkingen',eventId,'reserveringen',w.id));
      return d.exists()?{id:d.id,...d.data()}:null;
    }catch(e){
      console.warn('Reservering niet leesbaar',e);
      return null;
    }
  }));
  reservations=results.filter(Boolean);
  const mine=$('myWishes');
  mine.replaceChildren();
  for(const w of myPerson.wishes||[]){
    const line=el('div',undefined,'wish item');
    line.append(wishContent(w));
    const actions=el('div',undefined,'row');
    const edit=el('button','Wijzig','secondary smallbtn');
    edit.onclick=()=>editWish(w);
    const del=el('button','Verwijder','warn smallbtn');
    del.onclick=()=>removeWish(w.id);
    actions.append(edit,del);
    line.append(actions);
    mine.append(line);
  }
  if(!(myPerson.wishes||[]).length)
    mine.append(el('p','Je hebt nog geen wensen toegevoegd.','muted'));
  $('revealBtn').disabled=myPerson.kind||
    activeEvent.status!=='definitief'||
    (myPerson.wishes||[]).length<3;
  const msg=myPerson.kind
    ?'Dit is een verlanglijstje voor een kind. Je hoeft geen lootje te trekken.'
    :activeEvent.status!=='definitief'
    ?'De trekking is nog niet uitgevoerd.'
    :(myPerson.wishes||[]).length<3
    ?'Voeg eerst minimaal drie wensen toe.'
    :'Je mag je lootje openen!';
  text($('revealText'),msg);
  if(mySecret)renderSecret();
  renderWishlists();
}
async function addWish(){
  try{
    const v=$('newWish').value.trim();
    const url=cleanLink($('newWishUrl').value);
    if(!v)throw Error('Vul een cadeauomschrijving in.');
    if(v.length>160)throw Error('Maximaal 160 tekens per wens.');
    const list=myPerson.wishes||[];
    if(list.length>=30)throw Error('Maximaal 30 wensen.');
    if(list.some(w=>
      w.text.trim().toLocaleLowerCase('nl')===v.toLocaleLowerCase('nl')||
      (url&&w.url&&cleanLink(w.url)===url)
    ))throw Error('Dit cadeau of deze link staat al op je lijstje.');
    await updateDoc(personRef(eventId,myPerson.id),{
      wishes:[...list,{id:rid(),text:v,url}]
    });
    $('newWish').value='';
    $('newWishUrl').value='';
    await refreshParticipant();
  }catch(e){fail(e)}
}
async function editWish(w){
  const name=prompt('Cadeauomschrijving:',w.text);
  if(name===null)return;
  const urlText=prompt('Productlink (mag leeg blijven):',w.url||'');
  if(urlText===null)return;
  try{
    const textValue=name.trim(),url=cleanLink(urlText);
    if(!textValue||textValue.length>160)
      throw Error('Vul een omschrijving van maximaal 160 tekens in.');
    const list=myPerson.wishes||[];
    if(list.some(x=>x.id!==w.id&&(
      x.text.trim().toLocaleLowerCase('nl')===textValue.toLocaleLowerCase('nl')||
      (url&&x.url&&cleanLink(x.url)===url)
    )))throw Error('Dit cadeau of deze link staat al op je lijstje.');
    await updateDoc(personRef(eventId,myPerson.id),{
      wishes:list.map(x=>x.id===w.id?{...x,text:textValue,url}:x)
    });
    await refreshParticipant();
  }catch(e){fail(e)}
}
async function removeWish(id){
  try{
    await updateDoc(personRef(eventId,myPerson.id),{
      wishes:(myPerson.wishes||[]).filter(x=>x.id!==id)
    });
    await refreshParticipant();
  }catch(e){fail(e)}
}
async function reveal(){
  try{
    const s=await getDoc(secretRef(eventId,token));
    if(!s.exists())throw Error('Je lootje is nog niet beschikbaar.');
    mySecret=s.data();
    renderSecret();
    $('revealed').classList.remove('hidden');
    status('Je lootje is geopend!');
  }catch(e){fail(e)}
}
function renderSecret(){
  if(!mySecret)return;
  const p=people.find(x=>x.id===mySecret.recipientId);
  const target=$('revealed');
  target.replaceChildren(
    el('h3',`🎁 Jij koopt voor ${p?.naam||'onbekend'}!`),
    el('p','Bekijk hieronder het verlanglijstje. Dit blijft via je persoonlijke link bereikbaar.')
  );
  target.classList.remove('hidden');
  renderWishlists();
}
function canReserve(p){
  return !!myMember&&(p.kind||mySecret?.recipientId===p.id);
}
function renderWishlists(){
  const target=$('allWishlists');
  target.replaceChildren();
  for(const p of people){
    const section=el('div',undefined,'item');
    section.append(el('h3',p.naam+(p.kind?' 🧸':'')));
    const wishes=p.wishes||[];
    if(!wishes.length)section.append(el('p','Nog geen wensen.','muted'));
    for(const w of wishes){
      const res=p.id===myPerson.id
        ?null
        :reservations.find(x=>x.id===w.id);
      const row=el('div',undefined,'wish');
      row.append(wishContent(w));
      if(p.id!==myPerson.id&&res?.reserved)
        row.append(el('span','✓ Gereserveerd','pill'));
      if(canReserve(p)&&p.id!==myPerson.id){
        const mine=res?.reserved&&res.actorUid===auth.currentUser.uid;
        const b=el('button',
          res?.reserved?(mine?'Vrijgeven':'Al gereserveerd'):'Reserveren',
          res?.reserved?'secondary smallbtn':'smallbtn'
        );
        b.disabled=!!res?.reserved&&!mine;
        b.onclick=()=>reserve(p,w,!res?.reserved);
        row.append(b);
      }
      section.append(row);
    }
    target.append(section);
  }
}
async function reserve(p,w,value){
  try{
    if(!canReserve(p)||p.id===myPerson.id)
      throw Error('Je mag dit cadeau niet reserveren.');
    const ref=doc(db,'trekkingen',eventId,'reserveringen',w.id);
    await runTransaction(db,async tx=>{
      const old=await tx.get(ref);
      const data=old.exists()?old.data():null;
      if(value&&data?.reserved)
        throw Error('Dit cadeau is al gereserveerd.');
      if(!value&&(!data?.reserved||data.actorUid!==auth.currentUser.uid))
        throw Error('Alleen de koper kan deze reservering vrijgeven.');
      tx.set(ref,{
        targetId:p.id,
        wishId:w.id,
        reserved:value,
        actorUid:auth.currentUser.uid
      });
    });
    await refreshParticipant();
  }catch(e){fail(e)}
}
loginSetup();
onAuthStateChanged(auth,async user=>{
  try{
    if(eventId&&token){
      if(!user)await signInAnonymously(auth);
      else await startParticipant();
    }else if(user?.uid===ADMIN_UID){
      await startAdmin();
    }else{
      show('home');
      status('Welkom bij Lootjes');
    }
  }catch(e){fail(e)}
});
