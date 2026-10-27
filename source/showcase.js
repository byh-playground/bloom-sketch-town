import { installShowcase } from 'https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2c6de8e749d88d00fd8c9825170ec957bdd64d35/scenario.js';
const SHOWCASE = installShowcase({
    custom: (shape, win) => win.BloomSketchShowcase?.drawStroke(shape) === true,
    title:'스케치 타운',
    launcher:'#helpButton',
    playSelector:'#field',
    durationMs:27000,
    ready:win=>win.document.getElementById('gameVersion')?.textContent.includes('0.17.0')===true
      &&!!win.document.querySelector('#field'),
    timeline:[
  {
    "atMs": 0,
    "action": "chapter",
    "index": 0,
    "title": "그리는 한 획이 소환수가 됩니다",
    "caption": "전장에서 직접 선과 도형을 그려 소환수를 불러냅니다."
  },
  {
    "atMs": 1600,
    "action": "key",
    "code": "KeyD",
    "down": true
  },
  {
    "atMs": 3700,
    "action": "key",
    "code": "KeyD",
    "down": false
  },
  {
    "atMs": 4500,
    "action": "custom",
    "name": "line"
  },
  {
    "atMs": 6800,
    "action": "custom",
    "name": "circle"
  },
  {
    "atMs": 9000,
    "action": "chapter",
    "index": 1,
    "title": "움직이며 도형을 조합하기",
    "caption": "선은 빠르게, 도형은 충격과 연쇄 반사로 싸웁니다."
  },
  {
    "atMs": 9500,
    "action": "key",
    "code": "KeyW",
    "down": true
  },
  {
    "atMs": 10900,
    "action": "key",
    "code": "KeyW",
    "down": false
  },
  {
    "atMs": 11600,
    "action": "custom",
    "name": "circle"
  },
  {
    "atMs": 14100,
    "action": "key",
    "code": "Space",
    "down": true
  },
  {
    "atMs": 14200,
    "action": "key",
    "code": "Space",
    "down": false
  },
  {
    "atMs": 17100,
    "action": "chapter",
    "index": 2,
    "title": "지역을 공략하고 성장하기",
    "caption": "숲부터 채석장까지, 그림으로 길을 열고 적을 물리칩니다."
  },
  {
    "atMs": 17500,
    "action": "key",
    "code": "KeyD",
    "down": true
  },
  {
    "atMs": 20500,
    "action": "key",
    "code": "KeyD",
    "down": false
  },
  {
    "atMs": 21100,
    "action": "custom",
    "name": "line"
  },
  {
    "atMs": 24100,
    "action": "custom",
    "name": "circle"
  }
]
});

// Restore direct introduction links after the game's own menu router has booted.
if (window.__BLOOM_SHOWCASE_DEEPLINK && SHOWCASE) {
    window.addEventListener('load', () => SHOWCASE.open(), { once: true });
}
