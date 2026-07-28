const state={data:null,tab:'products',query:''};
const $=s=>document.querySelector(s);
const money=v=>Number.isFinite(+v)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(+v)+' ₽':'—';
const pct=v=>Number.isFinite(+v)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(+v)+'%':'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function init(){
  const saved=localStorage.getItem('wbPlannerData');
  if(saved){try{state.data=JSON.parse(saved)}catch{}}
 if(!state.data){
  const response = await fetch('./backup.json');
  if(!response.ok){
    throw new Error(`Не удалось загрузить backup.json: ${response.status}`);
  }
  state.data = await response.json();
}
  bind();render();
}
function bind(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));renderContent()});
  $('#search').oninput=e=>{state.query=e.target.value.toLowerCase().trim();renderContent()};
  $('#confirmAll').onclick=()=>{state.data.campaigns.forEach(x=>x.confirmed=true);save();render()};
  $('#exportJson').onclick=()=>download('WB_Promotion_Planner_backup.json',JSON.stringify(state.data,null,2),'application/json');
  $('#exportCsv').onclick=exportRecommendations;
  $('#importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{state.data=JSON.parse(await f.text());save();render()}catch{alert('Некорректный JSON-файл')}};
}
function save(){localStorage.setItem('wbPlannerData',JSON.stringify(state.data))}
function render(){renderSummary();renderContent()}
function renderSummary(){
 const d=state.data, eligible=d.conditions.filter(x=>x.eligible).length, rejected=d.conditions.length-eligible, confirmed=d.campaigns.filter(x=>x.confirmed).length;
 $('#summary').innerHTML=[['Товаров',d.products.length],['Акций',d.campaigns.length],['Подходящих условий',eligible],['Акций подтверждено',`${confirmed} / ${d.campaigns.length}`]].map(([l,v])=>`<div class="card"><strong>${v}</strong><span>${l}</span></div>`).join('');
}
function matches(...vals){return !state.query||vals.some(v=>String(v??'').toLowerCase().includes(state.query))}
function table(headers,rows){if(!rows.length)return '<div class="empty">Нет данных для отображения</div>';return `<table class="table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`}
function renderContent(){const c=$('#content');if(state.tab==='products')c.innerHTML=productsView();if(state.tab==='campaigns')c.innerHTML=campaignsView();if(state.tab==='recommendations')c.innerHTML=recommendationsView();if(state.tab==='inactive')c.innerHTML=inactiveView();if(state.tab==='settings')c.innerHTML=settingsView();bindDynamic()}
function productsView(){const rows=state.data.products.filter(p=>matches(p.sellerArticle,p.wbArticle,p.name,p.brand,p.category)).map(p=>`<tr><td>${esc(p.sellerArticle)}</td><td>${esc(p.wbArticle)}</td><td>${esc(p.name)}</td><td>${esc(p.brand)}</td><td>${money(p.currentRetailPrice)}</td><td>${pct(p.currentDiscount)}</td><td>${money(p.minimumPrice)}</td><td>${p.confirmed?'<span class="good">Да</span>':'Нет'}</td></tr>`);return table(['Артикул продавца','Артикул WB','Товар','Бренд','Эталонная розничная цена','Текущая скидка','Минимальная цена','Подтверждён'],rows)}
function campaignsView(){const rows=state.data.campaigns.filter(x=>matches(x.name,x.campaignType,x.sourceFile)).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.startDate||'—')}</td><td>${esc(x.endDate||'—')}</td><td>${esc(x.campaignType||'—')}</td><td>${esc(x.participationStatus||'—')}</td><td>${x.isAutomatic?'Да':'Нет'}</td><td>${x.confirmed?'<span class="good">Подтверждена</span>':`<button class="button small confirm" data-id="${esc(x.id)}">Подтвердить</button>`}</td></tr>`);return table(['Акция','Начало','Окончание','Тип','Статус участия','Автоматическая','Подтверждение'],rows)}
function getRecRows(){const campaigns=Object.fromEntries(state.data.campaigns.map(c=>[c.id,c]));return state.data.conditions.map(x=>({...x,campaign:campaigns[x.campaignId]})).filter(x=>matches(x.sellerArticle,x.campaign?.name)).sort((a,b)=>(b.eligible-a.eligible)||((b.deviationFromMinimum||0)-(a.deviationFromMinimum||0)))}
function recommendationsView(){const rows=getRecRows().map(x=>`<tr><td>${esc(x.sellerArticle)}</td><td>${esc(x.campaign?.name||x.campaignId)}</td><td>${money(x.currentRetailPrice)}</td><td>${money(x.plannedCampaignPrice)}</td><td>${money(x.minimumPrice)}</td><td>${pct(x.requiredUploadedDiscount)}</td><td class="${x.eligible?'good':'bad'}">${x.eligible?'Участвовать':'Не участвовать'}</td><td class="${(x.deviationFromMinimum||0)<0?'bad':'good'}">${money(x.deviationFromMinimum)}</td><td>${esc((x.rejectionReasons||[]).join('; '))}</td></tr>`);return `<div class="note">Эталонная розничная цена берётся из карточки товара и не изменяется в отчётах. Меняется только рекомендуемая скидка.</div>`+table(['Артикул','Акция','Розничная цена','Цена акции','Минимальная цена','Требуемая скидка','Рекомендация','Отклонение от минимума','Причина'],rows)}
function inactiveView(){
 const now=new Date(state.data.savedAt||Date.now()), campaigns=Object.fromEntries(state.data.campaigns.map(c=>[c.id,c]));
 const byArticle={};state.data.conditions.forEach(x=>{(byArticle[x.sellerArticle]??=[]).push(x)});
 const rows=state.data.products.filter(p=>matches(p.sellerArticle,p.name)).map(p=>{
   const cond=(byArticle[p.sellerArticle]||[]), past=cond.filter(x=>{const e=campaigns[x.campaignId]?.endDate;return e&&new Date(e)<now&&x.eligible});
   const last=past.sort((a,b)=>new Date(campaigns[b.campaignId].endDate)-new Date(campaigns[a.campaignId].endDate))[0];
   const lastDate=last?new Date(campaigns[last.campaignId].endDate):null;
   const days=lastDate?Math.floor((now-lastDate)/86400000):9999;
   const best=cond.sort((a,b)=>Math.abs(a.deviationFromMinimum||Infinity)-Math.abs(b.deviationFromMinimum||Infinity))[0];
   return {p,days,best};
 }).filter(x=>x.days>7).map(({p,days,best})=>{const minus=best?Math.max(0,(best.minimumPrice-best.plannedCampaignPrice)):null;const minusPct=best&&best.minimumPrice?minus/best.minimumPrice*100:null;return `<tr><td>${esc(p.sellerArticle)}</td><td>${esc(p.name)}</td><td>${days===9999?'Нет истории':days}</td><td>${esc(best?campaigns[best.campaignId]?.name:'—')}</td><td>${money(best?.plannedCampaignPrice)}</td><td>${money(best?.minimumPrice)}</td><td class="${minus>0?'bad':'good'}">${money(minus)}</td><td class="${minusPct>0?'bad':'good'}">${pct(minusPct)}</td></tr>`});
 return table(['Артикул','Товар','Дней без акции','Подобранная акция','Требуемая цена','Минимальная цена','Уход ниже минимума, ₽','Уход ниже минимума, %'],rows)
}
function settingsView(){const s=state.data.settings||{};return `<div class="settings">
<label class="field">Максимальная скидка, %<input data-setting="maxDiscount" type="number" step="0.1" value="${s.maxDiscount??46.5}"></label>
<label class="field">Допустимое отклонение, %<input data-setting="allowedDeviation" type="number" step="0.1" value="${s.allowedDeviation??0}"></label>
<label class="field">Стратегия<select data-setting="strategy"><option value="maxCoverage" ${s.strategy==='maxCoverage'?'selected':''}>Максимальный охват акций</option><option value="minPriceProtection" ${s.strategy==='minPriceProtection'?'selected':''}>Защита минимальной цены</option></select></label>
<label class="field">Часовой пояс<input data-setting="timezone" value="${esc(s.timezone||'Europe/Amsterdam')}"></label>
</div>`}
function bindDynamic(){document.querySelectorAll('.confirm').forEach(b=>b.onclick=()=>{const x=state.data.campaigns.find(c=>c.id===b.dataset.id);if(x)x.confirmed=true;save();render()});document.querySelectorAll('[data-setting]').forEach(i=>i.onchange=()=>{state.data.settings??={};state.data.settings[i.dataset.setting]=i.type==='number'?Number(i.value):i.value;save();renderSummary()})}
function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
function exportRecommendations(){const headers=['Артикул продавца','Акция','Эталонная розничная цена','Цена акции','Минимальная цена','Рекомендуемая скидка','Рекомендация','Отклонение от минимума'];const rows=getRecRows().map(x=>[x.sellerArticle,x.campaign?.name||'',x.currentRetailPrice,x.plannedCampaignPrice,x.minimumPrice,x.requiredUploadedDiscount,x.eligible?'Участвовать':'Не участвовать',x.deviationFromMinimum]);const csv='\ufeff'+[headers,...rows].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\n');download('Рекомендации_WB.csv',csv,'text/csv;charset=utf-8')}
init().catch(e=>{$('#content').innerHTML=`<div class="empty">Ошибка загрузки: ${esc(e.message)}</div>`});
