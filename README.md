# Argus

手機用的 PWA。React + TypeScript + Vite + Leaflet + Zustand + Tailwind，
部署在 Cloudflare Worker。

## 開發

```bash
npm install
npm run dev        # 開發
npm test           # 單元測試（Node 內建 test runner，零框架相依）
npm run typecheck
npm run build      # 產出 PWA
```

不填任何金鑰也跑得起來（會退回免金鑰資料來源）。要接真實影像來源時
複製 `.env.example` 成 `.env` 再填。

## 文件

- [架構](docs/架構.md)
- [設定教學](docs/設定教學.md)（手機可完成）
- [衛星過境預報](docs/衛星過境.md)
- 工作守則：[CLAUDE.md](CLAUDE.md)
