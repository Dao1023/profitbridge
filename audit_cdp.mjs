import fs from 'fs';
const base='http://127.0.0.1:9333';
const list=await (await fetch(base+'/json')).json();
let t=list.find(t=>t.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl);
let id=0;const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
const evl=async ex=>(await send('Runtime.evaluate',{expression:ex,returnByValue:true})).result?.result?.value;
await send('Page.enable');
await send('Page.navigate',{url:'file:///C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/index.html'});
await new Promise(r=>setTimeout(r,800));
const shot=async name=>{const m=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/audit_'+name+'.png',Buffer.from(m.result.data,'base64'))};

// 1. render sankey
await shot('1_sankey');

// 2. toggle to bar view
console.log('bar:',await evl(`toggleView();document.getElementById('barView').style.display`));
await shot('2_bars');
await evl(`toggleView()`);

// 3. search 'tsm' - does TSMC exist?
console.log('search tsm matches:',await evl(`(()=>{searchBox.value='tsm';applyFilter();return [...document.querySelectorAll('#companyList .company')].filter(c=>c.style.display!=='none').map(c=>c.textContent.trim().slice(0,30))})()`));
// 4. search 'apple' then click Apple card - does view change?
console.log('click apple:',await evl(`(()=>{searchBox.value='';applyFilter();document.querySelectorAll('#companyList .company')[1].click();return {title:document.getElementById('pageTitle').textContent,kpi:document.querySelector('.kpi .val').textContent}})()`));
// 5. language switch to English
console.log('lang:',await evl(`(()=>{document.querySelector('.lang-wrap select').value='English';setLang();return document.getElementById('pageTitle').textContent})()`));
await shot('3_lang');
// 6. sankey label overlap check: bbox of 净利润 label vs viewBox, and label vs flow overlap
console.log('labels:',await evl(`(()=>{const svg=document.querySelector('#sankeyView svg');const texts=[...svg.querySelectorAll('text')];const out=[];for(const t of texts){if(t.textContent.includes('净利润')||t.textContent.includes('$59.7B')||t.textContent.includes('62.0%')){const b=t.getBBox();out.push({txt:t.textContent,x:Math.round(b.x),right:Math.round(b.x+b.width),viewW:1040})}}return JSON.stringify(out)})()`));
// 7. quarter dropdown options
console.log('quarter opts:',await evl(`document.querySelectorAll('aside select option').length`));
// 8. download buttons wired?
console.log('btn handlers:',await evl(`(()=>{const btns=[...document.querySelectorAll('.btn')];return btns.map(b=>({t:b.textContent,has:!!b.onclick}))})()`));
// 9. flow proportion: measure node heights
console.log('nodes:',await evl(`(()=>{const rs=[...document.querySelectorAll('#sankeyView svg rect')].map(r=>({x:+r.getAttribute('x'),y:+r.getAttribute('y'),h:+r.getAttribute('height')}));return JSON.stringify(rs)})()`));
process.exit(0);
