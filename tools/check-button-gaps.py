"""Button-gap audit (WEB 11-26, Ryan: at least 12 px between neighbouring buttons). Local server on 127.0.0.1 only; every app route in mock mode and every public page at 375 and 1280 px;
prints each pair of visible buttons closer than 12 px (-1 = overlapping). Silent = pass.

    python tools/check-button-gaps.py [site-root]
"""
import http.server, socketserver, sys, threading, re, json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve(); MIN = 12
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a,directory=str(ROOT),**k)
    def log_message(self,*a): pass
    def end_headers(self): self.send_header('Cache-Control','no-store'); super().end_headers()
srv = socketserver.ThreadingTCPServer(('127.0.0.1',0),H); PORT=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
APP = ['#/','#/account','#/credits','#/request','#/help','#/build','#/looks','#/admin/ops','#/admin/renders','#/start','#/create-account','#/sign-in','#/forgot','#/reset','#/departments','#/jobs','#/nowhere']
PUB = ['','ryagram/','help/','connect-ai/','get-app/','report/','film/','terms/','privacy-policy.html','ai-content/','404.html','thank-you.html']
JS = """(min)=>{const els=[...document.querySelectorAll('a.button,button,.button,input[type=submit]')].filter(e=>{if(e.matches('.flip-arrow,[data-flip-prev],[data-flip-next]'))return false;if(e.closest('.mock-bar,[class*=mock]'))return false;if(e.closest('details:not([open])')&&!e.closest('summary'))return false;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'});
const out=[];const R=els.map(e=>[e,e.getBoundingClientRect()]);
for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++){const [a,A]=R[i],[b,B]=R[j];if(a.contains(b)||b.contains(a))continue;
const dx=Math.max(B.left-A.right,A.left-B.right);const dy=Math.max(B.top-A.bottom,A.top-B.bottom);
// gap between boxes: if they overlap on one axis, the other axis gap; else diagonal ignored
const ox=Math.min(A.right,B.right)-Math.max(A.left,B.left)>0, oy=Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top)>0;
let g=null; if(ox&&!oy) g=dy; else if(oy&&!ox) g=dx; else if(ox&&oy) g=-1;
if(g!==null&&g<min)out.push([Math.round(g*10)/10,(a.textContent||a.value||'').trim().slice(0,28),(b.textContent||b.value||'').trim().slice(0,28)]);}
return out;}"""
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for w,h in ((375,812),(1280,900)):
        ctx=b.new_context(viewport={'width':w,'height':h},is_mobile=(w<500))
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'),lambda r,_q:r.abort())
        p=ctx.new_page()
        urls=[('/app/?mock'+r) for r in APP]+[('/app/?mock&aiFirst'+r) for r in ['#/start']]+[('/'+u) for u in PUB]
        for u in urls:
            try:
                p.goto('about:blank'); p.goto(f'http://127.0.0.1:{PORT}{u}',wait_until='load',timeout=20000); p.wait_for_timeout(700)
                res=p.evaluate(JS,MIN)
                if res: print(w,u,json.dumps(res))
            except Exception as e: print(w,u,'ERR',str(e)[:80])
    b.close()
    print('button gaps: done')
