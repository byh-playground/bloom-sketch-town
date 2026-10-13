# SKETCH TOWN · 0.9.2 — 단일 E2E 검증 체계

이번 PATCH는 **단독 플레이에서 WASD·터치 입력을 무시하던 명령 실행 결함**을 수정합니다. `gatherLocalCommands`는 `rollVector`를 생성했지만 단독 `tickCommands`는 `roll`·`dash`만 처리해 버렸습니다. 또한 방향을 `held`만으로 계산해 빠른 키 누름(`pressed`만 남음)은 이전 바라보던 방향으로 굴렀습니다. 단독·멀티가 동일한 `executeRollVector`를 호출하도록 통합하고, 방향 계산은 `held || pressed`를 사용하며, 더 이상 사용하지 않는 이전 명령 경로를 제거했습니다. GameKit `ActionState`와 15TPS/RoomSession/보간 구조는 그대로입니다. 시뮬레이션 버전 `sketch-town-v090-world15-input-preview`는 그대로 유지합니다.

## 남긴 유일한 테스트 진입점

```bash
python source/build_rpg.py
python -m pip install playwright
python -m playwright install chromium
python source/e2e.py
```

GameKit·시뮬레이션·학습 모델을 모의 구현으로 대체하지 않습니다. **실제 Chromium + WebGL1 화면에서** 다음 하나의 연속 사용자 흐름을 실행합니다.

1. 데스크톱 브라우저에서 단일 HTML 진입, WebGL 정점 제출 및 15TPS/60FPS 목표·보간 적용 확인.
2. 마우스로 **실제로 원을 한 획 그림** → CNN 인식 → 실제 전투 적 체력 감소 확인.
3. 게임 진입 직후 D·W·S **짧은 탭** 구르기, 그림 직후 반대 방향 A키 구르기, 캐릭터 지름 3배(96 월드 단위) 거리 확인.
4. 학습 데이터 메뉴에서 방금 그린 원본 한 획 수집 → 실제 PNG 다운로드 → PNG CRC 및 원본 전용 메타데이터 검사.
5. GameKit 롤백용 게임 체크포인트를 저장·복구해 바이트가 동일한지 확인.
6. 모바일 터치 브라우저에서 **실제 화면 탭** → 구르기 및 WebGL 렌더링 확인.

위 흐름은 `source/e2e.py` **단 한 파일에서만** 실행합니다. 기존 `verify_*.py`, `verify_*.mjs`, `verify_*.cjs` 등 별도 테스트 11개를 삭제했습니다. 기존 테스트 결과를 합산해 완료 주장하지 않습니다. 테스트는 `e2e_artifacts/report.json`에 PASS/FAIL/NOT_RUN과 오류 사유를 기록합니다.

### 인터넷 P2P까지 포함하는 같은 E2E

```bash
python source/e2e.py --live-p2p
```

동일한 단일 스크립트에서 **공개 Nostr + 실제 WebRTC + 공식 GameKit 롤백**으로 두 브라우저의 방장/참가자 입장과 게스트 입력 동기화를 확인합니다. 별도 신호 서버·모의 `RoomSession`·가짜 DataChannel은 설치하지 않습니다. CDN/공개 relay/NAT가 차단되거나 WebGL이 없으면 FAIL입니다. `--live-p2p`를 지정하지 않았으면 인터넷 P2P는 명시적으로 `NOT_RUN`으로 남깁니다. 네트워크 검증이 자동으로 통과했다고 주장하지 않습니다.

리눅스 소프트웨어 GPU에서 headed 검증이 필요하면:

```bash
xvfb-run -a python source/e2e.py --headed
```

Windows에서는 `python -m playwright install chromium`으로 Playwright Chromium을 설치한 뒤 기본 명령으로 실행합니다. 필요하면 `SKETCH_CHROMIUM` 환경변수로 브라우저 실행 파일 경로를 명시할 수 있습니다. 브라우저의 WebGL1 초기화 실패를 Canvas2D나 가짜 GPU로 우회하지 않습니다.

## 현재 실행 결과와 제한

현재 `xvfb-run -a python source/e2e.py --headed`를 실제 실행했으며 **Chromium / SwiftShader WebGL1 통합 E2E 18/18 PASS**입니다(64.8초). 렌더 시작·종료 GPU 정점 제출, 실제 WASD 네 방향(짧은 탭 포함), 그림 후 방향 변경, 실제 한 획 시전 피해, 학습 PNG 메타데이터, 저장/복원, 모바일 터치까지 검사했습니다. CPU 기반 소프트웨어 GPU 병목 때문에 검사 중간에는 `pausePainting()`으로 반복 화면 렌더링만 잠시 멈추고 **15TPS 실제 GameKit 시뮬레이션 타이머는 계속 실행**했습니다. 이후 실제 WebGL 렌더링을 다시 켜 GPU 출력을 확인했습니다. P2P 인터넷 연결은 요청하지 않아 `NOT_RUN`이며 실제 멀티플레이 성공으로 확대 해석하지 않습니다. 재현 원본: `e2e_artifacts/report.json`.

단일 HTML은 `Sketch_Town_Topdown_RPG_v0.9.2.html`로 생성됩니다. `source/build_rpg.py`가 정본 생성기이며 입력 코드·학습 데이터·모델은 `source`에 남겨 두었습니다. 디버그 API는 테스트에서 상태 확인과 고정 적 배치에만 사용하며 사용자 제스처·GPU·네트워크 실행을 대체하지 않습니다.
