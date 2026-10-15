/**
 * content.js
 * 电商图片提取插件 - 内容脚本
 * 职责:仅在商品详情页注入「获取图片」悬浮按钮,点击后扫描并过滤页面商品图片,
 *       最后通过 chrome.runtime.sendMessage 把图片列表发给扩展后台。
 */

// ===================== 可配置项 =====================
const MIN_WIDTH = 100;        // 图片最小宽度
const MIN_HEIGHT = 100;       // 图片最小高度
const MAX_IMAGES = 300;       // 单次最多提取数量,防止超大页面卡顿
const LOAD_TIMEOUT = 6000;    // 单张图片尺寸探测超时(毫秒)
const CONCURRENCY = 6;        // 尺寸探测并发数

// 命中这些关键词的 URL 视为图标/logo/占位图/二维码等,予以过滤
const BLOCKLIST = /logo|icon|avatar|favicon|loading|placeholder|spinner|qrcode|erweima|wechat|empty|default|blank|transparent|1x1/i;

// 各平台懒加载属性命名不同,这里做统一兼容
const LAZY_ATTRS = [
  'data-src', 'data-lazy-src', 'data-original', 'data-lazyload',
  'data-lazy', 'data-ks-lazyload', 'data-imghref', 'data-hi-res-src',
  'data-image', 'data-real-url', 'data-background'
];

// 按钮内联的下载图标(SVG)
const ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
  '<polyline points="7 10 12 15 17 10"/>' +
  '<line x1="12" y1="15" x2="12" y2="3"/></svg>';

let isExtracting = false;

// ===================== 页面识别 =====================
// 判断当前 URL 是否为商品详情页(仅详情页才显示按钮)
function isProductDetailPage() {
  const url = location.href;
  const host = location.hostname;

  // 淘宝 / 天猫
  if (/(taobao|tmall)\.com/.test(host)) {
    return /item\.htm/.test(url) || /detail\.tmall\.com/.test(host);
  }
  // 京东
  if (/jd\.com/.test(host)) {
    return /item\.jd\.com\/\d+/.test(url) ||
           /item\.m\.jd\.com\/(product|ware)/.test(url);
  }
  // 拼多多 / 拼多多商家版
  if (/(pinduoduo|yangkeduo)\.com/.test(host)) {
    return /goods\.html/.test(url) || /\/goods\//.test(url) || /goods_id=/.test(url);
  }
  return false;
}

// ===================== 悬浮按钮 =====================
function createButton() {
  const btn = document.createElement('button');
  btn.id = 'ig-ext-btn';
  btn.type = 'button';
  btn.innerHTML =
    '<span class="ig-ext-icon">' + ICON_SVG + '</span>' +
    '<span class="ig-ext-label">获取图片</span>';
  btn.addEventListener('click', onExtract);
  document.body.appendChild(btn);
}

// 切换按钮加载状态
function setButtonLoading(loading) {
  const btn = document.getElementById('ig-ext-btn');
  if (!btn) return;
  const icon = btn.querySelector('.ig-ext-icon');
  const label = btn.querySelector('.ig-ext-label');
  btn.disabled = loading;
  if (loading) {
    icon.innerHTML = '<span class="ig-spinner"></span>';
    label.textContent = '提取中…';
  } else {
    icon.innerHTML = ICON_SVG;
    label.textContent = '获取图片';
  }
}

// 页面内轻提示
function showToast(text) {
  let t = document.getElementById('ig-ext-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ig-ext-toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ===================== 图片提取 =====================
// 将任意地址补全为绝对 URL,并只保留 http/https
function toAbsolute(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url || /^(data:|blob:|javascript:)/i.test(url)) return null;
  try {
    const u = new URL(url, location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) { /* 忽略非法地址 */ }
  return null;
}

// 解析 srcset 字符串,返回其中的 URL 列表
function parseSrcset(srcset) {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// 从 <img> 标签收集图片(含懒加载属性与 srcset)
function collectImgTags() {
  const set = new Set();
  document.querySelectorAll('img').forEach((img) => {
    // currentSrc 优先(反映了 srcset 实际选中的地址)
    const src = toAbsolute(img.currentSrc || img.getAttribute('src'));
    if (src) set.add(src);

    // 各种懒加载属性
    LAZY_ATTRS.forEach((attr) => {
      const v = img.getAttribute(attr);
      if (!v) return;
      const a = toAbsolute(v);
      if (a) set.add(a);
    });

    // srcset / data-srcset 可能包含多个候选尺寸
    ['srcset', 'data-srcset'].forEach((attr) => {
      const v = img.getAttribute(attr);
      if (!v) return;
      parseSrcset(v).forEach((u) => {
        const a = toAbsolute(u);
        if (a) set.add(a);
      });
    });
  });
  return set;
}

// 从 CSS 的 background-image 中提取 URL
function extractUrlsFromCss(css) {
  const urls = [];
  if (!css || css === 'none') return urls;
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    if (m[2]) urls.push(m[2]);
  }
  return urls;
}

// 收集背景图:内联样式全量扫描,计算样式仅针对疑似图片容器(避免性能问题)
function collectBackgroundImages() {
  const set = new Set();
  document.querySelectorAll('*').forEach((el) => {
    // 内联样式
    const inline = el.style && el.style.backgroundImage;
    if (inline && inline !== 'none') {
      extractUrlsFromCss(inline).forEach((u) => {
        const a = toAbsolute(u);
        if (a) set.add(a);
      });
    }

    // 计算样式:仅对 id/class 疑似图片的节点做 getComputedStyle
    const cls = (el.className && el.className.toString()) || '';
    const id = el.id || '';
    if (/img|image|pic|photo|banner|gallery|thumb|sku|detail|slide/i.test(cls + ' ' + id)) {
      try {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          extractUrlsFromCss(bg).forEach((u) => {
            const a = toAbsolute(u);
            if (a) set.add(a);
          });
        }
      } catch (e) { /* 忽略无法取计算样式的节点 */ }
    }
  });
  return set;
}

// URL 关键词过滤(图标/logo/占位图等)
function isBlocked(url) {
  return BLOCKLIST.test(url);
}

// 探测单张图片的真实尺寸(跨域图片的 naturalWidth/Height 在页面内仍然可读)
function getImageSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (size) => { if (!done) { done = true; resolve(size); } };
    const timer = setTimeout(() => finish(null), LOAD_TIMEOUT);
    img.onload = () => {
      clearTimeout(timer);
      finish({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    img.src = url;
  });
}

// 带并发限制的 map,避免同时加载过多图片
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// 主提取流程:收集 -> 去重 -> 过滤 -> 尺寸探测 -> 排序
async function extractImages() {
  const urlSet = new Set();
  collectImgTags().forEach((u) => urlSet.add(u));
  collectBackgroundImages().forEach((u) => urlSet.add(u));

  // 去掉命中黑名单的地址
  const candidates = [...urlSet].filter((u) => !isBlocked(u)).slice(0, MAX_IMAGES);

  // 并发探测尺寸并过滤过小图片
  const sized = await mapWithConcurrency(candidates, CONCURRENCY, async (url) => {
    const size = await getImageSize(url);
    if (size && size.width >= MIN_WIDTH && size.height >= MIN_HEIGHT) {
      return { url, width: size.width, height: size.height };
    }
    return null;
  });

  const results = sized.filter(Boolean);
  // 按面积从大到小排序,优先展示大图(主图/细节图)
  results.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return results;
}

// ===================== 点击处理 =====================
async function onExtract() {
  if (isExtracting) return;
  isExtracting = true;
  setButtonLoading(true);
  try {
    const images = await extractImages();
    if (!images.length) {
      showToast('未找到符合条件的商品图片');
      return;
    }
    await chrome.runtime.sendMessage({ type: 'OPEN_GALLERY', images });
  } catch (e) {
    showToast('提取失败:' + (e && e.message ? e.message : '未知错误'));
  } finally {
    isExtracting = false;
    setButtonLoading(false);
  }
}

// ===================== 接收后台消息 =====================
// 工具栏图标点击时,后台会发送 EXTRACT 作为兜底触发
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'EXTRACT') {
    onExtract();
    sendResponse({ ok: true });
  }
});

// ===================== 初始化 =====================
function init() {
  if (!isProductDetailPage()) return;      // 非详情页不显示
  if (document.getElementById('ig-ext-btn')) return; // 避免重复注入
  createButton();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
