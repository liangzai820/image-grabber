/* =========================================================
   main.js · 图提取 ImageGrab 官网交互脚本
   职责:移动端菜单、滚动吸顶、滚动进入视口动画、导航区块高亮
   ========================================================= */

(function () {
  'use strict';

  // 标记 JS 可用:配合 CSS 的 .js .reveal,避免无 JS 时内容被动画隐藏
  document.documentElement.classList.add('js');

  // ===================== 1. 移动端汉堡菜单 =====================
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('open');
      navToggle.classList.toggle('active', isOpen);
      // 同步无障碍状态
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    // 点击任一导航链接后收起菜单
    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('open');
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ===================== 2. 导航栏滚动吸顶效果 =====================
  const navbar = document.getElementById('navbar');
  function onScroll() {
    if (!navbar) return;
    navbar.classList.toggle('scrolled', window.scrollY > 10);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // 初始化时执行一次

  // ===================== 3. 滚动进入视口动画 =====================
  // 元素进入视口后添加 .visible 触发淡入上移,并取消观察以提升性能
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    // 低版本浏览器兜底:直接显示
    revealEls.forEach((el) => el.classList.add('visible'));
  }

  // ===================== 4. 导航当前区块高亮 =====================
  // 以视口中间线为参考,当前处于中间线的 section 对应的导航项高亮
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"], .nav a[href^="#"]');

  if ('IntersectionObserver' in window && sections.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('id');
            navLinks.forEach((link) => {
              const active = link.getAttribute('href') === '#' + id;
              link.classList.toggle('active', active);
            });
          }
        });
      },
      // 收缩观察区域到视口中间一条横带,便于判断「当前」区块
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 }
    );
    sections.forEach((section) => sectionObserver.observe(section));
  }
})();
