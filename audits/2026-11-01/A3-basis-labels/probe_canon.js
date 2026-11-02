/* CANONICAL replica — functions copied verbatim from app.js (2026-11-01 snapshot) */
const base='C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge/data/';
const DATA={companies:require(base+'profit.json').companies};
const SEG={companies:require(base+'segments.json').companies};
const MB=1e3; const state={company:'NVDA',curMode:'native'}; const lang='zh';
const curOf=(tk=state.company)=>(DATA.companies[tk].currency||'USD-M');
const isUsd=(tk=state.company)=>curOf(tk)==='USD-M';
const canToggleCur=(tk=state.company)=>curOf(tk)==='CNY-M';
const dispInUsd=(tk=state.company)=>isUsd(tk)||!canToggleCur(tk)||state.curMode==='usd';
const isAnnual=(tk=state.company)=>DATA.companies[tk].frequency==='annual';
function dispFactor(qv,tk=state.company){return dispInUsd(tk)&&qv&&qv.fxToUsd!=null?qv.fxToUsd:1;}
function segFactor(qv,tk=state.company){return dispInUsd(tk)?1:1/(qv&&qv.fxToUsd!=null?qv.fxToUsd:1);}
function rawMetrics(qv){if(!qv)return null;const f=dispFactor(qv);return {revenue:qv.revenue*f};}
function quarterLabel(end,periodType){const y=Number(end.slice(0,4)),m=Number(end.slice(5,7));if(periodType==='interim')return `H1 ${y}`;return isAnnual()?`FY ${y}`:`Q${Math.floor((m-1)/3)+1} ${y}`;}
const CUM_SEG_TYPES=new Set(['half','FY','annual','mixed']);
function profitRowIsCumulative(tk,qv){const e=DATA.companies[tk];if(e.frequency==='annual')return true;if((e.frequency==='hk-mixed'||e.frequency==='mixed')&&(qv.periodType==='annual'||qv.periodType==='interim'))return true;return false;}
function ytdSum(tk,qEnd,key){let any=false,sum=0;for(const o of DATA.companies[tk].quarters){if(o.end.slice(0,4)===qEnd.slice(0,4)&&o.end<=qEnd&&o[key]!=null){any=true;sum+=o[key];}}return any?sum:null;}
function fiscalYearEndMonth(tk){const e=DATA.companies[tk]||{};const annual=(e.quarters||[]).filter(o=>o.periodType==='annual');if(annual.length)return Number(annual[annual.length-1].end.slice(5,7));const s=SEG&&SEG.companies[tk];if(s&&s.periodTypes){const cnt={};for(const k in s.periodTypes){const tp=s.periodTypes[k];if(tp==='annual'||tp==='FY'){const mm=Number(k.slice(5,7));cnt[mm]=(cnt[mm]||0)+1;}}const best=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];if(best)return Number(best[0]);}const cnt={};(e.quarters||[]).slice(-8).forEach(o=>{const mm=Number(o.end.slice(5,7));cnt[mm]=(cnt[mm]||0)+1;});const entries=Object.entries(cnt).sort((a,b)=>b[1]-a[1]);if(entries.length){const top=entries[0][1],tied=entries.filter(x=>x[1]===top).map(x=>Number(x[0]));return tied.includes(12)?12:tied[0];}return 12;}
function periodCoveredMonths(tk,qv){const endMonth=Number(qv.end.slice(5,7));const fye=fiscalYearEndMonth(tk);const startMonth=(fye%12)+1;return ((endMonth-startMonth+12)%12)+1;}
function barBasisInfo(tk,qv){const annualRow=qv.periodType==='annual'||isAnnual(tk);const months=periodCoveredMonths(tk,qv);const cumulative=!annualRow&&profitRowIsCumulative(tk,qv)&&months>3;return {annualRow,months,cumulative,decal:cumulative&&months<=9};}
function barBasisTag(tk,qv){const cm=periodCoveredMonths(tk,qv);if(cm<=3)return '';if(cm<=6)return 'H1';if(cm<=9)return '9M';return 'FY';}
function ytdQuartersCount(tk,qEnd){return DATA.companies[tk].quarters.filter(o=>o.end.slice(0,4)===qEnd.slice(0,4)&&o.end<=qEnd).length;}
function cumulativeView(tk,qv){const s=SEG&&SEG.companies[tk];if(!s)return null;if(!s.quarters||!s.quarters[qv.end])return null;const pt=(s.periodTypes&&s.periodTypes[qv.end])||s.periodType;if(!CUM_SEG_TYPES.has(pt))return null;if(profitRowIsCumulative(tk,qv))return null;if(fiscalYearEndMonth(tk)!==12)return null;if(ytdQuartersCount(tk,qv.end)<2)return null;const sum=key=>ytdSum(tk,qv.end,key);const isFY=pt==='FY'||pt==='annual'||Number(qv.end.slice(5,7))===12;return {kind:isFY?'FY':'half',label:isFY?`FY${qv.end.slice(0,4)} 全年累计`:`${qv.end.slice(0,4)} 上半年累计`,values:{revenue:sum('revenue')}};}
function mergeSegs(list){const m=new Map();for(const s of list){const k=s.name;if(m.has(k))m.get(k).value+=s.value;else m.set(k,{name:s.name,value:s.value,children:s.children?[...s.children]:undefined});}return [...m.values()];}
function segmentsFor(ticker,qEnd){const c=SEG.companies[ticker];if(!c)return null;if(c.quarters&&c.quarters[qEnd])return c.quarters[qEnd];if(c.annualQuarters&&c.annualQuarters[qEnd])return c.annualQuarters[qEnd];return null;}
function segValueFor(ticker,qEnd,name){const list=segmentsFor(ticker,qEnd);if(!list)return null;const merged=mergeSegs(list);const top=merged.find(s=>s.name===name);if(top)return top.value;for(const s of merged){const ch=(s.children||[]).find(c=>c.name===name);if(ch)return ch.value;}return null;}
function segPeriodType(ticker,end){const s=SEG&&SEG.companies[ticker];const pt=s&&s.periodTypes&&s.periodTypes[end];if(pt==='annual'||pt==='FY')return 'annual';if(pt==='half'||pt==='H1'||pt==='semiannual')return 'half';return 'quarter';}
function segPeriods(ticker,name){const s=SEG&&SEG.companies[ticker];if(!s||!s.quarters)return[];const byEnd=new Map();for(const qv of (DATA.companies[ticker]?DATA.companies[ticker].quarters:[]))byEnd.set(qv.end,qv);const ends=Object.keys(s.quarters).filter(en=>segValueFor(ticker,en,name)!=null).sort();return ends.map(en=>{const base=byEnd.get(en);const pt=segPeriodType(ticker,en);const row=base?{...base}:{end:en,periodType:pt==='annual'?'annual':(pt==='half'?'interim':'q')};row.end=en;row.__segPT=pt;return row;});}
function segPeriodLabel(ticker,qv){const pt=qv.__segPT||'quarter';const yr=qv.end.slice(0,4),yy=qv.end.slice(2,4),mm=Number(qv.end.slice(5,7));if(pt==='annual')return 'FY '+yr;if(pt==='quarter')return `Q${Math.floor((mm-1)/3)+1}'${yy}`;const cm=periodCoveredMonths(ticker,qv);if(cm<=6)return `H1'${yy}`;if(cm<=9)return `9M'${yy}`;return 'FY '+yr;}

function run(tk,lastN){
  const s=SEG.companies[tk]; if(!s||!s.quarters)return;
  state.company=tk;
  // choose the most-populated segment name
  const ends=Object.keys(s.quarters).sort(); const allNms=new Set();
  for(const l of Object.values(s.quarters))for(const x of l){allNms.add(x.name);for(const c of(x.children||[]))allNms.add(c.name);}
  let name=null,bc=-1; for(const nm of allNms){let c=0;for(const en of ends)if(segValueFor(tk,en,nm)!=null)c++;if(c>bc){bc=c;name=nm;}}
  const rows=segPeriods(tk,name);
  const data=rows.map(qv=>{const v=segValueFor(tk,qv.end,name);return v!=null?v*segFactor(qv,tk)/MB:null;});
  console.log(`\n== ${tk} freq=${DATA.companies[tk].frequency} cur=${curOf(tk)} FYE=${fiscalYearEndMonth(tk)} seg="${name}" pts=${rows.length} ==`);
  const show=rows.map((_,i)=>i).slice(-lastN);
  const yoyBaseIndex=i=>{const cur=rows[i];if(!cur)return -1;const md=cur.end.slice(5),yoy=String(Number(cur.end.slice(0,4))-1);for(let j=i-1;j>=0;j--)if(rows[j].end.slice(5)===md&&rows[j].end.slice(0,4)===yoy)return j;return -1;};
  for(const i of show){
    const qv=rows[i], v=data[i];
    const b=barBasisInfo(tk,qv);
    const cum=cumulativeView(tk,qv);
    const head=(b&&b.cumulative)?`${barBasisTag(tk,qv)} 累计`:quarterLabel(qv.end,qv.periodType);
    const axis=segPeriodLabel(tk,qv);
    // share (pctLine)
    let revDisp = (cum&&cum.values&&cum.values.revenue!=null)? cum.values.revenue*dispFactor(qv) : (rawMetrics(qv)||{}).revenue;
    const share = revDisp? +(v*MB/revDisp*100).toFixed(1):null;
    // growth (growthLine)
    let gb=null,gv=null;
    const pv0=i>0?data[i-1]:null;
    if(isAnnual(tk)){gb=(v==null||i===0||pv0==null)?null:'yoy';gv=(gb==='yoy')?+((v-pv0)/Math.abs(pv0)*100).toFixed(1):null;}
    else{
      const cumCur=profitRowIsCumulative(tk,qv), cumPrev=i>0&&profitRowIsCumulative(tk,rows[i-1]);
      if(cumCur){const bj=yoyBaseIndex(i),pv=bj>=0?data[bj]:null;gb=(v==null||pv==null)?null:'yoy';gv=(gb==='yoy')?+((v-pv)/Math.abs(pv)*100).toFixed(1):null;}
      else if(cumPrev){gb=null;}
      else{gb=(v==null||i===0||pv0==null)?null:'qoq';gv=(gb==='qoq')?+((v-pv0)/Math.abs(pv0)*100).toFixed(1):null;}
    }
    console.log(`  ${qv.end} segPT=${qv.__segPT} rowPT=${qv.periodType} | axis="${axis}" head="${head}" | cum=${!!cum} basis.cum=${b.cumulative} decal=${b.decal} | share=${share}% denom=${cum?'CUM':'single'} | grow=${gb} ${gv==null?'':gv}`);
  }
}
['600519.SS','600887.SS','000063.SZ','002594.SZ','300750.SZ','BIDU','JD','SONY','09633.HK','00700.HK','03690.HK','01398.HK','00941.HK','005930.KS','066570.KS','00992.HK'].forEach(tk=>run(tk,4));
