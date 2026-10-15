# Sketch Town

그림을 그려 공격하고 길을 여는 BLOOM 기반 액션 게임입니다. WASD·모바일 스틱으로 지역을 자유롭게 탐험하며 숲 → 문 → 습지 → 다리 → 채석장으로 진행합니다. 현재 버전은 **0.16.0**입니다. ChatGPT 원본 0.9.2에서 출발했으며 GameKit protocol 3의 동일 명령·롤백 경로를 사용합니다.

[게임 실행](https://byh-playground.github.io/bloom-sketch-town/)

## 실행과 검증

Node.js 22 이상과 Python 3.10 이상이 필요합니다. `npm ci`로 고정된 SVG 컴파일러 의존성을 설치한 뒤 빌드합니다.

```sh
npm ci
python source/build_rpg.py
python -m http.server 8080
```

http://localhost:8080 에서 실행합니다. 생성되는 `index.html`은 단일 실행 파일입니다. 게임 코드·고정 GameKit 모듈·CNN 데이터의 정본은 `source/`에 있습니다.

```sh
python -m pip install playwright
python -m playwright install chromium
python source/e2e.py
python source/e2e.py --live-p2p
```

고정 사용자 흐름만 선택하려면 `--flow progression`(지역 공략·관문·투자 저장) 또는 `--flow online --live-p2p`(시작 전 개인 투자·동시 PC/모바일 문 그리기·실제 재접속)를 사용합니다. `--flow all`이 기본이며 전체 실행은 180초 안에서 끝납니다.

마지막 명령은 공개 Nostr relay와 실제 WebRTC 2인 연결까지 검사합니다. `SKETCH_CHROMIUM`으로 설치된 Chromium/Edge 실행 경로를 지정할 수 있습니다. 결과는 Git에서 제외되는 `e2e_artifacts/`에 기록합니다. 과거 원본 결과는 `docs/original-e2e/`에 따로 보존했으며 현재 코드의 검증 결과로 간주하지 않습니다.

## 출처와 개발 상태

- 원본: [ChatGPT 스케치 타운](https://chatgpt.com/c/6acbb656-c434-83ee-8707-75bf94af3680)의 `Sketch_Town_Topdown_RPG_v0.9.2_Source.zip`
- ZIP SHA-256: `5d482afdc1aed32d1ecef9615dcca93259d70712f0ea4cc5484000e23b858ffb`
- [원본 설명 및 과거 검증 범위](docs/original-v0.9.2.md)
- [원본 이관·입력 개선 PR](https://github.com/byh-playground/bloom-sketch-town/pull/1)

## GameKit과 입력

멀티플레이에 사용하는 simloop, interpolation, rollback, transport는 모두 공식 GameKit v0.3.1의 동일 dist 커밋 `72b09b260edf9650353017acb49c06873fe9f5a1`에 고정했습니다. `source/gamekit/manifest.json`의 SHA-256을 빌드에서 확인하고 공식 ESM 바이트를 단일 HTML에 포함합니다. 기존 renderer/input/dom/audio와 게임 규칙은 원본을 유지합니다. 이전 멀티플레이 버전과는 방 namespace와 simulationVersion을 분리합니다.

입력 이벤트는 `observeInput` → 공식 `submitInput`으로 즉시 송신합니다. 입력 60Hz, 시뮬레이션 30TPS, 렌더 최대 60FPS는 독립 실행되며 게임 설정입니다. Command는 한 번만 제출하고 최초 예약 T를 바꾸지 않습니다. `MP_PROFILE`의 network scheduling, safety margin 8ms, jitter multiplier 2로 정상 입력에 도착 여유를 주며 늦은 입력만 공식 rollback으로 보정합니다. `reconciled`에서 표시 상태를 다시 게시합니다.

로컬 걷기·구르기 예측은 공식 `LocalInputPreview`와 `PresentationRuntime`을 사용하고 실제 게임과 같은 이동·충돌 함수를 호출합니다. 마법은 준비 자세만 예측하고 피해는 확정 명령에서 처리합니다. 걷기는 두 바이트 방향 지속 입력, 구르기·공격은 단발 Command로 처리합니다. 별도 게임 동기화 계층은 추가하지 않습니다.

## 검증·배포

기존 단일 `source/e2e.py --live-p2p`에서 실제 Edge의 기본 게임, 모바일 터치, CNN 마법, 공개 Nostr + 2인 WebRTC, 이벤트 내 즉시 송신·예측 게시, 지연·중복 RTC 패킷의 예약 T와 확정 해시를 검증합니다. 소프트웨어 WebGL 환경의 관측 프레임 시간은 물리 디스플레이 지연 보장이 아닙니다. 다중 기기·장거리 인터넷의 모든 지터 조합은 검증하지 않습니다.

[실제 Edge 검증 기록](docs/e2e-v0.12.1.json): 40 PASS, 0 NOT RUN, 30.5초. [0.11.0의 30TPS 표시·CPU 계측](docs/performance-v0.11.0.json).

PR CI는 번들 해시 확인과 빌드 재현성을 검사합니다. main 병합 시 동일 빌드의 `index.html`을 GitHub Actions Pages로 배포합니다.

[공통 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)과 [프로젝트 관리 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html)을 따릅니다.


### 0.11.0 입력 표시 개선

공식 `LocalInputPreview.isActive`로 새 Command와 진행 중인 구르기·마법 준비의 예측 수명을 분리합니다. 렌더 view의 안정적인 actorId로 해당 캐릭터의 cast만 표시하며 명령·발사·피해 규칙은 유지합니다. 시뮬레이션 30 TPS, 입력 60Hz, 렌더 최대 60FPS는 독립입니다. rollbackWindow 16틱(533ms), history 64틱(2133ms), preview horizon 16틱(533ms), 시뮬 backlog 16틱(533ms), maxCatchup 8틱(267ms), checksum 30틱(1초)으로 기존 시간 범위를 유지합니다.

### 0.12.0 걷기와 선택적 구르기

- PC: WASD/방향키를 누르는 동안 초당 140 월드 단위로 걷고, 놓으면 멈춥니다. 대각선 속도도 같습니다.
- Space: 이동 방향으로 구릅니다. 정지 중에는 바라보는 방향으로 구릅니다. 필드 클릭/탭 구르기는 0.14.0에서 직접 그리기로 교체했습니다.
- 모바일: 왼쪽 스틱으로 걷고 옆 구르기 버튼을 누릅니다. 전장에는 다른 손가락으로 동시에 그릴 수 있습니다.
- 구르기는 최대 96 거리, 2회 충전, 회당 650ms 충전을 유지합니다. 키/스틱을 유지하면 구르기 직후 걷기를 재개합니다.
- 이동 중에도 그릴 수 있습니다. 포커스 상실, 모달 열기, 터치 취소는 이동 입력을 해제합니다.

온라인 입력 크기와 simulationVersion을 변경하여 0.11.x 방과 분리했습니다. 모든 참가자는 동일한 현재 게임 버전 및 GameKit 번들을 사용합니다.


### 0.12.1 일정한 걷기 표시

기준 60Hz의 정수 분주인 시뮬 30TPS·입력 60Hz·표시 최대 60Hz만 설정합니다. GameKit loop가 다음 실행 마감을 소유하고 timer는 이를 따릅니다. 실제 늦은 실행의 catch-up은 유지하며 입력 이벤트는 즉시 제출합니다. 물리 디스플레이나 OS timer 정확도를 전제하지 않습니다.

권위 위치는 시뮬레이션 시각에 맞춘 2틱(66.7ms) 표시 지연으로 보간하여 수신 시각의 불규칙성을 흡수합니다. 이 지연은 입력 송신·게임 판정에 추가되지 않으며 온라인 자신의 움직임은 공식 LocalInputPreview로 즉시 표시합니다. 예측 구간은 실제 미래 tick 수와 loop의 표시 경계 시각을 사용합니다. 카메라·몸체는 같은 표시 위치를 따릅니다.

[동일 장면 전후 계측](docs/jitter-v0.12.1.json): 온라인 로컬 걷기 화면 델타 범위 −1.75~+2.76px → −0.30~+0.39px, 정지 프레임 2/51 → 0/50. 두 peer의 정상 timer에서 0/2 tick 반복이 없어졌습니다. render CPU p95는 최종 2.2/2.8ms이며 GPU 실행시간은 미측정입니다.


### 0.13.0 공통 표시 프레임

GameKit [PR46](https://github.com/byh-playground/bloom-gamekit/pull/46)의 `PresentationRuntime.frame(now)`을 권위 상태 렌더의 기본 경로로 사용합니다. 동적 객체는 현재 world 배열 대신 프레임 목록을 순회하므로 생성 첫 이동 구간과 지연된 제거까지 같은 표시 시간을 따릅니다. 본체·잔상은 `renderPath`/`pathInto`에서 같은 끝점을 받습니다. `Object.create(rawObject)` fallback과 게임 전용 잔상 배열을 제거했습니다.

온라인 자신의 캐릭터는 기존 `LocalInputPreview`를 같은 RAF 시각으로 선택하며, 선택한 모델을 본체·부착 외형·카메라에 함께 전달합니다. 투사체를 예측 시뮬레이션으로 복제하지 않습니다. 시뮬레이션 30TPS, 입력 60Hz, 표시 최대 60Hz와 예약 T 정책은 유지합니다.

[공식 사용 계약과 예제](https://github.com/byh-playground/bloom-gamekit/tree/main/modules/interpolation#권장-진입점-한-표시-프레임): 중간 반사점, 부착 관계, 모양은 게임이 소유합니다. 한 tick 안에 생성·제거되어 스냅샷에 나타나지 않는 객체는 모듈이 추론하지 않습니다. 이 게임의 경로는 현재 시뮬레이션이 계산한 tick 끝점을 보존합니다.

고정 manifest SHA-256: `842c6faa2723538ce6ee2817c9c0188c3596c2d03140c8dd90e156ac58141576`.


[0.13.0 실제 Edge E2E](docs/e2e-v0.13.0.json): 44 PASS, 미실행 0, 27초.
[GPU·2인 RTC 전후 계측](docs/presentation-v0.13.0.json): 참가자 초기 위치 유지 약 67→16.7ms(다음 한 프레임), 잔상/본체 간격 p95 약 31→0, 렌더 CPU p99 2.7→2.5ms. 표시 지연은 유지하며, 생성 후 첫 표시 시점은 약 4~7→50~55ms입니다. 미래 위치를 먼저 보이고 정지시키는 대신 표시 시간이 도달하면 첫 구간부터 움직입니다. 같은 PC의 짧은 정상 네트워크 측정이며 사용자 인터넷·장시간·모바일 GPU 성능을 보증하지 않습니다.

### 0.13.1 공통 표시 수정

GameKit PR47의 지연된 중첩 상태 전환과 PR48의 preview 복귀 수정을 포함한 공식 dist `e108fe481aa7314974c39974a169b549500bf12c`를 고정했습니다. source는 `2712703c83923f16bb70454ea60e2ac533489ef8`, manifest SHA-256은 `800e4ddd95a33c332dff5a0c60b06438ffea6fd3bb3bca331b52d56b73f0775e`입니다. interpolation 번들만 변경되며 게임 기능·밸런스·30TPS·입력 정책은 유지합니다. 모든 참가자는 0.13.1과 같은 번들을 사용해야 합니다.

[0.13.1 실제 Edge 검증](docs/e2e-v0.13.1.json): 기존 단일 E2E `--live-p2p`에서 44 PASS, 0 NOT RUN, 33.52초. 기본·모바일 입력, 즉시 preview, 공개 Nostr·2인 RTC, 예약 T·중복·확정 hash, 몸체·잔상 표시 시점을 확인했습니다.

### 0.13.2 GameKit v0.3.1

공식 dist `72b09b260edf9650353017acb49c06873fe9f5a1` (source `baa96876876a08013ad28b5a71c83bfadd285fab`)의 4개 모듈과 manifest SHA-256 `c713809653043e8eb1d9b629c0c2734e9526217f69e04b49283d068c1b5d7da7`을 빌드에서 검증합니다. 이동·전투 수치와 30 TPS/60Hz 입력/최대 60FPS는 유지합니다. 사용자 요청에 따라 이번 SDK 패치 갱신은 정적 코드·SHA·빌드 검사만 수행하며 입력·이동·마법·모바일과 공개 WebRTC 브라우저 검증은 생략합니다.


### 0.14.0 전장 직접 그리기

- 전장의 빈 곳에 한 획을 그립니다. WASD/왼쪽 스틱으로 이동하며 조준하고, Space/구르기 버튼으로 회피합니다. 짧은 탭은 발사·구르기를 만들지 않습니다. 학습 패드는 유지합니다.
- 화면의 잉크는 카메라가 움직여도 고정됩니다. 현재 표시된 캐릭터에서 그림 경계 상자 중심으로 방향을 보여 주고, 놓는 순간 확정한 방향으로 실제 캐릭터 위치에서 발사합니다. 최초 비행 중 자동 조준은 없으며 명중 후 연쇄 반사 규칙은 유지합니다. 캐릭터 24 CSS px 이내에서는 마지막 유효 방향, 아직 없으면 시작 시 바라보던 방향을 유지합니다.
- 포인터 취소·포커스 상실·창 크기 변경·모달 열기·사망은 미완성 획을 취소합니다. 화면/스틱/UI 포인터를 분리하며 온라인 시간 정지나 예측 투사체·피해를 추가하지 않습니다.
- 도형 인식은 정규화 좌표, 피해 면적은 고정 280×150 기준을 사용합니다. 같은 CSS 크기의 그림은 화면 위치·뷰포트·DPR과 관계없이 같은 피해를 내며, 큰 그림의 면적 효과는 유지합니다. 닫힌 그림은 시작점·그린 방향과 무관한 형태를 사용합니다.
- 반사 궤도는 실제 명중 위치에서 이어집니다. 새 반경과 각도로 중심이 순간 이동하던 전환을 제거하고, 문양 회전은 진행 방향 대신 투사체 나이를 따릅니다. 원래 경계 상자 중심 피벗은 그대로 유지합니다.
- 마법 명령과 롤백 체크포인트에 유한한 발사각을 필수로 저장합니다. 방 이름과 simulationVersion은 0.14.0으로 분리하며 이전 명령 형식 fallback은 없습니다. GameKit v0.3.1 manifest와 공식 번들은 변경하지 않았습니다.

기존 `python source/e2e.py --live-p2p`에서 실제 Windows Edge/WebGL, 전장 한 획·이동 중 조준·방향 고정·취소·모바일 동시 입력과 공개 Nostr·2인 WebRTC를 확인했습니다. 2026-10-14 실행은 66 PASS, 0 NOT RUN, 39.62초입니다. 실제 그림에서 생성된 명령의 공격자·중복 실행·확정 상태 해시를 양쪽에서 확인했고, 반사·회전도 실제 렌더 프레임과 화면으로 관측했습니다. 모바일 실기기·외부 NAT·장시간 밸런스는 미검증입니다. 이번 변경과 실제 결과의 원본은 [PR #9](https://github.com/byh-playground/bloom-sketch-town/pull/9)에 기록합니다.

### 0.15.0 지역 공략·회복 잉크·투자 성장

- 잉크 숲의 적 5마리 공략 → 미리 보이는 동쪽 봉인 종이벽에 문 윤곽 그리기 → 안개 습지의 적 5마리 공략 → 끊어진 길 양 끝을 한 획으로 연결 → 종이 채석장으로 진행합니다. 지역 안은 자유 이동입니다. 채석장 적 3마리를 물리치면 감시자가 나타납니다.
- 표시된 지점 가까이에서 PC **E** 또는 **환경 그리기**로 입력 모드를 선택합니다. 문은 대략적인 윤곽, 다리는 표시된 두 끝의 연결을 받아들이며, 수락한 실제 획을 통로에 남깁니다. 충돌 통로 폭은 고정 180입니다. 임의 벽 파괴와 자유형 충돌 지형은 지원하지 않습니다. 취소는 Esc·포인터 취소·포커스 상실·창 크기 변경·모달·사망에 연결됩니다.
- 개인 잉크는 최대/시작 100, 초당 8 회복, 소비 뒤 0.75초 대기입니다. 선·일반 낙서 4, 문양 12~20(기존 정규화 면적), 문 25, 다리 40이 기본 비용입니다. 공격과 환경 그리기 모두 수락된 명령에서 한 번만 소비하며, 무효·취소 획은 무료입니다. 동시에 같은 관문을 완성하면 첫 유효 명령만 소비합니다. 드롭은 최대치까지 잉크를 회복합니다. 그리는 중 예상 비용과 부족한 양·회복 대기를 표시합니다.
- 레벨 1에서 1포인트, 이후 레벨마다 1포인트를 얻습니다. **성장 → 잉크/전투/탐험 탭 → 미니 트리 선택 → 상세 → 투자 버튼**으로 확정합니다. 선택만으로 구매하지 않습니다. 최대 잉크 +15, 초당 회복 +1, 비용 -5%p, 공격력 +6%, 최대 HP +12를 각각 최대 5회 투자합니다. 자동 HP/공격 성장과 잉크 화폐 공방 강화를 교체했습니다.
- 투자는 하나의 계산 경로에서 파생값을 만듭니다. 무료 재분배는 현재 HP·잉크를 채우지 않으며, 브라우저에 저장한 레벨·경험치·투자는 새로고침과 방 참가에도 유지됩니다. 탐험 탭은 실제 공략·관문 완료 상태를 조회합니다.
- 개인 투자·잉크·재생 지연과 공유 관문·공략 수·완성 획은 GameKit 체크포인트/롤백/해시에 포함됩니다. 회복은 30TPS 시뮬레이션 시간으로 처리합니다. 0.14.x와는 방 namespace 및 simulationVersion을 분리하며 고정 GameKit v0.3.1 번들은 유지합니다.

정본은 `source/progression.js`의 규칙과 `source/progression-ui.js`의 조회/입력 화면이며, 기존 `game_part*.js`가 명령·렌더·입력·저장을 연결합니다. 투자 UI의 원본 패턴은 바운코의 `tech-view.js`와 실제 스탯 정의에서 확인했습니다. 기존 GitHub Actions Pages 구성을 유지합니다.

[0.15.0 실제 Edge 검증](docs/e2e-v0.15.0.json): 기본·390px·지역/투자 45 PASS(59.53초), 새 공개 Nostr·2인 RTC 흐름 6 PASS(29.23초). 재접속은 공식 RoomSession.leave()로 참가자 탈퇴를 완료한 뒤 같은 방에 다시 참가해 관문·투자와 확정 해시를 확인했습니다. 기존 E2E의 ANGLE SwiftShader WebGL 경로이며 하드웨어 GPU·모바일 실기기·외부 NAT·장시간 밸런스는 미검증입니다.

[PC 투자 화면](docs/growth-desktop-v0.15.0.png) · [390px 투자 화면](docs/growth-mobile-v0.15.0.png) · [390px 다리/채석장](docs/regions-mobile-v0.15.0.png)

### 0.16.0 상시 잉크 바·별 마법진·지역 맵

- 상단 잉크 바는 현재/최대, 회복/재생 대기, 빗금 예상 소비와 부족 상태를 한곳에서 보여 줍니다. PC·390px에서 목표·미니맵·투자·환경 입력의 위계를 정리하고 성장 노드에 투자 단계 바를 추가했습니다.
- 문 윤곽/다리 끝점 조건을 **둘레원 한 바퀴 + 다섯 꼭짓점 별**의 구조 판정으로 교체했습니다. 기존 별 마법진 레퍼런스와 순수 획 길이/경계/단순화를 재사용합니다. CNN 라벨만으로 통과시키지 않으며, 선·낙서·원만·별만은 거부합니다. 방향·회전·크기·샘플링 오차를 허용하고 실패 이유·흐린 안내를 유지해 재시도할 수 있습니다. 성공한 명령만 비용을 내며 그 뒤 문/다리와 완성 연출이 나타납니다.
- 숲은 수관 띠·공략 공터·그루터기, 습지는 실제 이동을 막는 물웅덩이·섬 공터·갈대·가라앉은 종탑, 채석장은 절벽·절단장·광맥·보스 공간으로 구분합니다. 설계한 지형·연결 길·랜드마크와 seeded 소품을 기존 WebGL 스케치 primitive로 그립니다. 길의 배열 좌표를 객체 좌표로 명시 변환해 실제 연결 동선이 렌더되도록 수정했습니다. 물/절벽/관문 충돌은 같은 고정 지형 데이터를 사용합니다.
- 관문 명령·맵 판정 계약은 0.16.0 방으로 분리하며 GameKit v0.3.1 번들은 유지합니다. 개인 성장 저장 형식은 바꾸지 않습니다. 정본 맵은 `source/region-map.js`, 마법진 판정은 `source/progression.js`입니다.

[0.16.0 영향 검증](docs/ux-v0.16.0.json): 실제 Edge UI·긍정/부정 포인터 그림 15 PASS, 지역 진행 14 PASS, 공개 Nostr·2인 RTC 6 PASS. 기존 전체 기능을 반복 검사하지 않았습니다. ANGLE SwiftShader WebGL 경로이며 하드웨어 GPU·모바일 실기기·외부 NAT·장시간 밸런스는 미검증입니다.

[잉크 부족 바](docs/ink-mobile-v0.16.0.png) · [마법진 재시도](docs/magic-retry-v0.16.0.png) · [투자 화면](docs/growth-mobile-v0.16.0.png) · [숲](docs/map-forest-v0.16.0.png) · [습지](docs/map-marsh-v0.16.0.png) · [채석장](docs/map-quarry-v0.16.0.png)

### SVG renderer migration candidate

The in-branch candidate authors static character and environment resources in `source/assets/*.svg`, then compiles them into the single-page build with the pinned GameKit 0.6.1 compiler. Live user strokes and transient combat effects remain runtime geometry. See the [implementation notes](docs/svg-renderer.md) and [fixed-scene benchmark](docs/svg-renderer-benchmark-v0.16.0.md). The candidate substantially reduces geometry upload bytes, but SwiftShader still shows a repeatable FPS regression, so the migration is not merged or deployed yet.
[SVG renderer migration implementation notes](docs/svg-renderer.md)
[Fixed-scene renderer benchmark and current SwiftShader regression](docs/svg-renderer-benchmark-v0.16.0.md)
