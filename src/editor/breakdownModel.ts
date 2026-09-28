import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { getScenarioScenes } from './sceneTimelineModel';

export interface BreakdownItem {
  id: string;
  name: string;
  hue: number | null;
  secondaryHue: number | null;
}

export interface BreakdownCategory {
  id: string;
  name: string;
  items: BreakdownItem[];
}

export interface SceneBreakdown {
  categories: BreakdownCategory[];
}

export interface BreakdownCatalogueEntry extends BreakdownItem {
  identity: string;
  categoryName: string;
  sceneIds: string[];
}

export type BreakdownAppearance = Pick<BreakdownItem, 'hue' | 'secondaryHue'>;

export const DEFAULT_BREAKDOWN_CATEGORIES = [
  'Personnages',
  'Décors',
  'Accessoires',
  'Costumes',
  'Son',
  'Besoins spéciaux',
  'Notes',
] as const;

const MAX_NAME_LENGTH = 120;
const AUTO_SOLID_COLOR_COUNT = 8;
const AUTO_HUE_STEP = 5;

interface PerceptualColor {
  lightness: number;
  greenRed: number;
  blueYellow: number;
}

function key(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

function identityKey(categoryName: string, itemName: string): string {
  return `${key(categoryName)}\u0001${key(itemName)}`;
}

function safeName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/gu, ' ').slice(0, MAX_NAME_LENGTH)
    : '';
}

function safeId(value: unknown, prefix: string, index: number): string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
    ? value
    : `${prefix}-${index}`;
}

function safeHue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(360, Math.round(value)))
    : null;
}

export function createBreakdownId(prefix: 'category' | 'item'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createDefaultBreakdown(): SceneBreakdown {
  return {
    categories: DEFAULT_BREAKDOWN_CATEGORIES.map((name, index) => ({
      id: `native-${index + 1}`,
      name,
      items: [],
    })),
  };
}

function normalizeBreakdown(value: unknown, useDefaultsWhenMissing: boolean): SceneBreakdown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { categories?: unknown }).categories)) {
    return useDefaultsWhenMissing ? createDefaultBreakdown() : { categories: [] };
  }
  const categoryIds = new Set<string>();
  const categories = (value as { categories: unknown[] }).categories.flatMap((entry, categoryIndex) => {
    if (!entry || typeof entry !== 'object') return [];
    const category = entry as { id?: unknown; name?: unknown; items?: unknown };
    const name = safeName(category.name);
    let id = safeId(category.id, 'category', categoryIndex);
    while (categoryIds.has(id)) id = `${id}-${categoryIndex}`;
    if (!name) return [];
    categoryIds.add(id);
    const itemIds = new Set<string>();
    const itemNames = new Set<string>();
    const items = (Array.isArray(category.items) ? category.items : []).flatMap((itemEntry, itemIndex) => {
      if (!itemEntry || typeof itemEntry !== 'object') return [];
      const item = itemEntry as { id?: unknown; name?: unknown; hue?: unknown; secondaryHue?: unknown };
      const itemName = safeName(item.name);
      const itemKey = key(itemName);
      if (!itemName || itemNames.has(itemKey)) return [];
      let itemId = safeId(item.id, 'item', itemIndex);
      while (itemIds.has(itemId)) itemId = `${itemId}-${itemIndex}`;
      itemIds.add(itemId);
      itemNames.add(itemKey);
      const hue = safeHue(item.hue);
      return [{
        id: itemId,
        name: itemName,
        hue,
        secondaryHue: hue === null ? null : safeHue(item.secondaryHue),
      }];
    });
    return [{ id, name, items }];
  });
  return { categories };
}

export function parseBreakdownData(raw: unknown): SceneBreakdown {
  if (typeof raw !== 'string' || !raw) return createDefaultBreakdown();
  try {
    return normalizeBreakdown(JSON.parse(raw), true);
  } catch {
    return createDefaultBreakdown();
  }
}

export function serializeBreakdownData(value: SceneBreakdown): string {
  return JSON.stringify(normalizeBreakdown(value, false));
}

export function getProjectBreakdowns(document: ProseMirrorNode): Record<string, SceneBreakdown> {
  const breakdowns = Object.fromEntries(getScenarioScenes(document).map(scene => {
    const heading = document.nodeAt(scene.from);
    return [scene.id, parseBreakdownData(heading?.attrs.breakdownData)];
  }));
  const appearances = new Map<string, Pick<BreakdownItem, 'hue' | 'secondaryHue'>>();
  for (const breakdown of Object.values(breakdowns)) for (const category of breakdown.categories) for (const item of category.items) {
    if (item.hue === null) continue;
    const identity = `${key(category.name)}\u0001${key(item.name)}`;
    if (!appearances.has(identity)) appearances.set(identity, { hue: item.hue, secondaryHue: item.secondaryHue });
  }
  for (const breakdown of Object.values(breakdowns)) {
    breakdown.categories = breakdown.categories.map(category => ({
      ...category,
      items: category.items.map(item => {
        const appearance = appearances.get(`${key(category.name)}\u0001${key(item.name)}`);
        return appearance ? { ...item, ...appearance } : item;
      }),
    }));
  }
  return breakdowns;
}

export function updateScenarioBreakdown(editor: Editor, sceneId: string, value: SceneBreakdown): boolean {
  return updateScenarioBreakdowns(editor, { [sceneId]: value });
}

/** Updates several scene sheets in one ProseMirror transaction so one Undo restores them all. */
export function updateScenarioBreakdowns(
  editor: Editor,
  values: Record<string, SceneBreakdown>,
): boolean {
  if (!editor.isEditable) return false;
  const requested = new Map(Object.entries(values));
  let transaction = editor.state.tr;
  let found = false;
  let changed = false;
  for (const scene of getScenarioScenes(editor.state.doc)) {
    const value = requested.get(scene.id);
    if (!value) continue;
    found = true;
    const heading = editor.state.doc.nodeAt(scene.from);
    if (!heading) continue;
    const breakdownData = serializeBreakdownData(value);
    if (heading.attrs.breakdownData === breakdownData) continue;
    transaction = transaction.setNodeMarkup(scene.from, undefined, {
      ...heading.attrs,
      breakdownData,
    });
    changed = true;
  }
  if (changed) editor.view.dispatch(transaction.setMeta('scenario-breakdown', true));
  return found;
}

export function getBreakdownSuggestions(
  breakdowns: Record<string, SceneBreakdown>,
  categoryName: string,
  query: string,
  excludedNames: string[] = [],
): string[] {
  return getBreakdownSuggestionItems(breakdowns, categoryName, query, excludedNames).map(item => item.name);
}

/** Returns the project-wide SmartType catalogue, including each element's shared colour identity. */
export function getBreakdownSuggestionItems(
  breakdowns: Record<string, SceneBreakdown>,
  categoryName: string,
  query: string,
  excludedNames: string[] = [],
): BreakdownItem[] {
  const categoryKey = key(categoryName);
  const queryKey = key(query);
  if (!categoryKey) return [];
  const excluded = new Set(excludedNames.map(key));
  return getBreakdownCatalogue(breakdowns)
    .filter(item => key(item.categoryName) === categoryKey)
    .filter(item => {
      const itemKey = key(item.name);
      return !excluded.has(itemKey) && (!queryKey || (itemKey !== queryKey && itemKey.startsWith(queryKey)));
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
    .slice(0, 8)
    .map(({ id, name, hue, secondaryHue }) => ({ id, name, hue, secondaryHue }));
}

export function getBreakdownCatalogue(
  breakdowns: Record<string, SceneBreakdown>,
): BreakdownCatalogueEntry[] {
  const catalogue = new Map<string, BreakdownCatalogueEntry>();
  for (const [sceneId, breakdown] of Object.entries(breakdowns)) {
    for (const category of breakdown.categories) {
      for (const item of category.items) {
        const identity = identityKey(category.name, item.name);
        const current = catalogue.get(identity);
        if (!current) {
          catalogue.set(identity, { ...item, identity, categoryName: category.name, sceneIds: [sceneId] });
        } else {
          if (!current.sceneIds.includes(sceneId)) current.sceneIds.push(sceneId);
          if (current.hue === null && item.hue !== null) {
            current.hue = item.hue;
            current.secondaryHue = item.secondaryHue;
          }
        }
      }
    }
  }
  return [...catalogue.values()];
}

function renderedHueToOklab(hue: number): PerceptualColor {
  // These values mirror colorStyle(): hsl(hue 72% 54%). Comparing the final
  // rendered colours in OKLab is much closer to human vision than comparing
  // raw hue angles, whose visual spacing is very uneven.
  const saturation = .72;
  const lightness = .54;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((hue % 360) + 360) % 360 / 60;
  const intermediate = chroma * (1 - Math.abs(sector % 2 - 1));
  const [redPrime, greenPrime, bluePrime] = sector < 1 ? [chroma, intermediate, 0]
    : sector < 2 ? [intermediate, chroma, 0]
      : sector < 3 ? [0, chroma, intermediate]
        : sector < 4 ? [0, intermediate, chroma]
          : sector < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  const linear = (value: number) => {
    const channel = value + match;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  };
  const red = linear(redPrime);
  const green = linear(greenPrime);
  const blue = linear(bluePrime);
  const lRoot = Math.cbrt(.4122214708 * red + .5363325363 * green + .0514459929 * blue);
  const mRoot = Math.cbrt(.2119034982 * red + .6806995451 * green + .1073969566 * blue);
  const sRoot = Math.cbrt(.0883024619 * red + .2817188376 * green + .6299787005 * blue);
  return {
    lightness: .2104542553 * lRoot + .793617785 * mRoot - .0040720468 * sRoot,
    greenRed: 1.9779984951 * lRoot - 2.428592205 * mRoot + .4505937099 * sRoot,
    blueYellow: .0259040371 * lRoot + .7827717662 * mRoot - .808675766 * sRoot,
  };
}

function perceptualDistance(leftHue: number, rightHue: number): number {
  const left = renderedHueToOklab(leftHue);
  const right = renderedHueToOklab(rightHue);
  return Math.hypot(
    left.lightness - right.lightness,
    left.greenRed - right.greenRed,
    left.blueYellow - right.blueYellow,
  );
}

/** Greedy maximin palette: every new solid is the colour furthest from its nearest neighbour. */
function automaticSolidHues(limit = AUTO_SOLID_COLOR_COUNT): number[] {
  const candidates = Array.from({ length: 360 / AUTO_HUE_STEP }, (_, index) => index * AUTO_HUE_STEP);
  const selected = [0];
  while (selected.length < limit) {
    let bestHue = candidates.find(hue => !selected.includes(hue)) ?? 0;
    let bestDistance = -1;
    for (const hue of candidates) {
      if (selected.includes(hue)) continue;
      const distance = Math.min(...selected.map(existing => perceptualDistance(hue, existing)));
      if (distance > bestDistance + Number.EPSILON) {
        bestHue = hue;
        bestDistance = distance;
      }
    }
    selected.push(bestHue);
  }
  return selected;
}

function appearanceKey(appearance: BreakdownAppearance): string {
  if (appearance.hue === null) return 'none';
  if (appearance.secondaryHue === null) return `solid:${appearance.hue}`;
  const pair = [appearance.hue, appearance.secondaryHue].sort((left, right) => left - right);
  return `stripe:${pair[0]}:${pair[1]}`;
}

function stripedAppearanceDistance(left: [number, number], right: [number, number]): number {
  const direct = (perceptualDistance(left[0], right[0]) + perceptualDistance(left[1], right[1])) / 2;
  const crossed = (perceptualDistance(left[0], right[1]) + perceptualDistance(left[1], right[0])) / 2;
  return Math.min(direct, crossed);
}

/**
 * Orders every two-colour combination while balancing colour reuse. The first
 * group of stripes therefore uses every solid colour exactly once instead of
 * producing a long series sharing the same dominant red.
 */
function automaticStripedAppearances(hues: number[]): Array<[number, number]> {
  const remaining: Array<[number, number]> = [];
  for (let left = 0; left < hues.length; left += 1) for (let right = left + 1; right < hues.length; right += 1) {
    remaining.push([hues[left], hues[right]]);
  }
  const ordered: Array<[number, number]> = [];
  const usage = new Map(hues.map(hue => [hue, 0]));
  while (remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const pair = remaining[index];
      const usageCost = (usage.get(pair[0]) ?? 0) + (usage.get(pair[1]) ?? 0);
      const distanceFromExisting = ordered.length
        ? Math.min(...ordered.map(existing => stripedAppearanceDistance(pair, existing)))
        : perceptualDistance(pair[0], pair[1]);
      const internalContrast = perceptualDistance(pair[0], pair[1]);
      // Usage dominates until every hue has appeared equally often. Perceptual
      // distance then chooses the most recognisable pair among equally fair options.
      const score = -usageCost * 10 + distanceFromExisting * 2 + internalContrast;
      if (score > bestScore + Number.EPSILON) {
        bestIndex = index;
        bestScore = score;
      }
    }
    const [pair] = remaining.splice(bestIndex, 1);
    ordered.push(pair);
    usage.set(pair[0], (usage.get(pair[0]) ?? 0) + 1);
    usage.set(pair[1], (usage.get(pair[1]) ?? 0) + 1);
  }
  return ordered;
}

const AUTOMATIC_SOLID_HUES = automaticSolidHues();
const AUTOMATIC_STRIPED_APPEARANCES = automaticStripedAppearances(AUTOMATIC_SOLID_HUES);

function nextAutomaticAppearance(used: BreakdownAppearance[]): BreakdownAppearance {
  const usedKeys = new Set(used.map(appearanceKey));
  for (const hue of AUTOMATIC_SOLID_HUES) {
    const appearance = { hue, secondaryHue: null };
    if (!usedKeys.has(appearanceKey(appearance))) return appearance;
  }
  for (const [hue, secondaryHue] of AUTOMATIC_STRIPED_APPEARANCES) {
    const appearance = { hue, secondaryHue };
    if (!usedKeys.has(appearanceKey(appearance))) return appearance;
  }
  // Eight solids plus every unordered pair provide 36 recognisable appearances.
  const fallback = AUTOMATIC_STRIPED_APPEARANCES[used.length % AUTOMATIC_STRIPED_APPEARANCES.length];
  return { hue: fallback[0], secondaryHue: fallback[1] };
}

export function getNextAutomaticBreakdownAppearance(
  breakdowns: Record<string, SceneBreakdown>,
): BreakdownAppearance {
  const used = getBreakdownCatalogue(breakdowns)
    .filter(item => item.hue !== null)
    .map(item => ({ hue: item.hue, secondaryHue: item.secondaryHue }));
  return nextAutomaticAppearance(used);
}

/** Assigns one deterministic, unique appearance to every project element identity. */
export function applyAutomaticBreakdownColors(
  breakdowns: Record<string, SceneBreakdown>,
): Record<string, SceneBreakdown> {
  const assignments = new Map<string, BreakdownAppearance>();
  const used: BreakdownAppearance[] = [];
  for (const entry of getBreakdownCatalogue(breakdowns)) {
    const appearance = nextAutomaticAppearance(used);
    assignments.set(entry.identity, appearance);
    used.push(appearance);
  }
  return Object.fromEntries(Object.entries(breakdowns).map(([sceneId, breakdown]) => [sceneId, {
    categories: breakdown.categories.map(category => ({
      ...category,
      items: category.items.map(item => ({
        ...item,
        ...assignments.get(identityKey(category.name, item.name)),
      })),
    })),
  }]));
}
