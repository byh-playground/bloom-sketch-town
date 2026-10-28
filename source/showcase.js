import { installShowcase } from 'https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2c6de8e749d88d00fd8c9825170ec957bdd64d35/scenario.js';
// The film plays the real game in a disposable frame; every step name is run by source/showcase-demo.js (`name:arg:arg`,
// positions are screen fractions from the viewport centre). Chapters are the captions; steps stage the field or perform the same
// inputs a player would, and the game's own simulation does the fighting.
const SHOWCASE = installShowcase({
    custom: (step, win) => win.BloomSketchShowcase?.run(step) === true,
    title:'스케치 타운',
    launcher:'#helpButton',
    playSelector:'#field',
    durationMs:46000,
    ready:win=>win.BloomSketchShowcase?.ready()===true,
    timeline:[
    {"atMs": 0, "action": "chapter", "index": 0, "title": "한 획이 소환수가 됩니다", "caption": "몸 외곽을 한 번 그리면 그 자리에 소환수가 나타나 스스로 싸워요."},
    {"atMs": 0, "action": "custom", "name": "stage"},
    {"atMs": 1000, "action": "custom", "name": "foes:3:0.36:-0.06"},
    {"atMs": 1800, "action": "custom", "name": "draw:circle:-0.14:-0.08:150"},
    {"atMs": 4200, "action": "custom", "name": "draw:triangle:-0.02:0.16:150"},
    {"atMs": 8300, "action": "chapter", "index": 1, "title": "성격을 고르면 표정과 능력이 달라져요", "caption": "성격마다 이점 하나에 약점 하나. 항상 좋은 선택은 없어요."},
    {"atMs": 8400, "action": "custom", "name": "mend"},
    {"atMs": 8600, "action": "custom", "name": "pick:2"},
    {"atMs": 9000, "action": "custom", "name": "foes:3:-0.38:0.02"},
    {"atMs": 9800, "action": "custom", "name": "draw:square:0.1:-0.2:150"},
    {"atMs": 12200, "action": "custom", "name": "pick:4"},
    {"atMs": 12800, "action": "custom", "name": "draw:triangle:-0.22:0.14:150"},
    {"atMs": 16000, "action": "chapter", "index": 2, "title": "소환수 전원이 일제 사격", "caption": "불꽃·물방울·번개를 그리면 나와 소환수가 한꺼번에 그 자리를 쏴요."},
    {"atMs": 16100, "action": "custom", "name": "mend"},
    {"atMs": 16400, "action": "custom", "name": "foes:6:0.32:0"},
    {"atMs": 17300, "action": "custom", "name": "magic:flame"},
    {"atMs": 22200, "action": "custom", "name": "foes:6:-0.30:-0.04:4"},
    {"atMs": 23800, "action": "custom", "name": "magic:water"},
    {"atMs": 26800, "action": "custom", "name": "magic:lightning"},
    {"atMs": 30500, "action": "chapter", "index": 3, "title": "합체로 한 단계 위로", "caption": "소환수 둘을 눌러 고르고 별을 그리면 새 소환수로 융합해요."},
    {"atMs": 30600, "action": "custom", "name": "mend"},
    {"atMs": 30700, "action": "custom", "name": "ensure:circle:square"},
    {"atMs": 31600, "action": "custom", "name": "select:circle"},
    {"atMs": 32600, "action": "custom", "name": "select:square"},
    {"atMs": 33800, "action": "custom", "name": "draw:star:0:-0.22:170"},
    {"atMs": 37500, "action": "chapter", "index": 4, "title": "보스마다 면역과 약점이 달라요", "caption": "다섯 보스를 모두 쓰러뜨리면 클리어. 약점을 찌르면 한 번에 무너집니다."},
    {"atMs": 37600, "action": "custom", "name": "mend"},
    {"atMs": 37800, "action": "custom", "name": "boss:1:0.34:0"},
    {"atMs": 39400, "action": "custom", "name": "magic:water"},
    {"atMs": 43000, "action": "custom", "name": "magic:flame"}
]
});

// Restore direct introduction links after the game's own menu router has booted.
if (window.__BLOOM_SHOWCASE_DEEPLINK && SHOWCASE) {
    window.addEventListener('load', () => SHOWCASE.open(), { once: true });
}
