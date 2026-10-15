/**
 * gallery.js
 * 画廊页逻辑:读取提取结果、渲染响应式网格、勾选管理、带进度的批量下载。
 */

const GALLERY_KEY = 'galleryImages';

let images = [];          // 提取到的图片列表
let selected = new Set(); // 已勾选的下标集合
let cards = [];           // 下标 -> 卡片 DOM 元素

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();

  // 读取后台写入的图片列表,读完后立即清除,避免残留
  const data = await chrome.storage.local.get(GALLERY_KEY);
  await chrome.storage.local.remove(GALLERY_KEY);
  const stored = data[GALLERY_KEY];

  if (stored && Array.isArray(stored.images) && stored.images.length) {
    images = stored.images;
    render();
  } else {
    document.getElementById('empty').classList.remove('hidden');
  }
}

function bindEvents() {
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    selected = new Set(images.map((_, i) => i));
    syncCheckboxes();
  });

  document.getElementById('btnInvert').addEventListener('click', () => {
    const next = new Set();
    images.forEach((_, i) => { if (!selected.has(i)) next.add(i); });
    selected = next;
    syncCheckboxes();
  });

  document.getElementById('btnDownload').addEventListener('click', downloadSelected);
}

// ===================== 渲染网格 =====================
function render() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  cards = [];

  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="thumb-wrap">' +
        '<img src="' + escapeHtml(img.url) + '" loading="lazy" alt="商品图' + (idx + 1) + '">' +
        '<label class="check">' +
          '<input type="checkbox" data-index="' + idx + '">' +
          '<span class="checkmark"></span>' +
        '</label>' +
        '<span class="badge">' + img.width + '×' + img.height + '</span>' +
      '</div>' +
      '<div class="card-meta">' + (idx + 1) + ' · ' + img.width + '×' + img.height + '</div>';

    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(idx);
      else selected.delete(idx);
      updateSelectedCount();
    });

    // 点击缩略图区域(除复选框外)也可切换勾选
    card.querySelector('.thumb-wrap').addEventListener('click', (e) => {
      if (e.target.closest('.check')) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    grid.appendChild(card);
    cards[idx] = card;
  });

  updateTotal();
  updateSelectedCount();
}

// 全选/反选后,把 DOM 复选框状态同步为 selected 集合
function syncCheckboxes() {
  cards.forEach((card, idx) => {
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = selected.has(idx);
  });
  updateSelectedCount();
}

function updateTotal() {
  document.getElementById('totalCount').textContent = images.length;
}

function updateSelectedCount() {
  document.getElementById('selectedCount').textContent = selected.size;
}

// ===================== 批量下载 =====================
async function downloadSelected() {
  const indices = [...selected].sort((a, b) => a - b);
  if (!indices.length) { showToast('请先勾选要下载的图片'); return; }

  setBusy(true);
  resetProgress();

  const total = indices.length;
  let completed = 0;
  let success = 0;
  let failed = 0;
  const failures = [];

  const CONCURRENCY = 3; // 同时下载 3 张,兼顾速度与稳定性
  let cursor = 0;

  async function worker() {
    while (cursor < indices.length) {
      const pos = cursor++;          // pos 即最终序号(从 0 开始)
      const idx = indices[pos];      // 对应 images 中的下标
      const card = cards[idx];
      card.classList.add('downloading');

      // 序号从 1 开始,后台据此生成 商品图_001.png 等文件名
      const res = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGE',
        url: images[idx].url,
        index: pos + 1
      }).catch((e) => ({ ok: false, error: e.message }));

      card.classList.remove('downloading');
      completed++;

      if (res && res.ok) {
        success++;
        card.classList.add('done');
      } else {
        failed++;
        card.classList.add('failed');
        failures.push({
          name: '商品图_' + String(pos + 1).padStart(3, '0'),
          error: (res && res.error) || '未知错误'
        });
      }
      updateProgress(completed, total, success, failed);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, total); i++) workers.push(worker());
  await Promise.all(workers);

  setBusy(false);
  if (failures.length) console.warn('下载失败列表:', failures);
  showToast('下载完成:成功 ' + success + ' 张,失败 ' + failed + ' 张');
}

function setBusy(busy) {
  document.getElementById('btnDownload').disabled = busy;
  document.getElementById('btnSelectAll').disabled = busy;
  document.getElementById('btnInvert').disabled = busy;
}

function resetProgress() {
  document.getElementById('progressBar').classList.remove('hidden');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = '';
}

function updateProgress(done, total, success, failed) {
  const pct = Math.round((done / total) * 100);
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    '正在下载 ' + done + '/' + total + ' · 成功 ' + success + ' · 失败 ' + failed;
}

// ===================== 工具 =====================
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

let toastTimer;
function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
