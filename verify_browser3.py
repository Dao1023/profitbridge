import time, json, os
switch_tab("E27124086E771779B7738B848EEFD7E3")
DL = r"C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge"
SHOTS = os.path.join(DL, "shots")

def grab(name):
    capture_screenshot(os.path.join(SHOTS, name))

def rects_px():
    return js("""
    const inst = echarts.getInstanceByDom(document.getElementById('chart'));
    const out = [];
    inst.getZr().storage.getDisplayList().forEach(el => {
      if (el.type === 'rect' && el.shape && el.shape.height > 1) out.push({y: Math.round(el.shape.y), h: Math.round(el.shape.height)});
    });
    return JSON.stringify({rects: out, links: window.__sankeyMeta.links, company: window.__sankeyMeta.company, quarter: window.__sankeyMeta.quarter});
    """)

print("== reset to NVDA latest ==")
print(js("document.getElementById('btnReset').click(); return JSON.stringify({company: window.__sankeyMeta.company, quarter: window.__sankeyMeta.quarter});"))
time.sleep(1.0)
print("NVDA px rects:", rects_px())
grab("rebuild_3_nvda_sankey.png")

print("== STEP 3: quarter dropdown ==")
before = js("return document.getElementById('kpis').innerText")
js("const qs=document.getElementById('quarterSelect'); qs.value='0'; qs.dispatchEvent(new Event('change')); return 'ok';")
time.sleep(1.2)
after = js("return JSON.stringify({title: document.getElementById('title').textContent, kpi: document.getElementById('kpis').innerText})")
print("AFTER :", after)
print("KPI CHANGED:", before != json.loads(after)["kpi"])
grab("rebuild_4_quarter_changed.png")
js("document.getElementById('btnReset').click(); return 'ok';")
time.sleep(1.0)

print("== STEP 4: tooltip ==")
js("const inst=echarts.getInstanceByDom(document.getElementById('chart')); inst.dispatchAction({type:'showTip', seriesIndex:0, dataIndex:0}); return 'ok';")
time.sleep(1.2)
grab("rebuild_5_tooltip.png")
tip = js("return JSON.stringify(Array.from(document.querySelectorAll('#chart div div')).map(d=>d.textContent).filter(s=>s.includes('$')))")
print("tooltip contents:", tip)
js("const inst=echarts.getInstanceByDom(document.getElementById('chart')); inst.dispatchAction({type:'hideTip'}); return 'ok';")

print("== STEP 5: export PNG ==")
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
print("DONE")
