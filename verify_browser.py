import time, json, os
DL = r"C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge"
SHOTS = os.path.join(DL, "shots")
os.makedirs(SHOTS, exist_ok=True)

def grab(name):
    capture_screenshot(os.path.join(SHOTS, name))

def sankey_rects():
    return js("""
    const inst = echarts.getInstanceByDom(document.getElementById('chart'));
    const g = inst.getModel().getSeriesByIndex(0).getGraph();
    const out = [];
    g.eachNode(n => { const L = n.getLayout(); if (L) out.push({name: n.name, value: n.getValue(), y: L.y, h: L.height}); });
    const meta = window.__sankeyMeta;
    return JSON.stringify({rects: out, links: meta.links, quarter: meta.quarter, company: meta.company});
    """)

print("== re-shot initial ==")
grab("rebuild_1_initial.png")

print("== STEP 1: switch to AAPL ==")
js("""
const cs = document.getElementById('companySelect');
cs.value = 'AAPL';
cs.dispatchEvent(new Event('change'));
return 'ok';
""")
time.sleep(1.5)
print(js("return JSON.stringify({title: document.getElementById('title').textContent, kpi: document.getElementById('kpis').innerText, meta: window.__sankeyMeta && {company: window.__sankeyMeta.company, quarter: window.__sankeyMeta.quarter}})"))
grab("rebuild_2_aapl.png")
print("AAPL rects:", sankey_rects())

print("== STEP 2: NVDA proportion check ==")
js("const cs=document.getElementById('companySelect'); cs.value='NVDA'; cs.dispatchEvent(new Event('change')); return 'ok';")
time.sleep(1.5)
print("NVDA rects:", sankey_rects())
grab("rebuild_3_nvda_sankey.png")

print("== STEP 3: quarter dropdown change ==")
before = js("return document.getElementById('kpis').innerText")
js("const qs=document.getElementById('quarterSelect'); qs.value='0'; qs.dispatchEvent(new Event('change')); return 'ok';")
time.sleep(1.2)
after = js("return JSON.stringify({title: document.getElementById('title').textContent, kpi: document.getElementById('kpis').innerText})")
print("BEFORE:", before)
print("AFTER :", after)
print("KPI CHANGED:", json.loads(before) != json.loads(after))
grab("rebuild_4_quarter_changed.png")

print("== STEP 4: tooltip ==")
js("const inst=echarts.getInstanceByDom(document.getElementById('chart')); inst.dispatchAction({type:'showTip', seriesIndex:0, dataIndex:0}); return 'ok';")
time.sleep(1.2)
grab("rebuild_5_tooltip.png")
tip_visible = js("return !!document.querySelector('#chart div div[style]') && Array.from(document.querySelectorAll('#chart div')).some(d => d.textContent.length > 0 && getComputedStyle(d).visibility !== 'hidden' && d.textContent.includes('$'))")
print("tooltip DOM found:", tip_visible)

print("== STEP 5: export PNG real download ==")
cdp("Browser.setDownloadBehavior", behavior="allow", downloadPath=DL)
js("document.getElementById('btnExport').click(); return 'ok';")
time.sleep(3)
dl_files = [f for f in os.listdir(DL) if f.startswith('profit_bridge')]
print("downloaded:", dl_files, [os.path.getsize(os.path.join(DL, f)) for f in dl_files])

print("== STEP 6: language toggle ==")
js("document.getElementById('btnLang').click(); return 'ok';")
time.sleep(1.2)
print(js("return JSON.stringify({title: document.getElementById('title').textContent, kpi: document.getElementById('kpis').innerText, btnReset: document.getElementById('btnReset').textContent, src: document.getElementById('srcLine').textContent, upd: document.getElementById('updLine').textContent})"))
grab("rebuild_6_zh.png")
js("document.getElementById('btnLang').click(); return 'ok';")
time.sleep(0.8)

print("== STEP 7: reset button ==")
js("document.getElementById('btnReset').click(); return 'ok';")
time.sleep(1.0)
print(js("return JSON.stringify({company: window.__sankeyMeta.company, quarter: window.__sankeyMeta.quarter})"))
print("DONE")

