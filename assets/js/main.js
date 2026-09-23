/* ============================================================
   孙茜 · 作品集 —— 网页版交互
   依赖 manifest.js（由 tools/build_tiles.py 生成）
   ============================================================ */
(function () {
  'use strict';

  var TILES = window.PORTFOLIO_TILES || {};
  var PAGES = window.PORTFOLIO_PAGES || {};

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  /* 告诉浏览器这张图在页面上占多宽，它才能从 srcset 里挑对档位。
     画面容器是 width:100%，但有个 max-width:1920px，所以宽屏上不再等于 100vw。 */
  var SIZES = '(min-width: 1920px) 1920px, 100vw';

  /* ---------------------------------------------------------
     1. 单页画面：套用清单里的真实尺寸和底色
     --------------------------------------------------------- */
  $$('img[data-page]').forEach(function (img) {
    var p = PAGES[img.dataset.page];
    if (!p) return;
    img.sizes = SIZES;
    img.srcset = p.srcset;
    img.src = p.src;                  // 老浏览器兜底
    img.width = p.w;
    img.height = p.h;
    img.style.background = p.bg;
    img.dataset.hi = p.hi;            // 放大查看时改用最大档
  });

  /* ---------------------------------------------------------
     2. 长图切片：生成 + 按需加载

     用 IntersectionObserver 而不是 loading="lazy"：
     浏览器自带的懒加载在慢速网络下会一次性预取 8000px，
     那会把好几 MB 的图在首屏就拉下来。
     --------------------------------------------------------- */
  var lazyIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var img = e.target;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      if (img.dataset.src) img.src = img.dataset.src;
      lazyIO.unobserve(img);
    });
  }, { rootMargin: '900px 0px', threshold: 0 });

  $$('.strip[data-strip]').forEach(function (strip) {
    var key = strip.dataset.strip;
    var tiles = TILES[key] || [];
    var sec = strip.closest('.sec');
    var label = sec ? (sec.dataset.label || '') : '';
    var frag = document.createDocumentFragment();

    tiles.forEach(function (t, i) {
      var img = document.createElement('img');
      // srcset 也延后到进入视口才设：提前设上去浏览器会立刻开始下载，懒加载就白做了。
      // sizes 可以先给，它只是告诉浏览器该挑哪一档，本身不触发请求。
      img.dataset.src = t.src;
      img.dataset.srcset = t.srcset;
      img.dataset.hi = t.hi;
      img.sizes = SIZES;
      img.width = t.w;
      img.height = t.h;
      img.style.background = t.bg;      // 加载完成前先铺上该切片自己的底色，避免闪白/闪黑
      img.decoding = 'async';
      img.loading = 'eager';            // 由上面的 IO 控制时机，这里不要再让浏览器插手
      img.dataset.zoom = 'group';
      img.dataset.group = key;
      img.alt = i === 0 ? label + ' 内容' : '';
      frag.appendChild(img);
      lazyIO.observe(img);
    });

    strip.appendChild(frag);
  });

  /* ---------------------------------------------------------
     3. 滚动：进度条 / 导航自动隐藏 / 回到顶部 / 当前章节
     --------------------------------------------------------- */
  var nav = $('#nav');
  var progress = $('#progress');
  var totop = $('#totop');
  var sections = $$('.sec');
  var navLinks = $$('.nav__links a[href^="#"]');
  var lastY = window.scrollY;
  var ticking = false;
  var mNarrow = window.matchMedia('(max-width: 1080px)');
  var mReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* 尺寸是要"读"的，读一次会让浏览器立刻算一遍布局。以前放在每帧的
     update() 里读，等于强制每帧重新布局一次 —— 强机器看不出来，弱机器上
     就是滚动发涩。改成只在真正可能变化时量一次。 */
  var secTops = [];
  var pageMax = 0;

  function measure() {
    secTops = sections.map(function (s) { return s.offsetTop; });
    pageMax = document.documentElement.scrollHeight - window.innerHeight;
  }

  function setActive(id) {
    navLinks.forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
    });
  }

  function update() {
    ticking = false;
    var y = window.scrollY;

    progress.style.transform = 'scaleX(' + (pageMax > 0 ? clamp(y / pageMax, 0, 1) : 0) + ')';

    nav.classList.toggle('is-solid', y > 90);

    // 向下滚收起导航、向上滚放出来，免得和每页自带的窗口条打架
    if (!nav.classList.contains('is-open')) {
      if (mNarrow.matches) {
        // 手机上目录页只有约 200px 高（1.92:1 的画面），导航浮在上面会盖住
        // 页面顶部的标题文字。所以顶部一律不显示，滚起来之后再按
        // 「上滚出现 / 下滚隐藏」走。
        if (y < 80 || y > lastY) nav.classList.add('is-hidden');
        else nav.classList.remove('is-hidden');
      } else if (y > lastY && y > 240) {
        nav.classList.add('is-hidden');
      } else {
        nav.classList.remove('is-hidden');
      }
    }
    lastY = y;

    totop.classList.toggle('is-on', y > window.innerHeight * 1.2);

    // 当前章节：以视口上方 35% 处为探针
    var probe = y + window.innerHeight * 0.35;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (secTops[i] <= probe) current = sections[i];
    }
    if (current) setActive(current.id);
  }

  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }, { passive: true });

  window.addEventListener('resize', function () { measure(); update(); });

  /* ---------------------------------------------------------
     锚点跳转：近的平滑滚，跨屏的直接瞬移

     本版整页约 5.5 万像素高，最长的一章（01 APP设计）自己就占了 2.6 万。
     如果交给 CSS 的 scroll-behavior:smooth，从目录点一次「联系我」会变成
     横穿全页的半分钟动画，沿途把整站图片全部下载解码一遍 —— 弱显卡机器上
     就是一路卡过去。
     --------------------------------------------------------- */
  function goTo(el) {
    var far = Math.abs(el.offsetTop - window.scrollY) > window.innerHeight * 2;
    var root = document.documentElement;
    root.style.scrollBehavior = (far || mReduce.matches) ? 'auto' : 'smooth';
    el.scrollIntoView({ block: 'start' });
    root.style.scrollBehavior = '';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var el = document.getElementById(a.getAttribute('href').slice(1));
    if (!el) return;
    e.preventDefault();
    closeMenu();
    goTo(el);
    history.replaceState(null, '', a.getAttribute('href'));
  });

  totop.addEventListener('click', goTo.bind(null, document.body));

  measure();
  update();

  // 图片是后插进来的、字体也可能迟一步换掉，尺寸会变。用 ResizeObserver
  // 盯着，变了才重量一次，而不是每帧去读。
  if (window.ResizeObserver) {
    new ResizeObserver(measure).observe(document.body);
  } else {
    window.addEventListener('load', measure);
  }

  /* ---------------------------------------------------------
     4. 手机端汉堡菜单
     --------------------------------------------------------- */
  var burger = $('#burger');
  var navLinksBox = $('#navLinks');

  function closeMenu() {
    navLinksBox.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
  }

  burger.addEventListener('click', function () {
    var open = !navLinksBox.classList.contains('is-open');
    navLinksBox.classList.toggle('is-open', open);
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
  });

  navLinksBox.addEventListener('click', function (e) {
    if (e.target.closest('a')) closeMenu();
  });

  /* ---------------------------------------------------------
     5. 目录三张卡片

     这个版本首页就是目录（那张画面本身就是「01 / 02 / 03」三张卡片），
     卡片热区是三个普通的 <a href="#..."> ，由第 3 节那个 document 级
     锚点处理器接管，这里不需要额外代码。
     别的版本有个「封面解锁」按钮，本版没有封面页，那段就删掉了。
     --------------------------------------------------------- */

  /* ---------------------------------------------------------
     6. 全屏放大
     --------------------------------------------------------- */
  var lbox = $('#lbox');
  var lboxImg = $('#lboxImg');
  var lboxLabel = $('#lboxLabel');
  var lboxClose = $('#lboxClose');
  var viewport = $('#lboxViewport');

  var gallery = [];
  var gi = 0;
  var scale = 1, tx = 0, ty = 0, fitScale = 1;

  function applyTransform() {
    lboxImg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function fitToViewport() {
    var iw = lboxImg.naturalWidth, ih = lboxImg.naturalHeight;
    if (!iw || !ih) return;
    var r = viewport.getBoundingClientRect();
    fitScale = Math.min(r.width / iw, r.height / ih);
    scale = fitScale;
    tx = (r.width  - iw * scale) / 2;
    ty = (r.height - ih * scale) / 2;
    applyTransform();
  }

  function showIndex(i) {
    if (!gallery.length) return;
    gi = (i + gallery.length) % gallery.length;
    var item = gallery[gi];
    lboxLabel.textContent = item.label;
    lboxImg.src = item.src;
    if (lboxImg.complete) fitToViewport();
  }

  function openLightbox(list, index) {
    gallery = list;
    lbox.hidden = false;
    document.body.style.overflow = 'hidden';
    scale = 1; tx = 0; ty = 0;
    showIndex(index);
  }

  function closeLightbox() {
    lbox.hidden = true;
    document.body.style.overflow = '';
    lboxImg.removeAttribute('src');
    gallery = [];
  }

  lboxImg.addEventListener('load', fitToViewport);
  lboxClose.addEventListener('click', closeLightbox);

  // 点任意画面进入放大；后景点击关闭
  document.addEventListener('click', function (e) {
    var img = e.target.closest('img[data-zoom]');
    if (!img) return;

    var group = img.dataset.group;
    var list, index;

    if (group) {
      var strip = document.querySelector('.strip[data-strip="' + group + '"]');
      var imgs = strip ? $$('img', strip) : [img];
      var sec = strip ? strip.closest('.sec') : null;
      var label = sec ? (sec.dataset.label || '') : '';
      list = imgs.map(function (im, i) {
        // 放大查看时直接取最大档（2880），看清 UI 细节——这正是面试官要看的东西
        return { src: im.dataset.hi || im.dataset.src || im.src,
                 label: label + '　' + (i + 1) + ' / ' + imgs.length };
      });
      index = imgs.indexOf(img);
    } else {
      var host = img.closest('.sec');
      list = [{ src: img.dataset.hi || img.dataset.src || img.src,
                label: (host && host.dataset.label) || '' }];
      index = 0;
    }

    openLightbox(list, Math.max(0, index));
  });

  // 滚轮缩放（以鼠标位置为锚点）
  viewport.addEventListener('wheel', function (e) {
    if (lbox.hidden) return;
    e.preventDefault();
    var r = viewport.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var next = clamp(scale * Math.exp(-e.deltaY * 0.0016), fitScale * 0.6, fitScale * 16);
    var k = next / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = next;
    applyTransform();
  }, { passive: false });

  // 拖动平移 + 双指捏合
  var pointers = new Map();
  var pinch = null;

  viewport.addEventListener('pointerdown', function (e) {
    if (lbox.hidden) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: scale, tx: tx, ty: ty,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2
      };
    } else {
      viewport.classList.add('is-grabbing');
    }
  });

  viewport.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    var prev = pointers.get(e.pointerId);
    var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinch) {
      var pts = Array.from(pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var r = viewport.getBoundingClientRect();
      var cx = pinch.cx - r.left, cy = pinch.cy - r.top;
      var next = clamp(pinch.scale * (dist / pinch.dist), fitScale * 0.6, fitScale * 16);
      var k = next / pinch.scale;
      tx = cx - (cx - pinch.tx) * k;
      ty = cy - (cy - pinch.ty) * k;
      scale = next;
      applyTransform();
    } else if (pointers.size === 1) {
      tx += dx; ty += dy;
      applyTransform();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) viewport.classList.remove('is-grabbing');
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  // 双击：适应窗口 ↔ 100%
  viewport.addEventListener('dblclick', function (e) {
    var r = viewport.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var next = Math.abs(scale - fitScale) < 0.001 ? 1 : fitScale;
    var k = next / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = next;
    applyTransform();
  });

  document.addEventListener('keydown', function (e) {
    if (lbox.hidden) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowRight') showIndex(gi + 1);
    if (e.key === 'ArrowLeft')  showIndex(gi - 1);
  });

  /* ---------------------------------------------------------
     7. 手机端提示：16:9 的画面在手机上很小，点开放大看细节
     --------------------------------------------------------- */
  var hint = $('#zoomHint');
  var firstStrip = $('.strip');
  if (hint && firstStrip && window.matchMedia('(max-width: 700px)').matches) {
    var hintShown = false;
    var hintIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || hintShown) return;
        hintShown = true;
        hint.style.opacity = '1';
        setTimeout(function () { hint.style.opacity = '0'; }, 7000);
        hintIO.disconnect();
      });
    }, { threshold: 0.2 });
    hintIO.observe(firstStrip);
  }

})();
