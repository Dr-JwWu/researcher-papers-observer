/**
 * ResearcherPapers 前端文案层（仅中文界面；不联网、不依赖 i18n 库）。
 *
 * 来源与变更声明 / Provenance notice:
 *   新建文件，不含上游代码。上游 daily-arXiv-ai-enhanced
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License，
 *   见 docs/licenses/daily-arxiv-LICENSE）原页面为英文且带语言探测。
 *   变更：固定中文文案；删除 English/Chinese 语言回退与 flatpickr 相关文案；
 *   新增日期精度、来源、主题、AI 依据（abstract）等必须如实说明的文案。
 *   2026-10 精简：删除“无访问控制/不可信数据”安全横幅、research_scope 工程口径、
 *   候选/取回/缺元数据/错误计数、结构自洽诊断与重复免责声明。
 *   2026-10 阅读改版（用户最新的五点）：主题不再作为卡片/详情标签展示，
 *   顶部只留两个主题过滤（**没有“全部”按钮**：初始都不选 = 两个主题都显示，
 *   再点一次即取消）；删除当日总结正文、PDF 预览与按钮、旧版 “TL;DR” 字样
 *   （改“一句话看懂”）；新增连续日期列表、中文大标题/英文副标题、可核单位、
 *   配图来源与许可的短文案。同一时刻最多一条来源状态。
 *   2026-10 二次精简：详情去掉“来源分类/抓取时间/进入方式长说明”，
 *   “AI 摘要”改“论文要点”，依据只留一句“根据论文摘要整理”，
 *   橙色警告块改普通 section 版式。
 *   本文件不重新授权上游代码，许可仍以 docs/licenses 为准。
 */
(function (root) {
  'use strict';

  const SOURCE_LABELS = { arxiv: 'arXiv', pubmed: 'PubMed', unknown: '来源未标注' };
  const TOPIC_LABELS = { embodied: '具身智能', surgical: '手术机器人/手术AI' };
  const PRECISION_LABELS = { year: '仅年份', month: '精确到月', day: '精确到日', unknown: '精度未标注' };
  const COVERAGE_LABELS = { complete: '来源正常', partial: '部分来源覆盖不完整', unknown: '来源状态未知' };

  const TEXT = {
    siteTitle: 'ResearcherPapers 论文日报',
    siteSubtitle: '具身智能 · 手术机器人/手术AI',
    pageTitleIndex: '论文日报 - ResearcherPapers',
    pageTitleSettings: '偏好设置 - ResearcherPapers',
    pageTitleStatistic: '统计 - ResearcherPapers',

    navStatistics: '统计',
    navSettings: '偏好设置',
    navBackHome: '返回首页',
    navAbout: '来源与许可',

    loadingPapers: '正在加载论文…',
    feedLoading: '正在加载日报…',
    loadingFiles: '正在读取数据文件列表…',
    noPapersForDate: '本日暂无收录论文。',
    noMatchingPapers: '当前筛选条件下没有论文。',
    loadFailedTitle: '数据暂时无法读取，请稍后重试。',
    fileListMissing: '暂无日报数据。',

    // 连续日期列表（按报告日期倒序，最新在顶部）
    feedLatest: '最新',
    feedDayCount: '收录 {n} 篇',
    feedDayEmpty: '该筛选下暂无收录。',
    feedDayMissing: '本日暂无日报。',
    // 数据解析不完整：不说“没有论文”，也不外露原始坏行与计数
    feedDayPartial: '部分内容无法读取。',
    feedDayUnreadable: '本日数据无法读取。',
    feedDayUnknown: '（日期不可用）',

    filterTopic: '主题',
    // 明确写清交互：没有“全部”按钮，都不选即两个主题都看
    filterTopicHint: '点击主题只看该主题，再点一次取消；两个都不选时两个主题都显示',
    filterKeywordAuthor: '关键词 / 作者',
    searchPlaceholder: '输入关键词搜索（标题、作者、摘要）',
    searchClear: '清除搜索',
    searchToggle: '搜索',
    // 命中原因按可见字段区分：标题（中/英文）、作者、论文要点；
    // 只有真实公开原摘要的命中才用“文本”。
    matchReasonTitle: '标题',
    matchReasonAuthor: '作者',
    matchReasonPoints: '论文要点',
    matchReasonText: '文本',

    cardDetails: '查看详情',
    cardAuthors: '作者',
    cardCategories: '来源分类',
    cardCategoriesUnknown: '来源分类未知',
    discoveryBackfill: '补录候选',
    discoveryBackfillCard: '补录',
    discoveryWindowMatch: '检索窗匹配',
    discoveryBackfillHint: '该论文由扩大日期窗的回填检索发现，不是当日首次发布，不代表当日新增。',
    discoveryWindowMatchHint: '该论文命中本轮检索窗口。',
    discoveryUnknownHint: '数据未标注进入方式（旧格式），不推断是否为当日首发。',
    cardPublished: '发表日期',
    cardUpdated: '修订',
    cardDiscovered: '发现',

    modalTitleFallback: '论文详情',
    modalAbstract: '原摘要',
    abstractLinkNote: '原摘要与全文请见来源链接。',
    modalAi: '论文要点',
    modalAiBasis: '根据论文摘要整理',
    modalAiMissing: '本篇暂无可读要点（缺少摘要或分析未完成）。',
    // 四项一律分条展示；空字段写“摘要未提供”，不编造内容。
    modalAiEmpty: '摘要未提供',
    modalAiField: {
      tldr: '一句话看懂',
      motivation: '研究动机',
      method: '方法',
      result: '结果',
      conclusion: '结论'
    },
    modalAuthors: '作者',
    modalAffiliations: '作者单位',
    // 数据里没有可核单位时如实说明，不按作者名猜单位
    modalAffiliationsUnknown: '单位待核实',
    modalAffiliationsSource: '来源',
    modalDoi: 'DOI',
    modalOpenAbs: '打开摘要页',
    modalCopyLink: '复制摘要页链接',
    modalCopied: '已复制到剪贴板',
    modalCopyFailed: '复制失败，请手动复制',
    modalNoLinkToCopy: '没有可复制的链接。',
    modalNavHint: '← → 切换 · 空格随机',
    modalClose: '关闭',

    // 配图：只在许可明确且图已复制到本站静态目录时显示
    figureSource: '图源',
    // 卡片不写 caption/许可大段（图片本身点进逐图署名页）；详情必须明确许可与图源入口
    modalFigureLicense: '配图许可',
    figureCreditTitle: '图片来源与许可',
    figureCreditsLink: '许可与图片来源',
    figureLicense: '许可',
    figureAltFallback: '论文配图',

    digestCoveragePartial: '部分来源覆盖不完整',
    sourceUnavailable: '本期 {sources} 来源暂缺',
    sourceIncomplete: '本期 {sources} 覆盖不完整',

    revisionTitle: '同日修订',
    revisionAdded: '新增',
    revisionRemoved: '移除',
    revisionUnit: '篇',

    statTitle: '已收录样本统计',
    statPublishedCount: '已收录',
    statUnit: '篇',
    statNoData: '没有可统计的数据。',
    statScopeNote: '统计口径：仅本站已收录样本，缺失日期不补 0。',
    statTrendTitle: '关键词趋势',
    statTrendHint: '仅统计本区间论文标题中的关键词频次。',
    statTrendUnavailable: '区间内没有可绘制的趋势（至少需要两个日期）。',
    statKeywordTitle: '热门关键词',
    statRelatedTitle: '相关论文',
    statRelatedNone: '没有匹配论文。',
    statGapNote: '以下日期暂无日报，未计入统计：',
    statEmptyNote: '以下日期日报为空：',
    statCloudSkip: '词云为避免重叠略去 {n} 个词，完整列表见上方。',

    settingsKeywordsTitle: '感兴趣的关键词',
    settingsAuthorsTitle: '感兴趣的作者',
    settingsAdd: '添加',
    settingsCopy: '复制',
    settingsKeywordPlaceholder: '输入关键词后回车…',
    settingsAuthorPlaceholder: '输入作者姓名后回车…',
    settingsEmptyKeywords: '还没有关键词，请在下方添加。',
    settingsEmptyAuthors: '还没有作者，请在下方添加。',
    settingsSave: '保存设置',
    settingsReset: '重置',
    settingsSaved: '设置已保存在本机浏览器，不会上传。',
    settingsResetDone: '已重置本机偏好。',
    settingsNoCopy: '没有可复制的内容。',
    settingsCopied: '已复制到剪贴板。',
    settingsCopyFailed: '复制失败，请手动复制。',
    settingsLocalOnly: '偏好只保存在本机浏览器，用于排序与高亮，不会上传。',

    footerTagline: 'ResearcherPapers 论文日报 · 具身智能 / 手术机器人',
    footerAbout: '来源、许可与免责说明'
  };

  function formatTemplate(template, values) {
    if (typeof template !== 'string') return '';
    const data = values || {};
    return template.replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match;
    });
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || SOURCE_LABELS.unknown;
  }

  const DISCOVERY_LABELS = { backfill: '补录候选', window_match: '检索窗匹配' };

  function discoveryLabel(kind) {
    return DISCOVERY_LABELS[kind] || '';
  }

  function discoveryHint(kind) {
    if (kind === 'backfill') return TEXT.discoveryBackfillHint;
    if (kind === 'window_match') return TEXT.discoveryWindowMatchHint;
    return TEXT.discoveryUnknownHint;
  }

  function topicLabel(topic) {
    return TOPIC_LABELS[topic] || String(topic || '');
  }

  function precisionLabel(precision) {
    return PRECISION_LABELS[precision] || PRECISION_LABELS.unknown;
  }

  function coverageLabel(status) {
    return COVERAGE_LABELS[status] || COVERAGE_LABELS.unknown;
  }

  function topicListLabel(topics) {
    const list = Array.isArray(topics) ? topics : [];
    if (list.length === 0) return '';
    return list.map(topicLabel).join(' + ');
  }

  root.PD = root.PD || {};
  root.PD.i18n = {
    TEXT: TEXT,
    SOURCE_LABELS: SOURCE_LABELS,
    TOPIC_LABELS: TOPIC_LABELS,
    PRECISION_LABELS: PRECISION_LABELS,
    COVERAGE_LABELS: COVERAGE_LABELS,
    formatTemplate: formatTemplate,
    sourceLabel: sourceLabel,
    DISCOVERY_LABELS: DISCOVERY_LABELS,
    discoveryLabel: discoveryLabel,
    discoveryHint: discoveryHint,
    topicLabel: topicLabel,
    precisionLabel: precisionLabel,
    coverageLabel: coverageLabel,
    topicListLabel: topicListLabel
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
