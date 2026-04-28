# 第10步：简单条件查询（聚合走指标，smart-ask-data）

本文件定义 `smart-ask-data` 第 10 步在“简单条件筛选 + 聚合改走指标”场景下的执行规范。

分支边界声明：本文件适用于第 10 步简单条件查询分支；其中聚合问题必须走指标流程，不得用复杂查询命令替代执行。

## 适用场景

当第 10 步完成分流判断后，若问题被判定为“简单条件查询问题”（包含明细筛选与简单聚合），必须执行本文件流程。

## 执行目标

按分流使用以下方式完成查询并返回结果，不进入复杂查询分支：
- 简单条件明细：使用 `kweaver context-loader query-object-instance`
- 简单条件聚合（计数、求和、平均、最值等）：使用指标流程（`metric_query_with_condition.py`）

## 简单聚合处理（计数/求和等，统一走指标）

当用户问题属于**简单条件下的聚合计算**（如总数、计数、求和、平均、最大/最小）时，不应使用对象实例明细查询方式，也不再使用 `kweaver dataview query` 直接做聚合 SQL，必须在本分支内切换为指标流程执行。

- 指标结构建模：指标通过 `scope`（所属对象类）、计算公式（过滤条件 + 聚合方式 + 分组字段）、时间维度、分析维度等要素完整描述业务量化逻辑。当前支持原子指标类型（`atomic`），复合指标类型后续迭代补充。
- 多维查询模式：
  - 即时查询：`instant=true`，获取当前汇总值。
  - 趋势查询：`instant=false` + 时间范围，按日/月/年等日历步长返回时序数据。
  - 同环比分析：`type=parallel`，配置偏移量后计算增长值与增长率。
  - 占比分析：`type=proportion`，按分析维度返回各维度占比百分比。

### 指标流程（必须）

1. 配置指标知识网络
   `--kn-id` 的来源同主流程，统一从 `SOUL.md` 读取，不得自行猜测或替换。  
   命令：
   `kweaver context-loader config set --kn-id <指标知识网络>`

2. 搜索相关指标  
   命令：
   `kweaver context-loader search-schema "利润率" --scope metric --max 5`

3. 执行指标  
   使用 `smart-data-analysis/scripts` 目录中的指标执行脚本：`metric_query_with_condition.py`。

   PowerShell 示例（单条件）：
   ```powershell
   python skills/smart-data-analysis/scripts/metric_query_with_condition.py `
     --kn-id <指标知识网络> `
     --metric-id <指标ID> `
     --field <字段名> `
     --op "==" `
     --value <筛选值> `
     --insecure
   ```

   Linux 示例（多条件）：
   ```bash
   python skills/smart-data-analysis/scripts/metric_query_with_condition.py \
     --kn-id <指标知识网络> \
     --metric-id <指标ID> \
     --logic and \
     --cond "<字段1>,==,string,<值1>" \
     --cond "<字段2>,>,number,<值2>" \
     --insecure
   ```

### 指标查询案例（实测）

以下案例基于已验证指标：
- `kn_id`: `d7lj3i54g3h4iis9fubg`
- `metric_id`: `d7nidst4g3h4iis9fur0`
- 业务含义：统计企业状态对象类型总数（可按条件筛选）

1. 单条件查询：企业状态 = 注销

```powershell
$t = kweaver token
python skills/smart-data-analysis/scripts/metric_query_with_condition.py `
  --kn-id d7lj3i54g3h4iis9fubg `
  --metric-id d7nidst4g3h4iis9fur0 `
  --field regstate_cn `
  --op "==" `
  --value 注销 `
  --bearer $t `
  --account-id ff8ef3da-3e12-11f1-8993-261248b384b3 `
  --account-type user `
  -bd bd_public `
  --insecure
```

期望返回关键值：
- `datas[0].values[0] = 89`

2. 多条件查询（AND）：企业状态 = 注销 且 注册资本 > 1000

```powershell
$t = kweaver token
python skills/smart-data-analysis/scripts/metric_query_with_condition.py `
  --kn-id d7lj3i54g3h4iis9fubg `
  --metric-id d7nidst4g3h4iis9fur0 `
  --logic and `
  --cond "regstate_cn,==,string,注销" `
  --cond "regcap,>,number,1000" `
  --bearer $t `
  --account-id ff8ef3da-3e12-11f1-8993-261248b384b3 `
  --account-type user `
  -bd bd_public `
  --insecure
```

期望返回关键值：
- `datas[0].values[0] = 74`

注意（PowerShell）：
- `--cond` 参数必须整体加引号，例如 `"regcap,>,number,1000"`，避免 `>` 被解释为重定向符。

## 执行命令（必须）

### A. 简单条件明细（`query-object-instance`）

#### PowerShell 模板（推荐）

```powershell
$payload = @{
  ot_id = "scjg_e_baseinfo"
  condition = @{
    operation = "and"
    sub_conditions = @(
      @{ field = "estdate"; operation = "=="; value_from = "const"; value = "2024-02-29" }
    )
  }
  limit = 200
}
$jsonArg = $payload | ConvertTo-Json -Depth 8 -Compress
$null = $jsonArg | ConvertFrom-Json
$jsonEscaped = $jsonArg -replace '"','\"'
npx kweaver context-loader query-object-instance $jsonEscaped
```

#### Linux 直接写版本

```bash
npx kweaver context-loader query-object-instance '{\"ot_id\":\"scjg_e_baseinfo\",\"condition\":{\"operation\":\"and\",\"sub_conditions\":[{\"field\":\"estdate\",\"operation\":\"==\",\"value_from\":\"const\",\"value\":\"2024-02-29\"}]},\"limit\":200}'
```

#### Linux 变量组装版本（推荐）

```bash
ot_id="scjg_e_baseinfo" && date_value="2024-02-29" && json=$(jq -nc --arg ot "$ot_id" --arg d "$date_value" '{ot_id:$ot,condition:{operation:"and",sub_conditions:[{field:"estdate",operation:"==",value_from:"const",value:$d}]},limit:200}') && json_escaped=$(printf '%s' "$json" | sed 's/"/\\"/g') && npx kweaver context-loader query-object-instance "$json_escaped"
```

## 执行要求

1. 保持命令结构与参数契约一致。  
2. 明细查询使用 `ot_id`、`condition`、`limit`；简单聚合查询统一使用指标流程（`metric_query_with_condition.py`）。  
3. 必须在本分支内拿到可复核查询结果；若执行失败，按主流程强约束立即停止。  
4. 成功后直接将查询结果交给后续第 11 步/第 12 步，不再走复杂查询分支。  
5. 聚合结果的行数、维度与时间粒度由指标请求体约束，不再以 `dataview query` 的 `LIMIT` 规则为准。  

## 命令参数防错（必须遵守）

- 禁止手写多层转义字符串（高概率触发 `Invalid JSON argument`）。
- 必须优先使用“对象组装 -> `ConvertTo-Json` -> 本地校验 -> 自动转义 -> 命令调用”流程。
- `query-object-instance` 入参建议来自变量（如 `$jsonEscaped`），不要直接内联复杂 JSON。
- `condition` 必须显式提供（至少含 `operation` 与 `sub_conditions`）。

### 最小自检（必须执行）

- 调用前先执行：`$null = $jsonArg | ConvertFrom-Json`
- 调用参数先执行：`$jsonEscaped = $jsonArg -replace '"','\"'`
- 若校验失败，立即返回原始报错并停止，不得继续调用 `query-object-instance`。
