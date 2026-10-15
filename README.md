# ResearcherPapers Observer — 验证样本

具身智能与手术机器人/手术AI中文文献阅读网站。当前仅一篇真实PubMed论文的验证样本，来源partial；不是全量日报，未启用每日自动研究。AI仅依据摘要，不是医疗建议。

网站：https://dr-jwwu.github.io/researcher-papers-observer/

本仓库只含白名单静态站点，不含采集/模型后端源码、数据库、原始证据、私有日志或个人笔记。

## 上游与许可

页面衍生自[Wei Deng及贡献者的daily-arXiv-ai-enhanced](https://github.com/dw-dengwei/daily-arXiv-ai-enhanced)，版本01fdad3b0aec2d2f7977b686253a7b0c1c8273dc。适用[Modified Apache License](docs/licenses/daily-arxiv-LICENSE)，不重标MIT/标准Apache-2.0。出处和修改说明保留在文件头及[来源说明](NOTICE.html)。非官方站点，不暗示上游背书。

样本论文：Teng Li、Sunny Zhang、Cate Balasubramanian、Thomas Looi、Dale J Podolsky，A Configurable Real2Sim Bimanual Teleoperation Framework for Surgical Robotic Tool Design and Evaluation，DOI 10.1002/rcs.70235，PMID42853000。Crossref发布者许可记录为CC BY 4.0，原作者署名和来源链接见NOTICE；中文内容为修改后的摘要级机器整理，不是原作者译文。无全文/PDF镜像。

## 发布

从main分支根目录发布GitHub Pages。`.nojekyll`禁用Jekyll处理，静态相对路径支持项目子目录。无需工作流、模型凭据或Secrets，不包含调度。启用入口：Settings → Pages → Deploy from a branch → main / (root) → Save。
