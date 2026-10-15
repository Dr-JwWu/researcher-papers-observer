/**
 * ResearcherPapers 数据源配置：本站相对目录。
 *
 * 来源与变更声明 / Provenance notice:
 *   本文件由上游 daily-arXiv-ai-enhanced web/js/data-config.js
 *   （main 01fdad3b0aec2d2f7977b686253a7b0c1c8273dc，Modified Apache License；
 *    参考 .upstream/daily-arxiv，许可证副本见 docs/licenses/daily-arxiv-LICENSE）
 *   改写而来，版权归上游原作者，本项目不重新许可、不改标 MIT。
 *   本文件为修改后的衍生文件，主要变更：
 *     1. 删除 repoOwner/repoName/dataBranch 与 raw.githubusercontent 拼接；
 *     2. 删除“由 GitHub Actions 注入、请勿手改”的说明（本站不再依赖 CI 注入）；
 *     3. 数据源改为本站相对 data/ 目录：assets/file-list.txt、
 *        data/YYYY-MM-DD_AI_enhanced_Chinese.jsonl、data/YYYY-MM-DD_digest.json；
 *     4. 仅同源相对路径，不含任何外部主机、令牌或账号信息。
 */

const DATA_CONFIG = {
    /** 数据目录（相对站点根，同源）。 */
    dataDir: 'data',

    /** 文件清单（相对站点根，同源）。 */
    fileListPath: 'assets/file-list.txt',

    /** 日报语言：接口只发布中文版，页面固定读取中文文件。 */
    language: 'Chinese',

    /**
     * 拼接本站数据文件路径。
     * @param {string} filePath - 相对路径，如 'data/2025-01-01_AI_enhanced_Chinese.jsonl'
     * @returns {string} 同源相对 URL
     */
    getDataUrl: function (filePath) {
        return String(filePath || '');
    },

    /**
     * 某日日报文件路径。
     * @param {string} date - YYYY-MM-DD
     * @returns {string} 同源相对 URL
     */
    getDigestUrl: function (date) {
        return this.dataDir + '/' + date + '_digest.json';
    }
};
