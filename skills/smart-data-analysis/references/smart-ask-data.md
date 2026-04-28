# smart-ask-data（问数子技能）

用于把自然语言问题按第 10 步分流为可执行查询，并返回可复核的取数结果。

## 参考经验

- [`smart-ask-data-knowledge.md`](smart-ask-data-knowledge.md)：沉淀常见问数口径与 SQL 约束经验（如企业名称非空过滤；**未特别声明时企业口径不含个体工商户**）。
- [`smart-json2plot.md`](smart-json2plot.md)：当用户有画图需求时，将 SQL 结果转换为绘图数据。

## 使用场景

- 用户要查“多少、明细、汇总、TopN、占比”等可查询问题（第 10 步按类型分流）
- 已明确或可收敛到 `kn_id_ask_data`
- 需要最终交付数据结果，而不是仅定位资产
- 用户在问数后要求画图（柱状图、饼图、折线图、散点图）

## 输入要求

- `kn_id_ask_data`（必须来自 `SOUL.md`）
- 时间范围、过滤条件、统计口径（至少可推导）
- 认证上下文：`token`、`base_url`、`user_id`（可由上层编排注入）
- 可选：`chart_type`（`bar` / `pie` / `line` / `scatter`）

## 强约束（SOUL 对齐，必须执行）

- 必须严格按第 5-12 步顺序执行，不得跳步、并步、倒序或绕过门禁。
- 禁止编造或篡改流程：不得虚构已执行步骤、不得伪造步骤结果、不得擅自修改流程定义与执行记录。
- 任一步骤失败必须立即停止流程并返回真实失败原因；在失败状态下不得继续后续步骤。
- **关键链门禁**：第 **7**（寻找候选表）、**8**（校验数据查询权限）、**9**（获取候选表详情）、**10**（查询数据，含**日期及区间合法性**校核与执行查询）步任一执行失败（无可用候选、权限校验不通过、详情拉取失败、**公历日期/区间不合法**、简单明细 JSON 条件不合法、简单聚合指标执行失败、复杂查询 SQL 不合法或执行失败等），必须**立即终止全流程**，不得进入第 11 步及以后；**不得**为“跑通结果”而改用本文件未规定的命令或旁路工具继续取数。
- **第 7–10 步命令与路径限定（必须）**：第 **7–10** 步**不得使用本文件未规定的命令或旁路工具**替代规定动作。具体为：第 **7** 步**仅允许**使用 `kweaver context-loader search-schema "用户问题关键词" --scope object --max 5` 检索候选表/视图；第 **8** 步权限校验**仅允许**使用 `kweaver curl` / `kweaver call` 向本文规定的 **`GET /api/mdl-data-model/v1/data-views/<dataview_id>`** 拉取视图信息并解析 `operations`（**不得**以其它未声明接口替代本步权限判据，但 `dataview get` 不得替代本步对 `data_query` 的显式校验）；若第 8 步判定缺少 `data_query`，仅允许按 [`apply-data-auth.md`](apply-data-auth.md) 使用申请权限脚本发起授权申请；第 **9** 步**仅允许**使用 `kweaver dataview get <dataview_id>` 拉取详情；第 **10** 步按分流执行：简单条件明细查询仅允许使用 `kweaver context-loader query-object-instance '<json>'`，简单条件聚合查询仅允许按 [`smart-ask-data-step10-simple-query.md`](smart-ask-data-step10-simple-query.md) 调用指标流程（`metric_query_with_condition.py`），复杂查询仅允许使用 `kweaver dataview query <dataview_id> --sql <sql_var> --limit <n>`（及对应变量/heredoc 传参方式）。若第 **10** 步失败，**必须**停止并返回真实失败原因，**不得**改用其他 `kweaver` 子命令、数据库直连、自写脚本、其它 HTTP/接口或其它工具替代本步规定动作。**禁止**用其他 `kweaver` 子命令、数据库直连、自写脚本等替代上述第 7–10 步的规定命令与数据依据。
- 最终结果必须包含候选表信息（至少展示候选表名称、候选表 id、入选理由）。
- 最终结果中禁止展示 SQL 原文（SQL 仅用于内部生成与执行）；最终对用户仅展示查询结果与口径说明。
- 防遗漏约束：当同一核心指标字段在多个业务对象中同时命中（例如“法定代表人姓名”同时命中企业与律所），不得仅保留单一候选；至少保留 2 个候选并给出入选理由。
- 歧义澄清约束：若用户问题未限定主体范围且候选涉及多个主体域（如企业、律所、个体），在确定第 10 步查询参数前必须先澄清口径；未澄清时不得默认丢弃高匹配候选。
- **行数默认上限**：明细/多行结果默认上限为 **200**（`simple_detail` 通过 `query-object-instance` 的 `limit` 控制，`complex_query` 通过 SQL `LIMIT` 控制）；单行聚合类结果除外；若用户要求其他条数或全量，以用户口径为准并在交付中说明。

## 编排门禁流程（承接总入口第 4 步后继续，序号连续）

进度执行硬约束（必须执行）：
- 每完成第 5-12 步中的任一步，都要立即输出一次进度。
- 进度模板固定为：`[smart-ask-data] 进度：已完成第 N 步（步骤名称）；下一步：第 N+1 步（步骤名称）`
- **第 7 步附加要求**：除上述进度行外，本步**必须同时输出「候选表列表」**（见下文第 7 步「候选表列表」）；**不得**只输出进度而无候选表列表就进入第 8 步。
- 若当前步骤尚未输出进度，**不得进入下一步**。
- 若发现缺步、跳步或步骤失败，必须**立即停止流程**并说明原因，不得继续执行。
- 若流程在第 12 步结束，必须输出：`[smart-ask-data] 进度：已完成第 12 步（总结结果）；流程完成`

5. **检查知识网络**：使用 `kweaver bkn get <kn_id_ask_data>` 确认知识网络存在；并检查该网络**不是元数据知识网络**。若不存在或识别为元数据知识网络，必须先提示用户切换到业务知识网络后再执行问数。
6. **配置知识网络**：使用 `kweaver context-loader config set --kn-id <kn_id_ask_data>` 配置当前问数使用的知识网络，确保后续查询在正确网络上下文中执行。
7. **寻找候选表**：使用 `kweaver context-loader search-schema "用户问题关键词" --scope object --max 5` 检索候选表/视图，优先选择与统计口径、时间范围、核心指标字段匹配的对象进入后续问数流程；筛选时必须同时考虑**视图名称、视图描述、视图字段**三类信息，避免仅凭单一关键词命中。  
   - **候选表列表（第 7 步必须输出）**：在输出「已完成第 7 步」类进度**的同时**，须列出**拟进入第 8 步做权限校验**的候选（一条候选一行，可用 Markdown 表格或等价结构化列表）。每条至少包含：**对象类型/业务名称**（以检索结果 `concept_name`、`name` 等为准）、**数据视图 id**（即后续 `kweaver curl` 拉取、以及 `dataview get` / `dataview query` 所用的 **UUID**，通常对应检索结果中 `data_source` 下 `type` 为 `data_view` 的 `id` 字段，**以接口返回为准，禁止手填**）。若同屏保留多个候选，应完整列出，并与上文「多候选保留」要求一致；无可用候选时，列表可为空，但必须说明无命中并终止流程。
   - 筛选权重要求：提高“视图字段命中”的权重，字段命中优先级应高于仅名称命中或仅描述命中；当名称/描述与字段命中冲突时，以字段匹配结果优先。
   - 建议权重示例：视图字段命中 0.5、视图名称命中 0.3、视图描述命中 0.2（可按业务场景微调，但需保持“字段命中最高”原则）。
   - 多候选保留要求：当出现“字段强匹配 + 对象域不同”的候选（例如 `name`/`director_name` 都映射“法定代表人姓名”）时，默认保留前 2-3 个候选进入**第 8 步**（含权限校验），不得在第 7 步提前裁剪为单表。
   - 关键词扩展要求：对“法定代表人”类问题，检索关键词应至少包含 `法定代表人`、`负责人`、`法人代表`，避免因字段命名差异（如 `name`、`director_name`）漏召回。
  - **第 7 步 `search-schema` 报 `view_detail` 权限不足（失败即停）**：若命令返回体（含嵌套的 `details` / JSON 串）中 **`error_details`** 出现 **`Access denied: insufficient permissions for [view_detail]`**（或与平台一致的等价表述，均指向缺少**视图详情**权限），则**立即终止**问数流程，**不得**进入第 8 步及以后。须向用户**明确提示**：请在平台为当前问数所需的数据视图或业务知识网络完成授权，**配置并开通 `view_detail`（视图详情）权限**（可结合平台「数据视图 / 授权 / 查看详情 / view_detail」等实际菜单名表述）。此情形下**无可用候选**，「候选表列表」可为空，但须在说明中写明上述权限要求与真实报错原文要点。
  - **第 7 步 `search-schema` 报向量模型未启用（失败即停）**：若命令返回体（含嵌套的 `details` / JSON 串）中 **`error_details`** 出现 **`DefaultSmallModelEnabled is false`**（或与平台一致、均指向**概念/向量检索依赖的小模型未启用**的等价表述），则**立即终止**问数流程，**不得**进入第 8 步及以后。须向用户**明确提示**：请在 **`bkn-backend` 服务**侧**配置并启用向量模型**（使 `DefaultSmallModelEnabled` 为可用状态；具体配置项以部署文档为准），否则 `search-schema` 无法完成向量化，第 7 步无有效候选。此情形下**无可用候选**，「候选表列表」可为空，但须在说明中写明上述要求与真实报错原文要点。
8. **校验候选表数据查询权限**：对第 7 步「候选表列表」中的**每个** `dataview_id`（有多个则逐一处理），向数据模型服务请求该数据视图的元信息，读取返回体中的 `operations` 数组/列表。执行前 `kweaver` 应已完成 **auth** 与当前问数**同一平台**的上下文。请求路径形态为 `GET`：

   `/api/mdl-data-model/v1/data-views/<dataview_id>`

   其中 **`<dataview_id>`** 为第 7 步中对应行的 UUID。执行时直接使用相对 API 路径（不拼接平台根 URL），响应一般为 JSON 数组，取 `[0].operations`（以实际响应为准）。

   - **通过条件**：`operations` 中**包含**字符串 **`data_query`**，视为**具备数据查询（查询数据）能力**，该候选在本步**通过**。
   - **无权限时先申请**：若候选 `operations` 中不含 `data_query`，须先按 [`apply-data-auth.md`](apply-data-auth.md) 发起权限申请（脚本：`skills/smart-data-analysis/scripts/apply_data_auth.py`，参数至少含 `dataview_id`、`user_id`、`user_name`）。**若申请接口调用失败、返回失败码或关键参数缺失导致申请未提交成功，必须立即终止流程**；仅在申请成功后，方可重新执行本步校验。
   - **失败即停**：若完成申请后仍无任一候选具备 `data_query`（或接口失败导致无法判权且无法补救），**立即终止**问数流程，并明确提示用户：**该数据视图需先完成授权，并获取数据查询权限**（可结合平台「授权 / 数据查询 / data_query」等实际菜单名表述）。若**至少一个**候选含 `data_query`，可进入第 9 步；**多表 JOIN 问数**时，最终 SQL 中**每一个**会参与 `dataview query` 的 `dataview_id` 均须在本步**各自**已确认其 `operations` 含 `data_query`，**任一侧**不含则不得进入第 11 步，须改选有权限的候选、收敛 SQL 或终止并提示同上。
   - **Windows（PowerShell）**（将示例中的 `dataview_id` 替换为第 7 步列表中的真实值；`ConvertFrom-Json` 前须避免管道损坏 UTF-8，建议**落盘**再读；多个 id 可循环执行）：

     ```powershell
     $out = Join-Path $env:TEMP 'dv-6110a40a.json'
     chcp 65001 | Out-Null
     cmd /c "kweaver curl `"/api/mdl-data-model/v1/data-views/6110a40a-1585-4d3b-bfc0-602e678d190d`" -X GET 2>nul > `"$out`""
     (Get-Content -Path $out -Raw -Encoding utf8 | ConvertFrom-Json)[0].operations
     ```

     对输出列表判断：若其中包含 `data_query`，则具备查询权限。

   - **Linux（bash 等）**（同样仅替换 `dataview_id`）：

     ```bash
     kweaver curl "/api/mdl-data-model/v1/data-views/6110a40a-1585-4d3b-bfc0-602e678d190d" -X GET 2>/dev/null \
       | python3 -c "import json,sys; d=json.load(sys.stdin); print(*d[0]['operations'], sep='\n')"
     ```

     在管道场景下，若因编码导致 `json.load` 失败，可改为**先**将 `kweaver curl` 输出**重定向到 UTF-8 文件**后，用 `python3 -c "import json; print(json.load(open('...',encoding='utf-8'))[0]['operations'])"` 解析（与 Windows 落盘再解析同理）。

9. **获取候选表详情**：对**第 8 步已通过**权限校验的 `dataview_id`，使用 `kweaver dataview get <dataview_id>` 获取字段、主键、数据源等结构化详情，用于确认可查询性与第 10 步参数依据（若上一步有多个有权限的候选，可按第 10 步需要全部拉取或只拉将参与查询的表）。
10. **查询数据（含分流与结果返回）**：本步必须完成复杂度判定并产出查询结果；简单条件查询（含明细与简单聚合：计数/求和/最值等）执行 [`smart-ask-data-step10-simple-query.md`](smart-ask-data-step10-simple-query.md)，复杂查询执行 [`smart-ask-data-step10-complex-query.md`](smart-ask-data-step10-complex-query.md)。不得跨分支使用未规定命令替代执行。**必须严格参考对应分支的指定文档执行，不得自行变更执行路径或命令。**  
   - **简单查询组合判定（新增）**：当同一需求同时包含 `simple_detail` 与 `simple_aggregation` 两部分时，仍归类为**简单查询**，应按简单查询分支执行；仅在出现超出简单查询能力边界的语义/计算要求时，才归类为 `complex_query`。  
   - **查询类型显式输出（必须）**：第 10 步完成后，输出结果中必须显式声明本次选择的查询类型，且仅可为以下三类之一：`simple_detail`（简单条件明细）、`simple_aggregation`（简单条件聚合）、`complex_query`（复杂查询）。  
   - 推荐输出格式：`查询类型：simple_detail | simple_aggregation | complex_query`（可附中文释义）。
11. **画图需求分支（按用户问题触发）**：当用户明确提出“画柱状图/饼图/折线图/散点图”等需求时，调用 [`smart-json2plot.md`](smart-json2plot.md)；基于第 10 步查询结果生成图表数据，并按 Markdown + 标识符格式输出（不直接出图）。
12. **总结结果**：统一展示候选表与查询结果（不展示 SQL 原文）。候选表需至少包含：候选表名称、候选表 id、入选理由；查询结果必须以表格方式展示，确保用户可直接核对字段与取值。若第 11 步已触发，还需合并展示图表数据结果。若第 7 步存在多主体域候选，需在本步显式说明“最终采用口径”与“未采用候选原因”。

## 输出要求

1. 候选表信息（至少包含候选表名称、候选表 id、入选理由）
2. 查询结果（明细或聚合，表格展示）
3. 最小口径说明（时间、过滤、KN；若默认 `LIMIT 200` 被覆盖或未适用，一并说明）
4. 查询类型声明（来自第 10 步分流结果：`simple_detail` / `simple_aggregation` / `complex_query`）
5. 若触发画图需求：补充 `smart-json2plot` 生成的图表数据（Markdown + 标识符）

## 不做事项

- 不做业务解读、归因、建议
- 不直接进行图表出图（仅在需要时调用 `smart-json2plot` 生成绘图数据）
- 不做代码二次加工

## 失败处理

- 明确报错原因（口径缺失、权限不足、无命中、执行失败）
- 总入口已路由为问数时，对**可识别的公历日期/区间**若校验不通过，在**进入子流程前**即停止（见 `smart-data-analysis` 总入口第 3 步「问数前：日期及区间合法性」）
- 第 10 步若**公历日期或日期区间不合法**（或 SQL 中仍将出现非法日期字面量），须在本步内停止执行并向用户说明无效处，请修正后重试
- 第 7 步若出现 `error_details` 含 **`Access denied: insufficient permissions for [view_detail]`**，须按上文第 7 步专条提示用户配置 **`view_detail`（视图详情）** 权限，不得进入后续步骤
- 第 8 步若候选缺少 `data_query`，须先按 [`apply-data-auth.md`](apply-data-auth.md) 发起权限申请；申请后复检仍不通过则终止流程
- 第 8 步若权限申请本身执行失败（接口失败/参数不完整/未成功提交），须立即终止流程，不得继续后续步骤
- 第 7 步若出现 `error_details` 含 **`DefaultSmallModelEnabled is false`**，须**立即停止流程**，并按上文第 7 步专条提示用户在 **`bkn-backend` 服务**配置**向量模型**，不得进入后续步骤
- 给出下一步补充建议
- 不切换到“找数”分支伪造结果
- 第 10 步执行失败时，不改用其它命令或工具替代规定命令重试取数（简单条件明细分支为 `query-object-instance`，简单条件聚合与复杂查询分支为 `dataview query`，见上文「第 7–10 步命令与路径限定」）

## 命令行转义注意事项（PowerShell / Linux）

- 默认使用变量传 SQL，避免手工转义：
  - PowerShell：`$sql = @' ... '@`
  - Linux（bash/zsh）：`sql=$(cat <<'SQL' ... SQL)`
- 在 SQL 块内，`LIKE '%关键词%'` 保持单引号一层，不要写成 `''%关键词%''`。
- 表名/库名按 SQL 规范使用双引号，例如：`"adp_gzfrk"."scjg_e_baseinfo"`。
- 避免将 SQL 直接拼成单行字符串并手工转义；优先变量传参：
  - PowerShell：`--sql $sql`
  - Linux（bash/zsh）：`--sql "$sql"`
- 若必须单行命令再使用 `--sql '<sql>'`，并显式处理引号冲突。
