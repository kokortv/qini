const CURRENCY={GEL:'₾',USD:'$',EUR:'€',UAH:'₴',RUB:'₽'};
const API_URL=window.QINI_API_URL||'';
const DB_KEY='qini-db-v2';
try{
  const params=new URLSearchParams(location.search);
  if(params.has('reset')){
    localStorage.removeItem('qini-db');
    localStorage.removeItem(DB_KEY);
    sessionStorage.removeItem('qini-session');
    Object.keys(sessionStorage).forEach(k=>{if(k.startsWith('qini-menu-cache-'))sessionStorage.removeItem(k)});
    console.log('[qini] local data reset');
  }
}catch(e){}
// Пустая база. Все данные приходят только с сервера (или через оффлайн-режим).
const emptyDb={auth:{login:'admin',password:'admin123',name:'Администратор',phone:''},page:'overview',users:[],suppliers:[],warehouses:[],accounts:[],deliveries:[],writeoffs:[],products:[],sales:[]};
let db=JSON.parse(localStorage.getItem(DB_KEY)||'null')||JSON.parse(JSON.stringify(emptyDb));
db.auth={...emptyDb.auth,...(db.auth||{})};
db.page=db.page||'overview';
db.users=db.users||[];db.suppliers=db.suppliers||[];db.warehouses=db.warehouses||[];db.accounts=db.accounts||[];db.deliveries=db.deliveries||[];db.writeoffs=db.writeoffs||[];db.products=db.products||[];db.sales=db.sales||[];
function normalizeUser(x){
  let ids=x.warehouses||x.warehouseIds||[];
  if(typeof ids==='string'){try{ids=JSON.parse(ids)}catch(e){ids=ids.split(',').map(v=>v.trim()).filter(Boolean)}}
  return {...x,warehouses:Array.isArray(ids)?ids:[]};
}
function displayDate(value){
  if(!value)return '—';
  if(/T|Z/.test(String(value))){
    const d=new Date(value);
    if(!Number.isNaN(d.getTime()))return d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
  }
  return String(value).replace(',', '');
}
function normalizeSheetData(x){
  const warehouses=x.Warehouses||[],accounts=x.Accounts||[],suppliers=x.Suppliers||[];
  const warehouseName=v=>warehouses.find(w=>String(w.id)===String(v))?.name||v||'';
  const accountName=v=>accounts.find(a=>String(a.id)===String(v))?.name||v||'';
  const supplierName=v=>suppliers.find(s=>String(s.id)===String(v))?.name||v||'';
  const deliveryItems=x.DeliveryItems||[],writeoffItems=x.WriteoffItems||[];
  const itemsFor=(rows,idKey,id)=>rows.filter(i=>String(i[idKey])===String(id)).map(i=>({
    ...i,qty:+i.qty||0,cost:+i.cost||0,markup:Math.round(+i.markup||0),retailTotal:+i.retailTotal||0
  }));
  return {...x,
    Accounts:accounts.map(a=>({...a,balance:+a.balance||0,initial:+a.initial||0})),
    Sellers:(x.Sellers||[]).map(normalizeUser),
    Sales:(x.Sales||[]).map(s=>({...s,qty:+s.qty||0,markup:Math.round(+s.markup||0),unitPrice:+s.unitPrice||0,total:+s.total||0,profit:+s.profit||0,warehouse:warehouseName(s.warehouseId)})),
    Deliveries:(x.Deliveries||[]).map(d=>({...d,date:displayDate(d.date),supplier:d.supplier||supplierName(d.supplierId),warehouse:d.warehouse||warehouseName(d.warehouseId),account:d.account||accountName(d.accountId),paid:+d.paid||0,total:+d.total||0,items:d.items||itemsFor(deliveryItems,'deliveryId',d.id)})),
    Writeoffs:(x.Writeoffs||[]).map(w=>({...w,date:displayDate(w.date),warehouse:w.warehouse||warehouseName(w.warehouseId),account:w.account||accountName(w.accountId),total:+w.total||0,items:w.items||itemsFor(writeoffItems,'writeoffId',w.id)}))
  };
}
function inventoryFromData(x){
  const batches=[];
  const findBatch=(name,pack,warehouse,deliveryId)=>{
    if(deliveryId){
      const exact=batches.find(b=>b.name===name&&String(b.pack||'')===String(pack||'')&&b.warehouse===warehouse&&String(b.deliveryId||'')===String(deliveryId));
      if(exact)return exact;
    }
    return batches.find(b=>b.name===name&&String(b.pack||'')===String(pack||'')&&b.warehouse===warehouse&&b.stock>0.000001);
  };
  const deliveries=(x.Deliveries||[]).slice().sort((a,b)=>(+new Date(a.date||0))-(+new Date(b.date||0)));
  deliveries.forEach(d=>(d.items||[]).forEach(i=>{
    if(!i?.name)return;
    const qty=+i.qty||0;
    if(!qty)return;
    batches.push({name:i.name,pack:i.pack||'',stock:qty,cost:+i.cost||0,markup:Math.round(+i.markup||0),retailTotal:+i.retailTotal||0,warehouse:d.warehouse||'',deliveryId:d.id||'',deliveryDate:d.date||'',supplier:d.supplier||'',account:d.account||''});
  }));
  (x.Sales||[]).forEach(s=>{if(!s.productName)return;const b=findBatch(s.productName,s.pack||'',s.warehouse,s.deliveryId);if(b)b.stock-=(+s.qty||0)});
  (x.Writeoffs||[]).forEach(w=>(w.items||[]).forEach(i=>{if(!i?.name)return;const b=findBatch(i.name,i.pack||'',w.warehouse,i.deliveryId);if(b)b.stock-=(+i.qty||0)}));
  return batches.filter(b=>b.stock>0.000001);
}
function ensureCatalog(){
  if(Array.isArray(db.catalog))return;
  const seen=new Map();
  const push=(name,pack)=>{const n=String(name||'').trim();if(!n)return;const p=String(pack||'').trim();const key=n+'|'+p;if(seen.has(key))return;seen.set(key,{name:n,pack:p})};
  (db.deliveries||[]).forEach(d=>(d.items||[]).forEach(i=>push(i.name,i.pack)));
  (db.writeoffs||[]).forEach(w=>(w.items||[]).forEach(i=>push(i.name,i.pack)));
  (db.sales||[]).forEach(s=>push(s.productName,s.pack));
  (db.products||[]).forEach(p=>push(p.name,p.pack));
  db.catalog=[...seen.values()];
}
function catalogAdd(name,pack){
  const n=String(name||'').trim();if(!n)return;
  const p=String(pack||'').trim();
  if(!Array.isArray(db.catalog))db.catalog=[];
  if(!db.catalog.some(x=>x.name===n&&String(x.pack||'')===p))db.catalog.push({name:n,pack:p});
}
function catalogNames(){ensureCatalog();return [...new Set(db.catalog.map(x=>x.name))].sort((a,b)=>a.localeCompare(b,'ru'))}
function catalogPacks(name){
  ensureCatalog();
  const q=String(name||'').toLocaleLowerCase().trim();
  const matching=[],others=[];
  db.catalog.forEach(x=>{
    const pack=x.pack;if(!pack)return;
    const nm=String(x.name||'').toLocaleLowerCase();
    const hit=q&&(nm===q||nm.startsWith(q));
    (hit?matching:others).push(pack);
  });
  return [...new Set([...matching,...others])];
}
function sourceItem(name,pack,warehouse){
  const found=(db.deliveries||[]).flatMap(d=>(d.items||[]).map(i=>({...i,warehouse:d.warehouse}))).find(i=>i.name===name&&(!pack||i.pack===pack)&&(!warehouse||i.warehouse===warehouse));
  return found||null;
}
db.users=db.users.map(normalizeUser);
ensureCatalog();
let session=null;
try{session=JSON.parse(sessionStorage.getItem('qini-session')||'null')}catch(e){sessionStorage.removeItem('qini-session')}
let stockFilter='';
let syncState='idle';
function setSyncStatus(state){
  syncState=state;
  const n=document.getElementById('syncStatus');
  if(!n)return;
  n.dataset.state=state;
  const map={idle:'Не синхронизировано',pending:'Синхронизация…',sync:'Синхронизировано',error:'Ошибка синхронизации'};
  n.title=map[state]||'';
}
const save=()=>{db.products=inventoryFromData({Deliveries:db.deliveries,Writeoffs:db.writeoffs,Sales:db.sales});localStorage.setItem(DB_KEY,JSON.stringify(db))};
const money=(n,c='GEL')=>`${Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ${CURRENCY[c]||'₾'}`;
const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const el=s=>document.querySelector(s);
const fmtPct=n=>{const v=Number(n||0);if(!isFinite(v))return '0%';return Math.round(v)+'%'};
function toast(x){const t=el('#toast');if(t){t.textContent=x;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}}
function parseJsonResponse(text){
  const t=String(text||'').trim();
  if(!t)return {ok:false,error:'Сервер вернул пустой ответ. Проверьте деплой Apps Script.'};
  if(t[0]==='<')return {ok:false,error:'Сервер вернул HTML вместо JSON. Проверьте URL /exec и доступ «Anyone».'};
  try{return JSON.parse(t)}catch(e){return {ok:false,error:'Некорректный ответ сервера: '+t.slice(0,120)}}
}
function handleSessionError(errorText){
  if(!/сессия|session/i.test(errorText||''))return false;
  session=null;
  sessionStorage.removeItem('qini-session');
  toast('Сессия истекла. Войдите снова.');
  setSyncStatus('idle');
  setTimeout(()=>render(),900);
  return true;
}
async function api(action,entity,data){
  if(!API_URL)return {ok:false,error:'API_URL не настроен'};
  setSyncStatus('pending');
  let result;
  try{
    const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,entity,data,token:session?.token||''})});
    const text=await r.text();
    result=parseJsonResponse(text);
  }catch(e){setSyncStatus('error');return {ok:false,error:'Сеть: '+e.message}}
  if(!result.ok&&handleSessionError(result.error)){
    return result;
  }
  setSyncStatus(result.ok?'sync':'error');
  return result;
}
function login(){
  document.querySelector('#app').innerHTML=`<div class="login-page"><div class="login-card"><div class="brand login-brand"><div class="brand-mark">Q</div><div class="brand-text">qini</div></div><div class="login-kicker">УЧЁТ ПОСТАВОК</div><h1>С возвращением</h1><p>Войдите в рабочее пространство Qini</p><form id="loginForm"><label class="label">Логин</label><input class="input" name="login" autocomplete="username" placeholder="Введите логин" required><label class="label">Пароль</label><input class="input" type="password" name="password" autocomplete="current-password" placeholder="Введите пароль" required><button class="btn btn-primary login-button" id="loginBtn" type="submit">Войти</button><div id="loginError" class="login-error"></div></form></div></div>`;
  el('#loginForm').onsubmit=async e=>{
    e.preventDefault();
    const btn=el('#loginBtn');
    const setLoading=v=>{
      if(!btn)return;
      if(v){btn.disabled=true;btn.classList.add('is-loading');btn.innerHTML='<span class="spinner"></span> Вход…'}
      else{btn.disabled=false;btn.classList.remove('is-loading');btn.textContent='Войти'}
    };
    setLoading(true);
    const f=new FormData(e.target),l=f.get('login'),p=f.get('password');
    if(API_URL){
      const r=await api('login',null,{login:l,password:p});
      if(r.ok){
        session=r.session;
        sessionStorage.setItem('qini-session',JSON.stringify(session));
        render();sync();
      }else{
        setLoading(false);
        el('#loginError').textContent=r.error||'Неверный логин или пароль';
      }
    }else{
      if(l===db.auth.login&&p===db.auth.password)session={role:'admin',name:db.auth.name};
      else{const u=db.users.find(x=>x.login===l&&x.password===p);if(u)session={role:'seller',name:u.name,userId:u.id,warehouses:u.warehouses}}
      if(session){sessionStorage.setItem('qini-session',JSON.stringify(session));render()}
      else{setLoading(false);el('#loginError').textContent='Укажите URL Apps Script'}
    }
  };
}
const navA=[['overview','⌂','Обзор'],['sellers','♙','Продавцы'],['suppliers','♧','Поставщики'],['warehouses','▣','Склады'],['accounts','▤','Счета'],['deliveries','⇄','Поставки'],['writeoffs','↘','Списания'],['stock','◫','Остатки'],['stats','◔','Статистика']];
const navS=[['deliveries','⇄','Поставки'],['writeoffs','↘','Списания'],['stock','◫','Остатки'],['stats','◔','Статистика']];
const titles={overview:['Добрый день','Сводка по вашему бизнесу'],sellers:['Продавцы','Команда и доступ к складам'],suppliers:['Поставщики','Контакты и история сотрудничества'],warehouses:['Склады','Точки хранения и счета'],accounts:['Счета','Баланс и способы оплаты'],deliveries:['Поставки','Входящие поставки и расчёты'],writeoffs:['Списания','Учет движения товаров'],stock:['Остатки','Товары на складах'],stats:['Статистика','Продажи и динамика']};
const allowed=()=>session.role==='seller'?db.warehouses.filter(w=>session.warehouses?.includes(w.id)).map(w=>w.name):db.warehouses.map(w=>w.name);
const filterRows=a=>session.role==='seller'?a.filter(x=>!x.warehouse||allowed().includes(x.warehouse)):a;
function render(){
  if(!session)return login();
  const nav=session.role==='admin'?navA:navS,t=titles[db.page]||titles.overview;
  document.querySelector('#app').innerHTML=`<div class="app-shell"><aside class="sidebar" id="sidebar"><div class="brand"><div class="brand-mark">Q</div><div class="brand-text">qini</div><span class="role-pill">${session.role.toUpperCase()}</span></div><div class="nav-group"><div class="nav-label">Рабочий стол</div>${nav.map(x=>`<button class="nav-item ${db.page===x[0]?'active':''}" data-page="${x[0]}"><span class="nav-icon">${x[1]}</span>${x[2]}</button>`).join('')}</div><div class="sidebar-bottom"><button class="user-chip" id="profile"><div class="avatar">${session.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><div class="user-name">${esc(session.name)}</div><div class="user-caption">${session.role==='admin'?'Администратор':'Продавец'}</div></div></button><button class="nav-item logout" id="logout"><span class="nav-icon">↪</span>Выйти</button></div></aside><main class="main"><header class="topbar"><div><button class="icon-btn mobile-toggle" id="mobileMenu">☰</button><div class="eyebrow">Qini / ${t[1]}</div><h1 class="page-title">${t[0]}, ${esc(session.name.split(' ')[0])}</h1></div><div class="top-actions"><button class="icon-btn sync-status" id="syncStatus" data-state="${syncState}" title=""><span class="sync-dot"></span></button></div></header><div id="pageContent">${page()}</div></main></div>`;
  bind();
  setSyncStatus(syncState);
}
function statsPage(){
  const sales=db.sales||[];
  const total=sales.reduce((a,s)=>a+(Number(s.total)||0),0);
  const profit=sales.reduce((a,s)=>a+(Number(s.profit)||0),0);
  return `<div class="kpi-grid"><div class="kpi"><div class="kpi-top">Сумма всех продаж</div><div class="kpi-value retail-amount">${money(total)}</div><div class="kpi-note muted">${sales.length} ${sales.length===1?'продажа':'продаж'}</div></div><div class="kpi"><div class="kpi-top">Общий заработок</div><div class="kpi-value profit-amount">${money(profit)}</div><div class="kpi-note muted">Продажи минус себестоимость</div></div></div><div class="card"><div class="card-head"><div><h3 class="card-title">Статистика продаж</h3><div class="card-subtitle">Каждая продажа отдельной строкой</div></div><select class="select" style="max-width:180px"><option>Все время</option><option>Сегодня</option><option>Неделя</option><option>Месяц</option></select></div>${sales.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Дата и время</th><th>Товар</th><th>Фасовка</th><th>Количество</th><th>Наценка</th><th>Сумма продажи</th><th>Заработано</th><th>Комментарий</th>${session.role==='admin'?'<th>Действия</th>':''}</tr></thead><tbody>${sales.map(s=>`<tr><td>${displayDate(s.date)}</td><td>${esc(s.productName||'')}</td><td>${esc(s.pack||'')}</td><td>${s.qty||0}</td><td>${fmtPct(s.markup)}</td><td class="retail-amount">${money(s.total)}</td><td class="profit-amount">${money(s.profit)}</td><td>${esc(s.comment||'')}</td>${session.role==='admin'?`<td><button class="action-btn danger" data-delete="sales:${s.id}">⌫</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty"><div class="empty-icon">◔</div><h3 class="card-title">Продаж пока нет</h3><div class="card-subtitle">Добавьте продажу из раздела «Остатки»</div></div>'}</div>`;
}
function page(){
  if(db.page==='overview')return overview();
  if(db.page==='sellers')return entity('sellers','Продавцы','Новый продавец',['Имя','Логин','Телефон','Склады'],db.users.map(x=>[x.name,x.login,x.phone,x.warehouses.map(id=>db.warehouses.find(w=>w.id===id)?.name).join(', ')]));
  if(db.page==='suppliers')return entity('suppliers','Поставщики','Новый поставщик',['Имя','Телефон','Комментарий'],db.suppliers.map(x=>[x.name,x.phone,x.comment]));
  if(db.page==='warehouses')return entity('warehouses','Склады','Новый склад',['Название','Счёт','Комментарий'],db.warehouses.map(x=>[x.name,db.accounts.find(a=>a.id===x.accountId)?.name||'—',x.comment]));
  if(db.page==='accounts')return entity('accounts','Счета','Новый счёт',['Название','Валюта','Оплата','Баланс'],db.accounts.map(x=>[x.name,x.currency,x.payment,money(x.balance,x.currency)]));
  if(db.page==='deliveries')return `<div class="card"><div class="card-head"><div><h3 class="card-title">История поставок</h3><div class="card-subtitle">${db.deliveries.length} записей</div></div><button class="btn btn-primary" id="quickAdd">＋ Новая поставка</button></div>${table(filterRows(db.deliveries))}</div>`;
  if(db.page==='writeoffs')return `<div class="card"><div class="card-head"><div><h3 class="card-title">История списаний</h3><div class="card-subtitle">${db.writeoffs.length} записей</div></div><button class="btn btn-primary" id="quickAdd">＋ Новое списание</button></div><div class="empty"><div class="empty-icon">↘</div>${db.writeoffs.length?'Списания сохранены':'Списаний пока нет'}</div></div>`;
  if(db.page==='stock')return `<div class="card"><div class="card-head"><input class="input search" id="stockSearch" type="search" placeholder="Поиск товара..." autocomplete="off"><button class="btn btn-light btn-sm" id="createMenuBtn">📋 Создать меню</button></div><div class="table-wrap"><table class="table"><thead><tr></tr></thead><tbody></tbody></table></div></div>`;
  if(db.page==='stats')return statsPage();
  return '<div class="card"><div class="empty"><div class="empty-icon">◔</div><h3 class="card-title">Статистика пока пуста</h3><div class="card-subtitle">Здесь появятся продажи после подключения операций</div></div></div>';
}
function overview(){
  const rows=filterRows(db.deliveries);
  const totalOnAccounts=db.accounts.reduce((a,x)=>a+Number(x.balance||0),0);
  const totalStock=db.products.reduce((a,x)=>a+Number(x.stock||0),0);
  const monthTotal=rows.reduce((a,d)=>a+Number(d.total||0),0);
  const debtTotal=rows.reduce((a,d)=>a+Math.max(Number(d.total||0)-Number(d.paid||0),0),0);
  return `<div class="kpi-grid"><div class="kpi"><div class="kpi-top">Остаток на счетах</div><div class="kpi-value">${money(totalOnAccounts)}</div><div class="kpi-note muted">По всем счетам</div></div><div class="kpi"><div class="kpi-top">Товаров на складе</div><div class="kpi-value">${totalStock} шт</div><div class="kpi-note muted">Все партии</div></div><div class="kpi"><div class="kpi-top">Поставок всего</div><div class="kpi-value">${rows.length}</div><div class="kpi-note muted">На ${money(monthTotal)}</div></div><div class="kpi"><div class="kpi-top">Текущий долг</div><div class="kpi-value">${money(debtTotal)}</div><div class="kpi-note muted">Перед поставщиками</div></div></div><div class="content-grid"><div class="card"><div class="card-head"><div><h3 class="card-title">Последние поставки</h3><div class="card-subtitle">Только доступные склады</div></div></div>${table(rows)}</div><div class="card"><div class="card-head"><h3 class="card-title">Популярные товары</h3></div>${db.products.length?`<div class="bar-list">${db.products.slice(0,5).map((p,i)=>`<div class="bar-row"><span>${esc(p.name.split(' ')[0])}</span><div class="bar-bg"><div class="bar-fill" style="width:${90-i*18}%"></div></div><b>${90-i*18}%</b></div>`).join('')}</div>`:'<div class="empty"><div class="empty-icon">◫</div><div class="card-subtitle">Нет товаров</div></div>'}</div></div>`;
}
function deliveryEarned(d){return (db.sales||[]).filter(s=>String(s.deliveryId)===String(d.id)).reduce((a,s)=>a+(Number(s.profit)||0),0)}
function table(rows){
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Поставщик</th><th>Склад</th><th>Статус</th><th>Сумма</th><th>Долг</th><th>Заработано на поставке</th><th></th></tr></thead><tbody>${rows.map(d=>`<tr><td>${displayDate(d.date)}</td><td>${esc(d.supplier)}</td><td>${esc(d.warehouse)}</td><td><span class="status ${d.paid>=d.total?'paid':'due'}">${d.paid>=d.total?'Оплачено':'Не оплачено'}</span></td><td class="cost-amount">${money(d.total)}</td><td class="debt-amount">${d.paid<d.total?money(d.total-d.paid):'—'}</td><td class="profit-amount">${money(deliveryEarned(d))}</td><td>${session.role==='admin'?`<button class="action-btn edit" data-edit="deliveries:${d.id}">✎</button><button class="action-btn danger" data-delete="deliveries:${d.id}">⌫</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
function entity(type,title,add,heads,rows){
  const list={sellers:db.users,suppliers:db.suppliers,warehouses:db.warehouses,accounts:db.accounts}[type];
  return `<div class="card"><div class="card-head"><input class="input search" placeholder="Поиск ${title.toLowerCase()}..."><button class="btn btn-primary" id="quickAdd">＋ ${add}</button></div><div class="table-wrap"><table class="table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}<th>Действия</th></tr></thead><tbody>${rows.map((r,i)=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}<td><button class="action-btn edit" data-edit="${type}:${list[i].id}">✎</button><button class="action-btn danger" data-delete="${type}:${list[i].id}">⌫</button></td></tr>`).join('')}</tbody></table></div></div>`;
}
function fields(type,old){
  const f=type==='accounts'?[['name','Название счёта'],['initial','Изначальная сумма']]:type==='sellers'?[['name','Имя продавца'],['phone','Телефон'],['address','Адрес'],['login','Логин'],['password','Пароль']]:type==='warehouses'?[['name','Название склада'],['comment','Комментарий']]:[['name',type==='suppliers'?'Имя поставщика':'Название'],['phone','Телефон'],['comment','Комментарий']];
  return f.map(([k,l])=>`<div class="field ${['comment','address'].includes(k)?'full':''}"><label class="label">${l}</label>${['comment','address'].includes(k)?`<textarea class="textarea" name="${k}">${esc(old[k]||'')}</textarea>`:`<input class="input" name="${k}" type="${k==='password'?'password':k==='initial'?'number':'text'}" autocomplete="${k==='password'?'new-password':'off'}" value="${k==='password'?'':esc(old[k]||'')}" placeholder="${k==='password'&&old.id?'Оставьте пустым, чтобы не менять':''}" ${['name','login'].includes(k)?'required':''}>`}</div>`).join('');
}
function form(type,id){
  const list={sellers:db.users,suppliers:db.suppliers,warehouses:db.warehouses,accounts:db.accounts}[type]||[],old=list.find(x=>x.id===id)||{};
  return `<form class="form" id="entityForm" data-type="${type}" data-id="${id||''}"><div class="form-grid">${fields(type,old)}${type==='accounts'?`<div class="field"><label class="label">Валюта</label><select class="select" name="currency">${Object.entries(CURRENCY).map(([k,v])=>`<option value="${k}" ${old.currency===k?'selected':''}>${k} — ${v}</option>`).join('')}</select></div><div class="field"><label class="label">Вариант оплаты</label><select class="select" name="payment"><option ${old.payment==='Наличный'?'selected':''}>Наличный</option><option ${old.payment==='Безналичный'?'selected':''}>Безналичный</option></select></div>`:''}${type==='warehouses'?`<div class="field"><label class="label">Счёт</label><select class="select" name="accountId">${db.accounts.map(a=>`<option value="${a.id}" ${a.id===old.accountId?'selected':''}>${a.name}</option>`).join('')}</select></div>`:''}${type==='sellers'?`<div class="field full"><label class="label">Доступные склады</label><select class="select" name="warehouses" multiple>${db.warehouses.map(w=>`<option value="${w.id}" ${old.warehouses?.includes(w.id)?'selected':''}>${w.name}</option>`).join('')}</select></div>`:''}</div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeModal">Отмена</button><button class="btn btn-primary">Сохранить</button></div></form>`;
}
function nowLocal(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
function inputDate(value){
  if(!value)return nowLocal();
  if(value.includes('T'))return value.slice(0,16);
  const m=value.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  return m?`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`:nowLocal();
}
function packOptionsHtml(packs,currentPack,custom){
  return `<option value="" disabled hidden ${!currentPack&&!custom?'selected':''}></option>`+
    packs.map(p=>`<option ${p===currentPack?'selected':''}>${esc(p)}</option>`).join('')+
    `<option value="__custom__" ${custom?'selected':''}>＋ Фасовка</option>`;
}
function lineHtml(item={},kind='delivery'){
  const cost=(item.qty||0)*(item.cost||0);
  const retail=item.retailTotal||cost*(1+(Math.round(item.markup||30))/100);
  const packs=catalogPacks(item.name);
  const custom=item.pack&&!packs.includes(item.pack);
  return `<div class="line-item item-line"><input class="input" name="itemName" list="qini-products" value="${esc(item.name||'')}" placeholder="Название товара"><select class="select" name="pack">${packOptionsHtml(packs,item.pack,custom)}</select><input class="input pack-custom" name="packCustom" value="${custom?esc(item.pack):''}" placeholder="Введите фасовку" style="display:${custom?'block':'none'}"><input class="input" name="qty" type="number" value="${item.qty||''}" placeholder="Количество"><input class="input" name="cost" type="number" value="${item.cost||''}" placeholder="Цена / себестоимость"><input class="input calculated-cost" name="costTotal" value="${cost||0}" readonly><input class="input markup-field" name="markup" type="number" min="0" step="1" value="${Math.round(item.markup||30)}" placeholder="Наценка %"><input class="input calculated-retail" name="retailTotal" type="number" value="${retail||0}" placeholder="Сумма с наценкой"><button type="button" class="remove-line">×</button></div>`;
}
function lineHeaderHtml(){
  return `<div class="line-head"><div>Товар</div><div>Фасовка</div><div>Кол-во</div><div>Себестоимость</div><div>Сумма</div><div>Наценка, %</div><div>С наценкой</div><div></div></div>`;
}
function productDatalist(){return `<datalist id="qini-products">${catalogNames().map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>`}
function deliveryForm(id){
  const old=db.deliveries.find(x=>x.id===id)||{};
  const items=old.items?.length?old.items:[{}];
  return `<form class="form" id="deliveryForm" data-id="${id||''}">${productDatalist()}<div class="form-grid"><div class="field"><label class="label">Дата и время</label><input class="input" name="date" type="datetime-local" value="${inputDate(old.date)}" required></div><div class="field"><label class="label">Поставщик</label><select class="select" name="supplier">${db.suppliers.map(x=>`<option ${x.name===old.supplier?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label class="label">Склад</label><select class="select" name="warehouse">${allowed().map(x=>`<option ${x===old.warehouse?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div class="field"><label class="label">Счёт</label><select class="select" name="account">${db.accounts.map(x=>`<option ${x.name===old.account?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label class="label">Оплаченная сумма</label><input class="input" name="paid" type="number" min="0" value="${old.paid||''}" placeholder="Можно оставить пустым"></div><div class="field"><label class="label">Комментарий</label><input class="input" name="comment" value="${esc(old.comment||'')}" placeholder="Необязательно"></div><div class="field full"><label class="label">Товары в поставке</label><div class="line-items" id="deliveryLines">${lineHeaderHtml()}${items.map(i=>lineHtml(i)).join('')}</div><button type="button" class="add-line" id="addDeliveryLine">＋ Добавить ещё товар</button></div></div><div class="summary-row"><div><div class="summary-label">Сумма поставки</div><div class="summary-value" id="deliveryTotal">${money(old.total||0)}</div></div><div><div class="summary-label">Сумма с наценкой</div><div class="summary-value retail-amount" id="deliveryRetailTotal">${money(items.reduce((a,i)=>a+(i.retailTotal||((i.qty||0)*(i.cost||0)*(1+(Math.round(i.markup||30))/100))),0))}</div></div></div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeModal">Отмена</button><button class="btn btn-primary">${id?'Сохранить изменения':'Добавить поставку'}</button></div></form>`;
}
function writeoffForm(id){
  const old=db.writeoffs.find(x=>x.id===id)||{};
  const items=old.items?.length?old.items:[{}];
  return `<form class="form" id="writeoffForm" data-id="${id||''}">${productDatalist()}<div class="form-grid"><div class="field"><label class="label">Дата и время</label><input class="input" name="date" type="datetime-local" value="${inputDate(old.date)}" required></div><div class="field"><label class="label">Склад</label><select class="select" name="warehouse">${allowed().map(x=>`<option ${x===old.warehouse?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div class="field"><label class="label">Счёт зачисления</label><select class="select" name="account">${db.accounts.map(x=>`<option ${x.name===old.account?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label class="label">Комментарий</label><input class="input" name="comment" value="${esc(old.comment||'')}" placeholder="Необязательно"></div><div class="field full"><label class="label">Товары к списанию</label><div class="line-items" id="writeoffLines">${lineHeaderHtml()}${items.map(i=>lineHtml(i,'writeoff')).join('')}</div><button type="button" class="add-line" id="addWriteoffLine">＋ Добавить ещё товар</button></div></div><div class="summary-row"><div><div class="summary-label">Сумма списания</div><div class="summary-value" id="writeoffTotal">${money(old.total||0)}</div></div><div><div class="summary-label">Цена с наценкой</div><div class="summary-value retail-amount" id="writeoffRetailTotal">${money(items.reduce((a,i)=>a+(i.retailTotal||((i.qty||0)*(i.cost||0)*(1+(Math.round(i.markup||30))/100))),0))}</div></div></div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeModal">Отмена</button><button class="btn btn-primary">${id?'Сохранить изменения':'Добавить списание'}</button></div></form>`;
}
function modal(type,id){
  if(type==='delivery')return deliveryForm(id);
  if(type==='writeoff')return writeoffForm(id);
  if(type==='profile')return `<form class="form" id="profileForm"><div class="form-grid"><div class="field"><label class="label">Имя</label><input class="input" name="name" value="${esc(db.auth.name)}" required></div><div class="field"><label class="label">Телефон</label><input class="input" name="phone" value="${esc(db.auth.phone||'')}"></div><div class="field"><label class="label">Логин</label><input class="input" name="login" value="${esc(db.auth.login)}" required></div><div class="field"><label class="label">Новый пароль</label><input class="input" name="password" type="password" autocomplete="new-password"></div></div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeModal">Отмена</button><button class="btn btn-primary">Сохранить</button></div></form>`;
  return form(type,id);
}
function collectItems(form){
  return [...form.querySelectorAll('.item-line')].map(row=>{
    const qty=+(row.querySelector('[name=qty]')?.value||0);
    const cost=+(row.querySelector('[name=cost]')?.value||0);
    const retail=+(row.querySelector('[name=retailTotal]')?.value||0);
    const typedMarkup=+(row.querySelector('[name=markup]')?.value||30);
    const packSelect=row.querySelector('[name=pack]')?.value||'';
    const pack=packSelect==='__custom__'?(row.querySelector('[name=packCustom]')?.value||''):packSelect;
    const m=retail&&qty&&cost?((retail/(qty*cost))-1)*100:typedMarkup;
    return {name:row.querySelector('[name=itemName]')?.value||'',pack,qty,cost,markup:Math.round(m||0),retailTotal:retail};
  }).filter(x=>x.name||x.qty);
}
function bindLineRemove(){document.querySelectorAll('.remove-line').forEach(b=>b.onclick=()=>{if(document.querySelectorAll('.item-line').length>1)b.closest('.item-line').remove()})}
function openModal(type,id){
  const title=type==='profile'?'Мой профиль':id?'Редактировать запись':({delivery:'Новая поставка',writeoff:'Новое списание',sellers:'Новый продавец',suppliers:'Новый поставщик',warehouses:'Новый склад',accounts:'Новый счёт'}[type]||'Добавить');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="modal"><div class="modal"><div class="modal-head"><div><h2 class="modal-title">${title}</h2><div class="modal-desc">Изменения сохраняются в Google Sheets</div></div><button class="close" id="x">×</button></div>${modal(type,id)}</div></div>`);
  el('#x').onclick=()=>el('#modal').remove();
  el('#closeModal').onclick=()=>el('#modal').remove();
  if(type==='delivery'||type==='writeoff'){
    const formEl=el(type==='delivery'?'#deliveryForm':'#writeoffForm');
    el(type==='delivery'?'#addDeliveryLine':'#addWriteoffLine').onclick=()=>{
      const target=el(type==='delivery'?'#deliveryLines':'#writeoffLines');
      target.insertAdjacentHTML('beforeend',lineHtml({},type));
      bindLineRemove();
    };
    bindLineRemove();
    formEl.addEventListener('input',()=>{
      const total=collectItems(formEl).reduce((a,x)=>a+x.qty*x.cost,0);
      const out=el(type==='delivery'?'#deliveryTotal':'#writeoffTotal');
      if(out)out.textContent=money(total);
    });
    formEl.onsubmit=async e=>{
      e.preventDefault();
      const submit=e.submitter;if(submit)submit.disabled=true;
      const f=new FormData(e.target);
      const items=collectItems(e.target);
      const total=items.reduce((a,x)=>a+x.qty*x.cost,0);
      const supplier=f.get('supplier'),warehouse=f.get('warehouse'),account=f.get('account');
      const data={id:id||undefined,date:f.get('date'),warehouse,account,paid:+f.get('paid')||0,total,comment:f.get('comment'),items:JSON.stringify(items)};
      if(type==='delivery'){
        data.supplier=supplier;
        data.status=data.paid>=data.total?'paid':'due';
        data.supplierId=db.suppliers.find(x=>x.name===supplier)?.id||'';
        data.warehouseId=db.warehouses.find(x=>x.name===warehouse)?.id||'';
        data.accountId=db.accounts.find(x=>x.name===account)?.id||'';
      }else{
        data.warehouseId=db.warehouses.find(x=>x.name===warehouse)?.id||'';
        data.accountId=db.accounts.find(x=>x.name===account)?.id||'';
      }
      const response=await api(id?'update':'create',type==='delivery'?'Deliveries':'Writeoffs',data);
      if(API_URL&&!response.ok){if(submit)submit.disabled=false;toast('Ошибка сохранения: '+(response.error||'API'));return}
      items.forEach(i=>catalogAdd(i.name,i.pack));
      const list=type==='delivery'?db.deliveries:db.writeoffs;
      const local={...data,items,date:data.date};
      if(id){const old=list.find(x=>x.id===id);Object.assign(old,local)}
      else{const newId=(response&&response.data&&response.data.id)||((type==='delivery'?'d':'wo')+Date.now());list.unshift({...local,id:newId})}
      save();el('#modal').remove();render();
      if(API_URL){try{await sync()}catch(e){}}
      toast(type==='delivery'?'Поставка сохранена':'Списание сохранено');
    };
  }else if(type==='profile'){
    el('#profileForm').onsubmit=async e=>{
      e.preventDefault();
      const f=new FormData(e.target);
      db.auth.name=f.get('name');db.auth.phone=f.get('phone');db.auth.login=f.get('login');
      if(f.get('password'))db.auth.password=f.get('password');
      session.name=db.auth.name;
      sessionStorage.setItem('qini-session',JSON.stringify(session));
      save();el('#modal').remove();render();toast('Профиль обновлён');
    };
  }else{
    const f=el('#entityForm');if(!f)return;
    f.onsubmit=async e=>{
      e.preventDefault();
      const submit=e.submitter;if(submit)submit.disabled=true;
      const data=Object.fromEntries(new FormData(f));
      const t=f.dataset.type,id=f.dataset.id;
      const list={sellers:db.users,suppliers:db.suppliers,warehouses:db.warehouses,accounts:db.accounts}[t];
      let selected=[];
      if(t==='sellers'){selected=new FormData(f).getAll('warehouses');data.warehouseIds=JSON.stringify(selected)}
      if(t==='accounts')Object.assign(data,{currency:data.currency||'GEL',payment:data.payment||'Наличный',balance:+data.initial||0});
      const payload={...data,id:id||undefined};
      const response=await api(id?'update':'create',t==='sellers'?'Sellers':t[0].toUpperCase()+t.slice(1),payload);
      if(API_URL&&!response.ok){if(submit)submit.disabled=false;toast('Ошибка сохранения: '+(response.error||'API'));return}
      delete data.warehouseIds;
      if(t==='sellers')data.warehouses=selected;
      if(id){const old=list.find(x=>x.id===id);if(!data.password)delete data.password;Object.assign(old,data)}
      else{data.id=(response&&response.data&&response.data.id)||data.id||(t[0]+Date.now());list.push(data)}
      save();el('#modal').remove();render();
      if(API_URL){try{await sync()}catch(e){}}
      toast(id?'Изменения сохранены':'Запись добавлена');
    };
  }
}
function confirmInApp(message){
  return new Promise(resolve=>{
    document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="confirmModal"><div class="confirm-modal"><div class="confirm-icon">!</div><h3>Удалить запись?</h3><p>${message}</p><div class="confirm-actions"><button class="btn btn-light" id="cancelConfirm">Отмена</button><button class="btn btn-danger" id="acceptConfirm">Удалить</button></div></div></div>`);
    el('#cancelConfirm').onclick=()=>{el('#confirmModal').remove();resolve(false)};
    el('#acceptConfirm').onclick=()=>{el('#confirmModal').remove();resolve(true)};
  });
}
function bind(){
  document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{db.page=b.dataset.page;stockFilter='';save();render()});
  document.querySelectorAll('#quickAdd').forEach(b=>b.onclick=()=>openModal(db.page==='deliveries'?'delivery':db.page==='writeoffs'?'writeoff':db.page));
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const [t,id]=b.dataset.edit.split(':');openModal(t==='deliveries'?'delivery':t==='writeoffs'?'writeoff':t,id)});
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
    const [t,id]=b.dataset.delete.split(':');
    deleteRecord(t,id);
  });
  el('#profile')?.addEventListener('click',()=>session.role==='admin'?openModal('profile'):toast('Профиль изменяет администратор'));
  el('#logout')?.addEventListener('click',()=>{session=null;sessionStorage.removeItem('qini-session');render()});
  el('#mobileMenu')?.addEventListener('click',()=>el('#sidebar').classList.toggle('open'));
}
async function sync(){
  if(!API_URL||!session?.token)return;
  setSyncStatus('pending');
  try{
    const r=await fetch(`${API_URL}?action=bootstrap&token=${encodeURIComponent(session.token)}`);
    const text=await r.text();
    const p=parseJsonResponse(text);
    if(p.ok){
      const x=normalizeSheetData(p.data);
      db.accounts=x.Accounts||db.accounts;
      db.warehouses=x.Warehouses||db.warehouses;
      db.suppliers=x.Suppliers||db.suppliers;
      db.users=x.Sellers||db.users;
      const current=db.users.find(u=>String(u.id)===String(session.userId)||String(u.login)===String(session.login));
      if(session.role==='seller'&&current){session.userId=current.id;session.warehouses=current.warehouses||[];sessionStorage.setItem('qini-session',JSON.stringify(session))}
      db.sales=x.Sales||db.sales;
      db.deliveries=x.Deliveries||db.deliveries;
      db.writeoffs=x.Writeoffs||db.writeoffs;
      (db.deliveries||[]).forEach(d=>(d.items||[]).forEach(i=>catalogAdd(i.name,i.pack)));
      (db.writeoffs||[]).forEach(w=>(w.items||[]).forEach(i=>catalogAdd(i.name,i.pack)));
      (db.sales||[]).forEach(s=>catalogAdd(s.productName,s.pack));
      db.products=inventoryFromData(x);
      save();render();
      setSyncStatus('sync');
    }else{
      // Если сессия истекла — выходим на экран логина, а не красный кружок.
      if(handleSessionError(p.error)){return}
      setSyncStatus('error');
      toast('Ошибка синхронизации: '+(p.error||'сервер вернул ошибку'));
    }
  }catch(e){
    setSyncStatus('error');
    toast('Ошибка синхронизации: '+e.message);
  }
}
function stockSales(p){
  return (db.sales||[]).filter(s=>s.productName===p.name&&String(s.pack||'')===String(p.pack||'')&&(!p.warehouse||s.warehouse===p.warehouse)).reduce((a,s)=>({qty:a.qty+(+s.qty||0),total:a.total+(+s.total||0),profit:a.profit+(+s.profit||0)}),{qty:0,total:0,profit:0});
}
function decorateStock(){
  const table=document.querySelector('.table');if(!table)return;
  const tr=table.querySelector('thead tr');
  const labels=[
    {t:'Товар',title:'Товар'},{t:'Склад',title:'Склад'},{t:'Партия',title:'Партия — дата и поставщик поставки'},
    {t:'Ост.',title:'Остаток на складе'},{t:'Себес.',title:'Себестоимость за единицу'},
    {t:'Закуп',title:'Сумма по себестоимости (себестоимость × остаток)'},{t:'Нц.',title:'Наценка, % (целое число)'},
    {t:'Цена',title:'Цена с наценкой за единицу'},{t:'Итого',title:'Итого с наценкой (цена × остаток)'},{t:'',title:''}
  ];
  tr.innerHTML=labels.map(x=>`<th title="${x.title}">${x.t}</th>`).join('');
  const q=stockFilter.trim().toLowerCase();
  const list=q?db.products.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.pack||'').toLowerCase().includes(q)||(p.warehouse||'').toLowerCase().includes(q)||(p.supplier||'').toLowerCase().includes(q)):db.products;
  const tbody=table.querySelector('tbody');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="10"><div class="empty"><div class="empty-icon">◫</div><div class="card-subtitle">${q?'Ничего не найдено':'Остатков пока нет'}</div></div></td></tr>`;return}
  tbody.innerHTML=list.map(p=>{
    const idx=db.products.indexOf(p);
    const unit=p.cost*(1+p.markup/100);
    const deliveryFull=p.deliveryDate?`${displayDate(p.deliveryDate)}${p.supplier?' · '+p.supplier:''}`:'—';
    const deliveryShort=p.deliveryDate?displayDate(p.deliveryDate):'—';
    return `<tr><td>${esc(p.name)} <span style="color:var(--muted);font-weight:400">${esc(p.pack)}</span></td><td>${esc(p.warehouse||'—')}</td><td title="${esc(deliveryFull)}" style="white-space:nowrap">${esc(deliveryShort)}</td><td class="amount">${p.stock} шт</td><td class="cost-amount">${money(p.cost)}</td><td class="cost-amount">${money(p.cost*p.stock)}</td><td><input class="input preview-markup" type="number" min="0" step="1" value="${Math.round(p.markup)}" style="width:70px"> %</td><td class="retail-amount retail-unit">${money(unit)}</td><td class="retail-amount retail-total">${money(unit*p.stock)}</td><td><button class="btn btn-primary btn-sm sell-stock" data-stock-index="${idx}">Продать</button></td></tr>`;
  }).join('');
  tbody.querySelectorAll('.preview-markup').forEach((input,k)=>{
    const p=list[k];if(!p)return;
    input.addEventListener('input',()=>{
      const markup=Math.round(+input.value||0),unit=p.cost*(1+markup/100);
      const row=input.closest('tr');
      const ru=row.querySelector('.retail-unit'),rt=row.querySelector('.retail-total');
      if(ru)ru.textContent=money(unit);
      if(rt)rt.textContent=money(unit*p.stock);
    });
    input.addEventListener('blur',()=>{input.value=Math.round(+input.value||0)});
  });
  tbody.querySelectorAll('.sell-stock').forEach(b=>b.onclick=()=>openSaleModal(db.products[+b.dataset.stockIndex]));
}
function showDeliveryItems(id){
  const d=db.deliveries.find(x=>String(x.id)===String(id));if(!d)return;
  const rows=(d.items||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.pack)}</td><td>${i.qty}</td><td>${money(i.cost)}</td><td>${money(i.qty*i.cost)}</td><td>${fmtPct(i.markup)}</td><td>${money(i.qty*i.cost*(1+(i.markup||0)/100))}</td></tr>`).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="itemsModal"><div class="modal"><div class="modal-head"><div><h2 class="modal-title">Товары в поставке</h2><div class="modal-desc">${displayDate(d.date)} · ${esc(d.supplier||'')} · ${esc(d.warehouse||'')}</div></div><button class="close" id="closeItems">×</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Название</th><th>Фасовка</th><th>Количество</th><th>Себестоимость</th><th>Сумма</th><th>Наценка</th><th>Сумма с наценкой</th></tr></thead><tbody>${rows||'<tr><td colspan="7"><div class="empty">Товары не найдены</div></td></tr>'}</tbody></table></div></div></div>`);
  el('#closeItems').onclick=()=>el('#itemsModal').remove();
}
function decorateDeliveryActions(){
  const rows=document.querySelectorAll('.table tbody tr');
  rows.forEach((row,i)=>{
    const d=db.deliveries[i];if(!d||!session||session.role!=='admin'&&session.role!=='seller')return;
    const cell=row.lastElementChild;if(!cell)return;
    const b=document.createElement('button');b.className='action-btn';b.textContent='◉';b.title='Показать товары';
    b.onclick=()=>showDeliveryItems(d.id);cell.prepend(b);
  });
}
function decorateWriteoffs(){
  if(db.page!=='writeoffs')return;
  const empty=document.querySelector('#pageContent .empty');if(!empty||!db.writeoffs.length)return;
  const table=document.createElement('div');table.className='table-wrap';
  table.innerHTML=`<table class="table"><thead><tr><th>Дата и время</th><th>Склад</th><th>Счёт</th><th>Сумма</th><th>Комментарий</th>${session.role==='admin'?'<th>Действия</th>':''}</tr></thead><tbody>${db.writeoffs.map(w=>`<tr><td>${displayDate(w.date)}</td><td>${esc(w.warehouse||'')}</td><td>${esc(w.account||'')}</td><td class="cost-amount">${money(w.total)}</td><td>${esc(w.comment||'')}</td>${session.role==='admin'?`<td><button class="action-btn edit" data-edit="writeoffs:${w.id}">✎</button><button class="action-btn danger" data-delete="writeoffs:${w.id}">⌫</button></td>`:''}</tr>`).join('')}</tbody></table>`;
  empty.replaceWith(table);
  table.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openModal('writeoff',b.dataset.edit.split(':')[1]));
  table.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteRecord('writeoffs',b.dataset.delete.split(':')[1]));
}
async function deleteRecord(type,id){
  const message=type==='deliveries'
    ?'Удалить поставку и все продажи, сделанные из её партий?'
    :'После удаления запись нельзя будет восстановить.';
  if(!(await confirmInApp(message)))return;
  if(type==='sales'){
    const i=(db.sales||[]).findIndex(x=>String(x.id)===String(id));
    if(i>=0)db.sales.splice(i,1);
  }else if(type==='writeoffs'){
    const i=(db.writeoffs||[]).findIndex(x=>String(x.id)===String(id));
    if(i>=0)db.writeoffs.splice(i,1);
  }else if(type==='deliveries'){
    const list=db.deliveries,i=list.findIndex(x=>String(x.id)===String(id));
    if(i>=0)list.splice(i,1);
    db.sales=(db.sales||[]).filter(s=>String(s.deliveryId)!==String(id));
  }else{
    const list={sellers:db.users,suppliers:db.suppliers,warehouses:db.warehouses,accounts:db.accounts}[type];
    if(list){const i=list.findIndex(x=>String(x.id)===String(id));if(i>=0)list.splice(i,1)}
  }
  save();render();toast('Запись удалена');
  if(!API_URL)return;
  const entity=type==='sales'?'Sales':type==='writeoffs'?'Writeoffs':type==='deliveries'?'Deliveries':type==='sellers'?'Sellers':type[0].toUpperCase()+type.slice(1);
  const response=await api('delete',entity,{id});
  if(!response.ok)toast('Ошибка удаления: '+(response.error||'API'));
  try{await sync()}catch(e){}
}
function openSaleModal(p){
  const accountId=db.warehouses.find(w=>w.name===p.warehouse)?.accountId||'';
  const deliveryInfo=p.deliveryDate?`Поставка: ${displayDate(p.deliveryDate)}${p.supplier?' · '+esc(p.supplier):''}`:'Партия без поставки';
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="saleModal"><div class="modal"><div class="modal-head"><div><h2 class="modal-title">Продажа товара</h2><div class="modal-desc">${esc(p.name)} · ${esc(p.pack)} · ${esc(p.warehouse||'')} · ${deliveryInfo}</div></div><button class="close" id="closeSale">×</button></div><form class="form" id="saleForm"><div class="form-grid"><div class="field"><label class="label">Дата и время</label><input class="input" name="date" type="datetime-local" value="${nowLocal()}" required></div><div class="field"><label class="label">Количество</label><input class="input" name="qty" type="number" min="0.01" max="${p.stock}" step="any" required></div><div class="field"><label class="label">Наценка, %</label><input class="input" name="markup" type="number" min="0" step="1" value="${Math.round(p.markup||0)}" required></div><div class="field"><label class="label">Цена продажи за единицу</label><input class="input" name="unitPrice" type="number" step="any" value="${(p.cost*(1+Math.round(p.markup||0)/100)).toFixed(2)}" required></div><div class="field full"><label class="label">Комментарий</label><input class="input" name="comment" placeholder="Необязательно"></div></div><div class="summary-row"><div><div class="summary-label">Сумма продажи</div><div class="summary-value retail-amount" id="saleTotal">0</div></div><div><div class="summary-label">Заработано</div><div class="summary-value profit-amount" id="saleProfit">0</div></div></div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeSale2">Отмена</button><button class="btn btn-primary">Добавить продажу</button></div></form></div></div>`);
  const close=()=>el('#saleModal')?.remove();
  el('#closeSale').onclick=close;
  el('#closeSale2').onclick=close;
  const f=el('#saleForm');
  const recalc=(source)=>{
    const q=+(f.qty.value||0),markup=Math.round(+(f.markup.value||0)),price=+(f.unitPrice.value||0);
    if(source==='markup')f.unitPrice.value=(p.cost*(1+markup/100)).toFixed(2);
    else if(source==='price'&&p.cost)f.markup.value=Math.round(((price/p.cost)-1)*100);
    const finalPrice=+(f.unitPrice.value||0),total=q*finalPrice;
    el('#saleTotal').textContent=money(total);
    el('#saleProfit').textContent=money(q*(finalPrice-p.cost));
  };
  f.addEventListener('input',e=>recalc(e.target.name==='markup'?'markup':e.target.name==='unitPrice'?'price':''));
  recalc();
  f.onsubmit=async e=>{
    e.preventDefault();
    const q=+f.qty.value,price=+f.unitPrice.value,markup=Math.round(+f.markup.value||0),total=q*price,submit=e.submitter;
    if(submit){submit.disabled=true;submit.classList.add('is-loading');submit.innerHTML='<span class="spinner"></span> Сохраняем…'}
    const data={date:f.date.value,warehouseId:db.warehouses.find(w=>w.name===p.warehouse)?.id||'',accountId,productName:p.name,pack:p.pack,qty:q,markup,unitPrice:price,cost:p.cost,total,profit:q*(price-p.cost),sellerId:session.userId||'',deliveryId:p.deliveryId||'',comment:(f.comment?.value||'').trim()};
    const r=await api('create','Sales',data);
    if(API_URL&&!r.ok){if(submit){submit.disabled=false;submit.classList.remove('is-loading');submit.textContent='Добавить продажу'}toast('Ошибка сохранения: '+r.error);return}
    const newId=(r&&r.data&&r.data.id)||data.id||('sale'+Date.now());
    db.sales.push({...data,id:newId,warehouse:p.warehouse});
    save();close();render();
    if(API_URL){try{await sync()}catch(e){}}
    toast('Продажа добавлена');
  };
}
function shortId(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';let s='';for(let i=0;i<8;i++)s+=chars[Math.floor(Math.random()*chars.length)];return s}
function getLastMenu(){try{return JSON.parse(localStorage.getItem('qini-last-menu')||'null')}catch(e){return null}}
function setLastMenu(m){try{if(m)localStorage.setItem('qini-last-menu',JSON.stringify(m));else localStorage.removeItem('qini-last-menu')}catch(e){}}
function cacheMenu(id,menu){try{sessionStorage.setItem('qini-menu-cache-'+id,JSON.stringify({t:Date.now(),m:menu}))}catch(e){}}
function getCachedMenu(id){try{const raw=sessionStorage.getItem('qini-menu-cache-'+id);if(!raw)return null;const o=JSON.parse(raw);if(!o||Date.now()-o.t>10*60*1000)return null;return o.m}catch(e){return null}}
function menuUrl(id){return location.origin+location.pathname+'#menu='+id}
function showMenuLoading(){
  const styles=`<style>body{background:#f7f8fc;margin:0}#app{min-height:100vh}.menu-page{max-width:720px;margin:0 auto;padding:32px 20px 60px;font-family:'DM Sans',sans-serif;color:#202432}.menu-loading{text-align:center;padding:100px 20px;color:#8c93a5}.spinner-lg{width:40px;height:40px;border:3px solid #e8eaf0;border-top-color:#7868ee;border-radius:50%;display:inline-block;animation:qini-spin 0.8s linear infinite;margin-bottom:18px}@keyframes qini-spin{to{transform:rotate(360deg)}}</style>`;
  document.querySelector('#app').innerHTML=styles+`<div class="menu-page"><div class="menu-loading"><div class="spinner-lg"></div><div>Загрузка меню…</div></div></div>`;
}
function renderMenuPage(menu){
  const items=Array.isArray(menu.items)?menu.items:[];
  const styles=`body{background:#f7f8fc;margin:0}#app{min-height:100vh}.menu-page{max-width:720px;margin:0 auto;padding:32px 20px 60px;font-family:'DM Sans',sans-serif;color:#202432}.menu-header{text-align:center;padding:20px 0 30px;border-bottom:1px solid #e8eaf0;margin-bottom:24px}.menu-brand{width:54px;height:54px;margin:0 auto 16px;border-radius:16px;background:linear-gradient(145deg,#897af5,#6354db);color:#fff;display:grid;place-items:center;font-family:Manrope;font-weight:800;font-size:28px;box-shadow:0 12px 30px rgba(120,104,238,.35)}.menu-title{font:800 28px Manrope;letter-spacing:-1px;margin:0 0 8px}.menu-sub{color:#8c93a5;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700}.menu-list{display:grid;gap:10px}.menu-item{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 20px;background:#fff;border:1px solid #e8eaf0;border-radius:16px;box-shadow:0 6px 20px rgba(31,38,64,.05)}.menu-item-name{font-weight:700;font-size:15px}.menu-item-pack{color:#8c93a5;font-size:12px;margin-top:3px}.menu-item-price{font:800 17px Manrope;color:#7868ee;white-space:nowrap}.menu-empty{padding:60px 20px;text-align:center;color:#8c93a5}.menu-footer{text-align:center;margin-top:36px;color:#b1b5c2;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700}@media(max-width:500px){.menu-title{font-size:22px}.menu-item{padding:14px 16px}.menu-item-name{font-size:14px}.menu-item-price{font-size:15px}.menu-page{padding:20px 14px 40px}}`;
  document.querySelector('#app').innerHTML=`<style>${styles}</style><div class="menu-page"><header class="menu-header"><div class="menu-brand">Q</div><h1 class="menu-title">${esc(menu.title||'Меню')}</h1><div class="menu-sub">Актуально на ${new Date().toLocaleDateString('ru-RU')}</div></header>${items.length?`<div class="menu-list">${items.map(i=>`<div class="menu-item"><div><div class="menu-item-name">${esc(i.n||'')}</div>${i.p?`<div class="menu-item-pack">${esc(i.p)}</div>`:''}</div><div class="menu-item-price">${money(i.pr)}</div></div>`).join('')}</div>`:'<div class="menu-empty">Меню пустое</div>'}<footer class="menu-footer">Сформировано в qini</footer></div>`;
}
function showMenuError(msg){
  const styles=`<style>body{background:#f7f8fc;margin:0}#app{min-height:100vh}.menu-err{padding:100px 24px;text-align:center;font-family:'DM Sans',sans-serif;color:#8c93a5}.menu-err h2{color:#202432;font-family:Manrope;margin:0 0 10px}.menu-err button{margin-top:20px;background:#7868ee;color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:700;cursor:pointer}</style>`;
  document.querySelector('#app').innerHTML=`${styles}<div class="menu-err"><h2>${esc(msg)}</h2><p>Возможно, ссылка устарела или повреждена.</p><button onclick="location.reload()">Повторить</button></div>`;
}
async function renderMenuFromHash(raw){
  showMenuLoading();
  const looksShort=raw.length<=24&&/^[A-Za-z0-9]+$/.test(raw);
  if(looksShort){
    const cached=getCachedMenu(raw);
    if(cached){renderMenuPage(cached);return}
    if(!API_URL){showMenuError('Меню недоступно');return}
    try{
      const r=await fetch(`${API_URL}?action=menu&id=${encodeURIComponent(raw)}`);
      const text=await r.text();
      const t=String(text||'').trim();
      if(!t||t[0]==='<'){showMenuError('Меню временно недоступно');return}
      let data;try{data=JSON.parse(t)}catch(e){showMenuError('Некорректный ответ сервера');return}
      if(data.ok&&data.menu){cacheMenu(raw,data.menu);renderMenuPage(data.menu);return}
      showMenuError(data.error||'Меню не найдено');
    }catch(e){showMenuError('Не удалось загрузить меню')}
    return;
  }
  try{
    const decoded=decodeURIComponent(escape(atob(raw)));
    const menu=JSON.parse(decoded);
    renderMenuPage(menu);
  }catch(e){showMenuError('Не удалось открыть меню')}
}
function openMenuDialog(){
  const last=getLastMenu();
  if(!last){openCreateMenu();return}
  const dateStr=last.ts?new Date(last.ts).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'';
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="menuDialog"><div class="modal" style="width:min(520px,100%)"><div class="modal-head"><div><h2 class="modal-title">Меню</h2><div class="modal-desc">У вас уже есть созданное меню</div></div><button class="close" id="closeDialog">×</button></div><div class="form"><div class="form-grid"><div class="field full"><div style="padding:16px 18px;background:#fafaff;border:1px solid var(--line);border-radius:14px"><div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(last.title||'Меню')}</div><div style="color:var(--muted);font-size:12px">${last.items||0} товаров${dateStr?' · '+dateStr:''}</div></div></div></div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeDialog2">Отмена</button><button type="button" class="btn btn-light" id="newMenuBtn">Создать новое</button><button type="button" class="btn btn-primary" id="openLastBtn">Открыть последнее</button></div></div></div></div>`);
  const close=()=>el('#menuDialog')?.remove();
  el('#closeDialog').onclick=close;
  el('#closeDialog2').onclick=close;
  el('#newMenuBtn').onclick=()=>{close();openCreateMenu()};
  el('#openLastBtn').onclick=()=>{close();window.open(menuUrl(last.id),'_blank')};
}
function openCreateMenu(){
  const products=(db.products||[]).filter(p=>p.stock>0);
  if(!products.length){toast('Нет товаров в остатках');return}
  const rows=products.map((p,i)=>`<label style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #f1f2f6;cursor:pointer"><input type="checkbox" name="pick" value="${i}" checked style="width:16px;height:16px;accent-color:#7868ee"><span style="flex:1;font-size:13px;font-weight:600;color:#202432">${esc(p.name)}${p.pack?' <span style="color:#8c93a5;font-weight:400">· '+esc(p.pack)+'</span>':''}</span><span style="font-weight:700;color:#7868ee;font-size:13px;white-space:nowrap">${money(p.cost*(1+p.markup/100))}</span></label>`).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="menuModal"><div class="modal" style="width:min(620px,100%)"><div class="modal-head"><div><h2 class="modal-title">Создать меню</h2><div class="modal-desc">Отметьте товары — сгенерируется ссылка для отправки</div></div><button class="close" id="closeMenu">×</button></div><form class="form" id="menuForm"><div class="form-grid"><div class="field full"><label class="label">Название меню</label><input class="input" name="title" value="Меню" placeholder="Например: Меню на сегодня" required></div><div class="field full"><label class="label">Товары (${products.length})</label><div style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:12px">${rows}</div></div></div><div class="modal-foot"><button type="button" class="btn btn-light" id="closeMenu2">Отмена</button><button class="btn btn-primary" type="submit">Создать ссылку</button></div></form></div></div>`);
  const close=()=>el('#menuModal')?.remove();
  el('#closeMenu').onclick=close;
  el('#closeMenu2').onclick=close;
  el('#menuForm').onsubmit=async e=>{
    e.preventDefault();
    const submit=e.submitter;
    const orig=submit?submit.textContent:'';
    if(submit){submit.disabled=true;submit.classList.add('is-loading');submit.innerHTML='<span class="spinner"></span> Создаём…'}
    const f=new FormData(e.target);
    const picks=f.getAll('pick').map(x=>+x);
    if(!picks.length){toast('Выберите хотя бы один товар');if(submit){submit.disabled=false;submit.classList.remove('is-loading');submit.textContent=orig}return}
    const items=picks.map(i=>{const p=products[i];return {n:p.name,p:p.pack,pr:+((p.cost*(1+p.markup/100)).toFixed(2))}});
    const title=(f.get('title')||'Меню').trim();
    const menu={title,items,ts:Date.now()};
    const prev=getLastMenu();
    if(!API_URL){
      let b64;
      try{b64=btoa(unescape(encodeURIComponent(JSON.stringify(menu))))}catch(err){toast('Не удалось сформировать меню');if(submit){submit.disabled=false;submit.classList.remove('is-loading');submit.textContent=orig}return}
      close();
      showMenuLink(location.origin+location.pathname+'#menu='+b64,null);
      return;
    }
    const id=shortId();
    const r=await api('saveMenu',null,{id,title,payload:JSON.stringify(menu)});
    if(!r.ok){toast('Не удалось сохранить меню: '+(r.error||'API'));if(submit){submit.disabled=false;submit.classList.remove('is-loading');submit.textContent=orig}return}
    if(prev&&prev.id){api('deleteMenu',null,{id:prev.id}).catch(()=>{})}
    cacheMenu(id,menu);
    setLastMenu({id,title,items:items.length,ts:Date.now()});
    close();
    showMenuLink(menuUrl(id),id);
  };
}
function showMenuLink(url,_id){
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="linkModal"><div class="modal" style="width:min(620px,100%)"><div class="modal-head"><div><h2 class="modal-title">Ссылка на меню готова</h2><div class="modal-desc">Скопируйте и отправьте клиенту</div></div><button class="close" id="closeLink">×</button></div><div class="form"><div class="field full"><label class="label">Ссылка</label><textarea class="textarea" id="menuLink" readonly rows="3" style="font-size:11px">${esc(url)}</textarea></div><div class="modal-foot"><button type="button" class="btn btn-light" id="previewLink">Открыть</button><button type="button" class="btn btn-light" id="closeLink2">Закрыть</button><button type="button" class="btn btn-primary" id="copyLink">Скопировать</button></div></div></div></div>`);
  el('#closeLink').onclick=()=>el('#linkModal').remove();
  el('#closeLink2').onclick=()=>el('#linkModal').remove();
  el('#previewLink').onclick=()=>window.open(url,'_blank');
  el('#copyLink').onclick=async()=>{
    try{await navigator.clipboard.writeText(url);toast('Ссылка скопирована')}
    catch(err){const ta=el('#menuLink');ta.focus();ta.select();try{document.execCommand('copy');toast('Ссылка скопирована')}catch(e2){toast('Скопируйте вручную')}}
  };
}
const renderBase=render;
render=()=>{
  renderBase();
  if(db.page==='stock'){
    decorateStock();
    const ss=document.getElementById('stockSearch');
    if(ss){ss.value=stockFilter;ss.addEventListener('input',()=>{stockFilter=ss.value;decorateStock()})}
    const cb=document.getElementById('createMenuBtn');
    if(cb)cb.onclick=openMenuDialog;
  }
  if(db.page==='deliveries')decorateDeliveryActions();
  if(db.page==='writeoffs')decorateWriteoffs();
};
(async()=>{
  const hash=String(location.hash||'');
  if(hash.startsWith('#menu=')){
    await renderMenuFromHash(hash.slice(6));
    return;
  }
  render();
  sync();
})();
document.addEventListener('input',e=>{
  const form=e.target.closest('#deliveryForm,#writeoffForm');if(!form)return;
  const row=e.target.closest('.item-line');
  if(row&&e.target.name==='itemName'){
    const name=e.target.value,select=row.querySelector('[name=pack]');
    if(select){
      const current=select.value;
      const packs=catalogPacks(name);
      const custom=current==='__custom__';
      select.innerHTML=packOptionsHtml(packs,current,custom);
      select.value=current||'';
    }
  }
  if(row&&e.target.name==='retailTotal'){
    const qty=+(row.querySelector('[name=qty]')?.value||0),cost=+(row.querySelector('[name=cost]')?.value||0);
    if(qty&&cost)row.querySelector('[name=markup]').value=Math.round(((+e.target.value/(qty*cost))-1)*100);
  }else form.querySelectorAll('.item-line').forEach(r=>{
    const qty=+(r.querySelector('[name=qty]')?.value||0),cost=+(r.querySelector('[name=cost]')?.value||0),markup=Math.round(+(r.querySelector('[name=markup]')?.value||30)),base=qty*cost;
    const c=r.querySelector('[name=costTotal]'),ret=r.querySelector('[name=retailTotal]');
    if(c)c.value=base.toFixed(2);
    if(ret)ret.value=(base*(1+markup/100)).toFixed(2);
  });
  const items=collectItems(form),base=items.reduce((a,x)=>a+x.qty*x.cost,0),retail=items.reduce((a,x)=>a+(x.retailTotal||x.qty*x.cost*(1+x.markup/100)),0);
  const out=form.querySelector('#deliveryTotal,#writeoffTotal'),retailOut=form.querySelector('#deliveryRetailTotal,#writeoffRetailTotal');
  if(out)out.textContent=money(base);
  if(retailOut)retailOut.textContent=money(retail);
});
document.addEventListener('change',e=>{
  if(e.target.name!=='pack')return;
  const custom=e.target.value==='__custom__',row=e.target.closest('.item-line'),input=row?.querySelector('[name=packCustom]');
  if(input){input.style.display=custom?'block':'none';if(custom)input.focus()}
});
document.addEventListener('change',e=>{
  if(e.target.name!=='pack')return;
  const form=e.target.closest('#writeoffForm'),row=e.target.closest('.item-line');
  if(!form||!row)return;
  const item=sourceItem(row.querySelector('[name=itemName]')?.value,row.querySelector('[name=pack]')?.value,form.querySelector('[name=warehouse]')?.value);
  if(item){
    row.querySelector('[name=cost]').value=item.cost||0;
    row.querySelector('[name=markup]').value=Math.round(item.markup||0);
    row.querySelector('[name=cost]').dispatchEvent(new Event('input',{bubbles:true}));
  }
});
document.addEventListener('focusin',e=>{if(e.target.matches('input[type=number],input[name=itemName]'))e.target.select()});
document.addEventListener('submit',e=>{
  const b=e.submitter;
  if(b&&!b.classList.contains('is-loading')&&b.closest('#entityForm,#deliveryForm,#writeoffForm,#profileForm,#saleForm,#menuForm')){
    b.disabled=true;b.classList.add('is-loading');
    b.dataset.originalText=b.textContent;
    b.innerHTML='<span class="spinner"></span> Сохраняем…';
  }
});
const apiOriginal=api;
api=async(action,entity,data)=>{
  if(entity==='Sales'){
    const existing=(db.sales||[]).find(s=>String(s.id)===String(data.id));
    if(!data.accountId)data.accountId=existing?.accountId||db.warehouses.find(w=>String(w.id)===String(data.warehouseId))?.accountId||'';
    const result=await apiOriginal(action,entity,data);
    if(!API_URL&&data.accountId){
      const account=db.accounts.find(a=>String(a.id)===String(data.accountId));
      const amount=Number(action==='delete'?(existing?.total||0):(data.total||0))||0;
      if(account){
        const delta=action==='delete'?-amount:amount;
        account.balance=Number(account.balance||0)+delta;
        console.log('[qini] offline balance adjust',{action,accountId:data.accountId,amount,delta,newBalance:account.balance});
        save();
      }
    }
    return result;
  }
  return apiOriginal(action,entity,data);
};