# Sketch Town

그림을 그려 마법을 시전하고 WASD·터치로 구르는 BLOOM 협동 액션 게임입니다. 현재 버전은 0.9.2이며 ChatGPT 원본을 독립 저장소로 이관했습니다.

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

현재 GameKit 파일은 원본 ZIP의 번들을 유지합니다. PR43의 dist `6d9125a58bf63e4b7b0f68a6882c30e9858172bc` 적용과 즉시 입력 송신·예측 지연 개선은 후속 통합 작업입니다. 초기 이관을 그 개선의 완료로 취급하지 않습니다.

Pages workflow는 main 변경 또는 수동 실행 시 `index.html`만 배포하도록 준비되어 있습니다. 저장소의 Pages source를 GitHub Actions로 설정한 뒤 승인된 배포에서 사용합니다. 공개 배포 여부와 검증 결과는 PR에서 확인합니다.

[공통 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)과 [프로젝트 관리 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html)을 따릅니다.
