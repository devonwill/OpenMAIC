import { nanoid } from 'nanoid';
import type { Action, PPTElement, PPTImageElement, Slide, SlideTheme } from '@openmaic/dsl';
import type { SceneOutline } from './outline-types.js';
import type {
  CompleteScene,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
} from './scene-types.js';

export interface BuildCompleteSceneOptions {
  /**
   * Stable identity supplied by retrying/upserting consumers. Reusing it turns
   * a replay into the same logical scene instead of appending a duplicate.
   * The default remains a random `nanoid()` for drop-in compatibility.
   */
  sceneId?: string;
}

/**
 * Unit logo stamped into the top-right corner of every GENERATED slide.
 *
 * Only the generation funnel (`buildCompleteScene`) applies it — imported /
 * uploaded decks are parsed by `@openmaic/importer`, which never calls this
 * module, so they stay untouched. The `src` is a same-origin path under
 * `public/`: the renderer loads it directly and the PPTX exporter inlines it
 * through the regular asset-manifest flow (refs are derived from the slide).
 */
const UNIT_LOGO_ID = 'unit-logo-uestc';

/** Fresh element per scene so later in-place edits cannot cross-contaminate. */
function createUnitLogoElement(): PPTImageElement {
  return {
    id: UNIT_LOGO_ID,
    name: 'unit-logo',
    type: 'image',
    src: '/unit-logos/uestc.png',
    // Top-right of the 1000 × (1000 * 0.5625) design canvas: 1000 - 64 - 20.
    left: 916,
    top: 20,
    width: 64,
    height: 64,
    rotate: 0,
    fixedRatio: true,
  };
}

/**
 * Append the logo on a copy — retry paths replay the same `content` object
 * and must observe identical input across calls. Skip when content already
 * carries the logo (e.g. regenerated from a previously stamped slide).
 */
function withUnitLogo(elements: PPTElement[]): PPTElement[] {
  if (elements.some((element) => element.id === UNIT_LOGO_ID)) return elements;
  return [...elements, createUnitLogoElement()];
}

/** Build a complete, store-independent scene from generated primitives. */
export function buildCompleteScene(
  outline: SceneOutline,
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent,
  actions: Action[],
  stageId: string,
  options: BuildCompleteSceneOptions = {},
): CompleteScene | null {
  const sceneId = options.sceneId ?? nanoid();
  const timestamps = { createdAt: Date.now(), updatedAt: Date.now() };

  if (outline.type === 'slide' && 'elements' in content) {
    const defaultTheme: SlideTheme = {
      backgroundColor: '#ffffff',
      themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4'],
      fontColor: '#333333',
      fontName: 'Microsoft YaHei',
      outline: { color: '#d14424', width: 2, style: 'solid' },
      shadow: { h: 0, v: 0, blur: 10, color: '#000000' },
    };
    const canvas: Slide = {
      id: nanoid(),
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: defaultTheme,
      elements: withUnitLogo(content.elements),
      background: content.background,
    };
    return {
      id: sceneId,
      outlineId: outline.id,
      stageId,
      type: 'slide',
      title: outline.title,
      order: outline.order,
      content: { type: 'slide', canvas },
      actions,
      ...timestamps,
    };
  }

  if (outline.type === 'quiz' && 'questions' in content) {
    return {
      id: sceneId,
      outlineId: outline.id,
      stageId,
      type: 'quiz',
      title: outline.title,
      order: outline.order,
      content: { type: 'quiz', questions: content.questions },
      actions,
      ...timestamps,
    };
  }

  if (outline.type === 'interactive' && 'html' in content) {
    return {
      id: sceneId,
      outlineId: outline.id,
      stageId,
      type: 'interactive',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'interactive',
        url: '',
        html: content.html,
        widgetType: content.widgetType,
        widgetConfig: content.widgetConfig,
      },
      actions,
      ...timestamps,
    };
  }

  if (outline.type === 'pbl' && 'projectV2' in content) {
    return {
      id: sceneId,
      outlineId: outline.id,
      stageId,
      type: 'pbl',
      title: outline.title,
      order: outline.order,
      content: { type: 'pbl', projectV2: content.projectV2 },
      actions,
      ...timestamps,
    };
  }

  return null;
}
