/**
 * 本文件：编辑坞折叠状态的 React 上下文。
 * 职责：EditDock 持有折叠状态并通过 Provider 下发，旁白时间轴用
 * useEditDock 读取折叠态并放置自己的折叠开关。
 * 关键点：时间轴脱离编辑坞渲染时 useEditDock 返回中性默认值（未折叠），
 * 使其不依赖外壳是否存在。
 */
'use client';

/**
 * Edit dock context — the fold the dock owns and the timeline operates.
 *
 * The dock owns the surface: the top border, the blur, the drag-resize handle,
 * the global edit bar and the height. The narration timeline owns everything
 * below that bar — including its own header row, because that row's controls and
 * its body share one piece of state (the insert-picker anchor, the TTS batch, the
 * focused clip). So the shell cannot render the row; it lends the timeline the
 * fold instead, and the timeline puts the toggle at the end of its own row where
 * the title has always been able to reach it.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface EditDockContextValue {
  /**
   * The dock is folded. The timeline's collapsed form is its axis of node icons
   * (still a body), so it reads this rather than being hidden by the shell.
   */
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const EditDockContext = createContext<EditDockContextValue | null>(null);

/** 向后代提供编辑坞折叠状态，通常由 EditDock 在时间轴外层调用。 */
export function EditDockProvider({
  value,
  children,
}: {
  value: EditDockContextValue;
  children: ReactNode;
}) {
  return <EditDockContext.Provider value={value}>{children}</EditDockContext.Provider>;
}

/**
 * Read the dock's fold. Returns a neutral value when the timeline is rendered
 * outside a dock (an isolated test, a future standalone mount) so it is never
 * coupled to the shell being there.
 */
/** 读取编辑坞折叠态；无 Provider 时回退到「未折叠」的中性默认值。 */
export function useEditDock(): EditDockContextValue {
  return useContext(EditDockContext) ?? { collapsed: false, toggleCollapsed: () => undefined };
}
