import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, colors, model
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-chart-colors', configFile: false, envDir: false, logLevel: 'silent', server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  colors = await server.ssrLoadModule('/src/chartColors.ts')
  model = await server.ssrLoadModule('/src/model.ts')
})
after(() => server?.close())

const slice = (label, share) => ({ label, value: share * 100, share })

test("a user's own category names keep their own colour while preset categories hold nothing", () => {
  const out = colors.colorize([slice('加密貨幣資產', 0.27), slice('現金與外幣活存', 0.26), slice('海外股票', 0.24), slice('台股', 0.23)], model.CATEGORIES)
  assert.deepEqual(out.map((s) => s.label), ['加密貨幣資產', '現金與外幣活存', '海外股票', '台股'])
  assert.equal(new Set(out.map((s) => s.color)).size, 4)
  assert.ok(!out.some((s) => s.label === '其餘'))
  // Preset order decides the slot, not the rank: cash takes the first slot whatever its share.
  assert.equal(out.find((s) => s.label === '現金與外幣活存').color, 'var(--s1)')
})

test('past eight present entities the rest fold into 其餘', () => {
  const many = Array.from({ length: 10 }, (_, i) => slice(`類別${i}`, 0.1))
  const out = colors.colorize(many, [])
  assert.equal(out.length, 9)
  assert.equal(out.at(-1).label, '其餘')
  assert.ok(Math.abs(out.at(-1).share - 0.2) < 1e-9)
})
