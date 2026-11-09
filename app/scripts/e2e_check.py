"""BrotIA v1.1 end-to-end browser check (headless Chrome over the DevTools Protocol; no npm installs).

Needs: the app dev server on :5190; for 'live' also the service on :8787. Playwright's cached
chrome-headless-shell; a Python with the 'websockets' package (service/.venv has it).

  service/.venv/bin/python app/scripts/e2e_check.py live            # Home (samples auto-load) → Portfolios → report → farm tabs → agent panel
  service/.venv/bin/python app/scripts/e2e_check.py live --ask      # also asks the agent one question (one paid API call)
  service/.venv/bin/python app/scripts/e2e_check.py live --wizard   # also walks the new-portfolio wizard (CIREN cadastre layer)
  service/.venv/bin/python app/scripts/e2e_check.py offline         # same path from the offline snapshot
  ... --shots=report                                                  # only (re)take screenshots whose name contains 'report'

The report is walked tab by tab (Overview, Payments, Exposures, Risks, Demographics, synced to ?tab=), with a
keyboard check (ArrowRight on the tab list) and a back-navigation check of the water status lookups.
The Incidents page (/app/incidents, v1.4) is checked in both modes: the sidebar item sits under Home and its 24 h badge
equals the page's 24 h rows; rows are grouped critical → warning → events; event rows link to the farm's Events tab
and credit rules to its Overview; both source popovers open; the kind filter and the 7-day window work.
Home (v1.4) is checked for its order (payment KPIs, payment schedule by tier, risk per portfolio, allocation collapsed,
portfolio table), the 24-month toggle, and, live only, a held /assess/portfolio request: payments show at once with
"Tier pending", a "still assessing" note follows after 15 s, and the tiers fill in once the request is released.
Env: E2E_CDP_PORT and E2E_CHROME_PROFILE override the DevTools port and the Chrome profile directory, so parallel
runs do not share a browser.

'offline' does not need the service stopped: the browser blocks every request to :8787 through CDP request
interception (Fetch.failRequest), so the app falls back to app/public/snapshot exactly as when the service is down.
Both modes start from an empty localStorage; the app loads BOTH sample portfolios on its first start (no "load
sample" UI, ADR-0026 D6): the sidebar lists both, Home aggregates both, and the second book (sample-cl-sur) gets its
own report check, one farm overview and the 60-report-sur screenshot.
Screenshots (demo order, 1440×900 unless named 'phone'; 01-home, the report tabs 03–07 and the farm overviews 10, 17, 22, 25
are full-page at 1440 wide, and so is 09-incidents; 42 is the Ovalle overview at 390 px): docs/v1-screens/.
Pass --no-shots to skip them.
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request
import websockets

SHOTS = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'v1-screens'))
PROFILE = os.environ.get('E2E_CHROME_PROFILE') or os.path.join(tempfile.gettempdir(), 'brotia-e2e-chrome-profile')
CHROME = os.path.expanduser('~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell')
PORT = int(os.environ.get('E2E_CDP_PORT', '9344'))
APP = 'http://localhost:5190'
PF = 'sample-cl'
PF_SUR = 'sample-cl-sur'
SUR_FARM = 'sur-talca-cherry'
FARMS = [('cl-ovalle-table-grape', 'ovalle'), ('cl-paine-walnut', 'paine')]
MODE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'live'
ASK_AGENT = '--ask' in sys.argv
WIZARD = '--wizard' in sys.argv
TAKE_SHOTS = '--no-shots' not in sys.argv
SHOT_FILTER = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--shots=')), '')
OFFLINE = MODE == 'offline'
ERRORS, results = [], []
TXT = "(document.body ? document.body.innerText : '')"

HOOK = r"""
window.__maps = [];
(function(){
  let _L;
  Object.defineProperty(window, 'L', { configurable: true, get(){ return _L; }, set(v){ _L = v; try { v.Map.addInitHook(function(){ window.__maps.push(this); }); } catch(e) {} } });
})();
window.__h = {
  byText(sel, text){ return [...document.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text)); },
  setVal(el, v){
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    el.focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  },
  map(){ return window.__maps[window.__maps.length - 1]; },
  pt(lat, lng){ const m = this.map(); const p = m.latLngToContainerPoint([lat, lng]); const r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
  scrollTo(text, sel){ const e = [...document.querySelectorAll(sel || 'h1,h2,h3,[role=heading]')].find(x => x.textContent.includes(text)); if (!e) return false;
    const m = document.querySelector('main'); m.scrollTo({ top: e.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 16 }); return true; },
};
"""


class CDP:
    """CDP client with a background reader, so blocked :8787 requests are failed at once even while we sleep."""

    def __init__(self, ws):
        self.ws, self.n, self.futures = ws, 0, {}
        self.blocked = 0
        # hold=True parks paused requests (instead of failing them) until release(): simulates a slow cold assessment.
        self.hold, self.held = False, []
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if 'id' in msg and msg['id'] in self.futures:
                self.futures.pop(msg['id']).set_result(msg)
                continue
            m, p = msg.get('method'), msg.get('params', {})
            if m == 'Runtime.exceptionThrown':
                ERRORS.append(p['exceptionDetails'].get('exception', {}).get('description', str(p)[:300]))
            elif m == 'Runtime.consoleAPICalled' and p.get('type') == 'error':
                ERRORS.append(' '.join(str(a.get('value', a.get('description', ''))) for a in p.get('args', []))[:300])
            elif m == 'Fetch.requestPaused' and self.hold:
                self.held.append(p['requestId'])
            elif m == 'Fetch.requestPaused':
                self.blocked += 1
                asyncio.create_task(self.call('Fetch.failRequest', requestId=p['requestId'], errorReason='ConnectionRefused'))

    async def call(self, method, **params):
        self.n += 1
        mid = self.n
        fut = asyncio.get_running_loop().create_future()
        self.futures[mid] = fut
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        msg = await asyncio.wait_for(fut, 120)
        if 'error' in msg:
            raise RuntimeError(f'{method}: {msg["error"]}')
        return msg.get('result', {})

    async def js(self, expr):
        r = await self.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(f'JS error: {r["exceptionDetails"].get("exception", {}).get("description", r["exceptionDetails"])}\n{expr[:200]}')
        return r.get('result', {}).get('value')

    async def click(self, x, y):
        for t in ('mouseMoved', 'mousePressed', 'mouseReleased'):
            await self.call('Input.dispatchMouseEvent', type=t, x=x, y=y, button='left', clickCount=1)
            await asyncio.sleep(0.05)

    async def shot(self, name):
        if not TAKE_SHOTS or (SHOT_FILTER and not any(s in name for s in SHOT_FILTER.split(','))):
            return None
        r = await self.call('Page.captureScreenshot', format='png')
        path = os.path.join(SHOTS, name)
        with open(path, 'wb') as f:
            f.write(base64.b64decode(r['data']))
        return path

    async def wait(self, expr, timeout=30, label=''):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if await self.js(expr):
                return True
            await asyncio.sleep(0.3)
        raise TimeoutError(f'timeout waiting for {label or expr[:120]}')

    async def click_button(self, text, sel='button'):
        ok = await self.js(f"(() => {{ const b = window.__h.byText({json.dumps(sel)}, {json.dumps(text)}); if (!b || b.disabled) return false; b.click(); return true; }})()")
        if not ok:
            raise RuntimeError(f'not clickable: {text}')
        await asyncio.sleep(0.4)

    async def settle(self, timeout=60):
        """Wait until no skeleton or spinner is on screen."""
        await self.wait("!document.querySelector('main .animate-pulse, main .animate-spin')", timeout=timeout, label='page settled')
        await asyncio.sleep(0.6)

    async def scroll(self, text, sel=None):
        ok = await self.js(f"window.__h.scrollTo({json.dumps(text)}, {json.dumps(sel)})")
        await asyncio.sleep(0.7)
        return ok

    async def top(self):
        await self.js("document.querySelector('main') && document.querySelector('main').scrollTo({top: 0})")
        await asyncio.sleep(0.3)

    async def viewport(self, w, h, mobile=False):
        await self.call('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=2 if mobile else 1, mobile=mobile)
        await asyncio.sleep(0.5)


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


async def step(name, coro):
    """Run one check group; a failure is recorded and the run goes on."""
    try:
        await coro
    except Exception as e:  # noqa: BLE001
        check(name, False, f'{type(e).__name__}: {e}'[:300])


# ---------------------------------------------------------------- pages

async def home_and_sample(c):
    tag = 'offline: ' if OFFLINE else ''
    await c.call('Page.navigate', url=APP + '/app')
    await asyncio.sleep(1.5)
    await c.js('localStorage.clear()')
    await c.call('Page.navigate', url=APP + '/app')
    await c.wait(f"{TXT}.includes('BrotIA') || !!document.querySelector('[aria-label=Sidebar]')", label='shell')
    await asyncio.sleep(1.0)
    empty = await c.js(f"{TXT}.slice(0, 2000)")
    check(f'{tag}home renders on first start (samples auto-load)', 'Portfolios' in empty, empty.split('\n')[0][:80])
    if OFFLINE:
        await c.wait(f"{TXT}.includes('Offline snapshot of')", timeout=20, label='offline banner')
        banner = await c.js(f"({TXT}.match(/Offline snapshot of[^\\n]*/)||[''])[0]")
        check('offline: banner shows the snapshot date', True, banner[:120])
    else:
        await c.wait(f"{TXT}.includes('Live data')", timeout=15, label='live pill')
        check('live: connection pill says Live data', True)

    sel = f"aside[aria-label=Sidebar] a[href='/app/portfolios/{PF}']"
    sel_sur = f"aside[aria-label=Sidebar] a[href='/app/portfolios/{PF_SUR}']"
    await c.wait(f'!!document.querySelector("{sel}") && !!document.querySelector("{sel_sur}")', timeout=60, label='both samples auto-loaded')
    side = await c.js(f"[...document.querySelectorAll('aside[aria-label=Sidebar] a')].map(a => a.textContent)")
    check(f'{tag}both samples auto-load on first start; the sidebar lists both with their codes',
          any('CLSF1' in x and 'Chile Specialty Fruit Credit I' in x for x in side) and any('CLSO2' in x and 'Southern Orchards Credit II' in x for x in side),
          json.dumps([x for x in side if x and ('CLS' in x)]))
    await c.call('Page.navigate', url=APP + '/app/portfolios')
    await c.wait(f"{TXT}.includes('Restore sample portfolios') && {TXT}.includes('CLSF1')", timeout=30, label='portfolios list')
    pl = await c.js(f"(t => ({{ load: t.includes('Load sample'), card: !!document.querySelector('[aria-label=\"Sample portfolios\"]'), demo: /Demo/.test(t) }}))({TXT})")
    check(f'{tag}Portfolios page: no "load sample" UI, no "Demo" names, restore link present', not pl['load'] and not pl['card'] and not pl['demo'], json.dumps(pl))
    await c.js(f'document.querySelector("{sel}").click()')
    await c.wait(f"location.pathname === '/app/portfolios/{PF}'", timeout=60, label='report route')
    check(f'{tag}sample-cl opens its report', True)


async def sur_book(c):
    """The second sample (ADR-0026): its report with a TOTAL row, one farm overview, and Home showing both books."""
    tag = 'offline: ' if OFFLINE else ''
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF_SUR}')
    await c.wait(f"(t => t.includes('CLSO2') && t.includes('Southern Orchards Credit II') && /TOTAL[\\s\\S]{{0,80}}100\\.0%/.test(t) && document.querySelectorAll('table tbody tr').length >= 9)({TXT})",
                 timeout=240, label='sur report')
    await c.settle(120)
    k = await c.js(f"""(() => {{ const t = {TXT}; return {{ rows: document.querySelectorAll('table tbody tr').length, high: (t.match(/High stress/g)||[]).length,
        watch: (t.match(/Watch/g)||[]).length, risk: (t.match(/Portfolio risk\\n([^\\n]+)/)||[])[1] }}; }})()""")
    check(f'{tag}sur report: 9 farms, TOTAL row', k['rows'] >= 9, json.dumps(k))
    if not OFFLINE:
        await full_page_shot(c, '60-report-sur.png')
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF_SUR}/farms/{SUR_FARM}?tab=overview')
    await c.wait(f"{TXT}.includes('Maule (Talca) cherries') && /Risk score|score/i.test({TXT})", timeout=180, label='sur farm')
    await c.settle(120)
    t = await c.js(f"{TXT}.slice(0, 600)")
    check(f'{tag}sur farm overview renders ({SUR_FARM})', 'Needs the live service' not in t and 'Assessment needs the live service' not in t, t.replace('\n', ' | ')[:200])
    await c.call('Page.navigate', url=APP + '/app')
    await c.wait(f"{TXT}.includes('Risk as of') && !{TXT}.includes('Tier pending')", timeout=180, label='home with both')
    h = await c.js(f"""(() => {{ const t = {TXT}; const s = document.querySelector('section[aria-labelledby=risk-h]');
        return {{ riskRows: s ? s.querySelectorAll('article').length : -1, cl: t.includes('CLSF1'), sur: t.includes('CLSO2') }}; }})()""")
    check(f'{tag}home aggregates both books (two risk rows, one USD group)', h['riskRows'] == 2 and h['cl'] and h['sur'], json.dumps(h))


REPORT_TABS = {
    'overview': ("t.includes('Farms and loans') && /TOTAL[\\s\\S]{0,80}100\\.0%/.test(t) && document.querySelectorAll('table tbody tr').length >= 12",
                 """(() => { const t = %s; return { rows: document.querySelectorAll('table tbody tr').length, letters: t.includes('(e)=(c)×(d)'),
                     high: (t.match(/High stress/g)||[]).length, total: /TOTAL[\\s\\S]{0,80}100\\.0%%/.test(t) }; })()""" % TXT),
    'payments': ("t.includes('Next installments') && t.includes('Installments due in the next 60 days') && t.includes('Credit actions')",
                 """(() => { const s = [...document.querySelectorAll('section')].find(x => x.querySelector('h3')?.textContent.startsWith('Installments due'));
                     return { upcoming: s ? s.querySelectorAll('tbody tr').length : -1, toggle: !!document.querySelector('[aria-label="Months shown"]'),
                              actions: (document.body.innerText.match(/Credit actions\\n([^\\n]+)/)||[])[1] }; })()"""),
    'exposures': ("['Exposure by tier','Exposure by crop','Exposure by zone','Exposure by region'].every(k => t.includes(k))",
                  """(() => { const crop = [...document.querySelectorAll('section')].find(x => x.querySelector('h3')?.textContent === 'Exposure by crop');
                      const bars = c => crop ? [...crop.querySelectorAll('div[style]')].filter(d => d.style.background.replace(/\\s/g, '') === c).length : -1;
                      return { highRed: bars('rgb(208,83,58)'), watchAmber: bars('rgb(232,147,58)') }; })()"""),
    'risks': ("['Risk score distribution','Water status','Stress drivers','Recent disasters'].every(k => t.includes(k)) && /(\\d+) of \\1 farms checked(?!…)/.test(t)",
              """(() => { const t = %s; const s = [...document.querySelectorAll('section')].find(x => x.querySelector('h3')?.textContent === 'Water status');
                  const counts = s ? [...s.querySelectorAll('dd')].map(d => +d.textContent) : [];
                  return { water: (t.match(/\\d+ of \\d+ farms checked[^\\n]*/)||[''])[0], sum: counts.reduce((a, b) => a + b, 0),
                           drivers: [...document.querySelectorAll('section')].find(x => x.querySelector('h3')?.textContent === 'Stress drivers')?.querySelectorAll('tbody tr').length ?? 0 }; })()""" % TXT),
    'demographics': ("['Farms by crop','Farms by region','Farms by zone','Growth stage now','Farm records'].every(k => t.includes(k)) && document.querySelectorAll('.leaflet-container path').length > 0",
                     """(() => ({ map: document.querySelectorAll('.leaflet-container path').length,
                         regions: [...document.querySelectorAll('section')].find(x => x.querySelector('h3')?.textContent === 'Farms by region')?.querySelectorAll('li').length ?? 0 }))()"""),
}
REPORT_SHOTS = {'overview': '03-report-overview.png', 'payments': '04-report-payments.png', 'exposures': '05-report-exposures.png',
                'risks': '06-report-risks.png', 'demographics': '07-report-demographics.png'}


async def full_page_shot(c, name, max_h=2600):
    """Grow the viewport to the page height (main is the scroll container), capture, restore 1440×900."""
    h = await c.js("(() => { const m = document.querySelector('main'); return m ? m.scrollHeight + (window.innerHeight - m.clientHeight) : document.body.scrollHeight; })()")
    await c.viewport(1440, int(min(max_h, max(900, h))))
    await asyncio.sleep(1.0)
    await c.shot(name)
    await c.viewport(1440, 900)


async def click_tab(c, label):
    await c.js(f"[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim().startsWith({json.dumps(label)})).click()")


async def report(c):
    tag = 'offline: ' if OFFLINE else ''
    await c.wait(f"{TXT}.includes('Farms and loans') && {TXT}.includes('TOTAL') && document.querySelectorAll('table tbody tr').length >= 12", timeout=180, label='report table')
    await c.settle(120)
    head = await c.js(f"""(() => {{ const t = {TXT}; return {{ tabs: [...document.querySelectorAll('[role=tablist][aria-label="Report sections"] [role=tab]')].map(b => b.textContent.trim()),
        kpis: ['Total outstanding','Portfolio risk','Exposure at watch or high','Incidents (last 24 h)'].filter(k => t.includes(k)).length,
        tab: new URLSearchParams(location.search).get('tab') }}; }})()""")
    check(f'{tag}report: header, four KPIs and five tabs, Overview by default', head['kpis'] == 4 and head['tabs'] == ['Overview', 'Payments', 'Exposures', 'Risks', 'Demographics'] and head['tab'] in (None, 'overview'), json.dumps(head))
    for tab, (ready, probe) in REPORT_TABS.items():
        await click_tab(c, tab.capitalize())
        try:
            await c.wait(f"new URLSearchParams(location.search).get('tab') === '{tab}'", timeout=5, label=f'?tab={tab}')
            await c.wait(f"(() => {{ const t = {TXT}; return {ready}; }})()", timeout=150, label=f'report {tab} tab')
            await c.settle(120)
            info = await c.js(probe)
            if tab == 'overview':
                ok = info['rows'] >= 12 and info['letters'] and info['total'] and info['high'] > 0
            elif tab == 'payments':
                ok = info['upcoming'] > 0 and info['toggle']
                await c.click_button('12 months', '[aria-label="Months shown"] button')
                n = await c.js("(() => { const s = [...document.querySelectorAll('section')].find(x => x.querySelector('h3')?.textContent === 'Next installments'); return s ? s.querySelectorAll('[title*=\" in \"]').length : 0; })()")
                info['months12'] = n
                ok = ok and n == 12
                await c.click_button('6 months', '[aria-label="Months shown"] button')
            elif tab == 'exposures':
                ok = info['highRed'] > 0 and info['watchAmber'] >= 0
            elif tab == 'risks':
                ok = info['sum'] == 12 and info['drivers'] > 0 and info['water'].startswith('12 of 12')
            else:
                ok = info['map'] > 0 and info['regions'] > 0
            check(f'{tag}report: {tab} tab', ok, json.dumps(info)[:260])
        except Exception as e:  # noqa: BLE001
            check(f'{tag}report: {tab} tab', False, f'{type(e).__name__}: {e}'[:260])
            continue
        if not OFFLINE:
            await c.top()
            await full_page_shot(c, REPORT_SHOTS[tab])

    # Keyboard: ArrowRight on the selected tab selects and focuses the next one (WAI-ARIA tabs).
    await click_tab(c, 'Overview')
    await asyncio.sleep(0.3)
    await c.js("document.querySelector('[role=tab][aria-selected=true]').focus()")
    for t in ('keyDown', 'keyUp'):
        await c.call('Input.dispatchKeyEvent', type=t, key='ArrowRight', code='ArrowRight', windowsVirtualKeyCode=39)
    await asyncio.sleep(0.4)
    kb = await c.js("({ tab: new URLSearchParams(location.search).get('tab'), focus: document.activeElement && document.activeElement.id })")
    check(f'{tag}report: arrow keys move between tabs', kb['tab'] == 'payments' and kb['focus'] == 'report-tab-payments', json.dumps(kb))

    # Water status after going to a farm and back (the cached lookups used to be wiped: "0 of 12 farms checked").
    await click_tab(c, 'Overview')
    await c.wait("document.querySelectorAll('table tbody tr').length >= 12", timeout=10, label='table')
    await c.js("document.querySelector('table tbody tr').click()")
    await c.wait("location.pathname.includes('/farms/')", timeout=10, label='farm page')
    await asyncio.sleep(1.5)
    await c.js('history.back()')
    await c.wait(f"location.pathname === '/app/portfolios/{PF}'", timeout=10, label='back to report')
    await click_tab(c, 'Risks')
    try:
        await c.wait(f"/12 of 12 farms checked(?!…)/.test({TXT})", timeout=60, label='water status after back')
        check(f'{tag}report: water status fills in after going back from a farm', True)
    except TimeoutError as e:
        w = await c.js(f"({TXT}.match(/\\d+ of \\d+ farms checked[^\\n]*/)||[''])[0]")
        check(f'{tag}report: water status fills in after going back from a farm', False, f'{e}; {w}')

    await click_tab(c, 'Overview')
    await c.top()
    await c.js("document.querySelector('[aria-controls=report-incidents]').click()")
    await c.wait("!!document.getElementById('report-incidents')", timeout=10, label='incidents list')
    await asyncio.sleep(0.5)
    inc = await c.js("""(() => { const s = document.getElementById('report-incidents'); const n = document.querySelector('[aria-controls=report-incidents]').innerText.match(/\\n(\\d+)\\n/);
        return { kpi: n && +n[1], items: s.querySelectorAll('li').length, text: s.innerText.slice(0, 160) }; })()""")
    check(f'{tag}report: incidents tile opens the list', inc['items'] > 0, json.dumps(inc)[:240])
    await c.js("document.getElementById('report-incidents').scrollIntoView({block: 'center'})")
    await asyncio.sleep(0.6)
    await c.shot('50-offline-report.png' if OFFLINE else '08-report-incidents.png')
    await c.js("document.querySelector('[aria-controls=report-incidents]').click()")


TAB_CHECKS = {
    'overview': "/verdict/i.test(t) && /what to do/i.test(t) && t.includes('About this data') && t.includes('Next payment') && !t.includes('Notes on the data')",
    'imagery': "!!document.querySelector('[aria-label=\"Image date\"]')",
    'water': "t.includes('Water status') && t.includes('Is it irrigated') && t.includes('Farm vs zone peers')",
    'risk': "t.includes('Why this score') && t.includes('Formula') && /Climate and water \\(C\\)/.test(t)",
    'rules': "t.includes('Credit rules') && t.includes('Audit trail')",
    'events': "t.includes(\"Events in the farm's zone\")",
}


async def farm_tabs(c, farm_id, short, shots):
    tag = 'offline: ' if OFFLINE else ''
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF}/farms/{farm_id}')
    await c.wait(f"{TXT}.includes('Risk score') && /\\b(High stress|Watch|Normal)\\b/.test({TXT}) && !!document.querySelector('[role=tablist]')", timeout=180, label=f'{farm_id} header')
    tier = await c.js(f"({TXT}.match(/\\b(High stress|Watch|Normal)\\b/)||[])[0]")
    check(f'{tag}{short}: header with score and tier', bool(tier), f'tier={tier}')
    for i, tab in enumerate(TAB_CHECKS):
        label = tab.capitalize()
        await c.js(f"[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim().startsWith({json.dumps(label)})).click()")
        await c.wait(f"new URLSearchParams(location.search).get('tab') === '{tab}'", timeout=5, label=f'?tab={tab}')
        try:
            await c.wait(f"(() => {{ const t = {TXT}; return {TAB_CHECKS[tab]}; }})()", timeout=150, label=f'{short} {tab} tab')
            await c.settle(120)
            ok, detail = True, ''
        except TimeoutError as e:
            ok, detail = False, str(e)
        if tab == 'imagery' and ok:
            await c.wait("!!document.querySelector('.leaflet-image-layer')", timeout=60, label='imagery overlay')
            await asyncio.sleep(1.5)
            info = await c.js(f"""(() => {{ const t = {TXT}; const img = document.querySelector('.leaflet-image-layer');
                return {{ frames: (t.match(/Frame \\d+ of \\d+[^\\n]*/)||[''])[0], kind: ['Observed','Interpolated'].filter(k => t.includes(k)),
                         ok: !!(img && img.complete && img.naturalWidth > 0), toggle: !!document.querySelector('[aria-label=Resolution]') }}; }})()""")
            ok, detail = bool(info['kind'] and info['ok'] and info['toggle']), json.dumps(info)[:240]
        if tab == 'overview' and ok:
            ov = await overview_info(c)
            exp = OVERVIEW_EXPECT.get(short)
            ok = ov['verdict'] != '' and not ov['jargon'] and (not exp or (exp[0] in ov['verdict'] and exp[1](ov)))
            detail = json.dumps(ov)[:300]
        check(f'{tag}{short}: {tab} tab', ok, detail)
        if f'{short}-{tab}' in shots:
            if tab == 'overview':
                await full_page_shot(c, shots[f'{short}-{tab}'])
            else:
                await c.shot(shots[f'{short}-{tab}'])
        if tab == 'imagery' and ok:
            await c.js("[...document.querySelectorAll('[aria-label=Resolution] [role=radio]')].find(b => /Enhanced/.test(b.textContent)).click()")
            await asyncio.sleep(2.0)
            sr = await c.js(f"""(() => {{ const t = {TXT}; const img = document.querySelector('.leaflet-image-layer');
                return {{ ai: t.includes('AI-enhanced'), src: img && img.src.split('/').pop(), ok: !!(img && img.complete && img.naturalWidth > 0) }}; }})()""")
            check(f'{tag}{short}: AI toggle shows the enhanced image with its label', sr['ai'] and sr['ok'] and '_sr' in (sr['src'] or ''), json.dumps(sr))
            if f'{short}-imagery-ai' in shots:
                await c.shot(shots[f'{short}-imagery-ai'])
            await c.js("[...document.querySelectorAll('[aria-label=Resolution] [role=radio]')].find(b => /Native/.test(b.textContent)).click()")
            await asyncio.sleep(0.5)


OVERVIEW_INFO = r"""(() => {
  const v = document.querySelector('[data-testid=overview-verdict]');
  const acts = [...document.querySelectorAll('[data-testid=overview-actions] li')].map(li => li.querySelector('p').textContent.trim());
  const cards = [...document.querySelectorAll('[data-testid^=evidence-]')].map(e => e.dataset.testid.slice(9));
  const imgs = [...document.querySelectorAll('[data-testid^=evidence-] img')];
  const t = document.body.innerText;
  return { verdict: v ? v.textContent.trim() : '', actions: acts, none: t.includes('No action needed'), cards,
           thumbs: imgs.length, thumbsOk: imgs.every(i => i.complete && i.naturalWidth > 0 && !/_sr\./.test(i.src)),
           jargon: !!v && /z ≤|n=\d|composites/.test(v.textContent) };
})()"""


async def overview_info(c):
    """Overview facts; waits up to 60 s for the then-vs-now thumbnails (imagery arrives after the assessment)."""
    t0 = time.time()
    while True:
        ov = await c.js(OVERVIEW_INFO)
        if 'vigour' not in ov['cards'] and 'fire' not in ov['cards'] or (ov['thumbs'] > 0 and ov['thumbsOk']) or time.time() - t0 > 60:
            return ov
        await asyncio.sleep(1.0)


# Overview-only farms: (farm id, short name, expected text in the verdict, other expectations, 1440 full-page shot)
OVERVIEW_FARMS = [
    ('cl-copiapo-table-grape', 'copiapo', 'lost vigour', lambda o: 'Verify on site' in o['body'] and o['actions'][:1] == ['Schedule a field visit'], '17-copiapo-overview.png'),
    ('cl-requinoa-cherry', 'normal farm', 'All clear', lambda o: o['none'] and o['cards'] == [], '25-normal-farm-overview.png'),
]
OVERVIEW_EXPECT = {
    'ovalle': ('look abandoned', lambda o: o['actions'][:1] == ['Open a restructuring review'] and o['cards'][:1] == ['vigour'] and o['thumbs'] == 2 and o['thumbsOk']),
    'paine': ('No fire damage seen', lambda o: o['none'] and o['cards'] == ['fire'] and o['thumbs'] == 2 and o['thumbsOk']),
}


async def overview_only(c, farm_id, short, expect, more, shot):
    tag = 'offline: ' if OFFLINE else ''
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF}/farms/{farm_id}')
    await c.wait(f"(() => {{ const t = {TXT}; return {TAB_CHECKS['overview']}; }})()", timeout=180, label=f'{short} overview')
    await c.settle(120)
    ov = await overview_info(c)
    ov['body'] = await c.js(TXT)
    ok = expect in ov['verdict'] and not ov['jargon'] and more(ov)
    check(f'{tag}{short}: overview verdict, actions and evidence', ok, json.dumps({k: v for k, v in ov.items() if k != 'body'})[:300])
    if not OFFLINE:
        await full_page_shot(c, shot)


HOME_TIER_FILLS = ['#2FA05A', '#E8933A', '#D0533A']  # TIER_COLORS normal, watch, high
HOME_PENDING_FILL = '#C9D3CD'
HOME_BARS = "[...document.querySelectorAll('section[aria-labelledby=pay-h] path.recharts-rectangle')].map(p => (p.getAttribute('fill')||'').toUpperCase())"


async def home_with_data(c):
    tag = 'offline: ' if OFFLINE else ''
    await c.call('Page.navigate', url=APP + '/app')
    await c.wait(f"{TXT}.includes('Portfolio overview') && /Due in next 90 days\\n\\$[\\d,]{{4,}}/.test({TXT})", timeout=120, label='home KPIs')
    await c.settle(120)
    await c.wait(f"!{TXT}.includes('Tier pending') && {TXT}.includes('Risk as of')", timeout=60, label='home tiers')
    k = await c.js(f"""(() => {{ const t = {TXT}; const sec = id => document.querySelector(`section[aria-labelledby=${{id}}]`);
        const pos = ['Payment schedule', 'Risk per portfolio', 'Allocation', 'Portfolios'].map(h => [...document.querySelectorAll('main h2')].findIndex(x => x.textContent.trim() === h));
        return {{ kpis: [...document.querySelectorAll('section[aria-label="Key figures"] > div')].map(d => d.innerText.split('\\n')[0]),
          due90: (t.match(/Due in next 90 days\\n([^\\n]+)/)||[])[1], dueRisk: (t.match(/Due at watch or high\\n([^\\n]+)/)||[])[1],
          outstanding: (t.match(/Total outstanding\\n([^\\n]+)/)||[])[1], bars: {HOME_BARS},
          upcoming: sec('pay-h') ? sec('pay-h').querySelectorAll('tbody tr').length : -1, toggle: !!document.querySelector('[aria-label="Months shown"]'),
          riskRows: sec('risk-h') ? sec('risk-h').querySelectorAll('article').length : -1, gauge: !!document.querySelector('[aria-label^="Weighted risk "]'),
          allocClosed: !!document.querySelector('details') && !document.querySelector('details').open, order: pos, table: document.querySelectorAll('table').length }}; }})()""")
    tiers = sorted({f for f in k.pop('bars') if f in HOME_TIER_FILLS})
    ok = (k['kpis'][:3] == ['Due in next 90 days', 'Due at watch or high', 'Total outstanding'] and k['due90'].startswith('$') and k['dueRisk'].startswith('$')
          and len(tiers) >= 2 and k['upcoming'] >= 1 and k['toggle'] and k['riskRows'] >= 1 and k['gauge'] and k['allocClosed']
          and k['order'] == sorted(k['order']) and -1 not in k['order'] and k['table'] >= 2)
    check(f'{tag}home: payments KPIs first, payment schedule by tier, risk per portfolio, allocation collapsed, portfolio table', ok, json.dumps({**k, 'tiers': tiers})[:400])
    n = await c.js("""(async () => { const r = () => [...document.querySelectorAll('[aria-label="Months shown"] button')];
        const ticks = () => document.querySelector('section[aria-labelledby=pay-h] [role=img]').getAttribute('aria-label');
        const a = ticks(); r().find(b => b.textContent.startsWith('24')).click(); await new Promise(f => setTimeout(f, 400));
        const b = ticks(); const on = r().find(b => b.getAttribute('aria-checked') === 'true').textContent;
        r().find(b => b.textContent.startsWith('12')).click(); await new Promise(f => setTimeout(f, 300)); return { on, longer: b.length > a.length }; })()""")
    check(f'{tag}home: 24-month toggle extends the payment schedule', n['on'].startswith('24') and n['longer'], json.dumps(n))
    if not OFFLINE:
        await c.top()
        await full_page_shot(c, '01-home.png')


async def home_while_assessing(c):
    """Hold the portfolio assessment (a slow cold first run): Home must show payments at once, tiers pending, a
    'still assessing' note after 15 s, and fill the tiers in once the answer arrives."""
    c.hold, c.held = True, []
    await c.call('Fetch.enable', patterns=[{'urlPattern': '*://localhost:8787/assess/portfolio*'}])
    try:
        await c.call('Page.navigate', url=APP + '/app')
        await c.wait(f"/Due in next 90 days\\n\\$[\\d,]{{4,}}/.test({TXT}) && {TXT}.includes('Tier pending') && /Assessing \\d+ of \\d+/.test({TXT})", timeout=30, label='home while assessing')
        await asyncio.sleep(1.0)
        k = await c.js(f"""(() => {{ const t = {TXT}; return {{ held: 0, bars: {HOME_BARS}, upcoming: document.querySelectorAll('section[aria-labelledby=pay-h] tbody tr').length,
            dueRisk: (t.match(/Due at watch or high\\n([^\\n]+\\n[^\\n]+)/)||[])[1] }}; }})()""")
        k['held'] = len(c.held)
        check('live: home while assessing shows the payment schedule at once, tiers pending', k['held'] >= 1 and HOME_PENDING_FILL in k['bars'] and k['upcoming'] >= 1
              and k['dueRisk'].startswith('–'), json.dumps({**k, 'bars': sorted(set(k['bars']))}))
        await c.wait(f"{TXT}.includes('Still assessing')", timeout=25, label='still assessing note')
        note = await c.js(f"({TXT}.match(/Still assessing[^\\n]*/)||[''])[0]")
        check('live: a slow assessment gets a "still assessing" note', True, note[:140])
    finally:
        c.hold = False
        for rid in c.held:
            await c.call('Fetch.continueRequest', requestId=rid)
        await c.call('Fetch.disable')
    await c.wait(f"!{TXT}.includes('Tier pending') && {TXT}.includes('Risk as of') && !{TXT}.includes('Still assessing')", timeout=120, label='tiers after release')
    bars = await c.js(HOME_BARS)
    check('live: tiers fill in when the assessment arrives', any(f in HOME_TIER_FILLS for f in bars) and HOME_PENDING_FILL not in bars, json.dumps(sorted(set(bars))))


INCIDENTS_INFO = r"""(() => {
  const rows = [...document.querySelectorAll('[data-testid=incident-row]')];
  const badge = document.querySelector('aside[aria-label=Sidebar] [data-testid=incidents-badge]');
  const sev = rows.map(r => r.dataset.severity);
  const rank = { critical: 0, warning: 1, event: 2 };
  const links = rows.map(r => ({ sev: r.dataset.severity, hrefs: [...r.querySelectorAll('td:nth-child(3) a')].map(a => a.getAttribute('href')) }));
  const nearby = document.querySelector('[data-testid=incidents-nearby]');
  const nav = [...document.querySelectorAll('aside[aria-label=Sidebar] nav > ul > li')].map(li => li.textContent.trim().replace(/\d+$/, ''));
  return { rows: rows.length, severities: sev, ordered: sev.every((x, i) => i === 0 || rank[sev[i - 1]] <= rank[x]),
           badge: badge ? +badge.textContent : 0, tone: badge ? badge.dataset.tone : null,
           eventLinks: links.filter(l => l.sev === 'event').every(l => l.hrefs.length > 0 && l.hrefs.every(h => h.endsWith('?tab=events'))),
           ruleLinks: links.filter(l => l.sev !== 'event').every(l => l.hrefs.length === 1 && !l.hrefs[0].includes('?tab=')),
           nearby: nearby ? nearby.textContent.trim().slice(0, 60) : '', empty: document.body.innerText.includes('No incidents in'),
           underHome: nav.indexOf('Incidents') === nav.indexOf('Home') + 1,
           win: new URLSearchParams(location.search).get('window') || '24h' };
})()"""


async def incidents_page(c):
    """Sidebar Incidents item (under Home, 24 h badge) and the /incidents page: groups, links, provenance, filters."""
    tag = 'offline: ' if OFFLINE else ''
    await c.call('Page.navigate', url=APP + '/app/incidents')
    await c.wait(f"{TXT}.includes('Incidents') && (!!document.querySelector('[data-testid=incident-row]') || {TXT}.includes('No incidents in'))", timeout=180, label='incidents list')
    await c.settle(120)
    d = await c.js(INCIDENTS_INFO)
    ok = d['underHome'] and d['ordered'] and d['eventLinks'] and d['ruleLinks'] and d['rows'] == d['badge'] and (d['rows'] == 0 or d['tone'] in ('danger', 'warn'))
    check(f'{tag}incidents: sidebar item under Home, badge = 24 h rows, grouped critical → warning → events, farm links', ok, json.dumps(d)[:300])
    check(f'{tag}incidents: quiet line counts nearby events touching no farm', 'nearby' in d['nearby'], d['nearby'])
    if not OFFLINE:
        await full_page_shot(c, '09-incidents.png')
    # Provenance: an event row opens its source popover, a credit-rule row its rule panel.
    pops = []
    for sev in ('event', 'critical'):
        opened = await c.js(f"""(async () => {{ const r = document.querySelector('[data-testid=incident-row][data-severity={sev}]'); if (!r) return null;
            r.querySelector('td:last-child button').click(); await new Promise(z => setTimeout(z, 300));
            const p = document.querySelector('[role=dialog]'); const t = p ? p.innerText.slice(0, 80) : '';
            document.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Escape' }})); await new Promise(z => setTimeout(z, 200)); return t; }})()""")
        pops.append(opened)
    check(f'{tag}incidents: source popovers open for an event and a credit rule', all(p is None or len(p) > 0 for p in pops) and any(pops), json.dumps(pops)[:240])
    # Kind filter and the widened window.
    await c.click_button('Events', '[role=radiogroup] [role=radio]')
    k = await c.js(INCIDENTS_INFO)
    await c.click_button('All kinds', '[role=radiogroup] [role=radio]')
    await c.click_button('7 days', '[role=radiogroup] [role=radio]')
    await c.wait("new URLSearchParams(location.search).get('window') === '7d'", timeout=5, label='?window=7d')
    await asyncio.sleep(0.5)
    w = await c.js(INCIDENTS_INFO)
    ok = all(x == 'event' for x in k['severities']) and w['rows'] >= d['rows'] and w['ordered'] and w['badge'] == d['badge']
    check(f'{tag}incidents: kind filter and the 7-day window (badge stays 24 h)', ok, json.dumps({'events': k['rows'], '24h': d['rows'], '7d': w['rows'], 'nearby7d': w['nearby']}))


async def agent_panel(c):
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF}/farms/cl-ovalle-table-grape?tab=overview')
    await c.wait(f"/verdict/i.test({TXT}) && {TXT}.includes('Next payment')", timeout=120, label='farm overview')
    await c.click_button('Farming agent', 'aside[aria-label=Sidebar] button')
    await c.wait("!!document.querySelector('[aria-label=\"Question for the farming agent\"]')", timeout=15, label='agent panel')
    await asyncio.sleep(0.8)
    check('agent panel opens from the sidebar with the farm context', True)
    await c.shot('30-agent-panel.png')
    if ASK_AGENT:
        await c.js("(() => { const t=document.querySelector('[aria-label=\"Question for the farming agent\"]'); const d=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value'); d.set.call(t,'Why is this farm high stress, and what should the credit officer check first?'); t.dispatchEvent(new Event('input',{bubbles:true})); })()")
        await asyncio.sleep(0.3)
        await c.js("document.querySelector('aside button[aria-label=Ask]').click()")
        t0 = time.time()
        try:
            await c.wait("(() => { const a=document.querySelector('aside[aria-label=\"Farming agent\"]'); return a && !a.querySelector('.animate-spin') && /Apply|Dismiss|Tool calls|tool call|no_api_key|could not|unavailable/i.test(a.innerText); })()", timeout=120, label='agent answer')
            check('agent answers a question (live, paid)', True, f'{time.time()-t0:.0f}s')
        except TimeoutError as e:
            check('agent answers a question (live, paid)', False, str(e))
        await c.shot('31-agent-answer.png')
    await c.click_button('Farming agent', 'aside[aria-label=Sidebar] button')


async def phone(c):
    await c.viewport(390, 844, mobile=True)
    await c.call('Page.navigate', url=APP + '/app')
    await c.wait(f"{TXT}.includes('Due in next 90 days') && {TXT}.includes('Total outstanding')", timeout=120, label='phone home')
    await c.settle(120)
    await c.wait(f"!{TXT}.includes('Tier pending')", timeout=60, label='phone home tiers')
    w = await c.js("document.documentElement.scrollWidth")
    check('phone: home fits 390 px without horizontal scroll', w <= 390, f'scrollWidth={w}')
    await c.shot('40-phone-home.png')
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF}')
    await c.wait(f"{TXT}.includes('Farms and loans')", timeout=120, label='phone report')
    await c.settle(120)
    w = await c.js("document.documentElement.scrollWidth")
    check('phone: report fits 390 px without horizontal scroll', w <= 390, f'scrollWidth={w}')
    await c.shot('41-phone-report.png')
    await c.call('Page.navigate', url=f'{APP}/app/portfolios/{PF}/farms/cl-ovalle-table-grape')
    await c.wait(f"/verdict/i.test({TXT}) && {TXT}.includes('Next payment')", timeout=120, label='phone farm overview')
    await c.settle(120)
    await asyncio.sleep(1.0)
    w = await c.js("document.documentElement.scrollWidth")
    check('phone: farm overview fits 390 px without horizontal scroll', w <= 390, f'scrollWidth={w}')
    await c.shot('42-phone-farm-overview.png')
    await c.viewport(1440, 900)


async def wizard(c):
    await c.call('Page.navigate', url=APP + '/app/portfolios/new')
    await c.wait("!!document.querySelector('input[placeholder^=\"e.g. Central\"]')", label='wizard step 1')
    await c.js("window.__h.setVal(document.querySelector('input[placeholder^=\"e.g. Central\"]'), 'Valle de Limarí orchards')")
    await c.js("window.__h.setVal(document.querySelector('input[placeholder^=\"e.g. Banco\"]'), 'Test lender')")
    await asyncio.sleep(0.3)
    await c.click_button('Next')
    await c.wait("window.__maps.length > 0 && !!document.querySelector('[data-testid=farms-map] .leaflet-container')", label='farms map')
    await c.js("window.__h.map().setView([-30.5840, -71.2460], 16, {animate:false}); true")
    await asyncio.sleep(1.0)
    await c.click_button('Add from cadastre')
    await c.wait("document.body.innerText.match(/\\d+ orchards? in view/)", timeout=90, label='CIREN orchards')
    n = await c.js("(() => { let n = 0; window.__h.map().eachLayer(l => { if (l.feature?.properties?.objectId) n++; }); return n; })()")
    check('wizard: cadastre layer renders CIREN orchards', n > 0, f'{n} polygons')
    await c.js('localStorage.removeItem("clm-wizard-draft")')


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    proc = subprocess.Popen([CHROME, f'--remote-debugging-port={PORT}', f'--user-data-dir={PROFILE}', '--window-size=1440,900', '--no-first-run', '--hide-scrollbars', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        page = None
        for _ in range(80):
            try:
                page = next(t for t in json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json')) if t['type'] == 'page')
                break
            except Exception:
                time.sleep(0.2)
        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=80_000_000) as ws:
            c = CDP(ws)
            await c.call('Page.enable')
            await c.call('Runtime.enable')
            if OFFLINE:
                await c.call('Fetch.enable', patterns=[{'urlPattern': '*://localhost:8787/*'}, {'urlPattern': '*://127.0.0.1:8787/*'}])
            await c.viewport(1440, 900)
            await c.call('Emulation.setFocusEmulationEnabled', enabled=True)
            await c.call('Page.addScriptToEvaluateOnNewDocument', source=HOOK)

            await home_and_sample(c)
            await step('report', report(c))
            await step('second book', sur_book(c))
            if not OFFLINE:
                await step('home with data', home_with_data(c))
                await step('home while assessing', home_while_assessing(c))
                await c.call('Page.navigate', url=APP + '/app/portfolios')
                await c.wait(f"{TXT}.includes('Your portfolios')", label='portfolios list')
                await asyncio.sleep(0.8)
                await c.shot('02-portfolios.png')
            shots = {} if OFFLINE else {
                'ovalle-overview': '10-ovalle-overview.png', 'ovalle-imagery': '11-ovalle-imagery-native.png', 'ovalle-imagery-ai': '12-ovalle-imagery-ai.png',
                'ovalle-water': '13-ovalle-water.png', 'ovalle-risk': '14-ovalle-risk.png', 'ovalle-rules': '15-ovalle-rules.png', 'ovalle-events': '16-ovalle-events.png',
                'paine-risk': '20-paine-risk.png', 'paine-events': '21-paine-events.png'}
            shots['paine-overview'] = '22-paine-overview.png' if not OFFLINE else None
            shots = {k: v for k, v in shots.items() if v}
            for farm_id, short in FARMS:
                await step(f'{short} tabs', farm_tabs(c, farm_id, short, shots))
            for farm_id, short, expect, more, shot in OVERVIEW_FARMS:
                await step(f'{short} overview', overview_only(c, farm_id, short, expect, more, shot))
            if OFFLINE:
                await step('offline home', home_with_data(c))
                await step('offline incidents', incidents_page(c))
            else:
                await step('incidents', incidents_page(c))
                await step('agent panel', agent_panel(c))
                await step('phone', phone(c))
                if WIZARD:
                    await step('wizard', wizard(c))
            if OFFLINE:
                check('offline: requests to :8787 were blocked, not served', c.blocked > 0, f'{c.blocked} blocked')
            c.reader.cancel()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    errs = [e for e in ERRORS if 'favicon' not in e and not (OFFLINE and ('8787' in e or 'Failed to fetch' in e or 'ERR_CONNECTION_REFUSED' in e))]
    print('\nconsole errors:', len(errs))
    for e in errs[:15]:
        print('  ', e[:300])
    print(f"\n{sum(1 for r in results if r[1])}/{len(results)} passed")
    sys.exit(0 if all(r[1] for r in results) else 1)


asyncio.run(main())
