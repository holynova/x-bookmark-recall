<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="X 书签回看，在时间线里重读旧收藏：三条模拟推文之间插入一张蓝色的书签卡">
</p>

<p align="center">
  <a href="https://xiaosang.cc/x-bookmark-recall/">▶ 在线体验 Try the Demo</a>
  ·
  <a href="https://github.com/holynova/x-bookmark-recall/releases/tag/v0.3.0">下载 v0.3.0 Download</a>
  ·
  <a href="./README.en.md">完整英文版 Full English README</a>
</p>

**X 书签回看**是一款 Chrome 扩展。它把收藏过的帖子放回你正在刷的时间线，正文直接显示：可以换一条、打开原帖，或标为已读。书签不再是只进不出的收藏夹，而是会在刷 X 时重新遇到的旧相识。

**X Bookmark Recall** is a Chrome extension that brings your saved posts back into the X feed. Read the imported text inline, open the original, swap the card, or mark it as read — bookmarks stop being a write-only archive and resurface while you scroll.

## 截图 / Screenshots

<p align="center">
  <img src="./assets/readme/feed-zh.webp" width="100%" alt="演示时间线：旧收藏卡插在为你推荐信息流中，右侧是扩展弹窗的频道与展示位置设置">
</p>

<p align="center">
  <img src="./assets/readme/import-zh.webp" width="100%" alt="自动滚动导入面板：可设置最多导入条数和发帖年限">
</p>

截图与在线体验均使用演示数据。

## 三步开始 / Get Started

1. **安装**：下载并解压扩展。打开 `chrome://extensions/`，开启开发者模式，点击「加载已解压的扩展程序」，选择含 `manifest.json` 的文件夹。已安装的用户可以替换原目录里的文件，再点击「重新加载」。
2. **导入**：登录 X，刷新页面。从扩展弹窗打开书签页，点击「自动滚动导入」。最多条数和发帖年限均可留空；重复书签计入条数上限。
3. **回看**：回到首页。默认在「为你推荐」和「正在关注」都展示；顶部和时间线内的卡片可以独立开关。

## 继续往下刷 / As You Scroll

- 第一张时间线卡片默认插在第 3 条帖子后（可在弹窗里改）。
- 下一张需要随机间隔 9–15 条普通帖子，同时至少刷过约 3 屏；每趟最多再出现 3 张，两频道共享额度。
- 优先抽较早发布的未读帖；近期展示或跳过的书签暂缓出现（跳过后 3 天内不再抽）。
- 滚回同一个插入点会保留原卡，不会换一张新的。

## 功能 / Features

- **本机保存**：书签和阅读状态只保存在浏览器本地（`storage` + `unlimitedStorage`），不上传任何数据；已读可撤销。
- **双频道**：为你推荐 / 正在关注可各选其一或两个都展示；首页顶部与时间线内两种位置独立开关。
- **卡片操作**：原帖（打开原贴）、换一条（换一张候选卡）、标为已读；若 X 只在书签页显示摘要，可打开原帖读完整内容。
- **导入可控**：自动滚动导入可设条数上限与发帖年限；也可只导入已加载的书签，或滚动时继续收集。

## 本地开发 / Develop

```bash
npm ci
npm run check   # 语法检查 + 单元测试
npm test        # node --test（5 个测试文件）
```

扩展目录 `extension/` 可直接加载到 Chrome 调试；`site/` 是在线体验的演示站（演示数据）。

## 技术 / Tech

- Manifest V3（Chrome ≥ 114），零依赖：`extension/` 下纯原生 JS + CSS。
- 内容脚本注入 `x.com`：`x-page.js` 读时间线结构、`card.js` 渲染回看卡、`auto-import.js` 滚动导入书签、`scroll-recall.js` 控制插入节奏、`content.js` 统筹放置与交互；`worker.js` 是后台 Service Worker，`model.js` 管书签数据与抽取策略。
- 插入节奏是确定性的规则而非随机乱插：间隔 9–15 帖 + 3 屏滚动、每趟 3 张上限、跳过冷却 3 天，均可在 `scroll-recall.js` 与 `followups.js` 里核对。

```
extension/              Chrome 扩展（Manifest V3，v0.3.0）
  manifest.json         权限：storage、unlimitedStorage；仅匹配 https://x.com/*
  content.js            统筹卡片放置与交互
  x-page.js             读取 X 时间线结构
  card.js / card.css    回看卡片渲染与样式
  auto-import.js        书签页自动滚动导入
  scroll-recall.js      插入节奏（间隔 / 屏数）
  followups.js          后续卡片额度与冷却
  model.js              书签数据与抽取策略
  worker.js             后台 Service Worker
  popup.html/js/css     扩展弹窗（导入 + 设置）
site/                   在线体验演示站（demo.js + style.css）
test/                   5 个单元测试（node --test）
assets/readme/          hero 与截图（中英两套）
```

## English

**X Bookmark Recall** is a Chrome extension that brings your saved posts back into the X feed. Read the imported text inline, open the original, swap the card, or mark it as read.

- **Get started**: download and unzip the extension, load it unpacked at `chrome://extensions/` (Developer mode). Sign in to X, open Bookmarks from the popup, and start **Scroll and import** (item and age limits optional; duplicates count toward the limit). Cards appear in both **For You** and **Following** by default, with top and inline placements toggled separately.
- **As you scroll**: the first inline card defaults to after 3 posts; the next needs a random gap of 9–15 posts plus about 3 screens of scrolling, up to 3 extra cards per visit (shared across feeds). Older unread posts are favored; recently shown or skipped ones rest (3-day cooldown after a skip). Scrolling back restores the same card.
- **Privacy**: bookmarks and read status stay in your browser (local storage only); reads can be undone.
- **Tech**: Manifest V3 (Chrome ≥ 114), zero dependencies, vanilla JS. `npm ci && npm run check` runs syntax checks plus unit tests (`node --test`, 5 files). The installed extension's controls are currently in Chinese.
- Full English version: [README.en.md](./README.en.md).
