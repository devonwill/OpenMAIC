# 知识图谱与 Paper2Agent 融合试点

## 当前可用功能

首页「知识库」进入 `/knowledge`：图谱浏览、概念与别名检索、一跳关系展示、论文文本片段检索、来源查看和 Markdown 学习材料下载。

服务端接口 `GET /api/knowledge` 支持 `q`、`bundle`、`node` 参数。站点配置了 ACCESS_CODE 时，沿用现有访问码校验。资源在同一部署的授权用户间共享；本版不是私人文献库，不支持通过网页上传或执行仓库代码。

课堂知识接口已接入经典问答 `/api/chat`、Pi 问答 `/api/chat/pi`、大纲生成和场景正文生成。只检索 `reviewStatus: reviewed` 的知识包；开关默认关闭。检索附加到服务端请求，客户端原始聊天记录不被改写。

## 数据现状

- `data/knowledge/robotics-demo.json`：4 个演示知识点、3 条关系。不是原机器人学系统数据库，不能作为已审核教学依据。
- `data/knowledge/paper2agent-paper.json`：从用户提供的 Paper2Agent 阅读包导入 196 个正文/补充材料片段。保留文件 SHA-256 与片段位置，状态为待审核。此文件属于本机资料，未提交到 Git，包含于本次交付快照。
- 导入器只读取 `references/paper.md` 和可选的 `references/supplement.md`；不执行或注入 SKILL.md。图片、CSV 表格和可执行 MCP 服务尚未接入。文本中的图片链接仅作为原文保存，不保证在网页中可打开。
- 原机器人学 ZIP 内的数据是旧领域数据，未导入。需要从实际 Neo4j 实例取得机器人学数据导出。原 `/api/graph/` 有查询数量上限，不应把其默认结果误认为全库备份。

## 启动和使用

按原项目方式执行 `pnpm dev`，打开首页「知识库」。检索不到中文术语时可尝试英文名或别名。本版本采用本地词项匹配，尚未使用向量检索或模型实体提取。

选择节点/论文片段后可以下载 Markdown，再在首页作为课程材料上传。导出材料保留审核状态；手动上传不是自动审核，教师应先检查演示或待审核内容。图谱和无搜索的目录浏览最多显示 60 个节点，搜索可检索完整已加载知识包；单次最多返回 12 条搜索结果。

## 导入 Paper2Agent 阅读包

在 OpenMAIC 项目根目录运行：

```bash
pnpm exec tsx scripts/import-knowledge.ts \
  --paper /absolute/path/to/example-paper \
  --id example-paper --title '论文名称'
```

输入必须已有 `references/paper.md`。导入后的章节切片最长 10,000 字符；长段落的切分位置和公式需要人工核对。每次导入默认是 `unreviewed`，不会继承原包声称的审核状态。

## 导入旧图谱 JSON

```bash
pnpm exec tsx scripts/import-knowledge.ts \
  --graph /absolute/path/to/robotics-export.json \
  --id robotics-course --title '机器人学课程知识图谱'
```

兼容 `nodes/links` 和旧接口的 `data.nodes/data.links` 包装；支持 `name_ch/name`、`definition/explanation/content`、`relation_name/relation/name`。节点 ID 必须存在且唯一，所有关系端点必须有效。请使用稳定业务 ID；图片、视频、关系方向的历史准确性仍须核对。本版不迁移原系统账号和聊天历史。

导入器默认写入 `data/knowledge`，可以用 `--out DIRECTORY` 指定目录。禁止覆盖同名文件；更新请使用新的包 ID 和文件名，在审核后替换部署中的旧版本。

## 审核和开启课堂知识

1. 核对知识内容、原文位置、概念关系、单位/公式约定及所需图表。图谱“相关知识”不能直接解释成先修关系。
2. 由资料维护者将通过审核的 JSON 顶层 `reviewStatus` 从 `unreviewed` 改为 `reviewed`，并另存审核人与日期记录。不要把演示包改为真实知识包。
3. 在服务器配置中设置 `KNOWLEDGE_CLASSROOM_ENABLED=true`，重启应用。若使用外部资料目录，设置绝对路径 `KNOWLEDGE_DATA_DIR`。
4. 用课程题集检查答案和 `[知识来源:包ID/节点ID]` 对应的证据。提示词要求引用，但没有保证模型每次都会正确引用，仍需试教验证。

开关关闭、没有命中或知识文件损坏时，不阻断原课堂；损坏包在知识库页面报告并跳过。知识库仍可浏览待审核资料，但不会将它们自动附加到课堂请求。

默认每文件上限 20 MB、最多 50 个 JSON、总加载上限 50 MB；超过规模应增加索引服务。知识读取按请求进行，本试点未实现跨请求缓存。现有问答超时和中断协议保持不变；知识检索是可选附加环节。

## 部署

本地导入文件位于 Git 忽略目录。新机器部署必须另行复制知识包，或设置并挂载 `KNOWLEDGE_DATA_DIR`。Next standalone tracing 包含构建时的 `data/knowledge/*.json`；发布前确认其中仅有允许该站点用户访问的资料。关闭自动引用不会隐藏知识库中的资料。

## 版本与备份

融合前完整备份：
`../OpenMAIC-backups/OpenMAIC-before-knowledge-20260924-123127.tar.gz`

该归档包括 Git 历史、配置和当时未提交修改；排除 `node_modules`、`.next`、`_tmp_*`、`.DS_Store`。备份文件权限为 0600，因为可能含本地密钥。不要上传到公开仓库。

功能分支：`codex/knowledge-paper2agent-pilot-20260924`。本次功能提交只包含融合相关变更，原有模型和语音相关修改保留在工作区。

回退建议：先停止应用，将融合前完整备份解压到一个新目录，安装依赖后在新目录验证，再切换运行目录。不要直接覆盖当前工作区，以免丢失备份之后的其他改动。

```bash
mkdir -p /absolute/path/to/openmaic-restore
# 将 BACKUP 换成上面的完整备份路径；解压后会得到 OpenMAIC 子目录。
tar -xzf BACKUP -C /absolute/path/to/openmaic-restore
```

紧急关闭知识自动引用可设 `KNOWLEDGE_CLASSROOM_ENABLED=false` 并重启；这不会删除知识包。

## 验证与下一步

自动验证覆盖自然语言/别名检索、关系证据、重复 ID/悬空边拒绝、审核状态隔离、故障降级、API 数据、旧接口导入、防覆盖和不改写原始会话。另运行原大纲与 Pi 问答回归测试。

浏览器验证包含图谱点击、来源详情、材料下载、论文搜索、桌面与手机布局。未使用真实模型服务、Neo4j 或科研计算后端做端到端验证。

下一步先导入真实机器人学图谱和教师选定的论文包，再建设有基准答案的计算工具、MCP 调用网关及隔离运行环境。本次不包含自动论文转换流水线、通用 MCP 运行平台或完整仿真实验系统。
