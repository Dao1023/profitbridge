import time, json, os
DL = r"C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge"
SHOTS = os.path.join(DL, "shots")

def grab(name):
    capture_screenshot(os.path.join(SHOTS, name))

def rects_px():
    return js("""
    const inst = echarts.getInstanceByDom(document.getElementById('chart'));
    const out = [];
    inst.getZr().storage.getDisplayList().forEach(el => {
      if (el.type === 'rect' && el.shape && el.shape.height > 1) out.push({x: el.shape.x, y: el.shape.y, w: el.shape.width, h: el.shape.height});
    });
    const meta = window.__sankeyMeta;
    return JSON.stringify({rects: out, links: meta.links, quarter: meta.quarter, company: meta.company});
    """)

print("== reset to NVDA latest ==")
js("document.getElementById('btnReset').click(); return 'ok';")
time.sleep(1.2)
print("NVDA px rects:", rects_px())
grab("rebuild_3_nvda_sankey.png")

print("== STEP 3: quarter dropdown change ==")
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
print("DONE")
