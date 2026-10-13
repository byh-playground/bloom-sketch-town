# 작업 지침

- 저장소: byh-playground/bloom-sketch-town. 통합 브랜치: main. 작업 브랜치: codex/. 커밋 메시지: 한국어.
- README의 공통 개발 규칙과 프로젝트 관리 규칙을 읽는다. 작업 전 열린 PR, worktree 및 미커밋 변경을 확인한다.
- source/가 게임과 번들의 정본이다. index.html을 직접 수정하지 않고 python source/build_rpg.py로 재생성한다.
- 기존 검증 진입점은 python source/e2e.py다. 네트워크 변경은 같은 스크립트의 --live-p2p로 실제 2인 연결을 확인한다. 원본의 과거 검증 결과를 현재 실행 결과로 사용하지 않는다.
- 공개 배포와 머지는 사용자의 명시적 지시에 따른다.
