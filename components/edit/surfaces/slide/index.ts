/**
 * 本文件：slide surface 目录的桶文件（barrel）。
 * 职责：触发 register 的副作用注册，并对外导出 slideSurface。
 */
// Importing this module registers the slide surface as a side effect.
import './register';

export { slideSurface } from './SlideSurface';
