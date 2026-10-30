# 작업 지침

- 저장소: byh-playground/bloom-sketch-town. 통합 브랜치: main. 작업 브랜치: codex/. 커밋 메시지: 한국어.
- README의 공통 개발 규칙과 프로젝트 관리 규칙을 읽는다. 작업 전 열린 PR, worktree 및 미커밋 변경을 확인한다.
- 게임 정본은 루트 index.html과 source/ 원본 JS·CSS·SVG·CNN 데이터다. 브라우저가 직접 스크립트를 로딩하며 배포용 HTML이나 번들을 재생성하지 않는다. 원본 source/의 순서와 공유 lexical scope를 보존한다.
- 기존 검증 진입점은 python source/e2e.py다. 네트워크 변경은 같은 스크립트의 --live-p2p로 실제 2인 연결을 확인한다. 원본의 과거 검증 결과를 현재 실행 결과로 사용하지 않는다.
- 검증을 마친 PR은 별도 승인을 묻지 않고 `main`에 머지한다. `main` 푸시는 Pages가 공개 주소에 자동 배포하므로 머지가 곧 리모트 확인용 배포다. Stable은 검증·승인한 커밋에 불변 태그로 명시 승격할 때만 만들며 Pages 배포만으로 Stable로 간주하지 않는다.
