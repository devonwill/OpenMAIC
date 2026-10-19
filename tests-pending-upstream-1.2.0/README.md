# 待归位测试（上游 1.2.0 大重构未完整合并）

这些测试文件来自 THU-MAIC/OpenMAIC 的上游提交，但它们测量的实现代码属于
上游 1.2.0 的大规模目录重构（`lib/standalone-player/`、`lib/web-fetch/`、
`lib/server/generation/` 等新目录），本分支尚未合并那部分重构。

因此当前状态是「测试落地、实现未落地」，`pnpm test` 会失败。

## 为什么不直接删除

这些测试本身是有价值的断言，等上游重构合并后应当原样归位。目录结构与
`tests/` 下原路径保持一致，归位时直接整目录拷回即可：

```bash
# 上游 1.2.0 重构合并完成后
cp -R tests-pending-upstream-1.2.0/tests/. tests/
rm -rf tests-pending-upstream-1.2.0
```

`vitest.config.ts` 的 `include` 是 `tests/**/*.test.ts`，本目录不在其扫描
范围内，所以放在这里不影响测试与构建。

## 文件分类

### A. 孤儿测试（11 个）—— 被测实现整体缺失

上游把测试和实现放在同一个提交里，本分支只摘取了测试文件。

| 文件 | 对应上游修复 |
|---|---|
| `tests/action/engine-code-edit.test.ts` | #1929 引擎代码编辑 |
| `tests/agent-runtime/materials-owner-route.test.ts` | 素材属主路由 |
| `tests/agent-runtime/user-skill-fence.test.ts` | #1858 用户 skill 内容围栏化 |
| `tests/document/mineru-cloud-operator-policy.test.ts` | #1630 MinerU 运营方策略 |
| `tests/hooks/use-drag-element.test.ts` | #1631 拖拽元素 |
| `tests/lib/agent/runtime/stream-fn-images.test.ts` | 流式函数图像 |
| `tests/media/provider-media-download-bounds.test.ts` | #1933 provider 媒体下载限流 |
| `tests/persistence/owner-bound-operation-scope.test.ts` | owner 绑定操作域 |
| `tests/server/classroom-media-transport.test.ts` | #1883 课堂媒体传输 |
| `tests/workbench/material-upload-size-precheck.test.ts` | 素材上传预检 |
| `tests/workflows/app-pg-contract.test.ts` | PG 契约 |

### B. 原有测试（4 个）—— 源码已更新，断言未同步

上游改了被测源码的行为，但没有同步修改这几个测试文件。

| 文件 | 失败原因 |
|---|---|
| `tests/agent-runtime/skills.test.ts` | 断言仍指向旧的 skill 内容格式 |
| `tests/audio/regenerate-speech-tts.test.ts` | 断言仍指向旧的 TTS 参数 |
| `tests/persistence/route.test.ts` | 上游调整了路由的持久化契约 |
| `tests/workbench/entry-routes.test.ts` | `vi.mock("@/lib/workbench/entry-gate")` 未补新导出 `isWorkbenchEntryAllowedForRequest` |

B 类修复成本很低，合并上游重构后逐条对齐断言即可；也可以现在就单独修
`entry-routes`（只需在 mock 中补上该函数的返回值）。
