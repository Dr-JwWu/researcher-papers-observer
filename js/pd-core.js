/**
 * ResearcherPapers 前端核心：纯函数层（无 DOM、无网络、无依赖）。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件是 ResearcherPapers 新写的适配层，不含上游代码。
 *   页面布局与数据形状沿用 daily-arXiv-ai-enhanced（main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，
 *   见 .upstream/daily-arxiv 与 docs/licenses/daily-arxiv-LICENSE，Modified Apache License）。
 *   变更（相对上游 daily 的同名行为）：数据源改为本站相对 data/ 目录；
 *   URL 必须通过 http(s) 白名单；日期按 published_precision 显示、不补造月日；
 *   主题用 topics（embodied/surgical，允许双命中）而非 categories；pdf 仅真实 PDF。
 *   2026-10 阅读改版新增：可选 reading 字段（中文标题 / 分条要点 / 可核单位 / 合法配图）；
 *   配图 src 走 assets/papers/ 相对路径白名单（无协议、无主机、无穿越）；
 *   详情四项优先用结构化列表，旧 AI 字符串只做保守分条（不破小数、不改写）。
 *   本文件不是上游文件，不重新标注 MIT，许可仍随 docs/licenses 说明。
 *
 * 读取的数据契约（与 paper_digest/export.py 一致，前端只读不写）：
 *   assets/file-list.txt                     每行一个数据文件名
 *   data/YYYY-MM-DD_AI_enhanced_Chinese.jsonl 每行一条 public_paper JSON
 *   data/YYYY-MM-DD_digest.json               daily summary（make_day 的 summary）
 * 公共字段见 public_paper()；日汇总字段见 make_day()/summarize_day()。
 */
(function (root, factory) {
  'use strict';
  const PD = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = PD;
  if (root) root.PD = PD;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 主题标签：只有这两个，允许双命中。 */
  const TOPICS = ['embodied', 'surgical'];
  const TOPIC_ORDER = { embodied: 0, surgical: 1 };

  /** 来源：只认 arxiv/pubmed，其它一律按未知来源显示、不当成 arXiv。 */
  const SOURCES = ['arxiv', 'pubmed'];

  /** 数据文件命名，与 export.build_site 写出的文件名一致。 */
  const FILE_LIST_PATH = 'assets/file-list.txt';
  const DATA_DIR = 'data';
  const DAILY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})_AI_enhanced_([A-Za-z]+)\.jsonl$/;
  const DIGEST_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})_digest\.json$/;

  /** AI 五字段，顺序即展示顺序。 */
  const AI_FIELDS = ['tldr', 'motivation', 'method', 'result', 'conclusion'];

  const URL_SAFE = 'safe';
  const URL_REJECT_NOT_HTTP = 'not-http';
  const URL_REJECT_CREDENTIALS = 'credentials';
  const URL_REJECT_UNPARSEABLE = 'unparseable';
  const URL_REJECT_EMPTY = 'empty';
  const URL_REJECT_CONTROL = 'control-char';

  const DATE_PRECISIONS = ['year', 'month', 'day', 'time'];

  /* ------------------------------------------------------------------ *
   * 文本与 URL 安全
   * ------------------------------------------------------------------ */

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function hasControlChars(value) {
    if (typeof value !== 'string') return true;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
  }

  /**
   * 只做字符替换。本项目的所有输出都走 DOM 文本节点，
   * escape 仅用于文本导出/剪贴板等纯文本场景，不参与 HTML 拼接。
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 标签探测：用于测试/审计断言“外来字符串没有变成 DOM 元素”。
   * 命中即说明该字符串一旦被当成 HTML 解析就会产生元素或事件属性。
   */
  function containsHtmlMarkup(value) {
    if (typeof value !== 'string') return false;
    // 标签起始判定要求 '<' 紧跟字母/!/?//，因此 'a < b' 这类比较符不会误报；
    // 但仍覆盖 <script>、</script>、<?php、<!DOCTYPE 等真实标记起始。
    return /<\/?[a-zA-Z!?]/.test(value) || /&#[0-9a-zA-Z]+;?/.test(value) ||
      /%3c/i.test(value) || /\son[a-z]+\s*=/i.test(value);
  }

  /**
   * 外链唯一入口：只允许 http/https，禁止内嵌凭据、控制字符与相对路径。
   * 返回 {ok, url, reason}；调用方必须检查 ok 后才可写入 href/iframe src。
   */
  function normalizeHttpUrl(value) {
    if (value === null || value === undefined || value === '') {
      return { ok: false, url: null, reason: URL_REJECT_EMPTY };
    }
    if (typeof value !== 'string') {
      return { ok: false, url: null, reason: URL_REJECT_UNPARSEABLE };
    }
    const raw = value.trim();
    if (raw === '') return { ok: false, url: null, reason: URL_REJECT_EMPTY };
    if (hasControlChars(raw)) return { ok: false, url: null, reason: URL_REJECT_CONTROL };
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return { ok: false, url: null, reason: URL_REJECT_UNPARSEABLE };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, url: null, reason: URL_REJECT_NOT_HTTP };
    }
    if (!parsed.hostname) return { ok: false, url: null, reason: URL_REJECT_UNPARSEABLE };
    if (parsed.username || parsed.password) {
      return { ok: false, url: null, reason: URL_REJECT_CREDENTIALS };
    }
    return { ok: true, url: parsed.href, reason: URL_SAFE };
  }

  function safeHttpUrl(value) {
    const result = normalizeHttpUrl(value);
    return result.ok ? result.url : null;
  }

  /**
   * 真实 PDF 判定。上游把 PMC 文章页当 PDF（abs→pdf 字符串替换）是错的：
   * 只有明确是 PDF 的 URL 才允许出现按钮或 iframe。
   */
  function isRealPdfUrl(value) {
    const result = normalizeHttpUrl(value);
    if (!result.ok) return false;
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === 'pmc.ncbi.nlm.nih.gov' || host.endsWith('.pmc.ncbi.nlm.nih.gov')) {
      return path.endsWith('.pdf');
    }
    if (host === 'arxiv.org' || host.endsWith('.arxiv.org')) {
      return /^\/pdf\//.test(path) || path.endsWith('.pdf');
    }
    return path.endsWith('.pdf');
  }

  /**
   * 卡片配图（reading.figure.src）的唯一入口：只允许本站静态目录
   * `assets/papers/` 下的、由后端许可核对后落盘的单张图片。
   *
   * 与公开导出契约 v0.4 严格一致：文件名必须是内容 sha256（64 位小写十六进制）
   * 加 `.png/.jpg/.jpeg/.webp`，**不允许子目录、不允许任意文件名、不接受 gif/avif/svg**。
   * 这样即使同源目录里混入别的文件，也无法被数据指向当作论文配图。
   *
   * 为什么单独一条白名单、而不复用 safeHttpUrl：
   *   - 图片必须是许可已核实、由后端复制到本地的静态文件，不允许指向外部主机
   *     （外部 <img> 会带来第三方追踪与热链，也绕开本项目的“不加载外部资源”约定）；
   *   - 因此这里显式拒绝任何协议（含 javascript:/data:）、主机、绝对路径、
   *     `//`、反斜杠、查询串/锚点、控制字符与 `..` 穿越（含百分号编码后的穿越）。
   * 返回规范化后的相对路径，或 null（非法即不显示图，不猜测、不替换）。
   */
  const ASSET_PAPERS_PREFIX = 'assets/papers/';
  const FIGURE_FILE_RE = /^[0-9a-f]{64}\.(?:png|jpg|jpeg|webp)$/;

  function safeAssetImagePath(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (raw === '') return null;
    if (hasControlChars(raw)) return null;
    if (raw.indexOf('\\') !== -1) return null;
    if (raw.indexOf('?') !== -1 || raw.indexOf('#') !== -1) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null; // 任何协议（http:、data:、javascript:）
    if (raw.charAt(0) === '/') return null;                  // 站内绝对路径也不接受
    if (raw.indexOf('//') !== -1) return null;               // 协议相对 //host
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (error) {
      return null; // 畸形百分号序列
    }
    if (hasControlChars(decoded)) return null;
    if (decoded.indexOf('\\') !== -1) return null;
    if (decoded.indexOf('..') !== -1) return null;
    if (decoded.charAt(0) === '/') return null;
    if (decoded.indexOf('//') !== -1) return null;
    if (decoded.indexOf(ASSET_PAPERS_PREFIX) !== 0) return null;
    const rest = decoded.slice(ASSET_PAPERS_PREFIX.length);
    // 只允许“一层 + sha256 文件名 + 位图后缀”，与公开导出 v0.4 完全一致。
    if (!FIGURE_FILE_RE.test(rest)) return null;
    return ASSET_PAPERS_PREFIX + rest;
  }

  /**
   * 上游用 url.replace('abs','pdf')/replace('abs','html') 造链接。这里禁止：
   * 只接受数据里真实存在的 http(s) 字段，缺失就返回 null。
   */
  function paperLinks(paper) {
    const record = paper && typeof paper === 'object' ? paper : {};
    const abs = safeHttpUrl(record.abs) || safeHttpUrl(record.url);
    const pdf = safeHttpUrl(record.pdf);
    const pdfOk = pdf && isRealPdfUrl(pdf) ? pdf : null;
    return {
      abs: abs,
      pdf: pdfOk,
      code: safeHttpUrl(record.code_url),
      // 数据缺少摘要页链接时不猜测来源，也不拼接 arxiv.org/abs/<id>。
      absUnavailable: !abs
    };
  }

  /** 论文进入本轮日报的方式（可选第 17 字段，缺省=旧 16 字段数据）。 */
  const DISCOVERY_KINDS = ['backfill', 'window_match'];

  function normalizeDiscoveryKind(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    return DISCOVERY_KINDS.indexOf(text) !== -1 ? text : '';
  }

  function sourceLabel(source) {
    return SOURCES.indexOf(source) === -1 ? 'unknown' : source;
  }

  /* ------------------------------------------------------------------ *
   * 日期与精度（不得用抓取日冒充发表日）
   * ------------------------------------------------------------------ */

  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function normalizePrecision(value, published) {
    if (DATE_PRECISIONS.indexOf(value) !== -1) {
      if (value === 'time') return 'day';
      return value;
    }
    if (!isNonEmptyString(published)) return 'unknown';
    const text = published.trim();
    if (/^\d{4}$/.test(text)) return 'year';
    if (/^\d{4}-\d{2}$/.test(text)) return 'month';
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return 'day';
    return 'unknown';
  }

  /**
   * 只显示数据里真实存在的精度：YYYY 就只显示年，YYYY-MM 就只显示年月。
   * 禁止把缺月日补齐成 1 月 1 日（上游 new Date() 会这么干）。
   * 返回 {precision, iso, display, year, month, day}，display 为 '' 表示不可显示。
   */
  function describePublished(published, precision) {
    const effective = normalizePrecision(precision, published);
    const text = isNonEmptyString(published) ? published.trim() : '';
    const out = { precision: effective, iso: null, display: '', year: null, month: null, day: null };
    if (effective === 'unknown' || text === '') return out;

    const yearOnly = /^(\d{4})$/.exec(text);
    const monthOnly = /^(\d{4})-(\d{2})$/.exec(text);
    const dayMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (effective === 'year' && yearOnly) {
      out.year = Number(yearOnly[1]);
      out.iso = yearOnly[1];
      out.display = yearOnly[1];
      return out;
    }
    if (effective === 'month' && monthOnly) {
      const month = Number(monthOnly[2]);
      if (month >= 1 && month <= 12) {
        out.year = Number(monthOnly[1]);
        out.month = month;
        out.iso = monthOnly[0];
        out.display = monthOnly[0];
        return out;
      }
    }
    if (effective === 'day' && dayMatch && isIsoDate(dayMatch[0])) {
      out.year = Number(dayMatch[1]);
      out.month = Number(dayMatch[2]);
      out.day = Number(dayMatch[3]);
      out.iso = dayMatch[0];
      out.display = dayMatch[0];
      return out;
    }
    // 精度与文本不一致：不猜，降级为“未标注”。
    out.precision = 'unknown';
    return out;
  }

  /** 修订时间：只接受真实 ISO 时间字符串，不补全、不猜测。 */
  const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

  function describeUpdated(updated) {
    if (!isNonEmptyString(updated)) return { display: '', iso: null };
    const text = updated.trim();
    if (!ISO_TIME_RE.test(text)) return { display: '', iso: null };
    return { display: text.slice(0, 10), iso: text };
  }

  /** 发现时间（抓取时刻）：只展示到日，且必须与发表时间分开标注。 */
  function describeDiscovered(discoveredAt) {
    if (!isNonEmptyString(discoveredAt)) return { display: '', iso: null };
    const text = discoveredAt.trim();
    if (!ISO_TIME_RE.test(text)) return { display: '', iso: null };
    return { display: text.slice(0, 10), iso: text };
  }

  /**
   * 日报生成/更新时间：只接受真实 ISO 时间，显示到分钟（UTC 偏移不额外标注，
   * 因为这里只表示“日报更新时间”，不参与发表日期或检索窗口推断）。
   */
  function describeTimestamp(value) {
    if (!isNonEmptyString(value)) return { display: '', iso: null };
    const text = value.trim();
    if (!ISO_TIME_RE.test(text)) return { display: '', iso: null };
    const date = text.slice(0, 10);
    const timeMatch = /T(\d{2}):(\d{2})/.exec(text);
    return { display: timeMatch ? date + ' ' + timeMatch[1] + ':' + timeMatch[2] : date, iso: text };
  }

  /** 日报文件的日期键 → 显示用；只接受真实 YYYY-MM-DD。 */
  function describeFileDate(date) {
    if (!isIsoDate(date)) return { display: '', iso: null };
    return { display: date, iso: date };
  }

  /** 日期区间标签：起止都必须真实，且 start<=end。 */
  function describeDateRange(start, end) {
    if (!isIsoDate(start) || !isIsoDate(end) || start > end) return { display: '', start: null, end: null };
    return { display: start + ' ~ ' + end, start: start, end: end };
  }

  /* ------------------------------------------------------------------ *
   * 数据源路径（本站相对目录，不访问 raw.githubusercontent / API）
   * ------------------------------------------------------------------ */

  function dailyFilePath(date, language) {
    if (!isIsoDate(date)) return null;
    const lang = language || 'Chinese';
    return DATA_DIR + '/' + date + '_AI_enhanced_' + lang + '.jsonl';
  }

  function digestFilePath(date) {
    if (!isIsoDate(date)) return null;
    return DATA_DIR + '/' + date + '_digest.json';
  }

  /** file-list.txt 纯文本解析：只收本站 data/ 下的日报文件，忽略路径穿越。 */
  function parseFileList(text) {
    const result = { dates: [], dailyFiles: [], digests: [], byDate: {}, ignored: [] };
    if (typeof text !== 'string' || text.trim() === '') return result;
    const seenDaily = {};
    const seenDigest = {};
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i].trim();
      if (raw === '') continue;
      if (raw.indexOf('..') !== -1 || raw.charAt(0) === '/' || /^[a-zA-Z]+:/.test(raw)) {
        result.ignored.push(raw);
        continue;
      }
      const name = raw.indexOf('/') === -1 ? raw : raw.slice(raw.lastIndexOf('/') + 1);
      const daily = DAILY_FILE_PATTERN.exec(name);
      const digest = DIGEST_FILE_PATTERN.exec(name);
      if (daily) {
        const date = daily[1];
        if (!isIsoDate(date)) { result.ignored.push(raw); continue; }
        if (!seenDaily[date]) { seenDaily[date] = []; result.byDate[date] = result.byDate[date] || { languages: [], digest: null }; }
        if (seenDaily[date].indexOf(daily[2]) === -1) seenDaily[date].push(daily[2]);
        result.byDate[date].languages = seenDaily[date];
        result.dailyFiles.push({ date: date, language: daily[2], path: DATA_DIR + '/' + name, name: name });
        if (result.dates.indexOf(date) === -1) result.dates.push(date);
      } else if (digest) {
        const date = digest[1];
        if (!isIsoDate(date)) { result.ignored.push(raw); continue; }
        if (seenDigest[date]) continue;
        seenDigest[date] = true;
        result.byDate[date] = result.byDate[date] || { languages: [], digest: null };
        result.byDate[date].digest = DATA_DIR + '/' + name;
        result.digests.push({ date: date, path: DATA_DIR + '/' + name, name: name });
      } else {
        result.ignored.push(raw);
      }
    }
    // 排序：不依赖 NaN；用 ISO 字符串比较并对非法日期兜底。
    result.dates.sort(function (a, b) {
      if (!isIsoDate(a)) return 1;
      if (!isIsoDate(b)) return -1;
      return a < b ? 1 : (a > b ? -1 : 0);
    }); // 新→旧
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 论文记录解析（对外来字段一律只取白名单，缺就置空，不造值）
   * ------------------------------------------------------------------ */

  function stringList(value) {
    if (typeof value === 'string') return value.trim() === '' ? [] : [value];
    if (!Array.isArray(value)) return [];
    return value.filter(function (item) { return typeof item === 'string' && item.trim() !== ''; });
  }

  function normalizeTopics(value) {
    const list = stringList(value);
    const unique = [];
    for (let i = 0; i < list.length; i += 1) {
      if (TOPICS.indexOf(list[i]) !== -1 && unique.indexOf(list[i]) === -1) unique.push(list[i]);
    }
    unique.sort(function (a, b) { return TOPIC_ORDER[a] - TOPIC_ORDER[b]; });
    return unique;
  }

  /** categories 只是来源分类标签，绝不用于主题筛选。 */
  function normalizeCategories(value) {
    const list = stringList(value);
    const unique = [];
    for (let i = 0; i < list.length; i += 1) {
      if (unique.indexOf(list[i]) === -1) unique.push(list[i]);
    }
    return unique;
  }

  function normalizeAi(value) {
    const source = value && typeof value === 'object' ? value : {};
    const ai = {};
    for (let i = 0; i < AI_FIELDS.length; i += 1) {
      const key = AI_FIELDS[i];
      ai[key] = typeof source[key] === 'string' ? source[key] : '';
    }
    return ai;
  }

  const AI_EMPTY = '摘要未提供';

  /**
   * 公开导出里的原摘要占位句：正式周未逐篇核准原文转载许可，
   * 公共数据不转载原摘要（私有库仍保留完整摘要供 AI 分析，AI 只依据摘要）。
   * 页面必须把它当“没有原摘要”，不能在“原摘要”标题下假装有摘要。
   */
  const ABSTRACT_PLACEHOLDER = '原摘要请见论文来源页面。';

  function isAbstractPlaceholder(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '') return false; // 空串是“缺摘要”，不是占位
    return text === ABSTRACT_PLACEHOLDER || (text.length <= 40 && text.indexOf('原摘要请见') !== -1);
  }

  /** 是否为可公开展示的真实原摘要（占位句与空串都算没有）。 */
  function hasPublicAbstract(paper) {
    const text = paper && typeof paper.abstract === 'string' ? paper.abstract.trim() : '';
    return text !== '' && !isAbstractPlaceholder(text);
  }

  /* ------------------------------------------------------------------ *
   * 阅读增强字段 reading（可选）：中文标题、分条要点、可核单位、合法配图
   *
   * 形状（后端许可核对后才会写进公开导出；缺字段即不存在，不推断）：
   *   reading = {
   *     title_zh: string,
   *     bullets: {motivation:[str], method:[str], result:[str], conclusion:[str]},
   *     affiliations: [{name: string, source_url: string}],
   *     figure: {src: 'assets/papers/<sha256 64位小写十六进制>.png|jpg|jpeg|webp',
   *              caption: string, source_url: string, license: string,
   *              credit_url?: 'docs/figure-credits.html#paper-<cid>'}
   *   }
   * 17 字段旧数据没有 reading，页面必须照常可读（回退到 AI 字符串）。
   * ------------------------------------------------------------------ */

  const READING_FIELDS = ['motivation', 'method', 'result', 'conclusion'];
  /** 渲染护栏：单字段最多渲染多少条要点（超出的数据仍留在原始导出里）。 */
  const READING_BULLET_LIMIT = 50;
  const AFFILIATION_LIMIT = 12;

  function emptyReadingBullets() {
    const out = {};
    for (let i = 0; i < READING_FIELDS.length; i += 1) out[READING_FIELDS[i]] = [];
    return out;
  }

  function normalizeReadingBullets(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const out = emptyReadingBullets();
    for (let i = 0; i < READING_FIELDS.length; i += 1) {
      const field = READING_FIELDS[i];
      const list = stringList(source[field]);
      const trimmed = [];
      for (let j = 0; j < list.length && trimmed.length < READING_BULLET_LIMIT; j += 1) {
        const item = list[j].trim();
        if (item !== '' && trimmed.indexOf(item) === -1) trimmed.push(item);
      }
      out[field] = trimmed;
    }
    return out;
  }

  /**
   * 可核单位：只认数据里显式给出的 name；source_url 必须通过 http(s) 白名单
   * 才会成为可点击来源（非法 URL 只丢链接，不丢名称，也绝不按作者名猜单位）。
   */
  function normalizeAffiliations(value) {
    const raw = Array.isArray(value) ? value : [];
    const out = [];
    for (let i = 0; i < raw.length && out.length < AFFILIATION_LIMIT; i += 1) {
      const item = raw[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      // 新 schema：name（原文）+ name_zh（中文）；旧数据只有 name 也照常可用。
      const name = isNonEmptyString(item.name) ? item.name.trim() : '';
      const nameZh = isNonEmptyString(item.name_zh) ? item.name_zh.trim() : '';
      if (name === '' && nameZh === '') continue;
      const key = (name || nameZh).toLowerCase();
      if (out.some(function (entry) { return (entry.name || entry.nameZh).toLowerCase() === key; })) continue;
      const sourceUrl = safeHttpUrl(item.source_url);
      out.push({
        name: name,
        nameZh: nameZh,
        // 展示标签：原文 + （中文）；只有中文时就用中文，不拼接空括号。
        label: name === '' ? nameZh : (nameZh === '' || nameZh === name ? name : name + '（' + nameZh + '）'),
        sourceUrl: sourceUrl,
        verifiable: !!sourceUrl
      });
    }
    return out;
  }

  /**
   * 卡片上的论文编号 pill：只做前缀剥离，不拼接、不猜测。
   *   arxiv:2610.18869 → 2610.18869     pubmed:42853000 → PMID 42853000
   * 其它来源保留原始 id；空 id 返回 ''。
   */
  function paperIdLabel(paper) {
    const id = paper && isNonEmptyString(paper.id) ? paper.id.trim() : '';
    if (id === '') return '';
    const match = /^([A-Za-z]+):(.+)$/.exec(id);
    if (!match) return id;
    const source = match[1].toLowerCase();
    const value = match[2].trim();
    if (value === '') return '';
    if (source === 'pubmed') return 'PMID ' + value;
    return value;
  }

  /**
   * 配图：src 必须是 assets/papers/ 下的本地静态图片，且必须带非空 license
   * （许可不明确一律不显示，宁缺勿伪造授权）；source_url 只作为外链来源。
   */
  function normalizeFigure(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const src = safeAssetImagePath(value.src);
    if (!src) return null;
    const license = isNonEmptyString(value.license) ? value.license.trim() : '';
    if (license === '') return null;
    const caption = isNonEmptyString(value.caption) ? value.caption.trim() : '';
    return {
      src: src,
      caption: caption,
      sourceUrl: safeHttpUrl(value.source_url),
      license: license,
      creditUrl: safeCreditUrl(value.credit_url)
    };
  }

  /**
   * 逐图署名页（figure.credit_url）的唯一入口：**只允许本站生成的相对署名页**，
   * 精确形如 `docs/figure-credits.html#paper-2610-18869`（backend c671：canonical id 转小写，
   * `[a-z0-9]` 之外的连续字符归一为 '-'，因此必须是 `paper-` + 非空分段、单短横连接）。
   * 不接受无锚点裸页、尾随/连续短横、协议、主机、绝对路径、穿越或查询串；
   * 非法即返回 null（页面回退到图源外链，不猜地址）。
   * 注意：NOTICE 上的集中署名页入口是静态 HTML 里的普通相对链接，不经过本函数。
   */
  const CREDIT_URL_RE = /^docs\/figure-credits\.html#paper-[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const CREDIT_URL_MAX = 200;

  function safeCreditUrl(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (raw === '') return null;
    if (hasControlChars(raw)) return null;
    if (raw.indexOf('\\') !== -1) return null;
    if (raw.indexOf('?') !== -1) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
    if (raw.charAt(0) === '/' || raw.indexOf('//') !== -1) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (error) {
      return null;
    }
    if (decoded.indexOf('..') !== -1) return null;
    if (decoded.length > CREDIT_URL_MAX) return null;
    if (!CREDIT_URL_RE.test(decoded)) return null;
    return decoded;
  }

  /**
   * 许可文本 → 官方许可页：只有**固定已知映射**，绝不按任意许可字符串拼 URL
   * （拼出来的“看似合法”链接会把许可写错，比没有链接更糟）。
   * 目前真实导出的都是 CC BY 4.0；未知许可返回 {url: null}，页面只显示许可文本。
   */
  const LICENSE_LINKS = Object.freeze({
    'cc by 4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'https://creativecommons.org/licenses/by/4.0/': 'https://creativecommons.org/licenses/by/4.0/',
    'http://creativecommons.org/licenses/by/4.0/': 'https://creativecommons.org/licenses/by/4.0/',
    'creativecommons.org/licenses/by/4.0/': 'https://creativecommons.org/licenses/by/4.0/'
  });

  function licenseInfo(license) {
    const text = isNonEmptyString(license) ? license.trim() : '';
    if (text === '') return { license: '', url: null, known: false };
    // 归一化只用于查表：大小写、空白、连字符/下划线差异视为同一个已知许可。
    const key = text.toLowerCase().replace(/[\s_-]+/g, ' ');
    const url = LICENSE_LINKS[key];
    if (!url) return { license: text, url: null, known: false };
    const safe = safeHttpUrl(url);
    return { license: text, url: safe, known: !!safe };
  }

  function normalizeReading(value) {
    const out = {
      present: false,
      titleZh: '',
      bullets: emptyReadingBullets(),
      affiliations: [],
      figure: null
    };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    out.present = true;
    out.titleZh = isNonEmptyString(value.title_zh) ? value.title_zh.trim() : '';
    out.bullets = normalizeReadingBullets(value.bullets);
    out.affiliations = normalizeAffiliations(value.affiliations);
    out.figure = normalizeFigure(value.figure);
    return out;
  }

  /** 卡片/详情主标题：有中文标题用中文，否则回退英文原题（不翻译、不拼接）。 */
  function displayTitle(paper) {
    const reading = paper && paper.reading ? paper.reading : null;
    if (reading && reading.titleZh !== '') return { main: reading.titleZh, secondary: paper.title };
    return { main: (paper && paper.title) || '', secondary: '' };
  }

  /* ------------------------------------------------------------------ *
   * 旧版 AI 长字符串 → 保守分条
   *
   * 只有 reading.bullets 的结构化列表缺失时才会用到。规则是“宁可少切”：
   *   - 只在句末标点后切（。！？；! ? ; 与换行）；
   *   - 英文句点仅在“后面是空白 + 大写字母/CJK”且“前面不是数字”且
   *     “前一个词不是常见缩写”时才切 → 不会把 3.5 / 0.92 / et al. / v1.2 切断；
   *   - 只做切片，不改写、不补写、不合并（每条都是原文的连续子串）。
   * ------------------------------------------------------------------ */

  const ABBREVIATION_TAIL = /(?:^|[\s(（[【"“'‘])(?:et|al|e\.g|i\.e|eg|ie|fig|figs|eq|eqs|tab|sec|ref|refs|no|nos|vol|pp|cf|vs|approx|ca|dr|mr|mrs|ms|prof|inc|ltd|co|corp|univ|dept|resp|ieee|acm|arxiv|bio|med|min|max|avg|std|etc)$/i;

  function isSentenceBoundary(text, index) {
    const char = text.charAt(index);
    if (char === '\n' || char === '。' || char === '！' || char === '？' || char === '；' ||
        char === '!' || char === '?' || char === ';') {
      return true;
    }
    if (char !== '.') return false;
    // 保护小数与版本号：只有“点号两侧都是数字”时才是小数点（3.5 / 0.92 / v1.2.3），
    // 此时绝不切分；句末点号（“达 0.92. The model…”“v1.2 发布。”）仍可切。
    const prev = text.charAt(index - 1);
    const next = text.charAt(index + 1);
    const prevIsDigit = prev >= '0' && prev <= '9';
    const nextIsDigit = next >= '0' && next <= '9';
    if (prevIsDigit && nextIsDigit) return false;
    if (next !== ' ' && next !== '\t' && next !== '\n') return false;
    let cursor = index + 1;
    while (cursor < text.length && (text.charAt(cursor) === ' ' || text.charAt(cursor) === '\t')) cursor += 1;
    if (cursor >= text.length) return true; // 结尾的句点
    const after = text.charAt(cursor);
    const isUpperLatin = after >= 'A' && after <= 'Z';
    const isCjk = after.charCodeAt(0) > 0x2e7f;
    if (!isUpperLatin && !isCjk) return false;
    const before = text.slice(0, index);
    if (ABBREVIATION_TAIL.test(before)) return false;
    return true;
  }

  /** 保守分条：返回非空片段数组（每段都是入参的连续子串，只去首尾空白）。 */
  function splitSentences(text) {
    if (typeof text !== 'string') return [];
    const value = text;
    const parts = [];
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (!isSentenceBoundary(value, i)) continue;
      let end = i + 1;
      // 连续句末标点（"。。"、"！?"）并成一条，避免产生只有标点的条目。
      while (end < value.length && isSentenceBoundary(value, end)) end += 1;
      const chunk = value.slice(start, end).trim();
      if (chunk !== '') parts.push(chunk);
      start = end;
      i = end - 1;
    }
    if (start < value.length) {
      const tail = value.slice(start).trim();
      if (tail !== '') parts.push(tail);
    }
    return parts;
  }

  /**
   * 详情四项要点：优先 reading.bullets 的结构化列表（不切分），
   * 否则回退旧 AI 字符串做保守分条（不伪造、不破小数）。
   * 返回 {field: {items:[str], basis:'reading'|'legacy'|'none'}}。
   */
  function paperBullets(paper) {
    const reading = paper && paper.reading && typeof paper.reading === 'object'
      ? paper.reading
      : normalizeReading(null);
    const ai = (paper && paper.ai) || {};
    const out = {};
    for (let i = 0; i < READING_FIELDS.length; i += 1) {
      const field = READING_FIELDS[i];
      const structured = reading.bullets && Array.isArray(reading.bullets[field]) ? reading.bullets[field] : [];
      if (structured.length > 0) {
        out[field] = { items: structured.slice(), basis: 'reading' };
        continue;
      }
      const legacy = typeof ai[field] === 'string' ? ai[field].trim() : '';
      out[field] = legacy === ''
        ? { items: [], basis: 'none' }
        : { items: splitSentences(legacy), basis: 'legacy' };
    }
    return out;
  }

  /**
   * 单条 JSONL 行 → 公开视图字段。返回 null 表示该行不可展示（缺 id 或缺标题）。
   * 注意：不读取 extra；不把 AI 文本混进事实字段。
   */
  function normalizePaper(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw.paper && typeof raw.paper === 'object' ? raw.paper : raw;
    const id = isNonEmptyString(record.id) ? record.id.trim() : '';
    const title = isNonEmptyString(record.title) ? record.title.trim() : '';
    if (!id || !title) return null;

    const ai = normalizeAi(record.AI);
    const published = isNonEmptyString(record.published) ? record.published.trim() : null;
    const updated = isNonEmptyString(record.updated) ? record.updated.trim() : null;
    const discovered = isNonEmptyString(record.discovered_at) ? record.discovered_at.trim() : null;
    const source = SOURCES.indexOf(record.source) !== -1 ? record.source : '';
    const links = paperLinks(record);

    return {
      id: id,
      source: source,
      sourceLabel: sourceLabel(record.source),
      title: title,
      // 可选阅读增强（17 字段旧数据没有 reading，全部字段退化为空，不推断）。
      reading: normalizeReading(record.reading),
      authors: stringList(record.authors),
      abstract: typeof record.summary === 'string' ? record.summary : '',
      ai: ai,
      aiBasis: record.analysis_basis === 'abstract' ? 'abstract' : '',
      aiAvailable: AI_FIELDS.some(function (key) { return ai[key].trim() !== ''; }),
      topics: normalizeTopics(record.topics),
      categories: normalizeCategories(record.categories),
      doi: isNonEmptyString(record.doi) ? record.doi.trim() : null,
      published: published,
      publishedPrecision: normalizePrecision(record.published_precision, published),
      updated: updated,
      discoveredAt: discovered,
      discoveryKind: normalizeDiscoveryKind(record.discovery_kind),
      links: links,
      fileDate: null
    };
  }

  /**
   * JSONL 文本 → {papers, invalidLines, totalLines}。
   * 坏行跳过并计数（不静默吞掉，界面要能看到缺口）。
   */
  function parseJsonl(text, options) {
    const opts = options || {};
    const fileDate = opts.fileDate || null;
    const result = { papers: [], invalidLines: 0, totalLines: 0, dropped: 0 };
    if (typeof text !== 'string' || text.trim() === '') return result;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line === '') continue;
      result.totalLines += 1;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        result.invalidLines += 1;
        continue;
      }
      const paper = normalizePaper(parsed);
      if (!paper) { result.dropped += 1; continue; }
      if (fileDate && isIsoDate(fileDate)) paper.fileDate = fileDate;
      result.papers.push(paper);
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 日期汇总（digest）解析
   * ------------------------------------------------------------------ */

  function normalizeCoverage(value) {
    const source = value && typeof value === 'object' ? value : {};
    const status = source.status === 'complete' ? 'complete' : (source.status === 'partial' ? 'partial' : 'unknown');
    const sources = [];
    if (Array.isArray(source.sources)) {
      for (let i = 0; i < source.sources.length; i += 1) {
        const item = source.sources[i];
        if (!item || typeof item !== 'object') continue;
        const itemSource = SOURCES.indexOf(item.source) !== -1 ? item.source : 'unknown';
        const itemStatus = item.status === 'complete' ? 'complete' : (item.status === 'partial' ? 'partial' : 'unknown');
        sources.push({
          source: itemSource,
          sourceLabel: sourceLabel(item.source),
          status: itemStatus,
          candidateCount: typeof item.candidate_count === 'number' ? item.candidate_count : null,
          metadataFetched: typeof item.metadata_fetched === 'number' ? item.metadata_fetched : null,
          dateFrom: isIsoDate(item.date_from) ? item.date_from : null,
          dateTo: isIsoDate(item.date_to) ? item.date_to : null,
          errorCount: typeof item.error_count === 'number' ? item.error_count : null,
          limitCount: typeof item.limit_count === 'number' ? item.limit_count : null,
          missingMetadata: typeof item.missing_metadata === 'number' ? item.missing_metadata : null
        });
      }
    }
    return {
      status: status,
      sources: sources,
      scopeNote: isNonEmptyString(source.scope_note) ? source.scope_note.trim() : '',
      // 缺口是显式的：partial 或来源为空都必须让用户看到。
      hasGap: status !== 'complete' || sources.length === 0 ||
        sources.some(function (item) { return item.status !== 'complete'; })
    };
  }

  /**
   * 来源状态列表（research_scope 里唯一会被页面使用的信息）。
   * 兼容两种形状：["arxiv", "pubmed"] 或 [{source: "arxiv", reason: "..."}]；
   * 只保留已知来源 id（arxiv/pubmed），非法值与原因文本一律丢弃；
   * policy/计数/UTC 窗口/失败原因等流程诊断不解析、不展示。
   */
  function normalizeScopeSourceList(listValue) {
    const raw = Array.isArray(listValue) ? listValue : [];
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i];
      const candidate = typeof item === 'string'
        ? item.trim()
        : (item && typeof item === 'object' && typeof item.source === 'string' ? item.source.trim() : '');
      if (SOURCES.indexOf(candidate) !== -1 && out.indexOf(candidate) === -1) out.push(candidate);
    }
    return out;
  }

  function scopeSourceList(scopeValue, key, topLevelValue) {
    const scope = scopeValue && typeof scopeValue === 'object' ? scopeValue : null;
    if (scope && Array.isArray(scope[key])) return normalizeScopeSourceList(scope[key]);
    return normalizeScopeSourceList(topLevelValue);
  }

  /** 本轮真的拿不到数据的来源（源内 facts=0 或整段采集缺失）→“本期 X 来源暂缺”。 */
  function normalizeUnavailableSources(scopeValue, topLevelValue) {
    return scopeSourceList(scopeValue, 'sources_unavailable', topLevelValue);
  }

  /**
   * 本轮有数据但覆盖不完整（如 max_items 预算上限）→“本期 X 覆盖不完整”。
   * 与 unavailable 并列时 unavailable 优先，已在 unavailable 里的来源不再重复。
   */
  function normalizeIncompleteSources(scopeValue, topLevelValue) {
    const incomplete = scopeSourceList(scopeValue, 'sources_incomplete', topLevelValue);
    const unavailable = normalizeUnavailableSources(scopeValue, null);
    return incomplete.filter(function (source) { return unavailable.indexOf(source) === -1; });
  }

  /** revision（同日修订）：只展示数量与说明，不展示 private journal 原因。 */
  function normalizeRevision(value) {
    const source = value && typeof value === 'object' ? value : null;
    const out = { present: false, addedCount: null, removedCount: null, note: '' };
    if (!source) return out;
    out.present = true;
    if (typeof source.added_count === 'number' && source.added_count >= 0) out.addedCount = source.added_count;
    if (typeof source.removed_count === 'number' && source.removed_count >= 0) out.removedCount = source.removed_count;
    if (isNonEmptyString(source.note)) out.note = source.note.trim();
    return out;
  }

  function normalizeDigestBody(value) {
    const source = value && typeof value === 'object' ? value : {};
    const status = isNonEmptyString(source.status) ? source.status.trim() : 'unknown';
    const sections = [];
    if (Array.isArray(source.sections)) {
      for (let i = 0; i < source.sections.length; i += 1) {
        const section = source.sections[i];
        if (!section || typeof section !== 'object') continue;
        const topic = TOPICS.indexOf(section.topic) !== -1 ? section.topic : '';
        const heading = isNonEmptyString(section.heading) ? section.heading.trim() : '';
        const text = typeof section.text === 'string' ? section.text : '';
        if (!heading && !text) continue;
        sections.push({
          topic: topic,
          topicLabel: topic,
          heading: heading,
          text: text,
          paperIds: stringList(section.paper_ids)
        });
      }
    }
    return {
      status: status,
      sections: sections,
      note: isNonEmptyString(source.note) ? source.note.trim() : '',
      basis: source.analysis_basis === 'abstract' ? 'abstract' : ''
    };
  }

  /**
   * data/YYYY-MM-DD_digest.json → 视图模型。
   * 结构固定为 {date, generated_at, coverage:{status,sources:[...]}, digest:{status,sections:[...]}, pending_count}。
   * 任何缺失/畸形都降级为 available:false + problem，不假造摘要；
   * 页面只据此显示“暂无总结”，不向外暴露内部 problem/status 文本。
   */
  function normalizeDigest(raw, fallbackDate) {
    const out = {
      available: false,
      problem: '',
      date: isIsoDate(fallbackDate) ? fallbackDate : null,
      generatedAt: '',
      coverage: normalizeCoverage(null),
      unavailableSources: [],
      incompleteSources: [],
      revision: normalizeRevision(null),
      digest: normalizeDigestBody(null),
      pendingCount: null,
      paperCount: null
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      out.problem = 'missing';
      return out;
    }
    if (isIsoDate(raw.date)) out.date = raw.date;
    if (!out.date) { out.problem = 'bad-date'; return out; }
    out.generatedAt = isNonEmptyString(raw.generated_at) ? raw.generated_at.trim() : '';
    out.coverage = normalizeCoverage(raw.coverage);
    out.unavailableSources = normalizeUnavailableSources(raw.research_scope, raw.sources_unavailable);
    out.incompleteSources = normalizeIncompleteSources(raw.research_scope, raw.sources_incomplete);
    out.revision = normalizeRevision(raw.revision);
    out.digest = normalizeDigestBody(raw.digest);
    if (typeof raw.pending_count === 'number' && raw.pending_count >= 0) out.pendingCount = raw.pending_count;
    if (typeof raw.paper_count === 'number' && raw.paper_count >= 0) out.paperCount = raw.paper_count;
    if (!isNonEmptyString(raw.digest && raw.digest.status)) {
      out.problem = 'bad-digest';
      return out;
    }
    out.available = true;
    return out;
  }

  /**
   * 日汇总与当天论文的交叉核对：digest 引用的 paper_id 必须在当天数据里存在，
   * 且该论文的 topics 必须包含该 section 的 topic（与 export.validate_day 同规则）。
   */
  function crossCheckDigest(digest, papers) {
    const list = Array.isArray(papers) ? papers : [];
    const byId = {};
    for (let i = 0; i < list.length; i += 1) byId[list[i].id] = list[i];
    const missing = [];
    const topicMismatch = [];
    const cited = [];
    const sections = digest && digest.digest ? digest.digest.sections : [];
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      for (let j = 0; j < section.paperIds.length; j += 1) {
        const id = section.paperIds[j];
        if (cited.indexOf(id) === -1) cited.push(id);
        const paper = byId[id];
        if (!paper) {
          if (missing.indexOf(id) === -1) missing.push(id);
          continue;
        }
        if (section.topic && paper.topics.indexOf(section.topic) === -1) {
          if (topicMismatch.indexOf(id) === -1) topicMismatch.push(id);
        }
      }
    }
    const unreferenced = list.filter(function (paper) {
      return cited.indexOf(paper.id) === -1;
    }).map(function (paper) { return paper.id; });
    return { citedIds: cited, missingIds: missing, topicMismatchIds: topicMismatch, unreferencedIds: unreferenced };
  }

  /**
   * 计数与缺口。partial 必须显式：collected 不是全量，只代表已发布数据。
   */
  function computeCoverage(digest, papers, options) {
    const opts = options || {};
    const list = Array.isArray(papers) ? papers : [];
    const coverage = digest && digest.coverage ? digest.coverage : normalizeCoverage(null);
    const byTopic = { embodied: 0, surgical: 0, both: 0, none: 0 };
    for (let i = 0; i < list.length; i += 1) {
      const topics = list[i].topics;
      if (topics.length === 0) byTopic.none += 1;
      else if (topics.length > 1) byTopic.both += 1;
      else byTopic[topics[0]] += 1;
    }
    const bySource = { arxiv: 0, pubmed: 0, unknown: 0 };
    for (let i = 0; i < list.length; i += 1) {
      const key = SOURCES.indexOf(list[i].source) !== -1 ? list[i].source : 'unknown';
      bySource[key] += 1;
    }
    const declaredCount = digest && typeof digest.paperCount === 'number' ? digest.paperCount : null;
    const countMismatch = declaredCount !== null && declaredCount !== list.length;
    const pendingCount = digest && typeof digest.pendingCount === 'number' ? digest.pendingCount : null;
    const invalidLines = typeof opts.invalidLines === 'number' ? opts.invalidLines : 0;
    const dropped = typeof opts.dropped === 'number' ? opts.dropped : 0;
    const digestStatus = digest && digest.available ? digest.digest.status : 'unavailable';
    const noIncluded = digestStatus === 'no_included_papers';
    return {
      publishedCount: list.length,
      declaredCount: declaredCount,
      countMismatch: countMismatch,
      pendingCount: pendingCount,
      // 缺口来源：覆盖 partial/缺失、日报缺失或未完成、待处理、解析丢弃。
      gapReasons: {
        coverageIncomplete: coverage.hasGap,
        digestMissing: !(digest && digest.available),
        digestIncomplete: !noIncluded && digestStatus !== 'completed',
        digestNoIncluded: noIncluded,
        pending: pendingCount !== null && pendingCount > 0,
        countMismatch: countMismatch,
        invalidLines: invalidLines > 0,
        dropped: dropped > 0
      },
      byTopic: byTopic,
      bySource: bySource,
      coverage: coverage
    };
  }

  function hasAnyGap(gapReasons) {
    const reasons = gapReasons || {};
    return Object.keys(reasons).some(function (key) { return reasons[key] === true; });
  }

  /**
   * 来源覆盖是否不完整（partial / 未知 / 无来源记录）。
   * 页面只在没有更具体来源状态时用它给一句“部分来源覆盖不完整”，其余流程计数不外露。
   */
  function coverageIsPartial(coverage) {
    const cov = coverage && coverage.coverage ? coverage.coverage : coverage;
    if (!cov || !Array.isArray(cov.sources)) return true;
    if (cov.status !== 'complete') return true;
    if (cov.sources.length === 0) return true;
    return cov.sources.some(function (item) { return item.status !== 'complete'; });
  }

  /**
   * 跨日来源状态聚合：首页按日期倒序连续展示所有日报，但来源状态**只允许一行**。
   * unavailable（真的没拿到数据）优先于 incomplete（有数据但覆盖不完整），
   * 两者都按 SOURCES 固定顺序去重；partial 表示至少有一天覆盖不完整，
   * 仅在既没有 unavailable 也没有 incomplete 时用作兜底短句。
   */
  function aggregateScopeStatus(days) {
    const list = Array.isArray(days) ? days : [];
    const unavailable = [];
    const incomplete = [];
    let partial = false;
    const pushKnown = function (target, value) {
      const source = typeof value === 'string' ? value.trim() : '';
      if (SOURCES.indexOf(source) === -1 || target.indexOf(source) !== -1) return;
      target.push(source);
    };
    for (let i = 0; i < list.length; i += 1) {
      const day = list[i];
      if (!day) continue;
      const digest = day.digest && typeof day.digest === 'object' ? day.digest : {};
      const dayUnavailable = Array.isArray(digest.unavailableSources) ? digest.unavailableSources : [];
      const dayIncomplete = Array.isArray(digest.incompleteSources) ? digest.incompleteSources : [];
      for (let j = 0; j < dayUnavailable.length; j += 1) pushKnown(unavailable, dayUnavailable[j]);
      for (let k = 0; k < dayIncomplete.length; k += 1) pushKnown(incomplete, dayIncomplete[k]);
      if (coverageIsPartial(day.coverage)) partial = true;
    }
    return {
      unavailable: unavailable.slice().sort(function (a, b) { return SOURCES.indexOf(a) - SOURCES.indexOf(b); }),
      incomplete: incomplete.filter(function (source) { return unavailable.indexOf(source) === -1; })
        .sort(function (a, b) { return SOURCES.indexOf(a) - SOURCES.indexOf(b); }),
      partial: partial
    };
  }

  /* ------------------------------------------------------------------ *
   * 主题筛选（允许双命中）与关键词/作者/文本匹配
   * ------------------------------------------------------------------ */

  /**
   * 主题选择：'all' 或 TOPICS 数组/单个 topic。
   * 选一个主题 → 命中的都显示（双命中论文在两个主题下都出现）；
   * 选两个主题 → 并集（等价于 all，但用于明确“双主题”视图）。
   */
  function matchesTopicFilter(paper, selected) {
    const topics = paper && Array.isArray(paper.topics) ? paper.topics : [];
    if (!selected || selected === 'all') return true;
    const wanted = Array.isArray(selected) ? selected : [selected];
    const valid = wanted.filter(function (item) { return TOPICS.indexOf(item) !== -1; });
    if (valid.length === 0) return true;
    return valid.some(function (topic) { return topics.indexOf(topic) !== -1; });
  }

  function filterPapersByTopic(papers, selected) {
    const list = Array.isArray(papers) ? papers : [];
    return list.filter(function (paper) { return matchesTopicFilter(paper, selected); });
  }

  /**
   * 页面可见的可搜索字段：中文标题（reading.title_zh）与英文原题、作者、
   * 论文要点（reading 四节 bullets + AI 五字段，详情里逐条可见）、以及
   * **真实**公开原摘要。公开导出的占位句不是内容，不进搜索面。
   */
  function paperSearchFields(paper) {
    const record = paper && typeof paper === 'object' ? paper : {};
    const reading = record.reading && typeof record.reading === 'object' ? record.reading : null;
    const titleParts = [record.title || ''];
    if (reading && isNonEmptyString(reading.titleZh)) titleParts.push(reading.titleZh);
    const points = [];
    if (reading && reading.bullets && typeof reading.bullets === 'object') {
      for (let i = 0; i < READING_FIELDS.length; i += 1) {
        const list = reading.bullets[READING_FIELDS[i]];
        if (!Array.isArray(list)) continue;
        for (let j = 0; j < list.length; j += 1) {
          if (isNonEmptyString(list[j])) points.push(list[j]);
        }
      }
    }
    for (let i = 0; i < AI_FIELDS.length; i += 1) {
      const value = record.ai ? record.ai[AI_FIELDS[i]] : '';
      if (isNonEmptyString(value)) points.push(value);
    }
    return {
      title: titleParts.filter(function (part) { return part !== ''; }).join(' '),
      author: (record.authors || []).join(', '),
      points: points.join(' '),
      abstract: hasPublicAbstract(record) ? record.abstract : ''
    };
  }

  /** 全部页面可见内容拼成的小写 haystack（搜索用；不当正则，只做字面子串）。 */
  function paperSearchHaystack(paper) {
    const fields = paperSearchFields(paper);
    return [fields.title, fields.author, fields.points, fields.abstract].join(' ').toLowerCase();
  }

  /**
   * 兼容入口：标题（含中文标题）+ 作者 + 真实原摘要；includeAi 时再并入论文要点。
   * 搜索路径用 paperSearchHaystack（始终包含论文要点）。
   */
  function paperHaystack(paper, options) {
    const opts = options || {};
    const fields = paperSearchFields(paper);
    const parts = [fields.title, fields.author, fields.abstract];
    if (opts.includeAi) parts.push(fields.points);
    return parts.join(' ').toLowerCase();
  }

  /** 一个词命中了哪些可见字段：'title' | 'author' | 'points' | 'abstract'。 */
  function searchHitFields(paper, term) {
    const needle = isNonEmptyString(term) ? term.trim().toLowerCase() : '';
    if (needle === '') return [];
    const fields = paperSearchFields(paper);
    return ['title', 'author', 'points', 'abstract'].filter(function (key) {
      return fields[key].toLowerCase().indexOf(needle) !== -1;
    });
  }

  /** 命中原因：字段区分标题/作者/论文要点；只有真实原摘要的命中记为 text。 */
  const SEARCH_REASON_KIND = { title: 'title', author: 'author', points: 'points', abstract: 'text' };

  function matchPaperText(paper, query, options) {
    const text = isNonEmptyString(query) ? query.trim() : '';
    if (text === '') return { matched: false, reason: '' };
    const hits = searchHitFields(paper, text);
    return hits.length > 0
      ? { matched: true, reason: SEARCH_REASON_KIND[hits[0]] || 'text' }
      : { matched: false, reason: '' };
  }

  /** 关键词之间是“或”，且只做字面子串匹配（不当正则）。 */
  function matchPaperKeywords(paper, keywords) {
    const list = stringList(keywords);
    if (list.length === 0) return { matched: false, matchedKeywords: [] };
    const matchedKeywords = list.filter(function (keyword) {
      return searchHitFields(paper, keyword).length > 0;
    });
    return { matched: matchedKeywords.length > 0, matchedKeywords: matchedKeywords };
  }

  /** 一组检索词 → 去重的字段级命中原因（如 title:手术机器人、points:抓取）。 */
  function searchReasons(paper, terms) {
    const list = stringList(terms);
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const term = list[i];
      const hits = searchHitFields(paper, term);
      for (let j = 0; j < hits.length; j += 1) {
        const reason = (SEARCH_REASON_KIND[hits[j]] || 'text') + ':' + term;
        if (out.indexOf(reason) === -1) out.push(reason);
      }
    }
    return out;
  }

  /** 作者匹配：作者姓名里的字面子串，多个作者之间是“或”。 */
  function matchPaperAuthors(paper, authors) {
    const list = stringList(authors);
    if (list.length === 0) return { matched: false, matchedAuthors: [] };
    const hay = (paper.authors || []).join(', ').toLowerCase();
    const matchedAuthors = list.filter(function (author) {
      return hay.indexOf(author.toLowerCase()) !== -1;
    });
    return { matched: matchedAuthors.length > 0, matchedAuthors: matchedAuthors };
  }

  /**
   * 综合排序与标记：匹配的排前面（上游行为，不隐藏论文）。
   * 关键词/作者/文本之间为“或”，匹配原因只用于卡片提示。
   */
  function rankPapers(papers, state) {
    const list = Array.isArray(papers) ? papers : [];
    const current = state || {};
    const keywords = stringList(current.keywords);
    const authors = stringList(current.authors);
    const query = isNonEmptyString(current.text) ? current.text.trim() : '';
    if (keywords.length === 0 && authors.length === 0 && query === '') {
      return list.map(function (paper) {
        return { paper: paper, matched: false, reasons: [] };
      });
    }
    const scored = list.map(function (paper) {
      // 检索面 = 全部页面可见内容；命中原因区分 标题/作者/论文要点
      // （真实公开原摘要的命中记 text；公开占位句不参与）。
      const terms = keywords.concat(authors);
      if (query !== '') terms.push(query);
      const reasons = searchReasons(paper, terms);
      return { paper: paper, matched: reasons.length > 0, reasons: reasons };
    });
    // 稳定排序：匹配优先，其余保持原顺序。
    const matchedFirst = scored.filter(function (item) { return item.matched; });
    const rest = scored.filter(function (item) { return !item.matched; });
    return matchedFirst.concat(rest);
  }

  /**
   * 高亮切分：返回 [{text, hit}]。用于 DOM 文本节点分段，
   * 不产生任何 HTML 字符串，因此外来文本不可能变成标签。
   * 词元按长度降序，避免短词破坏长词匹配。
   */
  function highlightSegments(text, terms) {
    const value = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text));
    const list = stringList(terms)
      .map(function (term) { return term.trim(); })
      .filter(function (term) { return term !== ''; })
      .sort(function (a, b) { return b.length - a.length; });
    if (value === '' || list.length === 0) return [{ text: value, hit: false }];
    const lower = value.toLowerCase();
    const marks = new Array(value.length);
    for (let i = 0; i < list.length; i += 1) {
      const needle = list[i].toLowerCase();
      if (needle === '') continue;
      let from = 0;
      for (;;) {
        const at = lower.indexOf(needle, from);
        if (at === -1) break;
        for (let k = at; k < at + needle.length; k += 1) marks[k] = true;
        from = at + needle.length;
      }
    }
    const segments = [];
    let buffer = '';
    let bufferHit = null;
    for (let i = 0; i < value.length; i += 1) {
      const hit = marks[i] === true;
      if (bufferHit === null) { bufferHit = hit; }
      if (hit !== bufferHit) {
        segments.push({ text: buffer, hit: bufferHit });
        buffer = '';
        bufferHit = hit;
      }
      buffer += value.charAt(i);
    }
    if (buffer !== '') segments.push({ text: buffer, hit: bufferHit === true });
    return segments;
  }

  /** 卡片作者显示规则（保留上游阅读体验）：≤4 全显示，>4 显示前2+后2。 */
  function formatAuthorsForCard(authors) {
    const list = stringList(authors);
    if (list.length === 0) return { display: [], truncated: false, total: 0 };
    if (list.length <= 4) return { display: list.slice(), truncated: false, total: list.length };
    return {
      display: list.slice(0, 2).concat(['…']).concat(list.slice(-2)),
      truncated: true,
      total: list.length
    };
  }

  /* ------------------------------------------------------------------ *
   * localStorage 净化（只存用户自己的偏好，键名固定、长度与条数受限）
   * ------------------------------------------------------------------ */

  const PREF_KEYS = { keywords: 'preferredKeywords', authors: 'preferredAuthors' };
  const PREF_LIMITS = { items: 40, itemLength: 80 };
  const PREF_SCHEMA = 'pd-prefs/1';

  /**
   * 标签剥离：处理 <iframe srcdoc="<script>"> 这类嵌套尖括号，
   * 以及 '<script'（被截断的残缺标签）。
   */
  const TAG_STRIP_RE = /<[^<>]*(?:<[^<>]*>[^<>]*)*>/g;
  // 残缺标签：只吃掉标签名与分隔符，不吃后面的正文
  // （否则 '<img src=x onerror=alert(1)>' 被整体吞掉，'<script>alert(1)' 会残留）。
  const PARTIAL_TAG_RE = /<\/?[a-zA-Z!/][^\s<>\/]*/g;
  const ON_ATTR_RE = /\son[a-z]+\s*=/gi;
  const ENTITY_RULES = [
    [/&#(\d{1,7});/g, function (match, code) {
      const point = Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }],
    [/&#[xX]([0-9a-fA-F]{1,6});/g, function (match, code) {
      const point = parseInt(code, 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }],
    [/&(lt|gt|amp|quot|apos|#39|#x27);/gi, ' ']
  ];

  function decodePercentOnce(value) {
    // 只解码一次百分号编码；失败（畸形序列）时原样返回。
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function stripMarkupOnce(value) {
    let text = value.replace(TAG_STRIP_RE, ' ');
    ENTITY_RULES.forEach(function (rule) { text = text.replace(rule[0], rule[1]); });
    return text
      .replace(PARTIAL_TAG_RE, ' ')
      // 闭合标签后紧跟的调用残留（</script>alert(1)）一并去掉；
      // 普通括号不处理，避免破坏 "masked autoencoder (MAE)" 这类真实关键词。
      .replace(/\/\s*[A-Za-z_$][\w$.]*\s*\([^()]{0,120}\)/g, ' ')
      .replace(ON_ATTR_RE, ' ');
  }

  /**
   * 净化用户偏好文本：迭代剥离标签与实体，直到稳定（最多 5 轮）。
   * 之所以迭代：实体解码可能"释放"出新标签（如 &#60;script&#62;），
   * 单轮处理会残留可被二次解释的文本。
   */
  function sanitizePreferenceItem(value) {
    if (typeof value !== 'string') return '';
    let text = value;
    for (let round = 0; round < 5; round += 1) {
      // 百分号编码也要解码一次：'%3Cscript%3E' 解出 '<script>' 后必须再被剥离。
      const decoded = round === 0 ? decodePercentOnce(text) : text;
      const next = stripMarkupOnce(decoded);
      if (next === text) break;
      text = next;
    }
    const collapsed = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (collapsed === '') return '';
    return collapsed.length > PREF_LIMITS.itemLength ? collapsed.slice(0, PREF_LIMITS.itemLength) : collapsed;
  }

  /** 列表净化：逐项净化、去重、限制条数。 */
  function sanitizePreferenceList(value) {
    const raw = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const unique = [];
    for (let i = 0; i < raw.length && unique.length < PREF_LIMITS.items; i += 1) {
      const item = sanitizePreferenceItem(raw[i]);
      if (item !== '' && unique.indexOf(item) === -1) unique.push(item);
    }
    return unique;
  }

  /** 从 localStorage 字符串读偏好：任何畸形输入都退化为空数组，不抛异常。 */
  function readPreferences(rawValue) {
    if (typeof rawValue !== 'string' || rawValue.trim() === '') return [];
    let parsed = null;
    try {
      parsed = JSON.parse(rawValue);
    } catch (error) {
      return [];
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsed = Array.isArray(parsed.items) ? parsed.items : [];
    }
    return sanitizePreferenceList(parsed);
  }

  /** 写入前统一走净化与 schema 标记，避免历史脏数据被回写。 */
  function serializePreferences(items) {
    return JSON.stringify({ schema: PREF_SCHEMA, items: sanitizePreferenceList(items) });
  }

  /** 兼容上游旧格式（纯数组）与本地新格式。 */
  function parseStoredPreferences(rawValue) {
    if (typeof rawValue !== 'string' || rawValue.trim() === '') return [];
    let parsed = null;
    try {
      parsed = JSON.parse(rawValue);
    } catch (error) {
      return [];
    }
    if (Array.isArray(parsed)) return sanitizePreferenceList(parsed);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return sanitizePreferenceList(parsed.items);
    }
    return [];
  }

  /** UTC 日期加减天数（只用于枚举区间日期，不参与发表日推断）。 */
  function shiftIsoDate(date, days) {
    if (!isIsoDate(date)) return null;
    const parts = date.split('-').map(Number);
    const ms = Date.UTC(parts[0], parts[1] - 1, parts[2]) + days * 86400000;
    const next = new Date(ms);
    const month = String(next.getUTCMonth() + 1).padStart(2, '0');
    const day = String(next.getUTCDate()).padStart(2, '0');
    return next.getUTCFullYear() + '-' + month + '-' + day;
  }

  /**
   * 把 [start,end] 展开成连续日期，并区分“有数据”与“缺失”。
   * 区间视图必须能显示缺失的日期（不能用 0 篇或直接跳过冒充完整）。
   */
  function expandDateRange(start, end, availableDates) {
    if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
      return { dates: [], present: [], missing: [] };
    }
    const available = Array.isArray(availableDates) ? availableDates : [];
    const dates = [];
    let cursor = start;
    let guard = 0;
    while (cursor && cursor <= end && guard < 1000) {
      dates.push(cursor);
      if (cursor === end) break;
      cursor = shiftIsoDate(cursor, 1);
      guard += 1;
    }
    const present = dates.filter(function (date) { return available.indexOf(date) !== -1; });
    const missing = dates.filter(function (date) { return available.indexOf(date) === -1; });
    return { dates: dates, present: present, missing: missing };
  }

  function compareIsoDatesDesc(a, b) {
    return a < b ? 1 : (a > b ? -1 : 0);
  }

  return {
    TOPICS: TOPICS,
    SOURCES: SOURCES,
    DISCOVERY_KINDS: DISCOVERY_KINDS,
    AI_FIELDS: AI_FIELDS,
    AI_EMPTY: AI_EMPTY,
    ABSTRACT_PLACEHOLDER: ABSTRACT_PLACEHOLDER,
    FILE_LIST_PATH: FILE_LIST_PATH,
    DATA_DIR: DATA_DIR,
    URL_REJECT: {
      NOT_HTTP: URL_REJECT_NOT_HTTP,
      CREDENTIALS: URL_REJECT_CREDENTIALS,
      UNPARSEABLE: URL_REJECT_UNPARSEABLE,
      EMPTY: URL_REJECT_EMPTY,
      CONTROL: URL_REJECT_CONTROL
    },
    PREF_KEYS: PREF_KEYS,
    PREF_LIMITS: PREF_LIMITS,
    PREF_SCHEMA: PREF_SCHEMA,

    isNonEmptyString: isNonEmptyString,
    hasControlChars: hasControlChars,
    escapeHtml: escapeHtml,
    containsHtmlMarkup: containsHtmlMarkup,
    normalizeHttpUrl: normalizeHttpUrl,
    safeHttpUrl: safeHttpUrl,
    safeAssetImagePath: safeAssetImagePath,
    safeCreditUrl: safeCreditUrl,
    isRealPdfUrl: isRealPdfUrl,
    paperLinks: paperLinks,
    sourceLabel: sourceLabel,
    normalizeDiscoveryKind: normalizeDiscoveryKind,
    isAbstractPlaceholder: isAbstractPlaceholder,
    hasPublicAbstract: hasPublicAbstract,

    READING_FIELDS: READING_FIELDS,
    READING_BULLET_LIMIT: READING_BULLET_LIMIT,
    normalizeReading: normalizeReading,
    normalizeAffiliations: normalizeAffiliations,
    normalizeFigure: normalizeFigure,
    paperIdLabel: paperIdLabel,
    licenseInfo: licenseInfo,
    LICENSE_LINKS: LICENSE_LINKS,
    displayTitle: displayTitle,
    splitSentences: splitSentences,
    paperBullets: paperBullets,

    isIsoDate: isIsoDate,
    normalizePrecision: normalizePrecision,
    describePublished: describePublished,
    describeUpdated: describeUpdated,
    describeDiscovered: describeDiscovered,
    describeTimestamp: describeTimestamp,
    describeFileDate: describeFileDate,
    describeDateRange: describeDateRange,
    shiftIsoDate: shiftIsoDate,
    expandDateRange: expandDateRange,
    compareIsoDatesDesc: compareIsoDatesDesc,

    dailyFilePath: dailyFilePath,
    digestFilePath: digestFilePath,
    parseFileList: parseFileList,

    stringList: stringList,
    normalizeTopics: normalizeTopics,
    normalizeCategories: normalizeCategories,
    normalizePaper: normalizePaper,
    parseJsonl: parseJsonl,
    normalizeCoverage: normalizeCoverage,
    normalizeUnavailableSources: normalizeUnavailableSources,
    normalizeIncompleteSources: normalizeIncompleteSources,
    normalizeRevision: normalizeRevision,
    normalizeDigest: normalizeDigest,
    crossCheckDigest: crossCheckDigest,
    computeCoverage: computeCoverage,
    hasAnyGap: hasAnyGap,
    coverageIsPartial: coverageIsPartial,
    aggregateScopeStatus: aggregateScopeStatus,

    matchesTopicFilter: matchesTopicFilter,
    filterPapersByTopic: filterPapersByTopic,
    paperHaystack: paperHaystack,
    paperSearchFields: paperSearchFields,
    paperSearchHaystack: paperSearchHaystack,
    searchHitFields: searchHitFields,
    searchReasons: searchReasons,
    matchPaperText: matchPaperText,
    matchPaperKeywords: matchPaperKeywords,
    matchPaperAuthors: matchPaperAuthors,
    rankPapers: rankPapers,
    highlightSegments: highlightSegments,
    formatAuthorsForCard: formatAuthorsForCard,

    sanitizePreferenceItem: sanitizePreferenceItem,
    sanitizePreferenceList: sanitizePreferenceList,
    readPreferences: readPreferences,
    serializePreferences: serializePreferences,
    parseStoredPreferences: parseStoredPreferences
  };
});
