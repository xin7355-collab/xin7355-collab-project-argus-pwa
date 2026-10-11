// 亮點偵測的單元測試。
//
// 跑法：npm test
//   （node --experimental-strip-types --test ...，不需要任何測試框架）
//
// 重點是證明「全域門檻」會把暗海域的小艇整個丟掉，而局部自適應門檻抓得到，
// 而且不會因此在雜訊上誤報一堆。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectBrightSpots, localStatsField, type LumImage } from './brightSpot.ts'

// ── 合成影像工具 ────────────────────────────────────────────

/** mulberry32：固定種子的 PRNG，測試才能重複。 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller 常態雜訊。 */
function gauss(r: () => number): number {
  const u = Math.max(1e-9, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

interface Canvas {
  img: LumImage
  /** 設定一個矩形區域的灰階值（alpha 一律 255）。 */
  fill: (
    x0: number,
    y0: number,
    w: number,
    h: number,
    lum: (x: number, y: number) => number,
  ) => void
}

function canvas(W: number, H: number): Canvas {
  const data = new Uint8ClampedArray(W * H * 4) // 預設全 0 → 全透明
  return {
    img: { width: W, height: H, data },
    fill(x0, y0, w, h, lum) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          const i = (y * W + x) * 4
          const v = lum(x, y)
          data[i] = v
          data[i + 1] = v
          data[i + 2] = v
          data[i + 3] = 255
        }
      }
    },
  }
}

/** 畫面上有沒有一個亮點落在 (cx, cy) 附近。 */
function near(spots: { x: number; y: number }[], cx: number, cy: number, tol = 8): boolean {
  return spots.some((s) => Math.abs(s.x - cx) <= tol && Math.abs(s.y - cy) <= tol)
}

/** 把亮度格建成跟 detectBrightSpots 內部一樣（step 2），供統計場測試用。 */
function lumGrid(img: LumImage, step = 2) {
  const gw = Math.ceil(img.width / step)
  const gh = Math.ceil(img.height / step)
  const L = new Float32Array(gw * gh)
  const d = img.data
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(img.width - 1, gx * step)
      const py = Math.min(img.height - 1, gy * step)
      const i = (py * img.width + px) * 4
      L[gy * gw + gx] =
        d[i + 3] < 10 ? -1 : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    }
  }
  return { L, gw, gh }
}

// ── 1. 核心缺陷：全域門檻讓暗區小艇被亮區淹掉 ──────────────

/**
 * 左半暗海（亮度 20）、右半太陽反光（亮度 120），左右各一艘小艇。
 * 左邊那艘只有 60——在暗海裡是十幾個 σ 的大目標，但遠低於全域門檻。
 */
function twoRegionScene(): Canvas {
  const c = canvas(256, 256)
  const r = rng(12345)
  c.fill(0, 0, 128, 256, () => 20 + gauss(r) * 3) // 暗海
  c.fill(128, 0, 128, 256, () => 120 + gauss(r) * 12) // 太陽反光
  c.fill(61, 125, 6, 6, () => 60) // 暗區小艇（相對當地很突出）
  c.fill(189, 125, 6, 6, () => 245) // 亮區小艇
  return c
}

test('局部門檻：暗區與亮區的小艇都要抓到', () => {
  const spots = detectBrightSpots(twoRegionScene().img)
  assert.ok(near(spots, 64, 128), `暗區小艇沒抓到：${JSON.stringify(spots)}`)
  assert.ok(near(spots, 192, 128), `亮區小艇沒抓到：${JSON.stringify(spots)}`)
  assert.ok(spots.length <= 4, `誤報過多：${spots.length} 個 ${JSON.stringify(spots)}`)
})

test('全域門檻（舊行為）：亮區小艇抓到、暗區小艇漏掉 — 這就是要修的缺陷', () => {
  const spots = detectBrightSpots(twoRegionScene().img, { localAdaptive: false })
  assert.ok(near(spots, 192, 128), '亮區小艇連舊版都該抓到')
  assert.ok(
    !near(spots, 64, 128),
    `舊版本來就該漏掉暗區小艇；若抓到了表示這個場景設計失效：${JSON.stringify(spots)}`,
  )
})

test('暗區小艇的突出度分數要夠高（才不會被亮區紋理擠出清單）', () => {
  const spots = detectBrightSpots(twoRegionScene().img)
  const dim = spots.find((s) => Math.abs(s.x - 64) <= 8 && Math.abs(s.y - 128) <= 8)
  assert.ok(dim, '暗區小艇沒抓到')
  // 局部 σ̂ 約 3 →(60−20)/3 ≈ 13σ；若用全域 σ̂（約 50）只有 0.8σ，會排到最後。
  assert.ok(dim.score > 5, `分數太低：${dim.score}`)
  assert.ok(Number.isFinite(dim.score), '分數必須是有限數')
})

// ── 2. 誤報護欄 ────────────────────────────────────────────

test('純雜訊暗海、沒有目標 → 幾乎不該有亮點', () => {
  const c = canvas(256, 256)
  const r = rng(777)
  c.fill(0, 0, 256, 256, () => 20 + gauss(r) * 3)
  const spots = detectBrightSpots(c.img)
  // 孤立單格雜訊被 minSize=2 擋掉；偶有相鄰兩格同時超標，放寬到 2。
  assert.ok(spots.length <= 2, `空海面誤報 ${spots.length} 個：${JSON.stringify(spots)}`)
})

test('完全平坦的畫面 → 0 個亮點（驗 minSigma 下限，否則門檻會崩到 0）', () => {
  const c = canvas(256, 256)
  c.fill(0, 0, 256, 256, () => 30)
  assert.equal(detectBrightSpots(c.img).length, 0)
})

test('平坦背景 + 亮塊：分數必須是有限數（MAD=0 時不能除以 0）', () => {
  const c = canvas(256, 256)
  c.fill(0, 0, 256, 256, () => 30)
  c.fill(125, 125, 6, 6, () => 200)
  const spots = detectBrightSpots(c.img)
  assert.ok(near(spots, 128, 128), `亮塊沒抓到：${JSON.stringify(spots)}`)
  for (const s of spots) assert.ok(Number.isFinite(s.score), `分數不是有限數：${s.score}`)
})

// ── 3. 覆蓋邊界：訓練格不足就要拒絕 ─────────────────────────

/**
 * 舊版的環測試是 `rc ? rs/rc : 0`——整圈都在畫面外或透明時 ringAvg 變成 0，
 * 於是 `v - 0 >= ringMargin` 無條件成立，影像覆蓋邊界會直接噴出假目標。
 * 新版要求有效訓練格 ≥ minTraining，估不出背景就不要猜。
 */
test('亮塊四周全是透明（估不出背景）→ 拒絕，不誤報', () => {
  const c = canvas(256, 256)
  const r = rng(99)
  c.fill(0, 128, 256, 128, () => 20 + gauss(r) * 3) // 下半部有資料，全域統計才算得出來
  c.fill(10, 10, 6, 6, () => 200) // 上半部孤島：四周 8px 內全透明
  const spots = detectBrightSpots(c.img)
  assert.ok(!near(spots, 13, 13, 10), `覆蓋邊界的孤島不該當成目標：${JSON.stringify(spots)}`)
})

test('同一個亮塊四周改成有海水 → 要抓到（證明上一條是「資料不足」而非擋掉亮塊本身）', () => {
  const c = canvas(256, 256)
  const r = rng(99)
  c.fill(0, 0, 256, 256, () => 20 + gauss(r) * 3)
  c.fill(10, 10, 6, 6, () => 200)
  const spots = detectBrightSpots(c.img)
  assert.ok(near(spots, 13, 13, 10), `有背景可估時就該抓到：${JSON.stringify(spots)}`)
})

// ── 4. 門檻場：重疊分塊不能留下接縫 ─────────────────────────

/** 用灰階函式造一張無雜訊的測試圖，並建出與偵測器一致的亮度格。 */
function gridFrom(W: number, H: number, lum: (x: number) => number) {
  const c = canvas(W, H)
  c.fill(0, 0, W, H, (x) => lum(x))
  return lumGrid(c.img)
}

test('門檻場：全圖都有覆蓋，且沿途單調不減（不能有來回跳的接縫）', () => {
  const { L, gw, gh } = gridFrom(256, 64, (x) => (x < 128 ? 20 : 120))
  const f = localStatsField(L, gw, gh, { fallbackMed: 70, fallbackSig: 50 })

  // 全圖都要被至少一個塊覆蓋到，否則就會有「退回全域統計」的破洞。
  for (let i = 0; i < gw * gh; i++) assert.ok(f.cnt[i] > 0, `格 ${i} 沒有被任何塊覆蓋`)

  const row = (gh >> 1) * gw
  let prev = -Infinity
  for (let gx = 0; gx < gw; gx++) {
    const v = f.med[row + gx]
    assert.ok(v >= prev - 1e-6, `門檻場在 gx=${gx} 回跳：${prev} → ${v}`)
    prev = v
  }
  assert.ok(f.med[row + 2] < 25, `左端門檻應貼近暗海：${f.med[row + 2]}`)
  assert.ok(f.med[row + gw - 3] > 115, `右端門檻應貼近亮區：${f.med[row + gw - 3]}`)
})

/**
 * 強雜波邊界（海岸線／反光邊緣）上，門檻場「不應該」出現兩側的混合值——
 * 混合值會讓亮的那一側整排誤報。edgeSkew 護欄會把跨邊界的塊剔掉，
 * 讓每一格都拿到某一側的乾淨統計。
 */
test('強邊界：門檻場不留兩側混合值（雜波邊界護欄要生效）', () => {
  const { L, gw, gh } = gridFrom(256, 64, (x) => (x < 128 ? 20 : 120))
  const f = localStatsField(L, gw, gh, { fallbackMed: 70, fallbackSig: 50 })
  for (let i = 0; i < gw * gh; i++) {
    const v = f.med[i]
    assert.ok(v <= 25 || v >= 115, `gx=${i % gw} 出現混合門檻 ${v}，邊界護欄沒生效`)
  }
})

/**
 * 反過來說，平緩漸變（不是雜波邊界）就該被重疊平均抹順。
 * 沒有重疊的話，步距等於塊寬，門檻會以約 25 為單位跳；50% 重疊砍半。
 */
test('平緩漸變：重疊平均要讓門檻場平滑（多層次、單步跳幅小）', () => {
  const { L, gw, gh } = gridFrom(256, 64, (x) => 20 + (100 * x) / 255)
  const f = localStatsField(L, gw, gh, { fallbackMed: 70, fallbackSig: 50 })

  const row = (gh >> 1) * gw
  const vals: number[] = []
  for (let gx = 0; gx < gw; gx++) vals.push(f.med[row + gx])

  let maxJump = 0
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] >= vals[i - 1] - 1e-6, `漸變場在 gx=${i} 回跳`)
    maxJump = Math.max(maxJump, vals[i] - vals[i - 1])
  }
  assert.ok(new Set(vals).size >= 6, `層次太少（${new Set(vals).size}），重疊平均沒生效`)
  assert.ok(maxJump <= 16, `單步跳幅過大：${maxJump}`)
  assert.ok(vals[0] < 40 && vals[gw - 1] > 100, `兩端值不對：${vals[0]} / ${vals[gw - 1]}`)
})
