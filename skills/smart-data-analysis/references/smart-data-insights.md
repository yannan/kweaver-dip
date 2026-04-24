---
name: smart-data-insights
version: "2.3.0"
user-invocable: true
description: >-
  数据洞察 skill 四个子场景：数据解读、维度分析、对比分析、归因分析。当用户要求「解读数据/趋势/异常/贡献/建议」或「多角度/多维度/分布」或「对比/比较/同比/环比/A与B」或「归因/根因/为什么/驱动因素/MECE 证据链」等时使用。
  面向有分析需求的业务用户：用户可见正文以通俗业务语言为主（结论先说清「说明了什么、对谁有用」），技术核对（表名、子问题编号、原样 SQL 等）集中在「附录 / 核对用」或章节后部，避免主文堆砌术语。
  统一执行路径：先做子场景识别，再按新版 smart-ask-data 第 7～9 步（候选表检索 → 权限校验 → dataview get）收敛可查询的数据视图与字段；在拆分子问题之前还须阅读本轮每一启用子场景在 references/ 下的输出模板（data_interpretation.md、dimensional_analysis.md、contrastive_analysis.md、attribution_analysis.md 四选一或多选，仅读启用项）；
  然后编写子问题清单并逐子问题按新版 smart-ask-data 第 10～11 步（生成 SQL → dataview query 执行）取数；
  仅基于各子问题「原样 SQL + 原样结果 + 最小口径」按已读模板合成正文（禁止无证据推断）。
  若用户已提供完整多子问题取数交付物且明确「仅洞察/仅解读、不取数」，可走「仅消费输入」降级路径（见正文）。
metadata:
  openclaw:
    skillKey: smart-data-insights
argument-hint:
  - 默认传入用户自然语言任务（含表/业务主题）；kn_id_ask_data 从 SOUL.md 读取。若仅做离线合成（即不重新取数），传入多段 smart-ask-data 最终交付原文（每段含 kn_id、SQL、结果、口径）或完整归因证据包。可提示优先子场景：数据解读 / 维度分析 / 对比分析 / 归因分析。
---

# Smart Data Insights（数据洞察：四子场景）

本 skill 的定位：**在可复核的数据证据上**，按所选子场景输出结构化结论。四个子场景 **共享同一套上游编排**（**先做子场景识别** → 新版 smart-ask-data 第 7～9 步：候选表检索 → 权限校验 → `dataview get` **收敛可查询的数据视图与字段** → **子场景模板查阅** → 子问题清单 → 每子问题第 10～11 步：生成 SQL/执行查询），差异在于 **子问题设计侧重点** 与 **输出章节模板**（分文件维护于 `references/`，**须在拆子问题前阅读对应模板**）。

**默认读者**：以 **业务用户**（关心指标含义、变化对业务的影响、可行动结论）为主；**编排与取数**仍须严格遵守 `smart-ask-data` 与各 reference 的证据约束，但 **用户可见主文** 应少写实现细节（如接口名、字段英文名、命令细节等），把「谁、在什么范围、看出什么、建议关注什么」写在前。

## 四子场景一览

| 子场景 | 典型用户诉求 | 独有模板（渐进加载） |
|------|----------------|----------------------|
| **数据解读** | 解读数据、分析结果、给建议、异常说明、趋势、贡献 | [references/data_interpretation.md](references/data_interpretation.md) |
| **维度分析** | 多角度、多维度、拆解、结构、分布、TopN | [references/dimensional_analysis.md](references/dimensional_analysis.md) |
| **对比分析** | 对比、比较、同比、环比、两期、A 与 B | [references/contrastive_analysis.md](references/contrastive_analysis.md) |
| **归因分析** | 根因、为什么、驱动因素、MECE、下滑/下跌/转化/流失归因、可验证证据链 | [references/attribution_analysis.md](references/attribution_analysis.md) |

**模板与渐进加载（MUST）**

- **读取范围**：只读 **本轮已启用** 的子场景文件；启用几类读几份，**禁止**未启用子场景也整本预读。
- **读取时机（与「子场景识别 / 找表 / 字段」的关系）**：在 **「子问题拆解」步骤开始之前**，须已完成：**①** **子场景识别**（确定本轮启用哪些子场景）；**②** 至少一次与用户问题相关的新版 smart-ask-data **第 7～9 步**（`kn-schema-search` 候选表检索 → 第 8 步权限校验 → 对通过候选执行 `dataview get` **收敛可查询的 `dataview_id` 与 `fields`**）；**③** 对 **每一个已启用子场景**，打开对应 `references/*.md`（含 `attribution_analysis.md`），至少阅读 **「子问题拆解指引 / 规则」** 与 **「输出模板」** 两节（标题以各文件内 `##` 为准）。**禁止**在未读模板的情况下编写子问题清单。
- **合成阶段**：最终输出仍须与已读模板章节一致；若写正文时需核对措辞，可再次打开同一文件，**不必**为未启用子场景补读全文。

---

## 与相关 skill 分工

- `smart-data-analysis`：总入口；将「数据洞察（含原数据解读诉求）」路由到本 skill，并保证 **`kn_id_ask_data`**（`SOUL.md`）、`token` / `base_url` / `user_id` / `date` 已对齐。
- `smart-ask-data`：单次问数执行层；本 skill **不替代**其 Step 1–7，**通过编排多次调用**完成各子问题取数。
- `smart-data-interpretation`：**已并入本 skill**；旧 slash 与 stub 仅作跳转说明（见 [../smart-data-interpretation/SKILL.md](../smart-data-interpretation/SKILL.md)）。
- **归因分析子场景**（`attribution_analysis`，见 [references/attribution_analysis.md](references/attribution_analysis.md)）：在本 skill 内完成 **MECE 子问题取数证据包** 与归因要点；**标准归因分析报告正文**仍由 `smart-reporting`（`attribution_analysis_report`）在同轮组装。历史独立技能名 **`smart-attribution-analysis`** 仅作兼容指称，编排上应并入本 skill。
- `smart-reporting`：基于既有交付写报告；若用户同轮要求「把洞察写成报告」，须在洞察完成后由总入口按 `smart-reporting` 交接。

---

## 能力边界（MUST）

- **必须经真实取数（默认路径）**：洞察中的每一个数字、表格、排名、差值 / 增幅，须能回指到某次新版 smart-ask-data 第 11 步 `kweaver dataview query` 的**原样结果集**（经 `smart-ask-data`）；**禁止**在无对应结果时编造、外推或用常识补齐。
- **拆子问题前的三前置（MUST）**：默认路径下，在编写「子问题清单」之前，必须 **(A)** 完成 **子场景识别**（本轮启用项已确定）；**(B)** 至少完成 **一次** 与用户问题相关的新版 smart-ask-data **第 7～9 步**（候选表检索 → 权限校验 → `dataview get` **收敛可查询数据视图与字段**）；**(C)** 已按 **已启用子场景** 阅读 `references/data_interpretation.md`、`references/dimensional_analysis.md`、`references/contrastive_analysis.md`、`references/attribution_analysis.md` 中各自的 **子问题指引 + 输出模板**（仅读启用项，路径见上文「四子场景一览」）。
- **禁止替代问数实现细节**：命令、接口与失败处理等 **一律遵循** [smart-ask-data/SKILL.md](../smart-ask-data/SKILL.md) 与其对应 `smart-ask-data.md`（含第 7～11 步约束）；尤其第 11 步仅允许使用 `kweaver dataview query ...` 执行查询，失败即停。
- **`execute_code_sync` （默认禁止，例外）**：除 **归因分析子场景（`attribution_analysis`）** 外，本 skill **禁止**使用 `execute_code_sync`。若本轮已启用 `attribution_analysis`，允许 **仅按** [`references/attribution_analysis.md`](references/attribution_analysis.md) 的边界使用二者，且输入必须可回指至已取得的 `dataview query` 结果。
- **子问题数量**：须在 **同一 assistant 回复** 内完成的子问题，建议 **2～8 条**（含）；**若启用 `attribution_analysis`**，子问题数量 **可按该文件建议（如 3～12 条）** 执行，但仍须有停止规则与失败门禁。
- **降级路径（仅消费输入）**：仅当用户 **显式提供** 多段「`smart-ask-data` 最终交付原文」（每段含 **kn_id、原样 SQL、原样结果、最小口径**），且声明 **不再发起新的第 7～11 步取数** 时，可跳过取数编排，直接按 **已启用子场景** 的 reference 模板合成；仍 **禁止**使用输入中不存在的数值。

---

## 编排总流程（默认路径；MUST 按序）

```text
数据洞察进度：
- [ ] 0. 前置：已由 smart-data-analysis 确认本任务为「数据洞察（四子场景之一或多个子场景）」且 kn_id_ask_data / 运行上下文可用（见 smart-ask-data Step 1）
- [ ] 1. 子场景识别（必须先做）：从四子场景中择一或多；多子场景时见下文「多子场景输出顺序」
- [ ] 2. 候选表检索（第 7 步）：使用 `kweaver context-loader kn-schema-search "用户问题关键词"` 检索候选表/视图，并按要求输出「候选表列表」（含对象类型/业务名称、dataview_id）。若报 `view_detail` 权限不足或 `DefaultSmallModelEnabled is false` → 失败即停
- [ ] 3. 查询权限校验（第 8 步）：对候选表列表逐一校验 `operations` 是否包含 `data_query`；若全部不含 → 失败即停
- [ ] 4. 获取候选表详情（第 9 步）：对通过权限校验的 `dataview_id` 执行 `kweaver dataview get <dataview_id>`，拿到 `meta_table_name` 与 `fields`，**收敛**本轮将用于 `dataview query` 的可查询视图与字段，作为后续 SQL 生成依据
- [ ] 5. 查阅子场景输出模板（须在子问题拆解前完成）：对步骤 1 **每一个已启用**子场景，阅读对应 `references/data_interpretation.md` / `references/dimensional_analysis.md` / `references/contrastive_analysis.md` / `references/attribution_analysis.md` 中的 **子问题拆解指引** 与 **输出模板** 章节；仅读启用项
- [ ] 6. 子问题拆解：写出「子问题清单」（每条可独立生成 SQL 并执行查询回答，且口径互不矛盾）；须能覆盖步骤 5 已读模板中的必选小节，并与步骤 4 的字段信息可落地
- [ ] 7. 逐子问题取数（第 10～11 步）：每个子问题在已获取的候选表详情基础上生成可执行 SQL（含日期合法性校核、**行数策略**等约束），并仅使用 `kweaver dataview query <dataview_id> --sql <sql_var> --limit <n>` 执行查询返回结果（失败即停）。其中 **行数策略**必须遵循 `smart-ask-data.md` 的“两段式约定”：**原始明细默认限行**（SQL `LIMIT 200` + `--limit 200`）；**聚合加工后的小结果不应被 `LIMIT 200` 截断**（可不加 SQL limit，并将 `--limit` 提升到如 `2000` 的安全值）。
- [ ] 8. 证据校核：任一子问题失败、空结果重试耗尽或缺关键字段 → 按「失败门禁」处理，禁止用其它子问题结果凑数
- [ ] 9. 洞察合成：仅基于各子问题交付物，**严格按步骤 5 已读模板** 输出；多段 SQL / 多结果须在「口径与证据来源」中分列
```

---

## 子场景识别（MUST）

根据 **用户问题** 关键词勾选子场景（可多选）。

**默认启用规则（关键，必须遵守）**：

- 当用户问题包含「解读/趋势/异常/贡献/建议/分析结果/给建议」等任一洞察诉求时，**必须启用「数据解读（data_interpretation）」子场景**；即使用户同时要求“重新取数/查一下再解读”，也不得只做取数汇总后直接结束，必须按 `references/data_interpretation.md` 的章节输出（不适用的章节按模板写「不适用」与原因）。
- 仅当用户问题**明确**只要“分布/TopN/多角度拆解”时，可只启用「维度分析」；仅当用户问题**明确**只要“对比/比较/同比/环比/A与B”时，可只启用「对比分析」；仅当用户问题**明确**只要「归因/根因/MECE 证据链」且不要轻量解读章节时，可只启用「归因分析」。
- 当用户同时需要 **轻量解读** 与 **归因证据链** 时，建议 **同时启用**「数据解读」与「归因分析」：解读章节承担趋势/异常叙述；归因章节承担可验证根因与 MECE 证据，**不得**在两处给出互相矛盾的「最终根因」表述。

**说明**：若首轮难以预判子问题能否支撑某模板小节，仍应先按用户意图完成 **子场景识别**、**第 7～9 步收敛视图与字段**、**模板查阅** 与 **子问题设计**；若取数完成后某子场景章节确不适用，在正文中按该子场景模板写「不适用」并符合其失败/局限小节。

| 判定 | 启用子场景 |
|------|----------|
| 解读 / 建议 / 异常说明 / 趋势叙事 / 贡献（非单纯要一张分布表） | **数据解读（data_interpretation）** |
| 多角度 / 多维度 / 分布 / 结构 / TopN（且不以双期差分为唯一目的） | **维度分析** |
| 对比 / 比较 / 同比 / 环比 / 两期 / A 与 B | **对比分析** |
| 归因 / 根因 / 为什么 / 驱动因素 / MECE / 下滑原因 / 证据链 / 深度归因 | **归因分析（attribution_analysis）** |

**多子场景输出顺序（MUST）**：**数据解读 → 维度分析 → 对比分析 → 归因分析**（仅输出已启用的章节，未启用则整章省略或写「本轮不适用」）。若用户 **显式**指定章节顺序，以用户指定为准并在「口径与证据来源」中声明。

**与原 v1.1 的对应关系**：仅启用 **维度分析 + 对比分析** 两子场景时，章节顺序与旧版「先第 2 章维度、再第 3 章对比」一致。

---

## 失败门禁（MUST）

- **未读模板即拆子问题**：若在写出「子问题清单」之前，未完成对 **已启用子场景** 对应 `references/*.md` 中 **子问题拆解指引 + 输出模板** 的阅读 → **禁止**进入第 10～11 步（生成 SQL / 执行查询）；须先补读再拆解。
- **smart-ask-data 第 7 步无可用候选 / 失败即停类报错**：若 `kn-schema-search` 无命中，或出现 `Access denied: insufficient permissions for [view_detail]`、`DefaultSmallModelEnabled is false` 等失败即停错误 → 立即终止并按 smart-ask-data 要求提示授权/配置；**禁止**猜表名继续。
- **smart-ask-data 第 8 步无查询权限**：若所有候选的 `operations` 均不含 `data_query`（或接口失败无法判权且无法补救）→ 立即终止并提示需授权开通数据查询权限；**禁止**绕过判权进入查询。
- **任一子问题 smart-ask-data 第 11 步无有效行**（在 `smart-ask-data` 空结果重试耗尽后）：须在正文中标明该子问题「无数据」，依赖该子问题的子场景章节写「不适用 / 不可判定」，**禁止**用其它查询结果顶替。
- **归因与报告**：若用户要求「归因分析报告/标准归因报告」终态排版，须在 **本 skill 内完成归因子场景证据包** 后，由总入口 **同轮** 调用 `smart-reporting`（`attribution_analysis_report`）输出报告正文；**禁止**以「请下一回合再发 `/smart-reporting`」作为终态。

---

## 输入契约（两模式）

### 模式 A — 执行型（默认）

- **输入**：用户自然语言问题；**`kn_id_ask_data`** 须从仓库根目录 **`SOUL.md`** 读取（与 [smart-data-analysis](../smart-data-analysis/SKILL.md) 一致，**禁止**未声明 KN）。
- **本 skill 负责**：按「编排总流程」驱动新版 smart-ask-data 第 7～11 步及多次子问题查询，再按启用子场景输出。

### 模式 B — 仅消费型（降级）

- **输入**：用户显式提供的 **≥1** 段 `smart-ask-data` 最终交付原文，每段至少含：**kn_id**、**SQL（原样）**、**结果数据（原样）**、**最小口径**；且用户要求 **不再新取数**。
- **本 skill 负责**：不发起新的第 7～11 步取数（不做候选检索/判权/`dataview get`/生成 SQL/执行查询）；仍须在合成前 **阅读本轮启用子场景的 `references/*.md` 输出模板**（与模式 A 步骤 5 同要求），再核对用户交付是否覆盖模板必选节。若段数不足以支撑某子场景，该子场景章节写「不适用」并在局限中列出缺哪类子问题。

---

## 跨子场景公共章节（必选骨架）

无论启用几类子场景，用户可见输出 **建议**包含下列 **公共** 块（子场景专有小节紧随其后）。**表达顺序**：先满足业务读者（摘要与子场景正文），再满足可复核性（附录中的技术核对）。

### 0. 洞察摘要（必选，1～5 条）

- 每条必须可回指 **某一子问题** 结果中的行 / 列，或由这些结果 **可验算** 得到。
- **写法**：用业务词写结论（如「2025 年案件量明显高于 2024」「罚款主要集中在××类」）；避免在摘要里写英文字段名、SQL 片段或「子问题 3」等实现标签——若需编号，放到 **附录** 与表格对照。

### 1. 口径与证据来源（必选）

- **对用户主文（建议放在本节前半，3～8 行内）**：用自然语言说明 **本次回答基于哪类业务数据**（如「行政处罚公开信息中的处罚日期、处罚金额、违法类型」）、**时间或范围**（如「库内有数据的全部年份」）、**主要限制**（如「当前样本共 N 条」）。不出现 `kn_id` 全串也可，但须有一句「数据来自当前配置的知识网络下的查询结果」。
- **对复核者 / 技术附录（本节后半或独立「附录：核对用」标题）**：**kn_id**、第 7 步「候选表列表」与关键词、各候选第 8 步判权要点（是否含 `data_query`）、参与查询的 `dataview_id` 的第 9 步结构摘要（`meta_table_name`/关键字段）、**子问题清单**（编号 + 最小口径 + 原样 SQL 或引用前文）、**结果集结构**、**口径复述**（与各 SQL 一致）。

### 2～5. 子场景章节（按需，顺序见上）

- **数据解读**：严格遵循 [references/data_interpretation.md](references/data_interpretation.md) 的章节顺序与证据约束；**对用户措辞**遵循该文件「对用户正文的语言」与主文/附录分工。
- **维度分析**：严格遵循 [references/dimensional_analysis.md](references/dimensional_analysis.md)（同上）。
- **对比分析**：严格遵循 [references/contrastive_analysis.md](references/contrastive_analysis.md)（同上）。
- **归因分析**：严格遵循 [references/attribution_analysis.md](references/attribution_analysis.md)（同上）；与 `smart-reporting` 场景 `attribution_analysis_report` 的输入契约对齐，便于同轮交接。

---

## 与 `smart-data-analysis` 的交接（MUST）

- 进入本 skill 前，**必须**已由 `smart-data-analysis` 注入 **`kn_id_ask_data`**（来自 `SOUL.md`）及运行上下文。
- **同轮闭环**：默认路径下，第 7～11 步的取数编排、各子问题查询与洞察正文须在 **同一 assistant 回复** 内完成。
- **与「单次问数终态」的关系**：用户仅要一条 SQL 结果、不要多子问题洞察时，总入口应只走 `smart-ask-data`，**不必**进入本 skill。

---

## 调用示例（slash / 指令）

```text
/smart-data-insights 数据解读：解读近一年销售表的销量趋势和头部区域贡献
/smart-data-insights 维度分析：对行政处罚公开表做多维度案件量分析（地区、违法类型、月份）
/smart-data-insights 对比分析：对比 2024 与 2025 各季度订单金额，并分渠道看差异
/smart-data-insights 解读 + 维度：分析本月订单的结构分布，并解读头部类目表现
/smart-data-insights 归因分析：销量下滑，请按区域与品类做 MECE 证据链并输出可验证根因
```


（仅消费型）用户粘贴多段「问数最终交付」并要求：「不要重新查库，仅基于以下结果做解读与维度洞察」→ 走 **模式 B**，并启用对应子场景的 reference。
