# 개발 문서

초파리의 습격 — 실제 커넥톰이 브라우저에서 그대로 도는 정적 페이지.
서버 없음, 빌드 도구 없음, 의존성 없음. 파일 다섯 개가 전부다.

---

## 1. 무엇이 어디에 있나

### 배포되는 파일

| 파일 | 크기 | gzip | 줄 | 하는 일 |
| --- | ---: | ---: | ---: | --- |
| `index.html` | 61.0 KB | 19.9 KB | 1,313 | 화면, 스타일, 게임 루프 전부 |
| `brain.bin` | 174.6 KB | 71.8 KB | — | 초파리 뇌 (뉴런 7,858 / 간선 7,107) |
| `lang.js` | 17.3 KB | 6.9 KB | 340 | 언어팩 (ko, en) |
| `puzzle.js` | 11.8 KB | 4.3 KB | 265 | 판, 조각, 초파리 차례, 기본 그림 5종 |
| `fly.js` | 5.3 KB | 2.0 KB | 121 | 뇌 구동부 — 파싱, 망막, 12스텝, 읽기 |

**사용자가 받는 양 약 105 KB** (gzip 합계). 그 뒤로는 구글 폰트 말고 아무것도 안 받는다.
그림 5종은 캔버스에서 그리고, 뇌는 이미 받았고, 추적기·CDN·프레임워크가 없다.

### 저장소에만 있는 파일

| 파일 | 하는 일 |
| --- | --- |
| `selftest.js` | 소프트웨어 캔버스 위에서 한 판을 끝까지 두는 검사 |
| `README.md` | 소개 |
| `DATA.md` | MaleCNS 출처 표기와 변경 내역 (CC BY 4.0 의무) |

### 배포 대상 세 곳

| 저장소 | 주소 | 비고 |
| --- | --- | --- |
| `saintiron82/saintiron82.github.io` | https://saintiron82.github.io/ | 사용자 사이트 |
| `saintiron82/beat-the-fly` | https://saintiron82.github.io/beat-the-fly/ | 프로젝트 사이트 |
| `saintiron82/flypuzzle` (비공개) | `web/` 아래 | 연구 코드와 같이 보관 |

세 곳이 **같은 파일의 복사본**이다. 고칠 때 한 곳만 고치면 어긋난다 — 5절 참고.

---

## 2. 초파리 뇌

### `brain.bin` 형식

헤더 24바이트 뒤에 배열 여덟 개가 이어 붙는다. 전부 리틀엔디언.

```
offset  크기        내용
     0  4 B         magic "FLYP"
     4  4 B         version = 1
     8  4 B         N     = 7858   뉴런
    12  4 B         E     = 7107   간선
    16  4 B         PR    = 4512   광수용체 (망막이 실제로 쓰는 수)
    20  4 B         READ  = 1767   읽는 곳 (L1)
    24  31,436 B    row     uint32  (N+1)   받는 쪽 기준 CSR 오프셋
 31460  28,428 B    col     uint32  (E)     보내는 쪽 뉴런 번호
 59888  28,428 B    weight  float32 (E)     부호를 접어 넣은 시냅스 수
 88316  36,096 B    grid    float32 (PR×2)  광수용체가 화면 어디를 보는지 (-1..1)
124412  18,048 B    retIdx  uint32  (PR)    광수용체의 뉴런 번호
142460   7,068 B    readIdx uint32  (READ)  L1 의 뉴런 번호
149528   7,068 B    eyeBin  uint32  (READ)  L1 을 눈 지도 칸에 대응
156596  18,048 B    prBin   uint32  (PR)    광수용체를 화면 지도 칸에 대응
        174,644 B   합계
```

`weight` 에 부호가 이미 곱해져 있다. 이 부분집합에서는 **간선 7,107개가 전부 음수**다 —
광수용체→L1 한 홉뿐이고 광수용체는 히스타민성이라 그렇다.

### 동역학

파이썬 원본(`ConnectomeRNN`)과 같은 세 줄이다.

```
x = W·h + bias + u
x = min(relu(x), 10)
h ← (1-α)·h + α·x
```

`α = 0.1`, `bias = 0.1`, 자극 이득 `GAIN = 0.2`, `STEPS = 12`.
시작 전에 입력 없이 64스텝 돌려 **안정 상태**를 잡고, 매번 거기서 출발한다.

> **`bias = 0.1` 은 조절 항목이 아니다.** 광수용체가 억제성이라 bias 가 0이면
> 첫 홉이 `relu(음수)` 가 되고 그 아래 전부가 영원히 정확히 0.0 에 머문다.
> 측정값: 평균 0.000000, 1e-9 를 넘는 단위 0개, 후보 간 편차 0. 그런데 **죽은 망은
> 정확히 우연 수준 점수를 내므로 결과처럼 보인다.**

### 망막

`grid` 의 정규화 좌표에서 쌍선형 보간으로 화면을 표본한 뒤 `(v - 0.5) × 2` 로 대비를 만든다.
PyTorch `grid_sample(align_corners=True)` 와 같은 규칙이다.

### 파이썬과의 대조

JS 포팅본을 파이썬 원본과 프레임 다섯 장으로 맞춰봤다. **최대 오차 1.2e-6** — float32/float64
반올림 수준이다. 뇌를 건드리면 이 대조를 다시 해야 한다.

### `brain.bin` 다시 만들기

`flypuzzle` 저장소에서, MaleCNS v1.0 원본(`nfly/data/`)이 있어야 한다.

```python
# flypuzzle.viewer.simple.minimal_connectome() 이 만드는 부분집합과 같다
#   광수용체 전부 + hex 좌표가 있는 L1, min_syn=3
# scratchpad/pack.py 가 위 형식으로 직렬화한다
```

`CELLS = ["L1"]` 이 바닥선이다. 광수용체만 남기면 `photoreceptor_layout` 이
컬럼 타겟의 시냅스 가중 평균 육각좌표에 광수용체를 놓기 때문에 **망막 자체가 안 만들어진다.**

---

## 3. 한 수에 일어나는 일

```
Puzzle.Turn(fly, pieces, board, target, lookMs, onTick, onDone)
  setInterval(tick, lookMs)          ← 이 틱이 곧 초파리의 속도 제한이다
    tick():
      후보 한 쌍 (i, j) 를 꺼내
      기준 프레임을 복사하고 그 두 칸만 덮어써서            ← 전체를 다시 그리지 않는다
      fly.look(frame)  →  L1 1,767개 값
      fly.gap(그 값, 완성본 값)  →  숫자 하나
      제일 작은 것을 기억
    후보를 다 보면 onDone(최선의 쌍)
```

**후보를 만들고, 그림을 그리고, 제일 작은 것을 고르는 것은 전부 이 코드가 한다.**
초파리가 하는 일은 `fly.look()` 한 줄 — 그림 한 장에서 숫자 1,767개를 내는 것뿐이다.

### 왜 한 틱에 한 장인가

세 가지를 한꺼번에 해결한다.

1. **정직한 속도.** 실제 초파리는 뇌가 하나라 한 장면씩 보고, 광수용체에서 라미나까지
   12~22ms 가 걸린다. 모델의 시간상수(α=0.1 × 12스텝)도 한 스텝을 1.5ms 로 놓으면 18ms 다.
2. **탭이 안 멈춘다.** 워커 없이도 UI 가 살아 있다.
3. **"43/66장 보는 중" 이 진행바가 아니라 사실이 된다.**

`BASE_MS = 18`, 가속 `SPEEDS = [0.1, 0.5, 1, 2, 5, 10]`, 실제 간격은 `18 / 배수`.

| 조각 | 후보 | ×0.1 | ×1 | ×10 |
| ---: | ---: | ---: | ---: | ---: |
| 6 | 15 | 2.7s | 0.3s | 0.03s |
| 12 | 66 | 11.9s | **1.2s** | 0.12s |
| 20 | 190 | 34.2s | 3.4s | 0.34s |
| 30 | 435 | 78.3s | 7.8s | 0.78s |

한 장 처리에 **곱셈덧셈 103,332번** (간선 7,107 × 12스텝 + 망막 보간 약 18,000).
1 메가FLOP도 안 된다. JS 단일 스레드로 3.6ms, 파이썬+CPU로 0.22ms.

---

## 4. 화면

### 배치는 재서 정한다, 추정하지 않는다

이 부분에서 세 번 틀렸다. 지금 구조는 이렇다.

```
fit()                  줄 나누기만 한다
  세로 화면에서 arena 의 실제 높이를 재고
  내 판이 폭을 다 쓰는 높이를 구한 뒤
  남는 만큼을 위 띠에 준다 (바닥값 max(120px, 28%))
  arena.style.gridTemplateRows = "<px> minmax(0,1fr)"

ResizeObserver         캔버스 크기를 정한다
  상자가 확정된 뒤 브라우저가 주는 사각형만 쓴다
  sz = min(box.width / 비율, box.height)
```

**레이아웃을 바꾸는 것과 그 결과를 재는 것을 같은 호흡에 하면 안 된다.** 이전 프레임 값을
읽게 되고, 상자보다 큰 캔버스는 `overflow:hidden` 에 그냥 잘린다. 여백을 상수로 추정하던
방식은 웹폰트가 늦게 도착하는 것만으로도 어긋났다.

그리드 줄은 `auto` 가 아니라 비율/픽셀이어야 한다. `auto` 면 줄 높이가 캔버스에,
캔버스가 다시 줄 높이에 달려 **잴 값이 순환한다.**

캔버스에 `max-width/max-height` 를 걸어 누가 뭘 계산하든 상자를 못 넘게 해 뒀다.

### 세로 화면

판도 세로로 세운다. 가로 3×4 는 세로에서 4×3 이 되고, 그림도 640×400 대신 **400×640**
(정확히는 4:3 세로, `PORT = {w:240, h:320, pw:480, ph:640}`)으로 생성한다.
390px 폰에서 12조각 한 조각이 97×81 → **130×156** 픽셀이 된다.

초파리는 이 변화를 신경 쓰지 않는다 — 망막이 정규화 좌표로 표본하고 완성본도 같은 방식으로
표본하기 때문이다.

실제 브라우저로 잰 값 (넘침 없음, 모든 캔버스가 제 상자 안):

| 화면 | 원본 | 초파리 | 내 판 | 조각(4×3) |
| --- | --- | --- | --- | --- |
| 320×568 | 59×79 | 51×68 | 145×194 | 48×49 |
| 375×667 | 72×96 | 62×83 | 207×276 | 69×69 |
| 390×844 | 109×146 | 65×87 | 302×403 | 101×101 |
| 430×932 | 128×171 | 73×98 | 349×466 | 116×117 |
| 768×1024 | 147×196 | 141×188 | 399×533 | 133×133 |

### 입력

`pointerdown / pointermove / pointerup` 하나로 마우스와 손가락을 같이 받는다.
7픽셀 미만으로 움직이면 **탭**, 그 이상이면 **드래그**. 둘 다 `doSwap(a, b)` 하나로 모인다.

> 터치 기기에서 `touchend` 와 `click` 이 **둘 다** 오면 한 번의 탭이 두 번 처리되어
> 고르자마자 취소된다. `pointerup` 은 한 번만 온다. `PointerEvent` 가 없는 구형
> 브라우저만 예전 방식을 쓰되 600ms 가드를 건다.

캔버스에 `touch-action:none` — 없으면 드래그가 페이지 스크롤이 된다.

### 애니메이션

조각 교환은 `requestAnimationFrame` 으로 190ms 동안 두 타일을 서로 지나가게 그린다.

> `requestAnimationFrame` 은 **탭이 안 보이면 멈춘다.** 초파리는 그 콜백이 끝나야 다음 수를
> 두므로, 백그라운드로 보내면 영영 얼어붙었다. `setTimeout(land, SWAP_MS + 260)` 으로
> 한 번 더 막는다. 둘 중 먼저 오는 쪽이 `land()` 를 부르고 `over` 플래그로 중복을 막는다.

---

## 5. 언어팩

`lang.js` 의 `window.LANG` 에 언어별로 한 덩이씩 들어간다.

```js
window.LANG = {
  ko: { name, ui:{…}, sizes:[…], sizesShort:[…], howto:{…},
        intro:{…}, over:{…}, lord:{win:[…], lose:[…]},
        lines:{look,good,bad,ahead,behind,close,win,lose}, tug:[[75,[…]],…],
        pictures:{…} },
  en: { … },
}
```

- 정적 문구는 마크업의 `data-i18n="ui.title"` (텍스트), `data-i18n-html` (HTML),
  `data-i18n-list` (`<li>` 목록)로 붙고 `applyLang()` 이 한 번에 채운다.
- 대사는 말하는 순간 `T("lines.good")` 처럼 꺼낸다.
- **빠진 키는 한국어로 대체된다** — 번역이 덜 끝나도 빈칸이 안 생긴다.
- 선택기는 `Object.keys(LANG)` 로 스스로 만들어진다. **언어 추가 = 객체 하나 추가.**
- 자리표시자는 `{name}` 이고 `fmt(str, vars)` 가 채운다.

첫 방문에는 `navigator.language` 를 따르고, 고른 값은 `localStorage["btf:lang"]` 에 남는다.

---

## 6. 공개 집계

`abacus.jasoncameron.dev` 의 카운터 두 개 (`beat-the-fly/human`, `beat-the-fly/fly`).
판이 끝나면 이긴 쪽에 `/hit`, 진 쪽은 `/get`.

**이 숫자는 측정값이 아니다.** 정적 페이지는 인증을 할 수 없어서 `curl` 한 줄이면 누구나
올릴 수 있다. 화면에도 그렇게 적혀 있다. 재미로 보는 표기이고, 근거로 쓸 수 없다.

호출은 전부 실패해도 되게 짜여 있다 — 서비스가 죽으면 숫자 대신 아무것도 안 보여준다.
(비슷한 무료 서비스 셋 중 둘은 이미 죽어 있었다: `countapi.xyz` 무응답, `counterapi` v1 은 410.)

`localStorage` 는 언어(`btf:lang`)와 설명 건너뛰기(`btf:skipHowto`)에만 쓴다.
시크릿 창에서 예외가 날 수 있어 읽기/쓰기 전부 `try/catch` 로 감쌌다.

---

## 7. 화면 흐름

```
로드
 └ brain.bin 받고 안정 상태 계산 → 지도 두 개 그림 → 집계 조회
 └ #intro  대왕의 인사(전황에 따라 갈림) + 줄다리기
      ↓ 맞서기
    #howto  1쪽 규칙+그림 ↔ 2쪽 상대 제원   (다시 보지 않기 → 건너뜀)
      ↓ 시작
    countdown(3)  판 위에 3·2·1, 입력 잠김
      ↓
    flyTurn() ↔ 사람 입력      먼저 다 맞추면
      ↓
    finish(who)  #over  대왕의 한마디 + 줄다리기 갱신 + 집계 보고
      ↓ 다시 한 판
    idle() → howto()
```

---

## 8. 검사

### `node selftest.js`

실제 코드를 그대로 두고 **작은 소프트웨어 캔버스** 위에서 한 판을 끝까지 둔다.
`fillRect`, 경로, `stroke`, `drawImage`, `getImageData` 를 게임이 부르는 만큼만 구현했다.

```
  ok   도형 가로  640x400, 밝기 표준편차 21.4
  ok   도형 세로  400x640, 밝기 표준편차 16.6
  ...
  ok   가로 12조각 3x4 완성: 9수 (최단 9)
  ok   세로 12조각 4x3 완성: 9수 (최단 9)
  all good
```

보는 것: 그림마다 **밝기 분산이 충분한가**(평평한 그림은 조각이 다 똑같아 퍼즐이 안 된다),
초파리가 섞인 판과 완성본을 **구분하는가**, 그리고 **정말로 푸는가**.

이 검사가 밤하늘 그림을 잡아냈다 — 표준편차 2.0. 검은 하늘에 점만 있으면 조각이 서로
구분이 안 된다. 구름과 달을 넣어 54.2 가 됐다.

### 헤드리스 브라우저로 눈으로 보기

레이아웃은 코드만 봐서는 못 고친다. 크롬 헤드리스로 실제 렌더를 찍고 좌표를 읽는다.

```bash
python -m http.server 8903            # 이 폴더에서

# 화면 캡처 — iframe 으로 정확한 폰 크기를 강제한다
#   --window-size 는 --dump-dom 의 레이아웃에 반영되지 않는다
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=420,890 --force-device-scale-factor=1 \
  --virtual-time-budget=16000 --screenshot=out.png \
  "http://127.0.0.1:8903/_wrapper.html"

# 좌표 읽기 — 래퍼가 iframe 안을 재서 <pre> 로 뱉게 하고 --dump-dom
```

래퍼는 `<iframe src="index.html" style="width:390px;height:844px">` 한 줄이면 된다.
자동 시작이 필요하면 임시 사본에 `#go` 를 누르는 스크립트를 덧붙인다.
**임시 파일은 `_` 로 시작하게 만든다** — `.gitignore` 가 `_*.html` 을 무시한다.

---

## 9. 배포

세 곳이 같은 파일의 복사본이라 한 번에 같이 올려야 한다.

```bash
cd beat-the-fly
node selftest.js                      # 먼저 통과시킨다
rm -f _*.html                          # 임시 파일 정리

cp index.html lang.js fly.js puzzle.js brain.bin ../saintiron82.github.io/
cp index.html lang.js fly.js puzzle.js brain.bin ../flypuzzle/web/

for d in beat-the-fly saintiron82.github.io; do
  (cd ../$d && git add -A && git commit -F msg.txt && git push origin master)
done
(cd ../flypuzzle && git add -A web && git commit -F msg.txt && git push origin master)
```

GitHub Pages 빌드는 1~3분 걸린다. 확인:

```bash
gh api repos/saintiron82/saintiron82.github.io/pages/builds --jq '.[0].status'
```

`built` 가 되기 전에는 옛 파일이 그대로 나온다. **실패가 아니라 그냥 느린 것이다.**

커밋 메시지에 작은따옴표가 들어가면 셸이 깨진다. `-F 파일` 로 넘긴다.

---

## 10. 걸렸던 것들

한 번씩 시간을 잡아먹은 것만.

**`str.replace` 는 조용히 실패한다.** 패치 스크립트에서 이것 때문에 두 번 크게 돌아갔다.
한 번은 `picture()` 가 그림 생성기에 크기를 안 넘기게 되어 모든 그림이 `undefined` 로
그려졌다 — 예외도 안 나고 문법 검사도 통과하는데 페이지만 안 뜬다. **바꾸기 전에 assert.**

**범위로 지우지 말 것.** `.rank` 규칙 사이에 줄다리기 CSS 가 끼어 있어서, 첫 `.rank` 부터
마지막 `.rank` 까지 잘랐더니 가운데가 통째로 날아갈 뻔했다. 규칙은 하나씩 지운다.

**태그를 지울 때 닫는 짝을 같이.** 통계 칸을 지우면서 `</div>` 하나가 남아 결과 카드가
일찍 닫히고 나머지가 밖으로 튀어나갔다. 여는/닫는 개수를 세서 확인한다.

**`align-items:start` 는 그리드 항목을 늘리지 않는다.** 카드의 `height:100%` 가 풀리지
않아 판 상자가 0이 되고, 그걸 잰 `fit()` 이 캔버스를 0px 로 만들었다. 판이 아예 사라졌다.

**`grid-template-columns: auto` 는 max-content 로 커진다.** 세로 화면에서 원본 칸이
화면을 넘겨 가로 스크롤이 생겼다. `minmax(0,1fr)` 로 못박는다.

**`--window-size` 는 `--dump-dom` 의 레이아웃에 반영되지 않는다.** 500×749 로 재고 있었다.
iframe 으로 크기를 강제해야 진짜 폰 좌표가 나온다.

**subprocess 인코딩.** `encoding="utf-8"` 만 주고 `PYTHONIOENCODING` 을 안 주면, 자식이
cp949 로 내보낸 한글 경로에서 읽기 스레드가 예외로 죽고 `stdout` 이 **`None`** 이 된다.
그 예외는 밖으로 안 올라온다. 폴더 대화상자가 "고르지 않았다" 를 돌려주던 원인이었다.

**셸을 멈춰도 자식 파이썬은 안 죽는다.** 버려진 스크립트 넷이 GPU 를 3.6시간 동안
39% / 6.4GB 로 잡고 있었다. PID 로 죽여야 한다.

---

## 11. 남은 것

- `flypuzzle/viewer/battle.py` (파이썬 서버판)는 정적판을 만들기 전 버전이라 뒤처져 있다.
- 언어팩에 `ja`, `zh` 를 넣으려면 `lang.js` 에 객체 하나씩 추가하면 된다. 선택기는 자동.
- 집계를 진짜 데이터로 남기려면 Cloudflare Worker + KV 로 옮겨야 한다. 위조를 막지는
  못하지만 줄일 수는 있고, 판별 시간·수·난도를 실제로 저장할 수 있다.
