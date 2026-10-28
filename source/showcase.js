import { installShowcase } from 'https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2c6de8e749d88d00fd8c9825170ec957bdd64d35/scenario.js';
// The film plays the real game in a disposable frame; every step name is run by source/showcase-demo.js (`name:arg:arg`,
// positions are screen fractions from the viewport centre). Chapters are the captions; steps stage the field or perform the same
// inputs a player would, and the game's own simulation does the fighting.
const SHOWCASE = installShowcase({
    custom: (step, win) => win.BloomSketchShowcase?.run(step) === true,
    title:'스케치 타운',
    launcher:'#helpButton',
    playSelector:'#field',
    durationMs:40000,
    ready:win=>win.BloomSketchShowcase?.ready()===true,
    timeline:[
    {"atMs": 0, "action": "chapter", "index": 0, "title": "한 획이 소환수가 됩니다", "caption": "몸 외곽을 한 번 그리면 소환수가 나타나 스스로 싸워요. 표정도 성격도 제각각이에요."},
    {"atMs": 0, "action": "custom", "name": "stage"},
    {"atMs": 1000, "action": "custom", "name": "foes:3:0.36:-0.06"},
    {"atMs": 1700, "action": "custom", "name": "pick:2"},
    {"atMs": 1800, "action": "custom", "name": "draw:circle:-0.14:-0.08:150"},
    {"atMs": 4100, "action": "custom", "name": "pick:4"},
    {"atMs": 4200, "action": "custom", "name": "draw:triangle:-0.02:0.16:150"},
    {"atMs": 5500, "action": "custom", "name": "foes:3:-0.38:0.02"},
    {"atMs": 6500, "action": "custom", "name": "pick:0"},
    {"atMs": 6600, "action": "custom", "name": "draw:square:0.1:-0.2:150"},
    {"atMs": 9000, "action": "chapter", "index": 1, "title": "먼 적도 마법 한 번에", "caption": "불꽃·물방울·번개를 적 쪽에 그리면 나와 소환수가 한꺼번에 쏴요."},
    {"atMs": 9100, "action": "custom", "name": "mend"},
    {"atMs": 9400, "action": "custom", "name": "foes:6:0.46:-0.08"},
    {"atMs": 11000, "action": "custom", "name": "magic:flame"},
    {"atMs": 15000, "action": "custom", "name": "foes:6:-0.46:0.04:4"},
    {"atMs": 16600, "action": "custom", "name": "magic:water"},
    {"atMs": 20000, "action": "custom", "name": "magic:lightning"},
    {"atMs": 23000, "action": "chapter", "index": 2, "title": "합체로 한 단계 위로", "caption": "소환수 둘을 눌러 고르고 별을 그리면 새 소환수로 융합해요."},
    {"atMs": 23100, "action": "custom", "name": "mend"},
    {"atMs": 23200, "action": "custom", "name": "ensure:circle:square"},
    {"atMs": 24100, "action": "custom", "name": "select:circle"},
    {"atMs": 25100, "action": "custom", "name": "select:square"},
    {"atMs": 26300, "action": "custom", "name": "draw:star:0:-0.22:170"},
    {"atMs": 30000, "action": "chapter", "index": 3, "title": "보스마다 면역과 약점이 달라요", "caption": "다섯 보스를 모두 쓰러뜨리면 클리어. 약점을 찌르면 한 번에 무너집니다."},
    {"atMs": 30100, "action": "custom", "name": "mend"},
    {"atMs": 30300, "action": "custom", "name": "boss:1:0.44:0"},
    {"atMs": 32400, "action": "custom", "name": "magic:water"},
    {"atMs": 36000, "action": "custom", "name": "magic:flame"}
]
});

// Restore direct introduction links after the game's own menu router has booted.
if (window.__BLOOM_SHOWCASE_DEEPLINK && SHOWCASE) {
    window.addEventListener('load', () => SHOWCASE.open(), { once: true });
}
