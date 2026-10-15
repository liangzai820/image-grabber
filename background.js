/**
 * background.js
 * 后台 Service Worker
 * 职责:接收内容脚本消息、把图片列表写入 storage 并打开画廊页、
 *       处理跨域抓取 + PNG 转换,最后调用 chrome.downloads 批量下载。
 */

const GALLERY_KEY = 'galleryImages';

// ===================== 消息路由 =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'OPEN_GALLERY') {
    handleOpenGallery(msg.images)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // 保持消息通道,异步响应
  }

  if (msg.type === 'DOWNLOAD_IMAGE') {
    handleDownload(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});

// 工具栏图标点击兜底:通知当前标签页的内容脚本重新提取
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT' });
  } catch (e) {
    // 非商品详情页或内容脚本未注入,忽略即可
  }
});

// ===================== 打开画廊页 =====================
async function handleOpenGallery(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('没有可展示的图片');
  }
  // 列表通过 storage 传给画廊页,避免 URL 长度限制
  await chrome.storage.local.set({ [GALLERY_KEY]: { token: Date.now(), images } });
  await chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
}

// ===================== 下载单张图片 =====================
async function handleDownload(msg) {
  const { url, index } = msg;
  if (!url) throw new Error('缺少图片地址');

  const result = await fetchAndConvertToPng(url);
  const filename = buildFilename(index, result.ext);

  const downloadId = await chrome.downloads.download({
    url: result.objectUrl,
    filename: filename,
    saveAs: false
  });

  // 延迟释放 Blob URL,确保下载任务已真正开始
  setTimeout(() => URL.revokeObjectURL(result.objectUrl), 60000);

  return {
    ok: true,
    index,
    downloadId,
    note: result.converted ? '已转换为PNG' : '保留原格式'
  };
}

// ===================== 抓取并转换为 PNG =====================
async function fetchAndConvertToPng(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const blob = await resp.blob();
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();

  // 本身就是 PNG,无需转换,直接使用
  if (contentType.includes('image/png') || /\.png(\?|#|$)/i.test(url)) {
    return { objectUrl: URL.createObjectURL(blob), ext: 'png', converted: false };
  }

  // 其它格式(jpg/webp/gif/avif 等)通过 createImageBitmap + OffscreenCanvas 转 PNG
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return { objectUrl: URL.createObjectURL(pngBlob), ext: 'png', converted: true };
  } catch (e) {
    // 部分格式(如 SVG 或异常数据)无法创建位图,回退为原图并保留原扩展名
    const ext = extFromType(contentType) || extFromUrl(url);
    return { objectUrl: URL.createObjectURL(blob), ext, converted: false };
  }
}

// ===================== 工具函数 =====================
// 文件名规则:商品图_001.png(序号补零)
function buildFilename(index, ext) {
  const n = String(index).padStart(3, '0');
  return `商品图_${n}.${ext}`;
}

function extFromUrl(url) {
  const m = url.match(/\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/);
  return m ? m[1].toLowerCase() : 'jpg';
}

function extFromType(type) {
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('svg')) return 'svg';
  if (type.includes('bmp')) return 'bmp';
  if (type.includes('avif')) return 'avif';
  return null;
}
