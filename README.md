# 电商图片提取下载插件

一个 Chrome 浏览器扩展,在淘宝 / 天猫、京东、拼多多(含商家版)的商品详情页,一键提取页面内所有商品图片,并在新标签页中集中展示、勾选、批量下载为 PNG。

## 安装

1. 打开 Chrome,在地址栏输入 `chrome://extensions` 并回车。
2. 打开右上角的「开发者模式」开关。
3. 点击「加载已解压的扩展程序」,选择本项目文件夹(即包含 `manifest.json` 的目录)。
4. 加载成功后,工具栏会出现插件图标。

## 使用

1. 打开任意商品详情页(淘宝/天猫、京东、拼多多商家版)。
2. 页面右下角会出现悬浮按钮「获取图片」,点击它。
3. 插件会自动扫描并过滤页面图片,然后打开「商品图片提取结果」新标签页。
4. 勾选需要下载的图片(支持全选 / 反选),点击「下载选中」。
5. 图片统一转换为 PNG,按 `商品图_001.png`、`商品图_002.png` …… 保存到浏览器默认下载目录;顶部进度条会实时显示进度与成功/失败数量。

## 说明

- 悬浮按钮**仅出现在商品详情页**,其它页面不会显示。
- 自动过滤图标、logo、占位图、1×1 像素图及小于 100×100 的图片。
- 已兼容常见的懒加载属性(`data-src`、`data-lazy-src`、`data-original` 等)以及 `srcset` / `background-image` 背景图。
- 跨域图片由 Service Worker 通过 `fetch + createImageBitmap + OffscreenCanvas` 转换 PNG;若某张图片下载失败,通常是其 CDN 域名未在 `manifest.json` 的 `host_permissions` 中声明,按需补充对应域名后重新加载扩展即可。
- 若原图为 PNG,则直接保存不重复转换;若遇到无法转换的格式(如部分 SVG),会保留原格式并仍按统一序号命名。

## 文件结构

```
image-grabber/
├── manifest.json    # MV3 清单:权限、host_permissions、content_scripts、service_worker
├── content.js       # 注入悬浮按钮 + 详情页识别 + 图片提取与过滤
├── content.css      # 悬浮按钮与提示样式
├── background.js    # Service Worker:消息转发、PNG 转换、批量下载
├── gallery.html     # 结果展示新标签页
├── gallery.js       # 网格渲染、勾选管理、下载进度
├── gallery.css      # 响应式网格与交互样式
└── README.md        # 本说明文档
```
