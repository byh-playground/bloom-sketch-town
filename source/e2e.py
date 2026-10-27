#!/usr/bin/env python3
"""SKETCH TOWN: the single supported real-browser end-to-end verification.

No GameKit mocks, no Canvas2D fallback, no synthetic success when Chromium WebGL
is unavailable.  Playwright drives real DOM/pointer/keyboard and real game code.

Usage:
  python source/build_rpg.py
  python source/e2e.py
  xvfb-run -a python source/e2e.py --headed
  python source/e2e.py --live-p2p  # optional PUBLIC relay + genuine RTC integration

Only test entrypoint in this source distribution. See README for scope/limits.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import struct
import sys
import time
import zlib
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / "index.html"
ARTIFACTS = Path(os.environ.get("SKETCH_TOWN_ARTIFACTS", ROOT / "e2e_artifacts"))
CHROMIUM = os.environ.get("SKETCH_CHROMIUM", "/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else "")
FLAGS = [
    "--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl",
    "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
]


class E2E:
    def __init__(self, *, headed: bool, live_p2p: bool):
        self.started = time.monotonic()
        self.flow = 'all'
        self.headed = headed
        self.live_p2p = live_p2p
        self.results = []
        self.errors = []
        self.gesture_reference = None
        self.html_sha256 = hashlib.sha256(HTML_PATH.read_bytes()).hexdigest()

    def check(self, name: str, condition: bool, detail=None):
        entry = {"name": name, "status": "PASS" if condition else "FAIL"}
        if detail is not None:
            entry["detail"] = detail
        self.results.append(entry)
        print(f"{'PASS' if condition else 'FAIL'}  {name}", flush=True)
        if not condition:
            raise AssertionError(f"{name}: {detail}")

    def note(self, name: str, why: str):
        self.results.append({"name": name, "status": "NOT_RUN", "reason": why})

    def save(self):
        ARTIFACTS.mkdir(exist_ok=True)
        payload = {
            "suite": "Sketch Town real Chromium E2E (single entrypoint)",
            "html_sha256": self.html_sha256,
            "flow": self.flow,
            "renderer_backend": "WebGL1 / ANGLE SwiftShader (existing E2E flags; no mock renderer)",
            "headless": not self.headed,
            "live_p2p_requested": self.live_p2p,
            "chromium": CHROMIUM,
            "browser_version": getattr(self,'browser',None),
            "elapsed_seconds": round(time.monotonic() - self.started, 2),
            "status": "PASS" if not self.errors else "FAIL",
            "checks": self.results,
            "errors": self.errors,
        }
        (ARTIFACTS / "report.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload


def png_metadata(raw: bytes):
    """Validate PNG chunk CRCs and parse the game's original-only tEXt record."""
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("download is not a PNG")
    i, info = 8, None
    while i < len(raw):
        if i + 12 > len(raw):
            raise ValueError("truncated PNG chunk")
        size = struct.unpack_from(">I", raw, i)[0]
        name = raw[i + 4:i + 8]
        payload = raw[i + 8:i + 8 + size]
        expected = struct.unpack_from(">I", raw, i + 8 + size)[0]
        if zlib.crc32(name + payload) & 0xffffffff != expected:
            raise ValueError(f"invalid PNG CRC: {name!r}")
        if name == b"tEXt" and payload.startswith(b"SketchTownDataset\x00"):
            info = json.loads(payload.split(b"\x00", 1)[1].decode("utf-8"))
        i += size + 12
        if name == b"IEND":
            if i != len(raw):
                raise ValueError("trailing bytes after PNG IEND")
            break
    if info is None:
        raise ValueError("missing original stroke metadata")
    return info


async def create_page(browser, *, width, height, mobile=False, dpr=1):
    context = await browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=dpr,
        is_mobile=mobile,
        has_touch=mobile,
        accept_downloads=True,
    )
    page = await context.new_page()
    # __A = open test ground near the spawn (see __sketchRpgDebug.arena); evaluated on every access so reloads keep working.
    await page.add_init_script("Object.defineProperty(window,'__A',{get:()=>window.__sketchRpgDebug.arena()})")
    issues = []
    page.on("pageerror", lambda error: issues.append(str(error)))
    return context, page, issues


_SHARED_SERVER = {}


def _shared_game_url():
    if "url" not in _SHARED_SERVER:
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(ROOT), **kwargs)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        Thread(target=server.serve_forever, daemon=True).start()
        _SHARED_SERVER["url"] = f"http://127.0.0.1:{server.server_port}/{HTML_PATH.name}"
    return _SHARED_SERVER["url"]


async def ready_game(page, *, html: str):
    # Rendering MUST be real WebGL. Do not bypass by injecting a fake renderer.
    # The page loads its scripts by relative URL (source-first bootstrap), so it must come from a real http origin.
    await page.goto(_shared_game_url(), wait_until="load", timeout=15000)
    game_ready = await page.evaluate("!!window.__sketchRpgDebug && window.__sketchRpgDebug.snapshot().rendererState === 'ready'")
    if not game_ready:
        has_webgl = await page.evaluate("!!document.createElement('canvas').getContext('webgl')")
        if not has_webgl:
            raise RuntimeError("실제 WebGL1 컨텍스트 생성 실패: 현재 Chromium/GPU 환경에서 E2E 실행 불가. 모의 렌더러로 대체하지 않음")
    await page.wait_for_function("window.__sketchRpgDebug !== undefined", timeout=10000)
    await page.wait_for_function("window.__sketchRpgDebug.snapshot().rendererState === 'ready'", timeout=10000)
    # The real field canvas must submit GPU geometry; a DOM-only screenshot cannot pass.
    await page.wait_for_function(
        "window.__sketchRpgDebug.rendererStats().vertices > 0", timeout=10000
    )


async def open_menu(page):
    """Open the ☰ dropdown that now holds multiplayer/codex/training/help/sound."""
    if not await page.locator('#headMenu').is_visible():
        await page.locator('#menuButton').click()
        await page.locator('#headMenu').wait_for(state='visible',timeout=3000)


async def draw_circle(page, size=180, kind='circle', at=None, tries=3):
    """Draw with real battlefield mouse events, centered on the first foe or on the world point `at`."""
    for attempt in range(tries):
      shot = await _draw_circle_once(page,size,kind,at)
      if shot is not None or attempt==tries-1:
        return shot
      await page.wait_for_timeout(400)


async def _draw_circle_once(page, size, kind, at):
    points = await page.evaluate("""([size,kind,at]) => {
      const d=window.__sketchRpgDebug,foe=at?{x:at[0],y:at[1]}:d.foePositions()[0],center=d.screenAt(foe.x,foe.y);
      const points=d.sample(kind,size,size);
      const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
      const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
      return points.map(p=>({x:Math.round(p.x-(minX+maxX)/2)+Math.round(center.x),y:Math.round(p.y-(minY+maxY)/2)+Math.round(center.y)}));
    }""",[size,kind,at])
    await page.mouse.move(points[0]['x'],points[0]['y'])
    await page.mouse.down()
    for point in points[1::max(1, len(points)//44)]:
        await page.mouse.move(point['x'],point['y'])
    await page.mouse.move(points[-1]['x'],points[-1]['y'])
    await page.evaluate("""() => {window.lastGestureShot=null;__sketchRpgDebug.clearLastShot();document.addEventListener('pointerup',()=>{
      window.lastGestureShot=__sketchRpgDebug.lastShot();
    },{once:true});}""")
    await page.mouse.up()
    return await page.evaluate("window.lastGestureShot")


async def set_traits(page, bold=0, quick=0):
    """Move the two real temperament sliders (range inputs) the way a player would; returns the dock state."""
    sliders = page.locator('#traitSliders input')
    await sliders.nth(0).fill(str(bold))
    await sliders.nth(1).fill(str(quick))
    return await page.evaluate("__sketchRpgDebug.traitState()")


async def run_desktop(browser, suite: E2E, html: str):
    context, page, issues = await create_page(browser, width=1024, height=768)
    try:
        await ready_game(page, html=html)
        info = await page.evaluate("""() => ({
          stats:window.__sketchRpgDebug.performanceStats(),
          gpu:window.__sketchRpgDebug.rendererStats(),
          snap:window.__sketchRpgDebug.snapshot()
        })""")
        suite.check("real desktop WebGL renders game geometry", info["gpu"]["vertices"] > 0 and info["snap"]["rendererState"] == "ready")
        suite.check("30 TPS simulation / 60 FPS rendering targets", info["stats"]["targetTPS"] == 30 and info["stats"]["targetFPS"] == 60)
        suite.check("GameKit interpolation has live entities", info["stats"]["interpolated"] and info["stats"]["trackedEntities"] > 0)
        frame_before_pagehide = info["gpu"]["frame"]
        await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))")
        suite.check("bfcache pagehide preserves the live SVG renderer",
                    (await page.evaluate("window.__sketchRpgDebug.snapshot().rendererState")) == "ready")
        await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        await page.wait_for_function(
            f"window.__sketchRpgDebug.rendererStats().frame > {frame_before_pagehide}", timeout=3000
        )
        has_context_loss = await page.evaluate("""() => {
          const gl=document.querySelector('#field').getContext('webgl');
          const ext=gl?.getExtension('WEBGL_lose_context');
          if(!ext)return false;
          window.__restoreSketchWebGL=()=>ext.restoreContext();
          ext.loseContext();
          return true;
        }""")
        suite.check("WebGL context loss extension is available", has_context_loss)
        if has_context_loss:
            await page.wait_for_function(
                "window.__sketchRpgDebug.snapshot().rendererState === 'lost'", timeout=5000
            )
            await page.evaluate("window.__restoreSketchWebGL()")
            await page.wait_for_function(
                "window.__sketchRpgDebug.snapshot().rendererState === 'ready' && window.__sketchRpgDebug.rendererStats().vertices > 0",
                timeout=10000,
            )
            suite.check("retained SVG meshes restore after WebGL context loss",
                        (await page.evaluate("window.__sketchRpgDebug.rendererStats().mesh.state")) == "ready")
        before_tick = info["snap"]["tick"]
        await page.wait_for_timeout(800)
        tick_state = await page.evaluate("window.__sketchRpgDebug.snapshot().tick")
        suite.check("the actual simulation advances independently from render", tick_state > before_tick + 3)
        # Real WebGL already verified above. Suppress repeated software GPU frames during
        # heavy input simulation; the actual GameKit timer continues at 30TPS.
        await page.evaluate("window.__sketchRpgDebug.pausePainting()")
        # Measure the movement kernel in a clear lane. Nearby default enemies can collide,
        # hit, or knock the player back during this short wall-clock sample.
        await page.evaluate("window.__sketchRpgDebug.moveTo(__A.x-5,__A.y);window.__sketchRpgDebug.combatFixture('boss',__A.x+1120,__A.y)")

        await page.locator('#field').focus()
        await page.keyboard.down('d')
        # Begin the timed sample only after the 60 Hz input pump has delivered the
        # held direction to a 30 TPS simulation step.
        await page.wait_for_function("window.__sketchRpgDebug.movementState().x===1 && window.__sketchRpgDebug.snapshot().player.x>475",timeout=2000)
        idle = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.wait_for_timeout(400)
        moved = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        distance = moved['player']['x'] - idle['player']['x']
        expected = (moved['tick']-idle['tick'])*140/30
        suite.check('held WASD walks at 140 world units/s without consuming roll',
                    distance > 20 and abs(distance-expected)<6 and moved['roll']['charges']==2, {'distance':distance,'expected':expected})
        await page.keyboard.up('d')
        await page.wait_for_timeout(100)
        stopped = await page.evaluate("window.__sketchRpgDebug.snapshot().player")
        await page.wait_for_timeout(150)
        later=await page.evaluate("window.__sketchRpgDebug.snapshot().player")
        suite.check('key release stops walking', all(stopped[k]==later[k] for k in ('x','y')))
        await page.keyboard.down('w')
        await page.keyboard.down('a')
        await page.wait_for_timeout(250)
        direction = await page.evaluate("window.__sketchRpgDebug.movementState()")
        suite.check('diagonal walking is normalized', abs(direction['x']**2+direction['y']**2-1)<.001 and direction['x']<0 and direction['y']<0)
        await page.keyboard.up('w')
        await page.keyboard.up('a')
        await page.keyboard.down('d')
        await page.keyboard.press('Space')
        await page.wait_for_timeout(220)
        rolled = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.wait_for_timeout(180)
        resumed = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        suite.check('Space rolls once and held direction resumes immediately', rolled['roll']['activeMs']==0 and rolled['roll']['charges']==1 and resumed['player']['x']>rolled['player']['x']+10)
        await page.keyboard.up('d')
        await page.keyboard.down('a')
        await page.evaluate("window.dispatchEvent(new Event('blur'))")
        await page.wait_for_timeout(100)
        suite.check('focus loss releases held movement', await page.evaluate("window.__sketchRpgDebug.movementState().x===0"))
        await page.keyboard.up('a')

        # The whole battlefield is ink input. A click is never a movement command.
        await page.evaluate("""() => {const d=window.__sketchRpgDebug;
          d.moveTo(__A.x-5,__A.y);d.combatFixture('boss',__A.x-260,__A.y);d.resumePainting();}""")
        await page.wait_for_timeout(100)
        before_tap=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.mouse.click(710,340)
        await page.wait_for_timeout(100)
        after_tap=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        tap_untouched=(after_tap['player']['x']==before_tap['player']['x'] and
                       after_tap['player']['y']==before_tap['player']['y'] and
                       after_tap['roll']['charges']>=before_tap['roll']['charges'] and
                       after_tap['castCount']==0 and after_tap['summonCount']==0)
        suite.check('battlefield tap neither rolls nor casts',
                    tap_untouched, {'before':before_tap,'after':after_tap})

        await page.mouse.move(700,330)
        await page.mouse.down()
        await page.mouse.move(740,300)
        await page.mouse.move(720,360)
        ink_before=await page.evaluate("window.__sketchRpgDebug.drawingState()")
        move_before=await page.evaluate("window.__sketchRpgDebug.snapshot().player.y")
        await page.keyboard.down('s')
        await page.wait_for_timeout(240)
        await page.evaluate("window.__sketchRpgDebug.pausePainting()")
        held=await page.evaluate("""() => ({ink:__sketchRpgDebug.drawingState(),player:__sketchRpgDebug.snapshot().player})""")
        suite.check('WASD moves during drawing while screen ink stays fixed',
                    held['player']['y']>move_before+15 and held['ink']['points']==ink_before['points'])
        await page.evaluate("""() => {window.releasedShot=null;document.addEventListener('pointerup',()=>{
          window.releasedShot=structuredClone(__sketchRpgDebug.queuedShots().at(-1));
        },{once:true});}""")
        await page.mouse.up()
        released=await page.evaluate("window.releasedShot")
        suite.check('release freezes the drawing-center map position',
                    released is not None and abs(released['x']-held['ink']['world']['x'])<0.2 and abs(released['y']-held['ink']['world']['y'])<0.2, released and {'x':released['x'],'y':released['y'],'drawn':held['ink']['world']})
        await page.keyboard.up('s')
        await page.keyboard.down('a')
        await page.wait_for_function("window.__sketchRpgDebug.summons().length>0",timeout=4000)
        summoned=await page.evaluate("window.__sketchRpgDebug.summons()[0]")
        await page.keyboard.up('a')
        suite.check('summon keeps the drawn shape and kind despite later movement',
                    summoned['kind']==released['kind'] and summoned['shape']==released['shape'] and 0<=released['x']<=4400,{'kind':summoned['kind'],'x':released['x']})

        # Interrupted drawings cannot leave a delayed cast or pointer ownership behind.
        await page.evaluate("window.__sketchRpgDebug.combatFixture('boss',__A.x+1120,__A.y)")
        for interruption in ('blur','modal','resize'):
            await page.mouse.move(700,330)
            await page.mouse.down()
            await page.mouse.move(740,300)
            await page.mouse.move(720,360)
            if interruption=='blur':
                await page.evaluate("window.dispatchEvent(new Event('blur'))")
            elif interruption=='modal':
                await open_menu(page)
                await page.locator('#helpButton').focus()
                await page.keyboard.press('Enter')
                await page.wait_for_function("window.__sketchRpgDebug.snapshot().modal==='help'")
            else:
                await page.set_viewport_size({'width':1000,'height':740})
                await page.wait_for_function("window.__sketchRpgDebug.drawingState().pointer===null", timeout=3000)
            await page.mouse.up()
            cancelled=await page.evaluate("""() => ({drawing:__sketchRpgDebug.drawingState(),shots:__sketchRpgDebug.queuedShots()})""")
            suite.check(interruption+' cancels drawing without a cast',cancelled['drawing']['pointer'] is None and not cancelled['shots'])
            if interruption=='modal':
                await page.keyboard.press('Escape')
                await page.wait_for_function("window.__sketchRpgDebug.snapshot().modal===null")
            elif interruption=='resize':
                await page.set_viewport_size({'width':1024,'height':768})
        # Deterministic fixture only arranges the battlefield; actual attack is a real gesture.
        await page.evaluate("""() => {const d=window.__sketchRpgDebug;d.moveTo(__A.x-5,__A.y);
          d.combatFixture('boss',__A.x+170,__A.y-5);d.renderNow();d.resumePainting();}""")
        hp_before = await page.evaluate("window.__sketchRpgDebug.foePositions()[0].hp")
        suite.gesture_reference=await draw_circle(page)
        await page.wait_for_function("document.getElementById('lastSpell').textContent.includes('방패 구체')", timeout=5000)
        await page.wait_for_function("""hp => {
           const foe = window.__sketchRpgDebug.foePositions()[0];
           return foe && foe.hp < hp;
        }""", arg=hp_before, timeout=12000)
        suite.check("real one-stroke gesture → CNN → spell → real boss damage", True)

        before = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        # Avoid a second spell: keyboard input immediately after painting must still move.
        await page.keyboard.down("a")
        try:
            await page.wait_for_function("""x => {
              const p=window.__sketchRpgDebug.snapshot().player;
              return p.x < x - 5;
            }""", arg=before["player"]["x"], timeout=8000)
        except Exception:
            diagnostic = await page.evaluate("""() => ({
              focus:document.activeElement?.id,
              snap:window.__sketchRpgDebug.snapshot(),
              pending:window.__sketchRpgDebug.pendingCommands()
            })""")
            print('WASD_AFTER_DRAW_DIAGNOSTIC',json.dumps(diagnostic,ensure_ascii=False),flush=True)
            raise
        after = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.keyboard.up("a")
        suite.check("WASD after drawing still walks", after["player"]["x"] < before["player"]["x"] - 5)

        # One real browser UI workflow, including an actual downloaded PNG.
        await open_menu(page)
        await page.locator("#trainingButton").click()
        await page.locator("#trainingLabel").select_option("circle")
        await page.locator("#importCombat").click()
        original_count = await page.evaluate("window.__sketchRpgDebug.datasetCount().original")
        suite.check("editor imports exactly one original stroke", original_count == 1)
        async with page.expect_download(timeout=10000) as pending:
            await page.locator("#exportSheet").click()
        downloaded = await pending.value
        file_path = await downloaded.path()
        info = png_metadata(Path(file_path).read_bytes())
        suite.check("PNG metadata retains original only, no augmented tiles",
            info.get("count") == 1 and len(info.get("entries", [])) == 1
            and info["entries"][0]["label"] == "circle"
            and info.get("version") == 2)

        await page.locator('#trainingModal [data-close]').click()
        await page.evaluate("window.__sketchRpgDebug.pauseRendering()")
        # Verify rollback snapshot roundtrip without changing the world before rendering.
        state = await page.evaluate("""() => {
            const d=window.__sketchRpgDebug,s=d.canonicalSnapshot();
            const valid=d.adapter().validateSnapshot(s);
            d.canonicalRestore(s);
            const t=d.canonicalSnapshot();
            return {valid,identical:s.length===t.length&&s.every((v,i)=>v===t[i])};
        }""")
        suite.check("canonical rollback save/load is byte-for-byte identical", state["valid"] and state["identical"])
        suite.check("no game JavaScript exception", not issues, issues[:5])
        await page.evaluate("window.__sketchRpgDebug.resumePainting()")
        await page.wait_for_timeout(160)
        suite.check("WebGL rendering resumes after input and rollback verification",
                    await page.evaluate("window.__sketchRpgDebug.rendererStats().vertices > 0"))
        await page.screenshot(path=str(ARTIFACTS / "desktop.png"))
    finally:
        await context.close()


async def run_mobile(browser, suite: E2E, html: str):
    context, page, issues = await create_page(browser, width=390, height=844, mobile=True, dpr=2)
    try:
        await ready_game(page, html=html)
        state = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.touchscreen.tap(235,340)
        await page.wait_for_timeout(120)
        changed=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        suite.check('mobile battlefield tap neither rolls nor casts',
                    changed['player']['x']==state['player']['x'] and changed['player']['y']==state['player']['y']
                    and changed['roll']['charges']>=state['roll']['charges'] and changed['castCount']==0 and changed['summonCount']==0,
                    {'before':state,'after':changed})
        await page.evaluate("window.__sketchRpgDebug.pausePainting()")
        stick=await page.locator('#moveStick').bounding_box()
        suite.check('mobile stick stays clear of battlefield drawing',
                    stick['x']+stick['width']<260 and
                    await page.evaluate("getComputedStyle(document.getElementById('draw')).pointerEvents==='none' && document.elementFromPoint(260,340).id==='field'"))
        cdp=await context.new_cdp_session(page)
        left={'x':stick['x']+stick['width']*.82,'y':stick['y']+stick['height']/2,'id':1}
        points=await page.evaluate("""() => {
          const points=__sketchRpgDebug.sample('circle',180,180);
          const cx=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2;
          const cy=(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2;
          return points.map(p=>({x:Math.round(p.x-cx)+275,y:Math.round(p.y-cy)+340}));
        }""")
        right={**points[0],'id':2}
        start=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[left]})
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[left,right]})
        for point in points[1::max(1,len(points)//44)]+[points[-1]]:
            right={**point,'id':2}
            await cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[left,right]})
        await page.wait_for_timeout(220)
        during=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        suite.check('independent fingers walk and draw together', during['drawPhase']=='drawing' and during['player']['x']>start['player']['x']+10)
        # Observe at the input edge, before a simulation tick consumes the cast.
        await page.evaluate("""() => {window.mobileGestureShot=null;document.addEventListener('pointerup',()=>{
          window.mobileGestureShot=structuredClone(__sketchRpgDebug.queuedShots().at(-1));
        },{once:true});}""")
        # CDP touchEnd identifies the contacts to end, not the remaining contacts.
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[right]})
        await page.wait_for_function("window.mobileGestureShot !== null && window.mobileGestureShot !== undefined", timeout=3000)
        mobile_shot=await page.evaluate("window.mobileGestureShot")
        reference=suite.gesture_reference
        suite.check('same real circle keeps classification and combat stats across desktop/mobile viewport and DPR',
                    reference is not None and mobile_shot is not None and reference['kind']==mobile_shot['kind']=='circle'
                    and all(abs(reference[key]-mobile_shot[key])<1e-6 for key in ('baseDamage','areaPower','impact','pen'))
                    and abs(reference['geo']['length']-mobile_shot['geo']['length'])<1e-6,
                    {'desktop':{key:reference[key] for key in ('kind','baseDamage','areaPower')} if reference else None,
                     'mobile':{key:mobile_shot[key] for key in ('kind','baseDamage','areaPower')} if mobile_shot else None})
        await page.wait_for_timeout(120)
        suite.check('drawing release keeps stick held', await page.evaluate("window.__sketchRpgDebug.movementState().x>0 && window.__sketchRpgDebug.snapshot().drawPhase==='idle'"))
        roll={'x':button['x']+button['width']/2,'y':button['y']+button['height']/2,'id':3}
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[left,roll]})
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[roll]})
        await page.wait_for_timeout(240)
        suite.check('mobile roll button consumes one charge and resumes walking', await page.evaluate("window.__sketchRpgDebug.rollState().charges===1 && window.__sketchRpgDebug.rollState().leftMs===0 && window.__sketchRpgDebug.movementState().x>0"))
        await cdp.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
        await page.wait_for_timeout(100)
        stopped=await page.evaluate("window.__sketchRpgDebug.movementState()")
        await page.wait_for_timeout(100)
        later=await page.evaluate("window.__sketchRpgDebug.movementState()")
        suite.check('touch cancellation stops movement',all(stopped[k]==later[k]==0 for k in ('x','y')),
                    {'stoppedMovement':stopped,'laterMovement':later})
        await page.evaluate("window.__sketchRpgDebug.resumePainting()")
        suite.check("mobile WebGL/JS stays operational", not issues, issues[:5])
        await page.screenshot(path=str(ARTIFACTS / "mobile.png"))
    finally:
        await context.close()


@contextmanager
def local_server():
    """Serve the SAME final game HTML for the optional *real* internet P2P test."""
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/{HTML_PATH.name}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


async def walk_to(page, points, timeout_s=90, arrive=30):
    """Walk the hero along waypoints with real keyboard input; returns the index of the next unreached waypoint."""
    await page.locator('#field').focus()
    held=set()
    async def hold(keys):
        for key in held-keys:
            await page.keyboard.up(key)
        for key in keys-held:
            await page.keyboard.down(key)
        held.clear(); held.update(keys)
    index=0; deadline=time.time()+timeout_s
    last=None; last_move=time.time(); slide=0
    while index<len(points) and time.time()<deadline:
        p=await page.evaluate('(()=>{const s=__sketchRpgDebug.snapshot().player;return {x:s.x,y:s.y};})()')
        dx=points[index]['x']-p['x']; dy=points[index]['y']-p['y']
        if (dx*dx+dy*dy)**.5<arrive:
            index+=1; last_move=time.time(); continue
        if last is None or abs(p['x']-last['x'])+abs(p['y']-last['y'])>2:
            last=p; last_move=time.time(); slide=0
        elif time.time()-last_move>0.8:
            # Wedged on a corner: slide along one axis only, alternating, then skip ahead if still stuck.
            slide+=1; last_move=time.time()
            if slide>6:
                index+=1; slide=0
        keys=set()
        only=('x' if slide%2==1 else 'y') if slide else None
        if only!='y':
            if dx>5: keys.add('d')
            elif dx<-5: keys.add('a')
        if only!='x':
            if dy>5: keys.add('s')
            elif dy<-5: keys.add('w')
        await hold(keys)
        await page.wait_for_timeout(50)
    await hold(set())
    return index


async def run_map(browser, suite: E2E):
    seed=20261026
    with local_server() as url:
        desktop,page,issues=await create_page(browser,width=1024,height=768)
        mobile,other,other_issues=await create_page(browser,width=390,height=844,mobile=True)
        try:
            await page.goto(f'{url}?seed={seed}')
            await other.goto(f'{url}?seed={seed}')
            for p in (page,other):
                await p.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            a=await page.evaluate('__sketchRpgDebug.mapState()')
            b=await other.evaluate('__sketchRpgDebug.mapState()')
            suite.check('same seed gives the same layout hash in a desktop and a 390px mobile page',a['hash']==b['hash'] and a['seed']==seed and a['worldSeed']==seed,{'a':a['hash'],'b':b['hash']})
            suite.check('layout hash matches a fresh generation of the same seed',(await page.evaluate(f'__sketchRpgDebug.mapHashFor({seed})'))['hash']==a['hash'])
            suite.check('different seeds give different layouts',(await page.evaluate(f'__sketchRpgDebug.mapHashFor({seed+1})'))['hash']!=a['hash'])
            suite.check('help screen shows the run seed',await page.evaluate("document.getElementById('mapSeed').textContent")==str(seed))
            suite.check('every prop is drawn and every solid prop is an obstacle',a['counts']['trees']==a['counts']['props'] and 0<a['counts']['obstacles']<=a['counts']['props'],a['counts'])
            zones=[q['zone'] for q in a['bossSites']]
            kinds=[q['kind'] for q in a['sites']]
            suite.check('five boss sites, one per zone from the coast (0) to the exact centre (4)',zones==[0,1,2,3,4] and a['bossSites'][4]['x']==a['size']//2 and a['bossSites'][4]['y']==a['size']//2 and all(q['radius']==150 for q in a['bossSites']),a['bossSites'])
            suite.check('spawn is on the coast zone; camps, portals and a mob nest set exist',a['sites'][0]['kind']=='spawn' and a['sites'][0]['zone']==0 and kinds.count('camp')>=5 and kinds.count('portal')>=3 and len(a['nests'])>=55,{'camps':kinds.count('camp'),'portals':kinds.count('portal'),'nests':len(a['nests'])})
            suite.check('map is a single connected walkable land (every site reachable, >=99.9% of walkable land)',a['report']['reachable'] and a['report']['reachedRatio']>0.999,a['report'])
            free=await page.evaluate("""m => ({spawn:!__sketchRpgDebug.terrainBlocked(m.spawn.x,m.spawn.y,16),
                bosses:m.bossSites.every(s=>!__sketchRpgDebug.terrainBlocked(s.x,s.y,56)),
                nests:m.nests.every(n=>!__sketchRpgDebug.terrainBlocked(n.x,n.y,20))})""",a)
            suite.check('the spawn, every boss spot and every mob nest stand on free ground (no wall, sea or prop)',all(free.values()),free)
            wild=[(n['hpScale'],n['zone']) for n in a['nests'] if n['kind']=='wild']
            avg=[sum(h for h,z in wild if z==zz)/max(1,sum(1 for h,z in wild if z==zz)) for zz in range(4)]
            centre=[n for n in a['nests'] if n['zone']==4]
            suite.check('wild nests get tougher towards the centre (hp scale rises over zones 0-3) and the centre zone has guard and boss nests',all(avg[i]<avg[i+1] for i in range(3)) and len(centre)>=2 and all(n['hpScale']>=3 for n in centre),{'avg':avg,'centre':len(centre)})
            sweep=await page.evaluate("""() => {const out={fail:0,attempts:{},maxMs:0,hashes:new Set()};
              for(let i=0;i<40;i++){const seed=(i*2654435761)>>>0;try{const r=__sketchRpgDebug.mapHashFor(seed);
                if(i<8&&__sketchRpgDebug.mapHashFor(seed).hash!==r.hash)out.fail++;out.attempts[r.attempt]=(out.attempts[r.attempt]||0)+1;out.maxMs=Math.max(out.maxMs,r.ms);out.hashes.add(r.hash);}catch(e){out.fail++;}}
              out.unique=out.hashes.size;delete out.hashes;return out;}""")
            suite.check('40 seeds all generate a reachable map (first 8 repeat identically), each within 3s',sweep['fail']==0 and sweep['unique']==40 and sweep['maxMs']<3000,sweep)
            # Join/recovery path: a checkpoint from seed A restored into a page that started with seed B rebuilds seed A's terrain.
            await other.goto(f'{url}?seed={seed+7}')
            await other.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            before=await other.evaluate('__sketchRpgDebug.mapState().hash')
            snapshot=await page.evaluate('Array.from(__sketchRpgDebug.canonicalSnapshot())')
            await other.evaluate('bytes=>__sketchRpgDebug.canonicalRestore(new Uint8Array(bytes))',snapshot)
            restored=await other.evaluate('__sketchRpgDebug.mapState()')
            suite.check('checkpoint restore rebuilds the sender\'s terrain from the shared seed',before!=a['hash'] and restored['hash']==a['hash'] and restored['worldSeed']==seed and restored['counts']==a['counts'],{'before':before,'restored':restored['hash'],'expected':a['hash']})
            # Real keyboard walk: coast camp to boss 1's site; arriving wakes boss 1.
            await page.evaluate("""() => {const d=__sketchRpgDebug,s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
              s.world.enemies=[];s.world.hazards=[];s.world.pickups=[];s.world.nests=s.world.nests.map(q=>({...q,on:false,done:true}));d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));d.invulnerable();}""")
            site=a['bossSites'][0]
            route=await page.evaluate('s=>__sketchRpgDebug.pathTo(s.x,s.y)',site)
            suite.check('a free route exists from the spawn to boss 1',route is not None and len(route)>3,len(route) if route else None)
            reached=await walk_to(page,route,timeout_s=120)
            await page.wait_for_function('__sketchRpgDebug.bossState().states[0]===1',timeout=6000)
            final=await page.evaluate('__sketchRpgDebug.snapshot().player')
            gap=((final['x']-site['x'])**2+(final['y']-site['y'])**2)**.5
            suite.check('real keyboard input walks from the coast camp to boss 1, whose arrival wakes the boss',reached==len(route) and gap<site['radius']+260,{'reached':reached,'of':len(route),'gap':gap})
            # A river and a cliff each stop a real walker.
            for name,wall in (('river',1),('cliff',2)):
                probe=await page.evaluate('w=>__sketchRpgDebug.edgeProbe(w)',wall)
                if probe is None:
                    suite.check(f'{name} blocks a real walker',False,'no free approach found');continue
                await page.evaluate('s=>{__sketchRpgDebug.setBossesDefeated(0);__sketchRpgDebug.moveTo(s.x,s.y);}',probe)
                await page.locator('#field').focus()
                await page.keyboard.down(probe['key'])
                await page.wait_for_timeout(1500)
                await page.keyboard.up(probe['key'])
                end=await page.evaluate('__sketchRpgDebug.snapshot().player')
                walked=((end['x']-probe['x'])*probe['dx']+(end['y']-probe['y'])*probe['dy'])
                short=((end['x']-probe['wallX'])*probe['dx']+(end['y']-probe['wallY'])*probe['dy'])
                suite.check(f'{name} blocks a real walker at its edge',walked>15 and short<0,{'probe':probe,'end':end,'walked':walked,'short':short})
            await page.screenshot(path=str(ARTIFACTS/'map-seed-desktop.png'))
            suite.check('map flow has no JavaScript errors',not issues and not other_issues,issues+other_issues)
        finally:
            await desktop.close()
            await mobile.close()


async def run_bosses(browser, suite: E2E):
    seed=20261026
    with local_server() as url:
        context,page,issues=await create_page(browser,width=1024,height=768)
        try:
            await page.goto(f'{url}?seed={seed}')
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            state=await page.evaluate('__sketchRpgDebug.bossState()')
            profiles=state['profiles']
            suite.check('five distinct bosses on five numbered sites, the last one at the map centre',len(profiles)==5 and len({p['name'] for p in profiles})==5 and [q['bossId'] for q in state['sites']]==[0,1,2,3,4],[p['name'] for p in profiles])
            f=[p['factors'] for p in profiles]
            kinds=['normal','line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle']
            expected=[
                {k:1 for k in kinds},
                {**{k:1 for k in kinds},'water':0,'flame':1.8},
                {**{k:1 for k in kinds},'flame':0,'water':1.8},
                {k:(1 if k in ('triangle','lightning') else .25) for k in kinds},
                {**{k:1 for k in kinds},'circle':0,'shuriken':1.8},
            ]
            suite.check('boss rule tables: none, water-immune/flame-weak, flame-immune/water-weak, triangle+lightning only, circle-immune/shuriken-weak',f==expected,f)
            dealt=await page.evaluate("""kinds => {const d=__sketchRpgDebug,out=[];for(let i=0;i<5;i++)for(const k of kinds){const id=d.spawnBoss(i);out.push({boss:i,kind:k,hit:d.bossHit(id,k,100)});}return out;}""",kinds)
            wrong=[x for x in dealt if x['hit']!=(0 if expected[x['boss']][x['kind']]==0 else max(1,round(100*expected[x['boss']][x['kind']])))]
            suite.check('real damage path applies each rule for all 55 boss/shape pairs (earlier bosses fallen, so unsealed)',not wrong,wrong[:5])
            # Seal: a boss whose predecessors still stand takes 10% of every hit; the seal lifts when they fall.
            sealed=await page.evaluate("""() => {const d=__sketchRpgDebug,out={};
              const id=d.spawnBoss(3,true);out.sealedHit=d.bossHit(id,'triangle',100);out.sealedFlags=d.bossState().sealed;
              d.setBossesDefeated(3);const id2=d.spawnBoss(3);out.openHit=d.bossHit(id2,'triangle',100);out.openFlags=d.bossState().sealed;return out;}""")
            suite.check('a sealed boss takes 10% of each hit (100 → 10) and the same hit deals 100 once earlier bosses have fallen',sealed['sealedHit']==10 and sealed['openHit']==100 and sealed['sealedFlags']==[False,True,True,True,True] and sealed['openFlags']==[False,False,False,False,True],sealed)
            # Real drawing: the fog turtle ignores a drawn water drop and is hurt by a drawn flame.
            await page.evaluate('__sketchRpgDebug.unlockAll();__sketchRpgDebug.moveTo(__A.x,__A.y)')
            boss_id=await page.evaluate('__sketchRpgDebug.spawnBoss(1)')
            await page.wait_for_timeout(200)
            water=await draw_circle(page,170,'water')
            await page.wait_for_function("__sketchRpgDebug.summons().some(q=>q.kind==='water')",timeout=9000)
            await page.wait_for_timeout(4000)
            after_water=await page.evaluate('id=>__sketchRpgDebug.bossHp(id)',boss_id)
            suite.check('a drawn water summon cannot hurt the water-immune boss',water is not None and water['kind']=='water' and after_water['hp']==720,{'shot':water and water['kind'],'hp':after_water})
            flame=await draw_circle(page,170,'flame')
            await page.wait_for_function("__sketchRpgDebug.summons().some(q=>q.kind==='flame')",timeout=9000)
            await page.wait_for_timeout(4000)
            after_flame=await page.evaluate('id=>__sketchRpgDebug.bossHp(id)',boss_id)
            suite.check('a drawn flame summon hurts the flame-weak boss',flame is not None and flame['kind']=='flame' and after_flame['hp']<720-30,{'shot':flame and flame['kind'],'hp':after_flame})
            # Free order, enforced by the seal: any site wakes its boss; the HUD says it is sealed; fall order unseals the next.
            await page.evaluate("""() => {const d=__sketchRpgDebug,s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
              s.world.enemies=[];s.world.summons=[];s.world.hazards=[];s.world.pickups=[];s.world.bossesDefeated=0;s.world.bossState=[0,0,0,0,0];s.world.nests=s.world.nests.map(q=>({...q,on:false,done:true}));d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));d.invulnerable();}""")
            sites=state['sites']
            await page.evaluate('s=>__sketchRpgDebug.moveTo(s.x,s.y)',sites[2])
            await page.wait_for_function('__sketchRpgDebug.bossState().active?.bossId==2',timeout=4000)
            hud=await page.evaluate("({quest:document.getElementById('questText').textContent,sealed:__sketchRpgDebug.bossState().sealed[2]})")
            suite.check('standing at boss site 3 wakes boss 3 sealed (no order lock, but a −90% seal with an on-screen hint)',hud['sealed'] and '봉인' in hud['quest'],hud)
            await page.screenshot(path=str(ARTIFACTS/'boss-sealed-desktop.png'))
            await page.evaluate("""() => {const d=__sketchRpgDebug,s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));s.world.enemies=[];s.world.bossState=[0,0,0,0,0];d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));}""")
            order=[]
            for i in range(5):
                await page.evaluate('s=>{__sketchRpgDebug.setPlayerHp(120);__sketchRpgDebug.moveTo(s.x,s.y);}',sites[i])
                await page.wait_for_function(f'__sketchRpgDebug.bossState().active?.bossId=={i}',timeout=4000)
                if i==1:
                    await page.wait_for_function("n=>document.getElementById('bossName').textContent.includes(n)",arg=profiles[1]['name'],timeout=4000)
                    hud=await page.evaluate("({shown:getComputedStyle(document.getElementById('bossBar')).display,name:document.getElementById('bossName').textContent,rule:document.getElementById('bossRule').textContent,quest:document.getElementById('questTitle').textContent})")
                    suite.check('boss bar shows the name, order and rule text',hud['shown']!='none' and profiles[1]['name'] in hud['name'] and '2/5' in hud['name'] and hud['rule']==profiles[1]['ruleText'],hud)
                    await page.screenshot(path=str(ARTIFACTS/'boss-2-desktop.png'))
                await page.evaluate('__sketchRpgDebug.finishBoss()')
                await page.wait_for_function(f'__sketchRpgDebug.snapshot().bossesDefeated=={i+1}',timeout=4000)
                order.append(i)
                if i==1:
                    snapshot=await page.evaluate('(()=>{const w=JSON.parse(new TextDecoder().decode(__sketchRpgDebug.canonicalSnapshot())).world;return [w.bossesDefeated,w.bossState]})()')
                    suite.check('checkpoint carries the defeated count and each boss state',snapshot[0]==2 and snapshot[1][:2]==[2,2],snapshot)
            await page.wait_for_function("document.getElementById('questTitle').textContent.includes('완성')",timeout=4000)
            final=await page.evaluate("({n:__sketchRpgDebug.snapshot().bossesDefeated,quest:document.getElementById('questTitle').textContent,active:__sketchRpgDebug.snapshot().activeBoss})")
            suite.check('defeating all five bosses completes the page',final['n']==5 and final['active'] is None and '완성' in final['quest'] and order==[0,1,2,3,4],final)
            suite.check('boss flow has no JavaScript errors',not issues,issues)
        finally:
            await context.close()


async def run_summons(browser, suite: E2E):
    """Drawn shapes become self-fighting summons: specs, placement, cap, combat, enemy targeting, checkpoint."""
    with local_server() as url:
        context,page,issues=await create_page(browser,width=1024,height=768)
        try:
            await page.goto(f'{url}?seed=20261026')
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            A=await page.evaluate('__sketchRpgDebug.arena()')
            specs=await page.evaluate('__sketchRpgDebug.summonSpecs()')
            kinds=['normal','line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle']
            names=[specs[k]['name'] for k in kinds if k in specs]
            suite.check('every shape kind has its own summon spec',sorted(specs)==sorted(kinds) and len(set(names))==11,sorted(specs))
            anchored=sorted(k for k,v in specs.items() if v['anchored']);taunting=sorted(k for k,v in specs.items() if v['taunt'])
            suite.check('only star and star circle stay in place; only circle and square taunt',anchored==['star','starcircle'] and taunting==['circle','square'],{'anchored':anchored,'taunt':taunting})
            # Every kind summons through the same command path as the net protocol.
            await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy);__sketchRpgDebug.moveTo(__A.x,__A.y);__sketchRpgDebug.setInk(100)")
            # Unlocks: a run starts with circle, triangle and square; a locked shape falls back to the scribble; a boss reward opens one.
            start=await page.evaluate("__sketchRpgDebug.unlockState()")
            suite.check('a run starts with circle, triangle and square open and no reward pending',start['unlocked']==['circle','triangle','square'] and start['reward'] is None,start)
            await page.evaluate("__sketchRpgDebug.castKind('flame',0,120)")
            await page.wait_for_function("__sketchRpgDebug.summons().length>0",timeout=6000)
            locked_kinds=await page.evaluate("__sketchRpgDebug.summons().map(q=>q.kind)")
            suite.check('a locked shape is summoned as the plain scribble instead',locked_kinds==['normal'],locked_kinds)
            await page.evaluate("()=>{const d=__sketchRpgDebug;d.spawnBoss(0);const e=world.enemies.find(x=>x.kind==='boss');damageEnemy(e,1e6,e.x,e.y,'#fff','circle');}")
            await page.wait_for_function("__sketchRpgDebug.unlockState().reward!==null",timeout=4000)
            offer=await page.evaluate("__sketchRpgDebug.unlockState()")
            await page.wait_for_function("!document.getElementById('rewardPanel').hidden",timeout=4000)
            picked=offer['reward']['choices'][0]
            await page.locator(f'#rewardChoices button[data-kind="{picked}"]').click()
            await page.wait_for_function("__sketchRpgDebug.unlockState().reward===null",timeout=4000)
            await page.wait_for_function("document.getElementById('rewardPanel').hidden",timeout=4000)
            after=await page.evaluate("__sketchRpgDebug.unlockState()")
            suite.check('a boss defeat offers three locked shapes; choosing one unlocks it for this run and hides the panel',
                        len(offer['reward']['choices'])==3 and all(k not in start['unlocked'] for k in offer['reward']['choices']) and picked in after['unlocked'] and len(after['unlocked'])==4 and await page.evaluate("document.getElementById('rewardPanel').hidden"),
                        {'offer':offer,'after':after})
            await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy);__sketchRpgDebug.moveTo(__A.x,__A.y);__sketchRpgDebug.setInk(100)")
            await page.evaluate("__sketchRpgDebug.unlockAll()")
            produced=[]
            for kind in [k for k in kinds if k!='line']:
                await page.evaluate("k=>{const d=__sketchRpgDebug;d.setInk(100);d.castKind(k,0,120);}",kind)
                await page.wait_for_function("k=>__sketchRpgDebug.summons().some(q=>q.kind===k)",arg=kind,timeout=4000)
                produced.append(kind)
                await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy)")
            suite.check('the 10 non-line shapes summon their creature (the line is a projectile)',produced==[k for k in kinds if k!='line'],produced)
            # Cap: an eleventh summon replaces the owner's oldest.
            await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy);__sketchRpgDebug.moveTo(__A.x,__A.y)")
            first_ids=[]
            for i in range(11):
                await page.evaluate("()=>{const d=__sketchRpgDebug;d.setInk(100);d.castKind('triangle',i*0.6,120+i*6);}".replace('i*0.6',str(i*0.6)).replace('i*6',str(i*6)))
                await page.wait_for_function(f"__sketchRpgDebug.summons().filter(q=>q.kind==='triangle').length==Math.min({i+1},__sketchRpgDebug.summonLimit())||__sketchRpgDebug.summons().length>={i+1}",timeout=4000)
                await page.wait_for_timeout(300)
                first_ids.append(await page.evaluate("__sketchRpgDebug.summons().map(q=>q.id)"))
            ids=first_ids[-1]
            suite.check('an eleventh summon replaces the oldest, leaving ten',len(ids)==10 and first_ids[9][0] not in ids and await page.evaluate('__sketchRpgDebug.summonLimit()')==10,first_ids[-2:])
            # Units collide: six summons cast onto the same point and an enemy among them are pushed apart.
            await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy);__sketchRpgDebug.moveTo(__A.x,__A.y)")
            for i in range(6):
                await page.evaluate("()=>{const d=__sketchRpgDebug;d.setInk(100);d.castKind('triangle',0,120);}")
                await page.wait_for_timeout(300)
            await page.wait_for_timeout(1500)
            gaps=await page.evaluate("""()=>{const s=__sketchRpgDebug.summons();let min=1e9;for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++)min=Math.min(min,Math.hypot(s[i].x-s[j].x,s[i].y-s[j].y));return {n:s.length,min}}""")
            suite.check('six summons cast onto one point spread apart instead of overlapping',gaps['n']==6 and gaps['min']>=24,gaps)
            # An anchored turret does not move when a mobile summon is cast onto it.
            await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy);__sketchRpgDebug.moveTo(__A.x,__A.y);__sketchRpgDebug.setInk(100);__sketchRpgDebug.castKind('star',0,120)")
            await page.wait_for_timeout(500)
            star0=await page.evaluate("__sketchRpgDebug.summons().find(q=>q.kind==='star')")
            await page.evaluate("__sketchRpgDebug.setInk(100);__sketchRpgDebug.castKind('triangle',0,120)")
            await page.wait_for_timeout(1500)
            star1=await page.evaluate("__sketchRpgDebug.summons().find(q=>q.kind==='star')")
            tri=await page.evaluate("__sketchRpgDebug.summons().find(q=>q.kind==='triangle')")
            dist=((tri['x']-star1['x'])**2+(tri['y']-star1['y'])**2)**.5
            suite.check('an anchored turret keeps its place while a mobile summon is pushed off it',abs(star1['x']-star0['x'])<.5 and abs(star1['y']-star0['y'])<.5 and dist>=24,{'moved':[star1['x']-star0['x'],star1['y']-star0['y']],'dist':dist})
            # Placement follows where the stroke is drawn (real mouse events).
            await page.evaluate("__sketchRpgDebug.combatFixture('chaser',__A.fx,__A.fy);__sketchRpgDebug.moveTo(__A.x,__A.y);__sketchRpgDebug.setInk(100)")
            # One step: the outline alone summons and spends ink; the slider steps set before it are attached and show as the face.
            dock=await set_traits(page,-2,1)
            ink0=await page.evaluate("__sketchRpgDebug.runState().actor.ink")
            max_id=await page.evaluate("Math.max(0,...__sketchRpgDebug.summons().map(q=>q.id))")
            shot=await draw_circle(page,120,'circle',at=[A['x']+150,A['y']])
            await page.wait_for_function("m=>__sketchRpgDebug.summons().some(q=>q.id>m&&q.kind==='circle')",arg=max_id,timeout=6000)
            placed=await page.evaluate("__sketchRpgDebug.summons().filter(q=>q.kind==='circle').at(-1)")
            ink1=await page.evaluate("__sketchRpgDebug.runState().actor.ink")
            suite.check('the sliders show their steps and a face preview before drawing',dock['dockVisible'] and dock['steps']=={'bold':-2,'quick':1} and dock['sliders']==[-2,1] and dock['faceMarks']>=4 and dock['summary'].startswith('이점'),dock)
            suite.check('a body stroke alone summons at once, spends ink, and carries the slider steps',shot is not None and shot['kind']=='circle' and placed['bold']==-2 and placed['quick']==1 and ink1<ink0-10 and abs(placed['x']-(A['x']+150))<45,{'shot':shot and shot['kind'],'steps':[placed['bold'],placed['quick']],'at':[placed['x'],placed['y']],'ink':[ink0,ink1]})
            await set_traits(page,0,0)
            # No direction or distance limit: a body drawn 450 units away (beyond the old 320 reach) appears exactly there.
            await page.evaluate("__sketchRpgDebug.moveTo(__A.x,__A.y);__sketchRpgDebug.setInk(100)")
            max_id=await page.evaluate("Math.max(0,...__sketchRpgDebug.summons().map(q=>q.id))")
            far_shot=await draw_circle(page,120,'triangle',at=[A['x']+450,A['y']])
            await page.wait_for_function("m=>__sketchRpgDebug.summons().some(q=>q.id>m&&q.kind==='triangle')",arg=max_id,timeout=6000)
            far=await page.evaluate("__sketchRpgDebug.summons().filter(q=>q.kind==='triangle').at(-1)")
            suite.check('a body drawn 450 units away is summoned exactly there, not clamped toward the player',far_shot is not None and abs(far_shot['x']-(A['x']+450))<60 and abs(far_shot['y']-A['y'])<60 and far['x']>A['x']+320 and 'aim' not in far_shot and 'reach' not in far_shot,{'shot':[far_shot and far_shot['x'],far_shot and far_shot['y']],'x':far['x'],'y':far['y'],'keys':sorted(far_shot or {})[:12]})
            # Ink cost.
            cost=await page.evaluate("""()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.fx,__A.fy);d.moveTo(__A.x,__A.y);d.setInk(100);
              const shot=d.spellSpec(d.sample('triangle',180,180));d.castKind('triangle',0,120);return {area:shot.areaPower};}""")
            await page.wait_for_function("__sketchRpgDebug.summons().some(q=>q.kind==='triangle')&&__sketchRpgDebug.runState().actor.ink<100",timeout=6000)
            ink=await page.evaluate("__sketchRpgDebug.runState().actor.ink")
            suite.check('one triangle spends 58-78 ink of 100: a second one is not affordable at once',15<ink<48,ink)
            # The line is the only projectile: no face step, fired along the drawn direction, hurts what it crosses.
            await page.evaluate("()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.x+220,__A.y);d.moveTo(__A.x,__A.y);d.setInk(100);d.setPlayerHp(120);}")
            await page.wait_for_timeout(120)
            hp0=await page.evaluate("__sketchRpgDebug.foePositions()[0].hp")
            line_shot=await draw_circle(page,170,'line',at=[A['x']+110,A['y']])
            await page.wait_for_timeout(700)
            line_state=await page.evaluate("({foes:__sketchRpgDebug.foePositions(),ink:__sketchRpgDebug.runState().actor.ink,n:__sketchRpgDebug.summons().length})")
            foe_hp=line_state['foes'][0]['hp'] if line_state['foes'] else 0
            suite.check('a drawn line fires at once: no summon, the foe in its path is hurt, ink is spent',
                        line_shot is not None and line_shot['kind']=='line' and line_state['n']==0 and foe_hp<hp0 and line_state['ink']<100,
                        {'shot':line_shot and line_shot['kind'],'hp0':hp0,'state':line_state})
            # Merging: tier-up (3 of a kind), fusion by recipe (5 pairs), full ink required and spent, other pairs refused, tap-select + star gesture.
            await page.evaluate("__sketchRpgDebug.unlockAll()")
            async def fresh():
                await page.evaluate("()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.fx,__A.fy);d.moveTo(__A.x,__A.y);d.setInk(100);}")
            async def make(kind,reach,angle=0):
                count=len(await page.evaluate("__sketchRpgDebug.mergeUnits()"))
                await page.evaluate("([k,r,a])=>{const d=__sketchRpgDebug;d.setInk(100);d.castKind(k,a,r);}",[kind,reach,angle])
                await page.wait_for_function("n=>__sketchRpgDebug.mergeUnits().length>n",arg=count,timeout=6000)
                return (await page.evaluate("__sketchRpgDebug.mergeUnits()"))[-1]
            await fresh()
            trio=[await make('circle',110,a) for a in (0,2,4)]
            before=await page.evaluate("__sketchRpgDebug.mergeUnits()")
            await page.evaluate("__sketchRpgDebug.setInk(100)")
            await page.evaluate("ids=>__sketchRpgDebug.mergeCommand(ids)",[u['id'] for u in trio])
            await page.wait_for_function("__sketchRpgDebug.mergeUnits().length===1",timeout=4000)
            after=await page.evaluate("({u:__sketchRpgDebug.mergeUnits()[0],ink:__sketchRpgDebug.runState().actor.ink})")
            avg_hp=sum(u['maxHp'] for u in before)/3
            suite.check('three circles at the same tier merge into one tier-2 circle at full hp, x1.8 stats, bigger body, all ink spent',
                        after['u']['kind']=='circle' and after['u']['tier']==2 and abs(after['u']['maxHp']-round(avg_hp*1.8))<=1 and after['u']['hp']==after['u']['maxHp'] and after['u']['r']>before[0]['r'] and after['ink']<60,
                        {'before':before,'after':after})
            await fresh()
            pair=[await make('water',110,0),await make('flame',110,3)]
            await page.evaluate("__sketchRpgDebug.setInk(50)")
            await page.evaluate("ids=>__sketchRpgDebug.mergeCommand(ids)",[u['id'] for u in pair])
            await page.wait_for_timeout(500)
            held=await page.evaluate("__sketchRpgDebug.mergeUnits().map(u=>u.kind)")
            suite.check('merging needs a full ink bar: with half ink nothing merges',sorted(held)==['flame','water'],held)
            await page.evaluate("__sketchRpgDebug.setInk(100)")
            await page.evaluate("ids=>__sketchRpgDebug.mergeCommand(ids)",[u['id'] for u in pair])
            await page.wait_for_function("__sketchRpgDebug.mergeUnits().length===1",timeout=4000)
            steam=await page.evaluate("__sketchRpgDebug.mergeUnits()[0]")
            suite.check('water + flame fuse into a steam spirit whose hp is the sum of both, at full hp',steam['kind']=='steam' and steam['tier']==1 and steam['maxHp']==sum(u['maxHp'] for u in pair) and steam['hp']==steam['maxHp'],{'steam':steam,'pair':pair})
            recipes=await page.evaluate("__sketchRpgDebug.recipes()")
            suite.check('exactly five recipes exist',recipes=={'flame+water':'steam','lightning+water':'storm','circle+square':'fortress','shuriken+triangle':'bladestorm','star+starcircle':'altar'},recipes)
            for a,b in [('lightning','water'),('circle','square'),('shuriken','triangle'),('star','starcircle')]:
                await fresh()
                units=[await make(a,110,0),await make(b,110,3)]
                await page.evaluate("__sketchRpgDebug.setInk(100)")
                await page.evaluate("ids=>__sketchRpgDebug.mergeCommand(ids)",[u['id'] for u in units])
                await page.wait_for_function("__sketchRpgDebug.mergeUnits().length===1",timeout=4000)
                fused=(await page.evaluate("__sketchRpgDebug.mergeUnits()"))[0]['kind']
                suite.check(f'{a} + {b} fuse into {recipes[a+"+"+b if a<b else b+"+"+a]}',fused==recipes[a+'+'+b if a<b else b+'+'+a],fused)
            await fresh()
            odd=[await make('circle',110,0),await make('triangle',110,3)]
            await page.evaluate("__sketchRpgDebug.setInk(100)")
            await page.evaluate("ids=>__sketchRpgDebug.mergeCommand(ids)",[u['id'] for u in odd])
            await page.wait_for_timeout(500)
            kept=await page.evaluate("__sketchRpgDebug.mergeUnits().map(u=>u.kind).sort()")
            suite.check('a pair without a recipe cannot merge',kept==['circle','triangle'],kept)
            # Tap two summons to select them, then draw a star: the same merge through the real input path.
            await fresh()
            duo=[await make('circle',120,0),await make('square',120,3)]
            await page.evaluate("__sketchRpgDebug.setInk(100)")
            for u in duo:
                spot=await page.evaluate("([x,y])=>__sketchRpgDebug.screenAt(x,y)",[u['x'],u['y']])
                await page.mouse.click(spot['x'],spot['y'])
            await page.wait_for_function("document.getElementById('selectText').textContent.includes('성벽 거인')",timeout=3000)
            picked=await page.evaluate("__sketchRpgDebug.selectedUnits()")
            chip_text=await page.locator('#selectText').inner_text()
            suite.check('tapping two summons selects them and the chip names the result',sorted(picked)==sorted(u['id'] for u in duo) and '성벽 거인' in chip_text,{'picked':picked,'chip':chip_text})
            await draw_circle(page,150,'star',at=[A['x'],A['y']-175],tries=1)
            await page.wait_for_function("__sketchRpgDebug.mergeUnits().length===1&&__sketchRpgDebug.mergeUnits()[0].kind==='fortress'",timeout=5000)
            suite.check('drawing a star while two are selected merges them (no star turret is summoned) and clears the selection',(await page.evaluate("__sketchRpgDebug.selectedUnits()"))==[] and await page.locator('#selectChip').is_hidden())
            # Combat: a summon kills a nearby foe while the player stands still.
            await page.evaluate("()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.x+220,__A.y);d.moveTo(__A.x,__A.y);d.setInk(100);d.setPlayerHp(120);d.castKind('triangle',0,160);}")
            await page.wait_for_function("__sketchRpgDebug.foePositions().length===0",timeout=15000)
            hp=await page.evaluate("__sketchRpgDebug.snapshot().player.hp")
            suite.check('a triangle summon kills a hunter on its own while the player stands still',hp>0,hp)
            # Enemies attack the nearest noticed summon before the player.
            await page.evaluate("""()=>{const d=__sketchRpgDebug;d.combatFixture('charger',__A.x+360,__A.y);d.moveTo(__A.x,__A.y);d.setInk(100);d.setPlayerHp(120);d.castKind('circle',0,240);}""")
            await page.wait_for_function("__sketchRpgDebug.summons().some(q=>q.kind==='circle')",timeout=4000)
            await page.wait_for_function("__sketchRpgDebug.summons().find(q=>q.kind==='circle')?.hp<__sketchRpgDebug.summons().find(q=>q.kind==='circle')?.maxHp",timeout=12000)
            php=await page.evaluate("__sketchRpgDebug.snapshot().player.hp")
            suite.check('an enemy near a summon hurts the summon, not the player 240 px away',php==120,php)
            # Temperament sliders: neutral has no traits; every other setting gains in one stat and pays in another.
            table=await page.evaluate("""()=>{const d=__sketchRpgDebug,rows=[];for(let b=-3;b<=3;b++)for(let q=-3;q<=3;q++){const m=d.temperamentFor(b,q),v=Object.values(m);rows.push({b,q,up:v.some(x=>x>1),down:v.some(x=>x<1),flat:v.every(x=>x===1)});}return rows;}""")
            neutral=[r for r in table if r['b']==0 and r['q']==0][0]
            rest=[r for r in table if not(r['b']==0 and r['q']==0)]
            suite.check('neutral steps have no traits; every other slider setting has both an advantage and a disadvantage',neutral['flat'] and all(r['up'] and r['down'] for r in rest) and len(table)==49,[r for r in rest if not(r['up'] and r['down'])][:4])
            # Real sliders and real body strokes: the face steps reach the summon.
            seen={}
            for steps in [(3,0),(-3,2),(0,-3),(0,3)]:
                await page.evaluate("()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.fx,__A.fy);d.moveTo(__A.x,__A.y);d.setInk(100);}")
                await set_traits(page,*steps)
                max_id=await page.evaluate("Math.max(0,...__sketchRpgDebug.summons().map(q=>q.id))")
                await draw_circle(page,120,'triangle',at=[A['x']+110,A['y']])
                await page.wait_for_function("m=>__sketchRpgDebug.summons().some(q=>q.id>m)",arg=max_id,timeout=6000)
                seen[steps]=await page.evaluate("m=>{const q=__sketchRpgDebug.summons().filter(q=>q.id>m).at(-1);return [q.bold,q.quick];}",max_id)
            suite.check('real slider positions and real body strokes give summons with those steps',all(list(k)==v for k,v in seen.items()),{str(k):v for k,v in seen.items()})
            await set_traits(page,0,0)
            # Temperament numbers reach the summon.
            by_steps={}
            for name,steps in {'neutral':(0,0),'bold':(3,0),'drowsy':(0,-3),'quick':(0,3)}.items():
                await page.evaluate("()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.fx,__A.fy);d.moveTo(__A.x,__A.y);d.setInk(100);}")
                await page.evaluate("s=>__sketchRpgDebug.castKind('triangle',0,120,.5,s[0],s[1])",list(steps))
                await page.wait_for_function("__sketchRpgDebug.summons().length>0",timeout=4000)
                by_steps[name]=await page.evaluate("(({maxHp,power})=>({maxHp,power}))(__sketchRpgDebug.summons()[0])")
            base=by_steps['neutral']
            suite.check('temperament multiplies hp and attack power',abs(by_steps['bold']['power']/base['power']-1.3)<.02 and abs(by_steps['bold']['maxHp']/base['maxHp']-.79)<.03 and abs(by_steps['drowsy']['maxHp']/base['maxHp']-1.15)<.03 and abs(by_steps['quick']['maxHp']/base['maxHp']-.85)<.03,by_steps)
            # A step outside -3..3 in a checkpoint is refused.
            refused=await page.evaluate("""()=>{const d=__sketchRpgDebug,s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));s.world.summons[0].bold=9;
              try{d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));return false;}catch(e){return true;}}""")
            suite.check('a checkpoint with an out-of-range temperament step is rejected',refused)
            # Anchored summon never walks.
            await page.evaluate("()=>{const d=__sketchRpgDebug;d.combatFixture('chaser',__A.fx,__A.fy);d.moveTo(__A.x,__A.y);d.setInk(100);d.castKind('star',0,100);}")
            await page.wait_for_function("__sketchRpgDebug.summons().some(q=>q.kind==='star')",timeout=4000)
            a=await page.evaluate("__sketchRpgDebug.summons().find(q=>q.kind==='star')")
            await page.evaluate("([x,y])=>__sketchRpgDebug.spawnEnemy('charger',x+260,y)",[a['x'],a['y']])
            await page.wait_for_timeout(3500)
            b=await page.evaluate("__sketchRpgDebug.summons().find(q=>q.id===%d)"%a['id'])
            suite.check('a star turret stays where it was drawn',b is not None and abs(b['x']-a['x'])<1 and abs(b['y']-a['y'])<1,{'a':[a['x'],a['y']],'b':b and [b['x'],b['y']]})
            # Checkpoint: summons are canonical state and survive restore with the same hash.
            same=await page.evaluate("""()=>{const d=__sketchRpgDebug,s=d.canonicalSnapshot(),before=JSON.parse(new TextDecoder().decode(s)).world.summons.map(q=>q.id).join();
              d.canonicalRestore(s);const t=d.canonicalSnapshot();return {before,after:JSON.parse(new TextDecoder().decode(t)).world.summons.map(q=>q.id).join(),equal:Array.from(s).join()===Array.from(t).join(),n:d.summons().length};}""")
            suite.check('summons are in the checkpoint and restore byte-for-byte',same['n']>0 and same['equal'] and same['before']==same['after'],same)
            await page.screenshot(path=str(ARTIFACTS/'summons-desktop.png'))
            suite.check('summon flow has no JavaScript errors',not issues,issues)
        finally:
            await context.close()


async def run_ink_hud(browser,suite):
    with local_server() as url:
        context,page,issues=await create_page(browser,width=390,height=844,mobile=True)
        try:
            await page.goto(url+'?seed=20261026')
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            await page.evaluate('__sketchRpgDebug.nestFixture(0);__sketchRpgDebug.invulnerable();__sketchRpgDebug.setInk(5)')
            await page.wait_for_timeout(150)
            bar=await page.locator('#inkBar').bounding_box()
            suite.check('390px ink bar is always visible and recovering below maximum',bar['height']>=5 and bar['x']>=0 and bar['x']+bar['width']<=390 and await page.locator('#inkMeter').get_attribute('data-state') in ('recovering','waiting'),{'bar':bar,'state':await page.locator('#inkMeter').get_attribute('data-state')})
            suite.check('390px ink meter and minimap/objective do not overlap',await page.evaluate("""() => {const a=inkMeter.getBoundingClientRect(),b=document.querySelector('.region-status').getBoundingClientRect(),c=document.querySelector('.mini-map').getBoundingClientRect();return a.bottom<b.top&&b.right<c.left;}"""))
            suite.check('removed growth and environment controls are absent from the DOM',await page.locator('#growthButton,#growthModal,#environmentButton,#investButton').count()==0)
            await page.screenshot(path=str(ARTIFACTS/'ink-low-mobile.png'))
            await page.evaluate('window.__zeroInk=setInterval(()=>__sketchRpgDebug.setInk(0),10)')
            region_shot=await draw_circle(page,140,tries=1)
            await page.wait_for_timeout(1200)
            held=await page.evaluate("({n:__sketchRpgDebug.summons().length,casts:__sketchRpgDebug.castInProgress()})")
            await page.evaluate('clearInterval(window.__zeroInk)')
            suite.check('with no ink a drawn summon stays pending (drawing kept, not lost)',region_shot is not None and held['n']==0 and held['casts']==1,{'shot':bool(region_shot),'held':held})
            await page.wait_for_function("__sketchRpgDebug.summons().length==1",timeout=8000)
            suite.check('the pending summon appears once ink has refilled',True)
            suite.check('ink HUD flow has no JavaScript error',not issues,issues)
            # Run end: a solo defeat freezes the field and shows the result panel with a restart button; no village revive.
            await page.evaluate("()=>{world.mode='playing';player.invulMs=0;player.hp=50;takeDamage(9999,null,null);}")
            await page.wait_for_function("!document.getElementById('runEnd').hidden",timeout=4000)
            over=await page.evaluate("({mode:world.mode,title:runEndTitle.textContent,stats:runEndStats.textContent,hp:player.hp})")
            await page.wait_for_timeout(2500)
            still=await page.evaluate("({mode:world.mode,hp:player.hp})")
            suite.check('a solo defeat ends the run: result panel with boss/kill/unlock/time stats, mode stays over, no revive',
                        over['mode']=='over' and '보스 0/5' in over['stats'] and '해금 도형 0개' in over['stats'] and still['mode']=='over' and still['hp']==0,{'over':over,'still':still})
            await page.evaluate("()=>{world.mode='playing';player.hp=100;player.invulMs=0;const d=__sketchRpgDebug;d.spawnBoss(4);const e=world.enemies.find(x=>x.kind==='boss');damageEnemy(e,1e6,e.x,e.y,'#fff','shuriken');}")
            await page.wait_for_function("world.mode==='clear'",timeout=4000)
            await page.wait_for_function("runEndTitle.textContent.includes('되찾')",timeout=4000)
            clear=await page.evaluate("({title:runEndTitle.textContent,stats:runEndStats.textContent,reward:world.reward})")
            suite.check('defeating the fifth boss clears the run: victory title, 5/5, no reward pending',clear['title'].startswith('스케치 타운')and '보스 5/5' in clear['stats'] and clear['reward'] is None,clear)
        finally:
            await context.close()


async def run_run_state(browser, suite: E2E):
    with local_server() as url:
        context, page, issues = await create_page(browser, width=1024, height=768)
        try:
            await page.goto(url+'?seed=20261026')
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            initial=await page.evaluate('__sketchRpgDebug.runState()')
            suite.check('new run starts with zero card ranks and base maximum ink',initial['actor']['maxInk']==100 and all(v==0 for v in initial['cards'].values()),initial['cards'])
            await page.evaluate("__sketchRpgDebug.cardFixture('inkMax')")
            applied=await page.evaluate('__sketchRpgDebug.runState().actor')
            suite.check('card rank raises derived maximum ink by one step',applied['maxInk']==115 and applied['cards']['inkMax']==1,applied)
            capped=await page.evaluate("[1,2,3,4,5,6].map(()=>__sketchRpgDebug.cardFixture('attack'))")
            suite.check('card rank stops at five',capped==[True,True,True,True,True,False],capped)
            await page.reload()
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            reloaded=await page.evaluate('__sketchRpgDebug.runState()')
            suite.check('reload starts a new run without saved card ranks',reloaded['actor']['maxInk']==100 and all(v==0 for v in reloaded['cards'].values()),reloaded['cards'])
            members=await page.evaluate('__sketchRpgDebug.nestFixture(0);__sketchRpgDebug.invulnerable();__sketchRpgDebug.foePositions().length')
            await page.wait_for_timeout(160)
            for _attempt in range(4):
                # a lone summon can die before the fifth kill; recast like a player would
                await page.evaluate('__sketchRpgDebug.setInk(100)')
                await draw_circle(page)
                try:
                    await page.wait_for_function(f'__sketchRpgDebug.runState().regionKills[0]>={members}',timeout=25000)
                    break
                except Exception:
                    if _attempt==3:raise
            suite.check('real attack clears a coast-zone mob nest and counts every kill in its zone',True)
            await page.set_viewport_size({'width':390,'height':844})
            members2=await page.evaluate('__sketchRpgDebug.nestFixture(1);__sketchRpgDebug.invulnerable();__sketchRpgDebug.setInk(100);__sketchRpgDebug.foePositions().length')
            await page.wait_for_function("(()=>{const d=__sketchRpgDebug,f=d.foePositions()[0];if(!f)return false;const c=d.screenAt(f.x,f.y);return c.x>40&&c.x<350&&c.y>120&&c.y<740})()",timeout=30000)
            pre=await page.evaluate("(()=>{const d=__sketchRpgDebug,f=d.foePositions()[0],c=d.screenAt(f.x,f.y);const e=document.elementFromPoint(c.x,c.y);return JSON.stringify({c,w:innerWidth,el:e&&(e.id||e.className),ink:d.snapshot().ink,sc:d.snapshot().summonCount,steps:d.traitState().steps})})()")
            region_shot=await draw_circle(page,140)
            suite.check('resized nest fixture queues the actual circle stroke',region_shot is not None and region_shot['kind']=='circle',region_shot or pre+await page.evaluate("JSON.stringify({d:__sketchRpgDebug.traitState(),chip:document.getElementById('resultChip').innerText,s:__sketchRpgDebug.snapshot().modal})"))
            if region_shot is None:return
            await page.wait_for_function(f'__sketchRpgDebug.runState().regionKills[1]>={members2}',timeout=90000)
            suite.check('each zone counts its own defeated enemies',await page.evaluate('__sketchRpgDebug.runState().regionKills.slice(0,2).every(n=>n>=3)'))
            suite.check('run state workflow has no JavaScript errors',not issues,issues)
        finally:
            await context.close()


async def run_real_p2p(browser, suite: E2E):
    # No fake Nostr discovery, no stub transport, no injected GameKit facade.
    with local_server() as url:
        host_context, host, host_errors = await create_page(browser, width=1024, height=768)
        guest_context, guest, guest_errors = await create_page(browser, width=390, height=844, mobile=True)
        async def report_cast_diagnostic(stage):
            diagnostics=await asyncio.gather(*(p.evaluate("""() => ({
              drawing:__sketchRpgDebug.drawingState(),multiplayer:__sketchRpgDebug.multiplayerState(),
              audit:__sketchRpgDebug.inputAudit(),preview:__sketchRpgDebug.previewInfo(),
              pending:__sketchRpgDebug.pendingCommands(),snapshot:__sketchRpgDebug.snapshot(),
              castAim:window.castReleasedAim,castStarted:window.castSampleStarted,
              casts:JSON.parse(new TextDecoder().decode(__sketchRpgDebug.canonicalSnapshot())).world.casts
                .map(c=>({owner:c.owner,ageMs:c.ageMs,durationMs:c.durationMs,x:c.shot?.x,y:c.shot?.y}))})""") for p in (host,guest)))
            print('REAL_CAST_DIAGNOSTIC',json.dumps({'stage':stage,'peers':diagnostics},ensure_ascii=False),flush=True)
            for name,page in (('host',host),('guest',guest)):
                await page.screenshot(path=str(ARTIFACTS/f'real-cast-{stage}-{name}.png'))
        async def ensure_multiplayer_modal(page):
            modal=page.locator('#multiplayerModal')
            if not await modal.is_visible():
                try:
                    await open_menu(page)
                    await page.locator('#multiplayerButton').click(no_wait_after=True,timeout=5000)
                except Exception:
                    if not await modal.is_visible():
                        raise
            await modal.wait_for(state='visible',timeout=5000)
        try:
            await asyncio.gather(host.goto(url, wait_until="load"), guest.goto(url, wait_until="load"))
            await asyncio.gather(
                host.wait_for_function("window.__sketchRpgDebug!==undefined", timeout=20000),
                guest.wait_for_function("window.__sketchRpgDebug!==undefined", timeout=20000),
            )
            await host.evaluate("""() => {const d=__sketchRpgDebug;d.moveTo(__A.x+400,__A.y);
              const s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
              s.actors[1].x=__A.x+400;s.actors[1].y=__A.y+25;s.world.enemies=[];s.world.hazards=[];s.world.nests=s.world.nests.map(q=>({...q,on:false,done:true}));
              d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));}""")
            code = str(secrets.randbelow(10000)).zfill(4)
            await open_menu(host)
            await host.locator("#multiplayerButton").click()
            await host.locator("#mpRoomInput").fill(code)
            await host.locator("#mpHost").click()
            await host.wait_for_function("window.__sketchRpgDebug.multiplayerState().connected", timeout=60000)
            await open_menu(guest)
            await guest.locator("#multiplayerButton").click()
            await guest.locator("#mpRoomInput").fill(code)
            await guest.locator("#mpJoin").click()
            await asyncio.gather(*(
                page.wait_for_function("""() => {
                  const s=window.__sketchRpgDebug.multiplayerState();
                  return s.connected && s.shared && s.players===2 && s.sessionMode==='rollback' && s.tickRate===30;
                }""", timeout=60000) for page in (host, guest)
            ))
            suite.check("actual public Nostr + WebRTC join + GameKit rollback admission", True)
            for page in (host, guest):
                cdp=await page.context.new_cdp_session(page)
                await cdp.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
            if suite.flow!='online':
                await guest.evaluate("""() => {
                  window.inputTiming={};
                  const send=RTCDataChannel.prototype.send;
                  RTCDataChannel.prototype.send=function(data){
                    if(inputTiming.eventAt && !inputTiming.sendAt) inputTiming.sendAt=performance.now();
                    if(window.delayInputUntil>performance.now()) {
                      const copy=data instanceof ArrayBuffer?data.slice(0):ArrayBuffer.isView(data)?data.slice():data;
                      setTimeout(()=>{if(this.readyState==='open'){send.call(this,copy);send.call(this,copy);}},700);
                    } else send.call(this,data);
                  };
                  let before,tick;
                  document.addEventListener('keydown',()=>{
                    inputTiming={eventAt:performance.now()};
                    before=__sketchRpgDebug.previewInfo();tick=__sketchRpgDebug.multiplayerState().tick;
                  },true);
                  document.addEventListener('keydown',()=>{
                    const after=__sketchRpgDebug.previewInfo();
                    inputTiming.immediatePreview=after.metrics.previewPublishes>before.metrics.previewPublishes;
                    inputTiming.sameAuthorityTick=__sketchRpgDebug.multiplayerState().tick===tick;
                    inputTiming.preview=after;
                    const x=before.x;
                    const frame=()=>{const v=__sketchRpgDebug.previewInfo();
                      if(v.x!==null&&Math.abs(v.x-x)>.1)inputTiming.previewAt=performance.now();
                      else if(performance.now()-inputTiming.eventAt<1500)requestAnimationFrame(frame);
                    };requestAnimationFrame(frame);
                  });
                }""")
                before = await guest.evaluate("window.__sketchRpgDebug.multiplayerState().guest.x")
                await guest.keyboard.down("d")
                await guest.wait_for_function("""x => window.__sketchRpgDebug.multiplayerState().guest.x > x+5""", arg=before, timeout=7000)
                await host.wait_for_function("""x => window.__sketchRpgDebug.multiplayerState().guest.x > x+5""", arg=before, timeout=14000)
                suite.check("actual guest input replicates through P2P rollback", True)
                await guest.wait_for_function("window.inputTiming.previewAt", timeout=5000)
                timing=await guest.evaluate("window.inputTiming")
                suite.check("DOM input sends before next simulation tick", timing['sendAt']-timing['eventAt']<1000/30, timing)
                suite.check("local preview responds without waiting for authority", timing['immediatePreview'] and timing['sameAuthorityTick'], timing)
                await guest.keyboard.up("d")
                await guest.wait_for_timeout(800)
                suite.check("guest walking does not apply movement input to host", await host.evaluate("window.__sketchRpgDebug.multiplayerState().host.moveX===0 && window.__sketchRpgDebug.multiplayerState().host.moveY===0"))
                # The injected duplicate must arrive beyond the 8-tick reservation horizon (~267 ms at 30 TPS).
                rolls=await host.evaluate("window.__sketchRpgDebug.multiplayerState().stats.rollbacks||0")
                await guest.evaluate("window.delayInputUntil=performance.now()+2000")
                await guest.keyboard.down("a")
                await guest.keyboard.press("Space")
                await guest.wait_for_timeout(180)
                await guest.keyboard.up("a")
                try:
                    await host.wait_for_function("n => (window.__sketchRpgDebug.multiplayerState().stats.rollbacks||0)>n", arg=rolls, timeout=8000)
                except Exception:
                    details=await asyncio.gather(*(p.evaluate("""() => ({
                      state:__sketchRpgDebug.multiplayerState(),audit:__sketchRpgDebug.inputAudit(),
                      preview:__sketchRpgDebug.previewInfo(),commands:__sketchRpgDebug.pendingCommands(),
                      delayedUntil:window.delayInputUntil||0,now:performance.now(),
                      keyA:__sketchRpgDebug.multiplayerState().guest.moveX})""") for p in (host,guest)))
                    print('LATE_INPUT_ROLLBACK_DIAGNOSTIC',json.dumps({'beforeRollbacks':rolls,'peers':details},ensure_ascii=False),flush=True)
                    for name,page in (('host',host),('guest',guest)):
                        await page.screenshot(path=str(ARTIFACTS/f'late-input-rollback-{name}.png'))
                    raise
                await host.wait_for_function("window.__sketchRpgDebug.multiplayerState().stats.reconciled>0", timeout=5000)
                await guest.evaluate("window.delayInputUntil=0")
                await guest.wait_for_timeout(650)
                states=await asyncio.gather(*(p.evaluate("window.__sketchRpgDebug.multiplayerState()") for p in (host,guest)))
                audits=await asyncio.gather(*(p.evaluate("window.__sketchRpgDebug.inputAudit()") for p in (host,guest)))
                reservations={c['sequence']:c['executeTick'] for entry in audits[1]['submitted'] for c in entry['commands']}
                for audit in audits:
                    executed=audit['executed']
                    suite.check("commands keep reserved T through execution and replay", bool(executed) and all(e['tick']==e['executeTick']==reservations[e['sequence']] for e in executed), executed)
                    normal=[e['sequence'] for e in executed if not e['replay']]
                    suite.check("duplicate packets do not execute a command twice outside replay",len(normal)==len(set(normal)),normal)
                boundary=min(s['confirmedTick'] for s in states)
                hashes=await asyncio.gather(*(p.evaluate("t=>window.__sketchRpgDebug.stateHash(t)",boundary) for p in (host,guest)))
                suite.check("late duplicated RTC input reconciles to equal confirmed hash",hashes[0] is not None and hashes[0]==hashes[1],{'tick':boundary,'hashes':hashes,'rollbacks':[s['stats'].get('rollbacks',0) for s in states]})
                suite.check("both peers use pinned protocol 3 bundle",all(s['gamekitSHA']=='418e17c455db56d6ed073d82d115191d9dd8bf04' and s['namespace']=='sketch-town-coop-0.24.0' and s['simulationVersion'].startswith('sketch-town-0.24.0-') and s['inputScheduling']=='network' and s['inputHz']==60 for s in states))
                for sender,actor in ((host,'a'),(guest,'b')):
                    for page in (host,guest):
                        await page.evaluate("""actor => {
                          window.castFrames=[];window.castTelemetry=[];window.shotFrames=[];window.aimFrames=[];
                          window.castSampleStarted=false;window.castSampleDone=false;window.castReleasedAim=null;
                          const sample=()=>{
                            const d=__sketchRpgDebug,snapshot=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
                            const cast=snapshot.world.casts.find(c=>c.owner===actor);
                            const actors=d.renderedActors(),localActor=actors.find(p=>p.id===actor);
                            if(cast&&castReleasedAim===null)castReleasedAim=cast.shot?.x??null;
                            if(!castSampleStarted&&(cast||localActor?.castActive)){
                              castSampleStarted=true;window.castSampleEnd=performance.now()+1400;
                            }
                            if(castSampleStarted){
                              const state=d.snapshot(),mp=d.multiplayerState(),audit=d.inputAudit();
                              const executed=new Set(audit.executed.filter(e=>!e.replay).map(e=>e.sequence));
                              const pending=audit.submitted.flatMap(s=>s.commands).filter(c=>!executed.has(c.sequence));
                              castFrames.push(actors);
                              castTelemetry.push({at:performance.now(),tick:mp.tick,snapshotTick:state.tick,confirmedTick:mp.confirmedTick,
                                casts:state.castCount,castQueue:state.castQueueCount,
                                worldCasts:snapshot.world.casts.filter(c=>c.owner===actor).map(c=>({ageMs:c.ageMs,durationMs:c.durationMs,kind:c.shot?.kind})),actors,
                                pendingInputs:pending.map(c=>({sequence:c.sequence,executeTick:c.executeTick})),pendingCommands:d.pendingCommands(),
                                submittedCount:audit.submitted.length,executedCount:audit.executed.length,
                                lastSubmitted:audit.submitted.at(-1)?.commands.map(c=>({sequence:c.sequence,executeTick:c.executeTick})),
                                lastExecuted:audit.executed.at(-1)?{sequence:audit.executed.at(-1).sequence,tick:audit.executed.at(-1).tick,playerId:audit.executed.at(-1).playerId,replay:audit.executed.at(-1).replay}:null});
                              shotFrames.push(d.presentedSummons());aimFrames.push(d.summons());
                              if(performance.now()>=window.castSampleEnd){window.castSampleDone=true;return;}
                            }
                            requestAnimationFrame(sample);
                          };sample();
                        }""",actor)
                    before_audits=await asyncio.gather(*(p.evaluate("window.__sketchRpgDebug.inputAudit()") for p in (host,guest)))
                    # A closed user stroke produces a long enough cast clip to observe on
                    # the delayed remote presentation timeline as well as the local preview.
                    x,y=(690,310) if actor=='a' else (245,340)
                    stroke=await sender.evaluate("""({x,y})=>Array.from({length:49},(_,i)=>{
                      const angle=2*Math.PI*i/48;
                      return {x:x+36*Math.cos(angle),y:y+36*Math.sin(angle)};
                    })""",{'x':x,'y':y})
                    await sender.mouse.move(stroke[0]['x'],stroke[0]['y'])
                    await sender.mouse.down()
                    for point in stroke[1:]:
                        await sender.mouse.move(point['x'],point['y'])
                    before_release_aim=await sender.evaluate("window.__sketchRpgDebug.drawingState().world.x")
                    await sender.mouse.up()
                    sender_index=0 if actor=='a' else 1
                    before_submissions=len(before_audits[sender_index]['submitted'])
                    try:
                        await sender.wait_for_function("n=>window.__sketchRpgDebug.inputAudit().submitted.length>n",arg=before_submissions,timeout=3000)
                    except Exception:
                        await report_cast_diagnostic(f'{actor}-submit')
                        raise
                    try:
                        await host.wait_for_function("actor=>JSON.parse(new TextDecoder().decode(__sketchRpgDebug.canonicalSnapshot())).world.casts.some(c=>c.owner===actor)",arg=actor,timeout=3000)
                    except Exception:
                        await report_cast_diagnostic(f'{actor}-world-cast')
                        raise
                    try:
                        await asyncio.gather(*(p.wait_for_function("window.castSampleStarted===true",timeout=3000) for p in (host,guest)))
                    except Exception:
                        await report_cast_diagnostic(f'{actor}-sample-start')
                        raise
                    try:
                        await host.wait_for_function("window.castReleasedAim!==null",timeout=3000)
                    except Exception:
                        await report_cast_diagnostic(f'{actor}-authoritative-aim')
                        raise
                    released_aim=await host.evaluate("window.castReleasedAim")
                    suite.check('RTC command freezes the actual drawing aim: '+actor,abs(released_aim-before_release_aim)<1e-10)
                    try:
                        await asyncio.gather(*(p.wait_for_function("window.castSampleDone===true",timeout=3000) for p in (host,guest)))
                    except Exception:
                        await report_cast_diagnostic(f'{actor}-sample-window')
                        raise
                    animation_diagnostics=[]
                    animation_results=[]
                    for page in (host,guest):
                        frames=await page.evaluate("window.castFrames")
                        telemetry=await page.evaluate("window.castTelemetry")
                        shots=await page.evaluate("window.shotFrames.flat()")
                        aimed=await page.evaluate("window.aimFrames.flat()")
                        suite.check('online cast summons the same creature for its owner on both peers: '+actor,
                                    any(p['owner']==actor for p in aimed),{'samples':len(aimed),'owners':sorted({p['owner'] for p in aimed})})
                        suite.check("presented summons are drawn on both peers", bool(shots), {'samples':len(shots)})
                        condition=any(p['id']==actor and p['castActive'] for f in frames for p in f) and not any(p['id']!=actor and p['castActive'] for f in frames for p in f)
                        animation_results.append(condition)
                        animation_diagnostics.append({'frames':len(frames),'activeFrames':[
                            {'at':sample['at'],'tick':sample['tick'],'snapshotTick':sample['snapshotTick'],
                             'confirmedTick':sample['confirmedTick'],'casts':sample['casts'],'castQueue':sample['castQueue'],
                             'worldCasts':sample['worldCasts'],
                             'actors':[{'id':p['id'],'castActive':p['castActive'],'clip':p.get('currentClip'),
                                        'expression':p.get('currentExpression'),'x':p['x'],'y':p['y']} for p in sample['actors']],
                             'pendingInputs':sample['pendingInputs'],'pendingCommands':sample['pendingCommands'],
                             'submittedCount':sample['submittedCount'],'executedCount':sample['executedCount'],
                             'lastSubmitted':sample['lastSubmitted'],'lastExecuted':sample['lastExecuted']}
                            for sample in telemetry if any(p['castActive'] for p in sample['actors'])],
                            'first':telemetry[0] if telemetry else None,'last':telemetry[-1] if telemetry else None})
                    for peer_index,condition in enumerate(animation_results):
                        suite.check("only casting actor animates: "+actor,condition,
                                    {'actor':actor,'peerIndex':peer_index,'peers':animation_diagnostics})
                    after_audits=await asyncio.gather(*(p.evaluate("window.__sketchRpgDebug.inputAudit()") for p in (host,guest)))
                    sender_index=0 if actor=='a' else 1
                    submitted=[c for entry in after_audits[sender_index]['submitted'][len(before_audits[sender_index]['submitted']):] for c in entry['commands']]
                    suite.check('real drawing release submits exactly one RTC cast: '+actor,len(submitted)==1)
                    sequence=submitted[0]['sequence']
                    executions=[]
                    for i,audit in enumerate(after_audits):
                        new=audit['executed'][len(before_audits[i]['executed']):]
                        normal=[e for e in new if e['sequence']==sequence and not e['replay']]
                        suite.check('real drawing cast executes once on peer '+str(i)+': '+actor,len(normal)==1,normal)
                        executions.append(normal[0])
                    suite.check('both peers attribute drawing cast to the same attacker: '+actor,executions[0]['playerId']==executions[1]['playerId'])
                states=await asyncio.gather(*(p.evaluate("window.__sketchRpgDebug.multiplayerState()") for p in (host,guest)))
                boundary=min(s['confirmedTick'] for s in states)
                hashes=await asyncio.gather(*(p.evaluate("t=>window.__sketchRpgDebug.stateHash(t)",boundary) for p in (host,guest)))
                suite.check('both real drawing casts finish with matching confirmed state',hashes[0] is not None and hashes[0]==hashes[1],{'tick':boundary,'hashes':hashes})
            await ensure_multiplayer_modal(guest)
            await guest.locator('#mpLeave').click()
            try:
                await guest.wait_for_function('window.__sketchRpgDebug!==undefined && !__sketchRpgDebug.multiplayerState().connected',timeout=20000)
            except Exception:
                diagnostics=await asyncio.gather(*(p.evaluate("""() => ({
                  multiplayer:__sketchRpgDebug.multiplayerState(),
                  modalVisible:document.getElementById('multiplayerModal')?.classList.contains('open'),
                  modalText:document.getElementById('multiplayerModal')?.innerText,
                  leaveText:document.getElementById('mpLeave')?.innerText,
                  progressText:document.getElementById('mpProgress')?.innerText,
                  location:location.href
                })""") for p in (host,guest)))
                print('LEAVE_DIAGNOSTIC',json.dumps(diagnostics,ensure_ascii=False),flush=True)
                for name,page in (('host',host),('guest',guest)):
                    await page.screenshot(path=str(ARTIFACTS/f'leave-failed-{name}.png'))
                raise
            try:
                await host.wait_for_function('__sketchRpgDebug.multiplayerState().players===1 && !__sketchRpgDebug.multiplayerState().shared',timeout=20000)
                suite.check('guest leave commits to the host roster before rejoining',True)
            except Exception:
                diagnostic=await host.evaluate("({state:__sketchRpgDebug.multiplayerState(),progress:document.getElementById('mpProgress').innerText})")
                print('LEAVE_ROSTER_DIAGNOSTIC',json.dumps(diagnostic,ensure_ascii=False),flush=True)
                await host.screenshot(path=str(ARTIFACTS/'leave-roster-failed-host.png'))
                suite.check('guest leave commits to the host roster before rejoining',False,diagnostic)
            await ensure_multiplayer_modal(guest)
            await guest.locator('#mpRoomInput').fill(code)
            await guest.locator('#mpJoin').click()
            try:
                await asyncio.gather(*(p.wait_for_function('__sketchRpgDebug.multiplayerState().shared',timeout=60000) for p in (host,guest)))
            except Exception:
                diagnostics=await asyncio.gather(*(p.evaluate("({state:__sketchRpgDebug.multiplayerState(),progress:document.getElementById('mpProgress').innerText})") for p in (host,guest)))
                print('REJOIN_DIAGNOSTIC',json.dumps(diagnostics,ensure_ascii=False),flush=True)
                for name,p in (('host',host),('guest',guest)):
                    await p.screenshot(path=str(ARTIFACTS/f'rejoin-failed-{name}.png'))
                raise
            await guest.wait_for_timeout(400)
            states=await asyncio.gather(*(p.evaluate('__sketchRpgDebug.multiplayerState()') for p in (host,guest)))
            boundary=min(s['confirmedTick'] for s in states)
            hashes=await asyncio.gather(*(p.evaluate('t=>__sketchRpgDebug.stateHash(t)',boundary) for p in (host,guest)))
            suite.check('ink/card checkpoint finishes with equal confirmed RTC state',hashes[0] is not None and hashes[0]==hashes[1],{'tick':boundary,'hashes':hashes})
            await host.screenshot(path=str(ARTIFACTS / "rtc-host.png"))
            await guest.screenshot(path=str(ARTIFACTS / "rtc-guest.png"))
            js_error_detail={'errors':(host_errors+guest_errors)[:5],
                             'states':await asyncio.gather(*(p.evaluate('__sketchRpgDebug.multiplayerState()') for p in (host,guest)))}
            suite.check("no JS errors in either online browser", not host_errors and not guest_errors, js_error_detail)
        finally:
            await guest_context.close()
            await host_context.close()


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--headed", action="store_true", help="use with xvfb-run when testing headed SwiftShader")
    parser.add_argument("--live-p2p", action="store_true", help="require actual public Nostr + WebRTC connection, never mock")
    parser.add_argument("--flow", choices=['all','progression','online','ux','map','boss','summon'], default='all', help="select a fixed user workflow within this single entrypoint")
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    suite = E2E(headed=args.headed, live_p2p=args.live_p2p)
    suite.flow=args.flow
    html = HTML_PATH.read_text(encoding="utf-8")
    browser = None
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=not args.headed, executable_path=CHROMIUM or None,
                args=FLAGS, timeout=16000,
            )
            suite.browser=browser.version
            try:
                async def scenarios():
                    if args.flow=='all':
                        await run_desktop(browser, suite, html)
                        await run_mobile(browser, suite, html)
                    if args.flow in ('all','map'):
                        await run_map(browser, suite)
                    if args.flow in ('all','summon'):
                        await run_summons(browser, suite)
                    if args.flow in ('all','boss'):
                        await run_bosses(browser, suite)
                    if args.flow in ('all','ux'):
                        await run_ink_hud(browser,suite)
                    if args.flow in ('all','progression'):
                        await run_run_state(browser, suite)
                    if args.live_p2p or args.flow=='online':
                        await run_real_p2p(browser, suite)
                    else:
                        suite.note("public internet WebRTC connection", "not requested; rerun with --live-p2p (same single E2E)")
                await asyncio.wait_for(scenarios(),timeout=300)
            finally:
                await asyncio.wait_for(browser.close(), timeout=6)
    except Exception as error:
        suite.errors.append({"type":type(error).__name__,"message":str(error)[:2000]})
        print(f"E2E FAILED: {type(error).__name__}: {str(error)[:500]}", flush=True)
    finally:
        result = suite.save()
        print(f"SKETCH TOWN E2E: {result['status']} | {len([x for x in suite.results if x['status']=='PASS'])} PASS | {len([x for x in suite.results if x['status']=='NOT_RUN'])} NOT RUN | {result['elapsed_seconds']}s", flush=True)
    return 0 if not suite.errors else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
