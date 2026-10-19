/**
 * 本文件：工作台入口组件。
 * 职责：作为独立落地的 workspace-shell 切片的接入点，渲染完整工作台外壳。
 */
import { WorkspaceShell } from '@/components/workbench/workspace/WorkspaceShell';

/** Integration seam for the independently landed workspace-shell slice. */
// 薄封装：路由层只引入本组件即可挂载工作台，便于外壳实现独立演进。
export function WorkspaceEntry() {
  return <WorkspaceShell />;
}
