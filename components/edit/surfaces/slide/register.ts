/**
 * 本文件：slide surface 的注册副作用。
 * 职责：把 slideSurface 注册进 sceneEditorRegistry，使 EditShell 能按
 * scene.type 解析到幻灯片编辑能力；应用启动时经 stage.tsx 引入一次。
 */
import { sceneEditorRegistry } from '@/lib/edit/scene-editor-registry';
import { slideSurface } from './SlideSurface';

// Side-effect registration. Imported once at app boot (via `stage.tsx`) so
// EditShell can resolve the slide surface the moment Pro mode is entered;
// the shell itself never imports surfaces directly.
sceneEditorRegistry.register(slideSurface);
