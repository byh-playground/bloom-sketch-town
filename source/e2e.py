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
ARTIFACTS = ROOT / "e2e_artifacts"
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
    issues = []
    page.on("pageerror", lambda error: issues.append(str(error)))
    return context, page, issues


async def ready_game(page, *, html: str):
    # Rendering MUST be real WebGL. Do not bypass by injecting a fake renderer.
    await page.set_content(html, wait_until="load", timeout=15000)
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


async def draw_circle(page, size=180):
    """Draw directly around the visible foe using real battlefield mouse events."""
    await page.locator('.glyph[data-kind="circle"]').click()
    points = await page.evaluate("""size => {
      const d=window.__sketchRpgDebug,foe=d.foePositions()[0],center=d.screenAt(foe.x,foe.y);
      const points=d.sample('circle',size,size);
      const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
      const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
      return points.map(p=>({x:Math.round(p.x-(minX+maxX)/2)+Math.round(center.x),y:Math.round(p.y-(minY+maxY)/2)+Math.round(center.y)}));
    }""",size)
    await page.mouse.move(points[0]['x'],points[0]['y'])
    await page.mouse.down()
    for point in points[1::max(1, len(points)//44)]:
        await page.mouse.move(point['x'],point['y'])
    await page.mouse.move(points[-1]['x'],points[-1]['y'])
    await page.evaluate("""() => {window.lastGestureShot=null;document.addEventListener('pointerup',()=>{
      window.lastGestureShot=structuredClone(__sketchRpgDebug.queuedShots().at(-1));
    },{once:true});}""")
    await page.mouse.up()
    return await page.evaluate("window.lastGestureShot")


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

        await page.locator('#field').focus()
        idle = await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.keyboard.down('d')
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
          d.moveTo(475,735);d.combatFixture('boss',220,735);d.resumePainting();}""")
        await page.wait_for_timeout(100)
        before_tap=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        await page.mouse.click(710,340)
        await page.wait_for_timeout(100)
        after_tap=await page.evaluate("window.__sketchRpgDebug.snapshot()")
        tap_untouched=(after_tap['player']['x']==before_tap['player']['x'] and
                       after_tap['player']['y']==before_tap['player']['y'] and
                       after_tap['roll']['charges']>=before_tap['roll']['charges'] and
                       after_tap['castCount']==0 and after_tap['projectileCount']==0)
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
        suite.check('release freezes latest visible-player to drawing-center aim',
                    released is not None and abs(released['aim']-held['ink']['aim'])<1e-10, released and {'aim':released['aim'],'visibleAim':held['ink']['aim']})
        await page.keyboard.up('s')
        await page.keyboard.down('a')
        await page.wait_for_function("window.__sketchRpgDebug.shotDetails().length>0",timeout=4000)
        aimed=await page.evaluate("window.__sketchRpgDebug.shotDetails()[0]")
        await page.keyboard.up('a')
        suite.check('projectile keeps released direction and drawn shape despite later movement and nearer enemy',
                    aimed['vx']>0 and abs(aimed['angle']-released['aim'])<1e-10 and aimed['shape']==released['shape'])

        # Interrupted drawings cannot leave a delayed cast or pointer ownership behind.
        await page.evaluate("window.__sketchRpgDebug.combatFixture('boss',1600,735)")
        for interruption in ('blur','modal','resize'):
            await page.mouse.move(700,330)
            await page.mouse.down()
            await page.mouse.move(740,300)
            await page.mouse.move(720,360)
            if interruption=='blur':
                await page.evaluate("window.dispatchEvent(new Event('blur'))")
            elif interruption=='modal':
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
        await page.evaluate("""() => {const d=window.__sketchRpgDebug;d.moveTo(475,735);
          d.combatFixture('boss',650,730);d.renderNow();d.resumePainting();}""")
        hp_before = await page.evaluate("window.__sketchRpgDebug.foePositions()[0].hp")
        suite.gesture_reference=await draw_circle(page)
        await page.wait_for_function("document.getElementById('lastSpell').textContent.includes('원 마법')", timeout=5000)
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
                    and changed['roll']['charges']>=state['roll']['charges'] and changed['castCount']==0 and changed['projectileCount']==0,
                    {'before':state,'after':changed})
        await page.evaluate("window.__sketchRpgDebug.pausePainting()")
        stick=await page.locator('#moveStick').bounding_box()
        button=await page.locator('#rollButton').bounding_box()
        suite.check('mobile stick and roll remain separate from battlefield drawing',
                    stick['x']+stick['width']<=button['x'] and
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


async def draw_gate(page, kind, *, mobile=False, cancel=False, invalid=False, glyph='starcircle', variant='normal',release_barrier=None,before_release=None):
    # Actual one-stroke UI input. The outer circle and star use the existing game reference.
    x = 1450 if kind == 'door' else 2900
    data=await page.evaluate("""data => {
      const sample=__sketchRpgDebug.sample(data.glyph,266,266),box={minX:Math.min(...sample.map(p=>p.x)),maxX:Math.max(...sample.map(p=>p.x)),minY:Math.min(...sample.map(p=>p.y)),maxY:Math.max(...sample.map(p=>p.y))};
      let raw=sample.map(p=>({x:p.x-(box.minX+box.maxX)/2,y:p.y-(box.minY+box.maxY)/2}));
      if(data.glyph==='line'||data.invalid)raw=[{x:-55,y:0},{x:0,y:0},{x:55,y:0}];
      if(data.glyph==='scribble')raw=Array.from({length:40},(_,i)=>({x:Math.sin(i*2.3)*63,y:Math.cos(i*1.7)*63}));
      if(data.glyph==='starcircle'&&data.variant!=='coarse')raw=raw.filter((_,i)=>i%3===0||i>=raw.length-6);
      if(data.variant==='reverse')raw.reverse();
      if(data.variant==='small-rotate')raw=raw.map(p=>({x:(p.x*Math.cos(.53)-p.y*Math.sin(.53))*.78,y:(p.x*Math.sin(.53)+p.y*Math.cos(.53))*.78}));
      if(data.variant==='coarse')raw=raw.filter((_,i)=>i%3===0||i>=raw.length-6).map((p,i)=>({x:p.x+Math.sin(i)*.7,y:p.y+Math.cos(i)*.7}));
      return raw.map(p=>__sketchRpgDebug.screenAt(data.x+p.x,735+p.y));
    }""",{'x':x,'glyph':glyph,'variant':variant,'invalid':invalid})
    if mobile:
        await page.locator('#environmentButton').tap()
    else:
        await page.locator('#field').focus()
        await page.keyboard.press('e')
    await page.wait_for_function('kind=>__sketchRpgDebug.progressionState().environment===kind',arg=kind,timeout=2000)
    if mobile:
        cdp=await page.context.new_cdp_session(page)
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{**data[0],'id':7}]})
        for point in data[1:]:
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{**point,'id':7}]})
        if release_barrier:
            await release_barrier.wait()
        if before_release:
            await before_release()
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel' if cancel else 'touchEnd','touchPoints':[]})
    else:
        await page.mouse.move(data[0]['x'],data[0]['y'])
        await page.mouse.down()
        for point in data[1:]:
            await page.mouse.move(point['x'],point['y'])
        if release_barrier:
            await release_barrier.wait()
        if before_release:
            await before_release()
        if cancel:
            await page.keyboard.press('Escape')
        await page.mouse.up()


async def run_magic_ux(browser,suite):
    with local_server() as url:
        context,page,issues=await create_page(browser,width=1280,height=900)
        try:
            await page.goto(url)
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            await page.evaluate('__sketchRpgDebug.progressionFixture(0)')
            await page.wait_for_timeout(150)
            fixture=await page.evaluate('Array.from(__sketchRpgDebug.canonicalSnapshot())')
            for glyph in ('line','scribble','circle','star'):
                await draw_gate(page,'door',glyph=glyph)
                await page.wait_for_timeout(100)
                state=await page.evaluate('__sketchRpgDebug.progressionState()')
                suite.check('actual gate UI rejects '+glyph+' with no ink cost',not state['gates']['door']['open'] and state['actor']['ink']==100 and state['actor']['inkDelayMs']==0,await page.locator('#resultChip').inner_text())
            for variant in ('normal','reverse','small-rotate','coarse'):
                await page.evaluate('bytes=>__sketchRpgDebug.canonicalRestore(new Uint8Array(bytes))',fixture)
                await page.wait_for_timeout(130)
                await draw_gate(page,'door',variant=variant)
                await page.wait_for_function('__sketchRpgDebug.progressionState().gates.door.open',timeout=3000)
                state=await page.evaluate('__sketchRpgDebug.progressionState()')
                suite.check('actual star-circle gate UI accepts '+variant+' and spends once',abs(state['actor']['ink']-75)<.01 and len(state['gates']['door']['stroke'])>10,state['gates']['door']['owner'])
            await context.close()
            context,page,issues=await create_page(browser,width=390,height=844,mobile=True)
            await page.goto(url)
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            await page.evaluate('bytes=>__sketchRpgDebug.canonicalRestore(new Uint8Array(bytes))',fixture)
            await page.evaluate('__sketchRpgDebug.moveTo(1340,735)')
            await page.wait_for_timeout(130)
            await page.locator('#environmentButton').click()
            await page.evaluate('__sketchRpgDebug.setInk(5)')
            await page.wait_for_function("document.getElementById('inkMeter').dataset.state==='shortage'",timeout=2000)
            bar=await page.locator('#inkBar').bounding_box()
            suite.check('390px ink bar is always visible with shortage and projected spend',bar['height']>=10 and bar['x']>=0 and bar['x']+bar['width']<=390 and await page.locator('#inkMeter').get_attribute('data-state')=='shortage' and '25.0' in await page.locator('#inkEstimate').inner_text(),{'bar':bar,'state':await page.locator('#inkMeter').get_attribute('data-state'),'estimate':await page.locator('#inkEstimate').inner_text()})
            suite.check('390px ink meter and minimap/objective do not overlap',await page.evaluate("""() => {const a=inkMeter.getBoundingClientRect(),b=document.querySelector('.region-status').getBoundingClientRect(),c=document.querySelector('.mini-map').getBoundingClientRect();return a.bottom<b.top&&b.right<c.left;}"""))
            await page.screenshot(path=str(ARTIFACTS/'ink-shortage-mobile.png'))
            await draw_gate(page,'door',glyph='circle',mobile=True)
            await page.wait_for_timeout(200)
            retry=await page.evaluate("({environment:__sketchRpgDebug.progressionState().environment,status:document.getElementById('strokeStatus').innerText,message:document.getElementById('resultChip').innerText})")
            suite.check('mobile incorrect circle keeps faint guide and retry reason',retry['environment']=='door' and '다섯' in retry['status'],retry)
            await page.screenshot(path=str(ARTIFACTS/'magic-retry-mobile.png'))
            await page.evaluate('__sketchRpgDebug.setInk(100)')
            await draw_gate(page,'door',mobile=True,variant='reverse')
            await page.wait_for_function('__sketchRpgDebug.progressionState().gates.door.open',timeout=3000)
            suite.check('actual mobile star-circle creates the completed door',True)
            await page.wait_for_timeout(720)
            await page.screenshot(path=str(ARTIFACTS/'magic-door-mobile.png'))
            await page.locator('#growthButton').click()
            await page.locator('#growthModal').wait_for(state='visible',timeout=2000)
            await page.screenshot(path=str(ARTIFACTS/'growth-ux-mobile.png'))
            ranks_count=await page.locator('.growth-ranks').count()
            invest_visible=await page.locator('#investButton').is_visible()
            investment_dom=await page.evaluate("""() => {
              const modal=document.querySelector('#growthModal'),button=document.querySelector('#investButton');
              const info=el=>{if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);
                return {display:s.display,visibility:s.visibility,opacity:s.opacity,hidden:el.hidden,
                  rect:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom},
                  clientRects:el.getClientRects().length};};
              return {viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},
                modal:{state:window.__sketchRpgDebug.snapshot().modal,...info(modal)},
                ranks:[...document.querySelectorAll('.growth-ranks')].map(info),investButton:info(button),
                investText:button?.innerText,investDisabled:button?.disabled};
            }""")
            suite.check('390px investment keeps graphical ranks and explicit purchase',ranks_count==3 and invest_visible,
                        {'ranksCount':ranks_count,'investVisible':invest_visible,'dom':investment_dom})
            await page.locator('#growthModal [data-close]').click()
            await page.evaluate('__sketchRpgDebug.moveTo(1780,485)')
            await page.locator('#field').focus()
            await page.keyboard.down('w')
            await page.wait_for_timeout(500)
            await page.keyboard.up('w')
            state=await page.evaluate('({player:__sketchRpgDebug.snapshot().player,movement:__sketchRpgDebug.movementState()})')
            suite.check('authored wetland water silhouette blocks actual walking',state['player']['y']>=460 and state['player']['y']<485,state)
            suite.check('new HUD/magic/map flow has no JavaScript error',not issues,issues)
        finally:
            await context.close()


async def run_progression(browser, suite: E2E):
    with local_server() as url:
        context, page, issues = await create_page(browser, width=1024, height=768)
        try:
            await page.goto(url)
            await page.wait_for_function('window.__sketchRpgDebug?.rendererStats().vertices>0')
            await page.locator('#growthButton').click()
            initial = await page.evaluate('__sketchRpgDebug.progressionState()')
            await page.locator('[data-node="inkMax"]').click()
            suite.check('growth selection only inspects; level 1 has one point',
                        initial['points']==1 and await page.evaluate('__sketchRpgDebug.progressionState().points===1'))
            await page.locator('#investButton').click()
            await page.wait_for_function('__sketchRpgDebug.progressionState().actor.maxInk===115')
            suite.check('explicit investment uses one point and shows derived maximum',
                        await page.evaluate('__sketchRpgDebug.progressionState().points===0') and '115' in await page.locator('#growthEffect').inner_text())
            await page.screenshot(path=str(ARTIFACTS/'growth-desktop.png'))
            await page.evaluate('__sketchRpgDebug.setPlayerHp(60);__sketchRpgDebug.setInk(30)')
            await page.locator('#redistributeButton').click()
            await page.wait_for_function('__sketchRpgDebug.progressionState().points===1')
            refunded=await page.evaluate('__sketchRpgDebug.progressionState().actor')
            suite.check('free redistribution never restores current HP or ink',refunded['hp']==60 and refunded['ink']==30 and refunded['maxInk']==100)
            await page.locator('#investButton').click()
            await page.wait_for_function('__sketchRpgDebug.progressionState().points===0')
            await page.wait_for_timeout(180)
            await page.reload()
            await page.wait_for_function('window.__sketchRpgDebug?.progressionState().actor.maxInk===115')
            suite.check('restart preserves saved investment and remaining points',await page.evaluate('__sketchRpgDebug.progressionState().points===0'))
            await page.locator('#growthModal [data-close]').click()
            await page.evaluate('__sketchRpgDebug.progressionCombatFixture(0)')
            await page.wait_for_timeout(160)
            await draw_circle(page)
            await page.wait_for_function('__sketchRpgDebug.progressionState().regionKills[0]===5',timeout=10000)
            suite.check('real attack clears forest before the visible paper-wall door',True)
            await page.evaluate("""() => {const d=__sketchRpgDebug;d.moveTo(1340,735);
              const s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
              s.world.pickups=[];d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));d.setInk(0);}""")
            await page.wait_for_timeout(120)
            await draw_gate(page,'door',cancel=True)
            cancelled=await page.evaluate('__sketchRpgDebug.progressionState()')
            suite.check('cancelled door stroke leaves gate closed without consuming ink',not cancelled['gates']['door']['open'] and cancelled['actor']['inkDelayMs']==0)
            await page.evaluate('__sketchRpgDebug.setInk(0)')
            # Recovery continues during a longer magic-circle stroke. Arrange low ink
            # at the release boundary so the acceptance condition is unambiguous.
            await draw_gate(page,'door',before_release=lambda:page.evaluate('__sketchRpgDebug.setInk(0)'))
            await page.wait_for_timeout(120)
            rejected=await page.evaluate('__sketchRpgDebug.progressionState()')
            message=await page.locator('#resultChip').inner_text()
            suite.check('valid drawing with insufficient ink explains needed amount and wait',not rejected['gates']['door']['open'] and '25.0' in message and '대기' in message,{'state':rejected,'message':message})
            await page.wait_for_function('__sketchRpgDebug.progressionState().actor.ink>=26',timeout=6000)
            await draw_gate(page,'door')
            await page.wait_for_function('__sketchRpgDebug.progressionState().gates.door.open',timeout=3000)
            door=await page.evaluate('__sketchRpgDebug.progressionState()')
            suite.check('basic regeneration enables door and preserves the actual stroke',len(door['gates']['door']['stroke'])>=5 and door['actor']['inkDelayMs']>0)
            await page.keyboard.down('d')
            await page.wait_for_function('__sketchRpgDebug.snapshot().player.x>1540',timeout=3000)
            await page.keyboard.up('d')
            suite.check('completed door changes collision and permits walking into marsh',True)
            await page.set_viewport_size({'width':390,'height':844})
            await page.evaluate('__sketchRpgDebug.progressionCombatFixture(1);__sketchRpgDebug.setInk(100)')
            await page.wait_for_timeout(150)
            region_shot=await draw_circle(page,140)
            suite.check('resized region fixture queues the actual circle stroke',region_shot is not None and region_shot['kind']=='circle',region_shot)
            if region_shot is None:return
            await page.wait_for_function('__sketchRpgDebug.progressionState().regionKills[1]===5',timeout=10000)
            await page.evaluate('__sketchRpgDebug.moveTo(2790,735)')
            await page.wait_for_timeout(150)
            before=await page.evaluate('__sketchRpgDebug.progressionState().actor.ink')
            await draw_gate(page,'bridge',invalid=True)
            invalid=await page.evaluate('__sketchRpgDebug.progressionState()')
            suite.check('incomplete bridge endpoints are rejected without spending ink',not invalid['gates']['bridge']['open'] and invalid['actor']['ink']>=before and '소비 없음' in await page.locator('#resultChip').inner_text())
            await draw_gate(page,'bridge')
            await page.wait_for_function('__sketchRpgDebug.progressionState().gates.bridge.open',timeout=3000)
            suite.check('marsh clear then drawn endpoint connection opens quarry',True)
            await page.keyboard.down('d')
            await page.wait_for_function('__sketchRpgDebug.snapshot().player.x>3000',timeout=3000)
            await page.keyboard.up('d')
            await page.locator('#growthButton').click()
            await page.locator('[data-tab="explore"]').click()
            suite.check('390px exploration tree shows actual prerequisite gates',
                        await page.locator('#growthTree [data-node]').count()==5 and '완료' in await page.locator('[data-node="door"]').inner_text() and '완료' in await page.locator('[data-node="bridge"]').inner_text() and await page.evaluate('document.documentElement.scrollWidth===innerWidth'))
            await page.screenshot(path=str(ARTIFACTS/'growth-mobile.png'))
            await page.locator('[data-tab="ink"]').click()
            await page.locator('[data-node="inkRegen"]').click()
            box=await page.locator('#investButton').bounding_box()
            suite.check('390px stat detail keeps separate investment action visible',box['y']>=0 and box['y']+box['height']<=844 and await page.locator('#investButton').is_enabled())
            await page.screenshot(path=str(ARTIFACTS/'growth-ink-mobile.png'))
            await page.locator('#growthModal [data-close]').click()
            await page.screenshot(path=str(ARTIFACTS/'quarry-mobile.png'))
            suite.check('region/ink/investment workflow has no JavaScript errors',not issues,issues)
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
                .map(c=>({owner:c.owner,ageMs:c.ageMs,durationMs:c.durationMs,aim:c.shot?.aim}))})""") for p in (host,guest)))
            print('REAL_CAST_DIAGNOSTIC',json.dumps({'stage':stage,'peers':diagnostics},ensure_ascii=False),flush=True)
            for name,page in (('host',host),('guest',guest)):
                await page.screenshot(path=str(ARTIFACTS/f'real-cast-{stage}-{name}.png'))
        try:
            await asyncio.gather(host.goto(url, wait_until="load"), guest.goto(url, wait_until="load"))
            await asyncio.gather(
                host.wait_for_function("window.__sketchRpgDebug!==undefined", timeout=20000),
                guest.wait_for_function("window.__sketchRpgDebug!==undefined", timeout=20000),
            )
            for page,tab,node in ((host,'ink','inkMax'),(guest,'combat','attack')):
                await page.locator('#growthButton').click()
                await page.locator(f'[data-tab="{tab}"]').click()
                await page.locator(f'[data-node="{node}"]').click()
                await page.locator('#investButton').click()
                await page.wait_for_function('__sketchRpgDebug.progressionState().points===0')
                await page.locator('#growthModal [data-close]').click()
            await host.evaluate("""() => {const d=__sketchRpgDebug;d.progressionFixture(0);
              const s=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
              s.actors[1].x=1340;s.actors[1].y=760;
              d.canonicalRestore(new TextEncoder().encode(JSON.stringify(s)));}""")
            code = str(secrets.randbelow(10000)).zfill(4)
            await host.locator("#multiplayerButton").click()
            await host.locator("#mpRoomInput").fill(code)
            await host.locator("#mpHost").click()
            await host.wait_for_function("window.__sketchRpgDebug.multiplayerState().connected", timeout=60000)
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
            await guest.wait_for_function('__sketchRpgDebug.progressionState().actor.investments.attack===1',timeout=5000)
            suite.check('start-before-join personal investments survive authoritative admission',
                        await host.evaluate('__sketchRpgDebug.progressionState().actor.investments.inkMax===1') and
                        await guest.evaluate('__sketchRpgDebug.progressionState().actor.investments.attack===1'))
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
                      setTimeout(()=>{if(this.readyState==='open'){send.call(this,copy);send.call(this,copy);}},250);
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
                suite.check("both peers use pinned protocol 3 bundle",all(s['gamekitSHA']=='72b09b260edf9650353017acb49c06873fe9f5a1' and s['namespace']=='sketch-town-coop-0.16.0' and s['simulationVersion'].startswith('sketch-town-0.16.0-') and s['inputScheduling']=='network' and s['inputHz']==60 for s in states))
                for sender,actor in ((host,'a'),(guest,'b')):
                    for page in (host,guest):
                        await page.evaluate("""actor => {
                          window.castFrames=[];window.castTelemetry=[];window.shotFrames=[];window.aimFrames=[];
                          window.castSampleStarted=false;window.castSampleDone=false;window.castReleasedAim=null;
                          const sample=()=>{
                            const d=__sketchRpgDebug,snapshot=JSON.parse(new TextDecoder().decode(d.canonicalSnapshot()));
                            const cast=snapshot.world.casts.find(c=>c.owner===actor);
                            const actors=d.renderedActors(),localActor=actors.find(p=>p.id===actor);
                            if(!castSampleStarted&&(cast||localActor?.castActive)){
                              castReleasedAim=cast?.shot?.aim??null;castSampleStarted=true;window.castSampleEnd=performance.now()+1400;
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
                              shotFrames.push(d.presentedProjectiles());aimFrames.push(d.shotDetails());
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
                    before_release_aim=await sender.evaluate("window.__sketchRpgDebug.drawingState().aim")
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
                    released_aim=await host.evaluate("actor=>JSON.parse(new TextDecoder().decode(__sketchRpgDebug.canonicalSnapshot())).world.casts.find(c=>c.owner===actor).shot.aim",actor)
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
                        suite.check('online cast preserves explicit aim on both peers: '+actor,
                                    bool(aimed) and all(abs(p['angle']-released_aim)<1e-10 for p in aimed),{'samples':len(aimed),'aim':released_aim})
                        suite.check("projectile trail endpoint uses body display time", bool(shots) and all(p.get('head') and abs(p['head']['x']-p['x'])<0.001 and abs(p['head']['y']-p['y'])<0.001 for p in shots), {'samples':len(shots)})
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
            # Both real peers draw the same cleared gate. Only the first accepted command pays.
            await guest.locator('#field').focus()
            await guest.keyboard.down('d')
            await guest.wait_for_function('__sketchRpgDebug.progressionState().actor.x>=1320',timeout=4000)
            await guest.keyboard.up('d')
            await guest.wait_for_timeout(200)
            for page in (host,guest):
                await page.wait_for_function('__sketchRpgDebug.progressionState().actor.ink>=__sketchRpgDebug.progressionState().actor.maxInk-0.01',timeout=5000)
            ink_before_gate=await host.evaluate("""() => JSON.parse(new TextDecoder().decode(__sketchRpgDebug.canonicalSnapshot())).actors
              .map((a,index)=>({index,ink:a.ink,maxInk:a.maxInk,deficit:a.maxInk-a.ink,investments:a.investments}))""")
            release=asyncio.Barrier(2)
            await asyncio.gather(draw_gate(host,'door',release_barrier=release),draw_gate(guest,'door',mobile=True,release_barrier=release))
            await asyncio.gather(*(p.wait_for_function('__sketchRpgDebug.progressionState().gates.door.open',timeout=5000) for p in (host,guest)))
            state=await host.evaluate('JSON.parse(new TextDecoder().decode(__sketchRpgDebug.canonicalSnapshot()))')
            deficit=sum(a['maxInk']-a['ink'] for a in state['actors'])
            ink_after_gate=[{'index':i,'ink':a['ink'],'maxInk':a['maxInk'],'deficit':a['maxInk']-a['ink'],'investments':a['investments']}
                            for i,a in enumerate(state['actors'])]
            suite.check('simultaneous PC/mobile door completion consumes exactly one personal gate cost',abs(deficit-25)<0.01,
                        {'deficit':deficit,'inkBefore':ink_before_gate,'inkAfter':ink_after_gate,'gate':state['world']['gates']['door']})
            if not await guest.locator('#multiplayerModal').is_visible():
                await guest.locator('#multiplayerButton').click(no_wait_after=True)
                await guest.locator('#multiplayerModal').wait_for(state='visible',timeout=5000)
            await guest.locator('#mpLeave').click()
            await guest.wait_for_function('window.__sketchRpgDebug!==undefined && !__sketchRpgDebug.multiplayerState().connected',timeout=10000)
            if not await guest.locator('#multiplayerModal').is_visible():
                await guest.locator('#multiplayerButton').click(no_wait_after=True)
                await guest.locator('#multiplayerModal').wait_for(state='visible',timeout=5000)
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
            await guest.wait_for_function('__sketchRpgDebug.progressionState().actor.investments.attack===1',timeout=5000)
            suite.check('actual reconnect restores shared gate and retains personal investments',await guest.evaluate('__sketchRpgDebug.progressionState().gates.door.open'))
            await guest.wait_for_timeout(400)
            states=await asyncio.gather(*(p.evaluate('__sketchRpgDebug.multiplayerState()') for p in (host,guest)))
            boundary=min(s['confirmedTick'] for s in states)
            hashes=await asyncio.gather(*(p.evaluate('t=>__sketchRpgDebug.stateHash(t)',boundary) for p in (host,guest)))
            suite.check('gate/ink/investment checkpoint finishes with equal confirmed RTC state',hashes[0] is not None and hashes[0]==hashes[1],{'tick':boundary,'hashes':hashes})
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
    parser.add_argument("--flow", choices=['all','progression','online','ux'], default='all', help="select a fixed user workflow within this single entrypoint")
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
                    if args.flow in ('all','ux'):
                        await run_magic_ux(browser,suite)
                    if args.flow in ('all','progression'):
                        await run_progression(browser, suite)
                    if args.live_p2p or args.flow=='online':
                        await run_real_p2p(browser, suite)
                    else:
                        suite.note("public internet WebRTC connection", "not requested; rerun with --live-p2p (same single E2E)")
                await asyncio.wait_for(scenarios(),timeout=180)
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
