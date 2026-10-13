# Sketch Town

그림을 그려 마법을 만들고 WASD·모바일 스틱으로 걷고 선택적으로 구르는 BLOOM 기반 액션 게임입니다. 현재 버전은 **0.12.1**입니다. 최신 ChatGPT 원본 0.9.2를 이관하고 GameKit protocol 3와 즉시 입력 처리를 적용했습니다.

[게임 실행](https://byh-playground.github.io/bloom-sketch-town/)

## 실행과 검증

Python 3.10 이상에서 실행합니다. 빌드는 표준 라이브러리만 사용합니다.

```sh
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

마지막 명령은 공개 Nostr relay와 실제 WebRTC 2인 연결까지 검사합니다. `SKETCH_CHROMIUM`으로 설치된 Chromium/Edge 실행 경로를 지정할 수 있습니다. 결과는 Git에서 제외되는 `e2e_artifacts/`에 기록합니다. 과거 원본 결과는 `docs/original-e2e/`에 따로 보존했으며 현재 코드의 검증 결과로 간주하지 않습니다.

## 출처와 개발 상태

- 원본: [ChatGPT 스케치 타운](https://chatgpt.com/c/6acbb656-c434-83ee-8707-75bf94af3680)의 `Sketch_Town_Topdown_RPG_v0.9.2_Source.zip`
- ZIP SHA-256: `5d482afdc1aed32d1ecef9615dcca93259d70712f0ea4cc5484000e23b858ffb`
- [원본 설명 및 과거 검증 범위](docs/original-v0.9.2.md)
- [원본 이관·입력 개선 PR](https://github.com/byh-playground/bloom-sketch-town/pull/1)

## GameKit과 입력

멀티플레이에 사용하는 simloop, interpolation, rollback, transport는 모두 PR45의 동일 dist 커밋 `e7a1782275b6414f2bcf2cd29de173f49b849004`에 고정했습니다. `source/gamekit/manifest.json`의 SHA-256을 빌드에서 확인하고 공식 ESM 바이트를 단일 HTML에 포함합니다. 기존 renderer/input/dom/audio와 게임 규칙은 원본을 유지합니다. 이전 멀티플레이 버전과는 방 namespace와 simulationVersion을 분리합니다.

입력 이벤트는 `observeInput` → 공식 `submitInput`으로 즉시 송신합니다. 입력 60Hz, 시뮬레이션 30TPS, 렌더 최대 60FPS는 독립 실행되며 게임 설정입니다. Command는 한 번만 제출하고 최초 예약 T를 바꾸지 않습니다. `MP_PROFILE`의 network scheduling, safety margin 8ms, jitter multiplier 2로 정상 입력에 도착 여유를 주며 늦은 입력만 공식 rollback으로 보정합니다. `reconciled`에서 표시 상태를 다시 게시합니다.

로컬 걷기·구르기 예측은 공식 `LocalInputPreview`와 `PresentationRuntime`을 사용하고 실제 게임과 같은 이동·충돌 함수를 호출합니다. 마법은 준비 자세만 예측하고 피해는 확정 명령에서 처리합니다. 걷기는 두 바이트 방향 지속 입력, 구르기·공격은 단발 Command로 처리합니다. 별도 게임 동기화 계층은 추가하지 않습니다.

## 검증·배포

기존 단일 `source/e2e.py --live-p2p`에서 실제 Edge의 기본 게임, 모바일 터치, CNN 마법, 공개 Nostr + 2인 WebRTC, 이벤트 내 즉시 송신·예측 게시, 지연·중복 RTC 패킷의 예약 T와 확정 해시를 검증합니다. 소프트웨어 WebGL 환경의 관측 프레임 시간은 물리 디스플레이 지연 보장이 아닙니다. 다중 기기·장거리 인터넷의 모든 지터 조합은 검증하지 않습니다.

[실제 Edge 검증 기록](docs/e2e-v0.12.0.json): 40 PASS, 0 NOT RUN, 35.05초. [0.11.0의 30TPS 표시·CPU 계측](docs/performance-v0.11.0.json).

PR CI는 번들 해시 확인과 빌드 재현성을 검사합니다. main 병합 시 동일 빌드의 `index.html`을 GitHub Actions Pages로 배포합니다.

[공통 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)과 [프로젝트 관리 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html)을 따릅니다.


### 0.11.0 입력 표시 개선

공식 `LocalInputPreview.isActive`로 새 Command와 진행 중인 구르기·마법 준비의 예측 수명을 분리합니다. 렌더 view의 안정적인 actorId로 해당 캐릭터의 cast만 표시하며 명령·발사·피해 규칙은 유지합니다. 시뮬레이션 30 TPS, 입력 60Hz, 렌더 최대 60FPS는 독립입니다. rollbackWindow 16틱(533ms), history 64틱(2133ms), preview horizon 16틱(533ms), 시뮬 backlog 16틱(533ms), maxCatchup 8틱(267ms), checksum 30틱(1초)으로 기존 시간 범위를 유지합니다.

### 0.12.0 걷기와 선택적 구르기

- PC: WASD/방향키를 누르는 동안 초당 140 월드 단위로 걷고, 놓으면 멈춥니다. 대각선 속도도 같습니다.
- Space: 이동 방향으로 구릅니다. 정지 중에는 바라보는 방향으로 구릅니다. 필드 클릭/탭 구르기도 유지합니다.
- 모바일: 왼쪽 스틱으로 걷고 옆 구르기 버튼을 누릅니다. 오른쪽 패드는 다른 손가락으로 동시에 그릴 수 있습니다.
- 구르기는 최대 96 거리, 2회 충전, 회당 650ms 충전을 유지합니다. 키/스틱을 유지하면 구르기 직후 걷기를 재개합니다.
- 이동 중에도 그릴 수 있습니다. 포커스 상실, 모달 열기, 터치 취소는 이동 입력을 해제합니다.

온라인 입력 크기와 simulationVersion을 변경하여 0.11.x 방과 분리했습니다. 모든 참가자는 같은 0.12.0 및 GameKit 번들을 사용합니다.


### 0.12.1 일정한 걷기 표시

기준 60Hz의 정수 분주인 시뮬 30TPS·입력 60Hz·표시 최대 60Hz만 설정합니다. GameKit loop가 다음 실행 마감을 소유하고 timer는 이를 따릅니다. 실제 늦은 실행의 catch-up은 유지하며 입력 이벤트는 즉시 제출합니다. 물리 디스플레이나 OS timer 정확도를 전제하지 않습니다.

권위 위치는 시뮬레이션 시각에 맞춘 2틱(66.7ms) 표시 지연으로 보간하여 수신 시각의 불규칙성을 흡수합니다. 이 지연은 입력 송신·게임 판정에 추가되지 않으며 온라인 자신의 움직임은 공식 LocalInputPreview로 즉시 표시합니다. 예측 구간은 실제 미래 tick 수와 loop의 표시 경계 시각을 사용합니다. 카메라·몸체는 같은 표시 위치를 따릅니다.
