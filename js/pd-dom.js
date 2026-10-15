/**
 * ResearcherPapers 前端 DOM 层：唯一允许创建元素的地方。
 *
 * 来源与变更声明 / Provenance notice:
 *   新建文件，不含上游代码。上游为 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   见 docs/licenses/daily-arxiv-LICENSE）。
 *   变更（安全）：上游用模板字符串 + innerHTML 渲染卡片/模态框/标签
 *   （app.js / settings.js / statistic.js），外来标题、作者、摘要、AI 文本、
 *   分类、关键词都会进入 HTML。本文件改为 createElement + textContent 构建，
 *   并集中处理外链（http/https 白名单、rel="noopener noreferrer"）。
 *   因此本目录下不再存在任何把外来字符串写入 innerHTML 的代码路径。
 *   本文件为项目自写代码，不重新标注上游许可，亦不把上游代码标为 MIT。
 */
(function (root) {
  'use strict';

  const PD = root.PD = root.PD || {};

  /** 额外允许的元素与属性（默认集合之外的都拒绝）。 */
  const EXTRA_TAGS = {
    svg: ['viewBox', 'width', 'height', 'fill', 'xmlns', 'class', 'aria-hidden', 'focusable', 'preserveAspectRatio'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule'],
    g: ['transform', 'class', 'fill', 'stroke', 'opacity'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width'],
    text: ['x', 'y', 'dx', 'dy', 'transform', 'fill', 'font-size', 'text-anchor', 'class'],
    // SVG 的 <title> 是图形提示文本（不是 HTML head 里的 title）。
    title: [],
    tspan: ['x', 'y', 'dx', 'dy', 'fill', 'font-size'],
    iframe: ['src', 'title', 'loading', 'referrerpolicy', 'sandbox', 'width', 'height', 'frameborder', 'class'],
    input: ['type', 'value', 'placeholder', 'min', 'max', 'step', 'checked', 'disabled', 'readonly'],
    button: ['type', 'disabled', 'title'],
    a: ['target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    time: [],
    small: [],
    strong: [],
    em: [],
    br: [],
    hr: []
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * 必须用 createElementNS(SVG_NS) 创建的标签。
   * 用 HTML createElement('svg'|'path'|…) 会得到 HTMLUnknownElement / 错误命名空间，
   * 表现为 0x0 尺寸、viewBox 被小写化成 viewbox 而失效（真实浏览器已验证）。
   */
  const SVG_TAGS = ['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title'];

  function isSvgTag(tag) {
    return SVG_TAGS.indexOf(String(tag).toLowerCase()) !== -1;
  }

  const SAFE_ATTR_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
  // 这些是必须保持大小写的 SVG 属性（含 SVG 2 的驼峰形式）。
  const SVG_CAMEL_ATTRS = ['viewBox', 'preserveAspectRatio', 'gradientUnits', 'patternUnits',
    'clipPathUnits', 'textLength', 'lengthAdjust', 'baseFrequency', 'stdDeviation', 'markerWidth',
    'markerHeight', 'refX', 'refY', 'startOffset', 'pathLength', 'vectorEffect'];
  // 事件处理器一律拒绝：任何 on* 属性都是注入面。
  const FORBIDDEN_ATTR = /^on/i;

  function resolveDoc(doc) {
    if (doc) return doc;
    if (typeof document !== 'undefined') return document;
    throw new Error('pd-dom: no document available');
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isAllowedTag(tag) {
    const name = String(tag).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(EXTRA_TAGS, name)) return true;
    // 常用结构/文本元素白名单，避免用 iframe/script 等拼装内容。
    return [
      'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'label', 'figure', 'figcaption',
      'details', 'summary', 'code', 'pre', 'blockquote'
    ].indexOf(name) !== -1;
  }

  function isAllowedAttr(tag, name) {
    if (typeof name !== 'string' || !SAFE_ATTR_NAME.test(name)) return false;
    if (FORBIDDEN_ATTR.test(name)) return false;
    // URL 属性先通过白名单，再由 el() 用 pd-core 校验协议后才写入。
    if (name === 'href' || name === 'src') return true;
    if (name === 'style') return true; // 只接受本项目常量样式表，见 setStyle
    if (name === 'class' || name === 'title' || name === 'id' || name === 'role') return true;
    if (name.indexOf('data-') === 0) return true;
    if (name.indexOf('aria-') === 0) return true;
    const extra = EXTRA_TAGS[String(tag).toLowerCase()];
    if (extra && extra.indexOf(name) !== -1) return true;
    // SVG 驼峰属性白名单（大小写敏感，必须逐字匹配）
    if (SVG_CAMEL_ATTRS.indexOf(name) !== -1) return true;
    return false;
  }

  /** 样式只接受本项目写死的对象（键名受限、值拒绝 url(/expression/反引号）。 */
  const STYLE_VALUE_REJECT = /(url\s*\(|expression\s*\(|javascript:|[<>`\\])/i;
  const STYLE_KEY_OK = /^[a-z][a-zA-Z0-9-]*$/;

  function setStyle(node, style) {
    if (!isPlainObject(style)) return node;
    Object.keys(style).forEach(function (key) {
      if (!STYLE_KEY_OK.test(key)) return;
      const value = style[key];
      if (typeof value !== 'string' && typeof value !== 'number') return;
      const text = String(value);
      if (STYLE_VALUE_REJECT.test(text)) return;
      try {
        node.style.setProperty(key, text);
      } catch (error) {
        /* 忽略非法样式，不影响内容渲染 */
      }
    });
    return node;
  }

  /**
   * 建元素。attrs 里任何以 on 开头的属性、未白名单化的 URL 属性都会被丢弃。
   * 文本一律经 textContent，不存在 HTML 解析路径。
   */
  function el(tag, attrs, children, doc) {
    const documentRef = resolveDoc(doc);
    const name = String(tag).toLowerCase();
    if (!isAllowedTag(name)) {
      throw new Error('pd-dom: tag not allowed: ' + name);
    }
    const node = isSvgTag(name)
      ? (typeof documentRef.createElementNS === 'function'
        ? documentRef.createElementNS(SVG_NS, name)
        : documentRef.createElement(name))
      : documentRef.createElement(name);
    const options = isPlainObject(attrs) ? attrs : {};
    Object.keys(options).forEach(function (key) {
      if (key === 'text') {
        node.textContent = options[key] === null || options[key] === undefined ? '' : String(options[key]);
        return;
      }
      if (key === 'style') { setStyle(node, options[key]); return; }
      if (!isAllowedAttr(name, key)) return;
      const value = options[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'href' || key === 'src') {
        // URL 属性只接受已通过 pd-core 白名单的结果，其余丢空。
        const safe = PD.safeHttpUrl ? PD.safeHttpUrl(value) : null;
        if (!safe) return;
        node.setAttribute(key, safe);
        return;
      }
      // 属性名原样写入：SVG 的 viewBox / preserveAspectRatio 必须保持大小写，
      // 小写化会让 viewBox 失效（真实浏览器已验证）；HTML 属性名本来就是小写，不受影响。
      node.setAttribute(key, String(value));
    });
    if (children !== null && children !== undefined) {
      append(node, children, doc);
    }
    return node;
  }

  /** 追加子节点：字符串/数字一律成为文本节点，绝不被解析为 HTML。 */
  function append(parent, children, doc) {
    const documentRef = resolveDoc(doc || (parent && parent.ownerDocument));
    const list = Array.isArray(children) ? children : [children];
    for (let i = 0; i < list.length; i += 1) {
      const child = list[i];
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        parent.appendChild(documentRef.createTextNode(String(child)));
      } else if (Array.isArray(child)) {
        append(parent, child, documentRef);
      } else {
        parent.appendChild(child);
      }
    }
    return parent;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function setText(node, value) {
    if (!node) return node;
    node.textContent = value === null || value === undefined ? '' : String(value);
    return node;
  }

  /** 高亮分段渲染：segments 来自 pd-core.highlightSegments（纯文本切分）。 */
  function highlighted(node, text, terms, className, doc) {
    const documentRef = resolveDoc(doc || (node && node.ownerDocument));
    const segments = PD.highlightSegments ? PD.highlightSegments(text, terms) : [{ text: String(text || ''), hit: false }];
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (segment.hit && className) {
        node.appendChild(el('span', { class: className, text: segment.text }, null, documentRef));
      } else {
        node.appendChild(documentRef.createTextNode(segment.text));
      }
    }
    return node;
  }

  /**
   * 外链：只有 http/https 通过 pd-core 校验才写入 href。
   * 一律 noopener noreferrer，避免 window.opener 与 Referer 泄露。
   */
  function externalLink(url, label, className, doc) {
    const safe = PD.safeHttpUrl ? PD.safeHttpUrl(url) : null;
    if (!safe) return null;
    const node = el('a', {
      href: safe,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: className || ''
    }, label === null || label === undefined ? safe : label, doc);
    return node;
  }

  function downloadLink(url, label, className, doc) {
    const node = externalLink(url, label, className, doc);
    if (node) {
      node.setAttribute('rel', 'noopener noreferrer');
      node.setAttribute('download', '');
    }
    return node;
  }

  /** 只在 URL 是真实 PDF 时才创建 iframe；调用方不要自行拼 src。 */
  function pdfFrame(url, title, doc) {
    if (!PD.isRealPdfUrl || !PD.isRealPdfUrl(url)) return null;
    const safe = PD.safeHttpUrl(url);
    if (!safe) return null;
    return el('iframe', {
      src: safe,
      title: title || 'PDF',
      class: 'pdf-frame',
      width: '100%',
      height: '800px',
      frameborder: '0',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      sandbox: 'allow-scripts allow-same-origin allow-popups'
    }, null, doc);
  }

  PD.dom = {
    el: el,
    append: append,
    clear: clear,
    setText: setText,
    highlighted: highlighted,
    externalLink: externalLink,
    downloadLink: downloadLink,
    pdfFrame: pdfFrame,
    setStyle: setStyle,
    isAllowedTag: isAllowedTag,
    isSvgTag: isSvgTag,
    SVG_NS: SVG_NS,
    SVG_TAGS: SVG_TAGS,
    isAllowedAttr: isAllowedAttr,
    EXTRA_TAGS: EXTRA_TAGS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
