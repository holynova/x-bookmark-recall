<p align="right">简体中文 · <a href="./README.en.md">English</a></p>
<p align="center"><img src="./assets/readme/hero-zh.svg" width="100%" alt="X 书签回看，在时间线里重读旧收藏"></p>

**X 书签回看**是一款 Chrome 扩展。它把收藏过的帖子放回你正在刷的时间线，正文直接显示。可以换一条、打开原帖，或标为已读。

[在线体验](https://xiaosang.cc/x-bookmark-recall/) · [下载 v0.3.0](https://github.com/holynova/x-bookmark-recall/releases/tag/v0.3.0)

![演示时间线中的旧收藏卡与频道设置](./assets/readme/feed-zh.webp)

## 三步开始

1. 下载并解压扩展。打开 `chrome://extensions/`，开启开发者模式，点击「加载已解压的扩展程序」，选择含 `manifest.json` 的文件夹。已安装的用户可以替换原目录里的文件，再点击「重新加载」。
2. 登录 X，刷新页面。从扩展弹窗打开书签页，点击「自动滚动导入」。条数和发帖年限均可留空，重复书签计入条数上限。
3. 回到首页。默认在「为你推荐」和「正在关注」都展示。顶部和时间线内的卡片可以独立开关。

![自动滚动导入面板，可设置最多条数和发帖年限](./assets/readme/import-zh.webp)

## 继续往下刷

第一张时间线卡片默认插在第 3 条帖子后。下一张随机间隔 9–15 条普通帖子，同时至少刷过约 3 屏。按剩余候选，每趟最多再出现 3 张，两频道共享额度。优先抽较早发布的未读帖，近期展示或跳过的书签暂缓出现。滚回同一个插入点会保留原卡。

书签和阅读状态保存在本机。已读可撤销。若 X 只在书签页显示摘要，可打开原帖阅读完整内容。截图与在线体验均使用演示数据。

<details>
<summary>本地开发与部署</summary>

```sh
npm ci
npm run check
npm run dev
npm run deploy:check
```

扩展目录 `extension/` 可直接加载。演示由作品集 Worker 提供。把 `main` 已提交的 `site/` 同步到作品集 `master` 的 `x-bookmark-recall/`，按作品集配置手动部署。

[GitHub Repo](https://github.com/holynova/x-bookmark-recall)

<img src="./assets/qr.png" width="120" alt="扫码打开在线演示">
</details>
