import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UiButton } from './UiButton';
import { UiFeedback } from './UiFeedback';
import { UiIconButton } from './UiIconButton';
import { UiInput } from './UiInput';
import { UiListItem } from './UiListItem';
import { UiMenuItem, nextMenuItemIndex } from './UiMenu';
import { UiProgress } from './UiProgress';
import { resolveFloatingPanelGeometry } from './floatingGeometry';
import { UiReadOnlyNotice } from './UiReadOnlyNotice';
import { UiSearchField } from './UiSearchField';
import { UiSwitch } from './UiSwitch';
import { UiTabs, nextTabIndex } from './UiTabs';
import { UiTextarea, resolveTextareaAutoGrow } from './UiTextarea';
import { UiTooltip } from './UiTooltip';

describe('shared interactive states', () => {
  it('cycles through menu items with arrows and supports Home and End', () => {
    expect(nextMenuItemIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextMenuItemIndex(-1, 3, 'ArrowUp')).toBe(2);
    expect(nextMenuItemIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(nextMenuItemIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextMenuItemIndex(1, 3, 'Home')).toBe(0);
    expect(nextMenuItemIndex(1, 3, 'End')).toBe(2);
    expect(nextMenuItemIndex(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('keeps menu items out of the page tab order for managed keyboard navigation', () => {
    const html = renderToStaticMarkup(<UiMenuItem>Ouvrir</UiMenuItem>);
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('tabindex="-1"');
  });

  it('announces loading and prevents duplicate button actions', () => {
    const button = renderToStaticMarkup(<UiButton loading>Enregistrement…</UiButton>);
    const iconButton = renderToStaticMarkup(<UiIconButton label="Action IA en cours" loading><span>IA</span></UiIconButton>);
    const iconWithTooltip = renderToStaticMarkup(<UiIconButton label="Supprimer" tooltip="Supprimer la scène"><span>×</span></UiIconButton>);
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('disabled=""');
    expect(button).toContain('ui-button__spinner');
    expect(iconButton).toContain('aria-busy="true"');
    expect(iconButton).toContain('disabled=""');
    expect(iconButton).toContain('Action IA en cours');
    expect(iconWithTooltip).toContain('ui-tooltip-anchor');
    expect(iconWithTooltip).toContain('aria-label="Supprimer"');
    expect(iconWithTooltip).not.toContain('title=');
  });

  it('uses assertive semantics only for errors and preserves typed tones', () => {
    const success = renderToStaticMarkup(<UiFeedback tone="success">Enregistré.</UiFeedback>);
    const warning = renderToStaticMarkup(<UiFeedback tone="warning">Connexion instable.</UiFeedback>);
    const danger = renderToStaticMarkup(<UiFeedback tone="danger">Échec.</UiFeedback>);
    expect(success).toContain('ui-feedback--success');
    expect(success).toContain('role="status"');
    expect(warning).toContain('ui-feedback--warning');
    expect(warning).toContain('role="status"');
    expect(danger).toContain('ui-feedback--danger');
    expect(danger).toContain('role="alert"');
  });

  it('announces the shared read-only business state without using an alert', () => {
    const html = renderToStaticMarkup(<UiReadOnlyNotice />);
    expect(html).toContain('ui-read-only-notice');
    expect(html).toContain('role="status"');
    expect(html).toContain('Lecture seule');
    expect(html).not.toContain('role="alert"');
  });

  it('uses roving focus for tabs and skips disabled entries', () => {
    expect(nextTabIndex(0, [0, 2], 1)).toBe(2);
    expect(nextTabIndex(2, [0, 2], 1)).toBe(0);
    expect(nextTabIndex(0, [0, 2], -1)).toBe(2);
    const html = renderToStaticMarkup(<UiTabs
      value="editor"
      ariaLabel="Espaces"
      onValueChange={() => undefined}
      tabs={[
        { value: 'editor', label: 'Éditeur' },
        { value: 'cloud', label: 'Cloud', disabled: true },
        { value: 'technical', label: 'Technique', accessibleLabel: 'Technique, verrouillé', locked: true },
      ]}
    />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Technique, verrouillé"');
    expect(html).toContain('data-ui-locked="true"');
  });

  it('centralizes selectable list items and progress semantics', () => {
    const item = renderToStaticMarkup(<UiListItem role="option" selected>Scénario</UiListItem>);
    const progress = renderToStaticMarkup(<UiProgress label="Export" value={125} max={100} showValue />);
    const pending = renderToStaticMarkup(<UiProgress label="Chargement" indeterminate />);
    expect(item).toContain('ui-list-item is-selected');
    expect(item).toContain('aria-selected="true"');
    expect(progress).toContain('role="progressbar"');
    expect(progress).toContain('aria-valuenow="100"');
    expect(progress).toContain('width:100%');
    expect(pending).toContain('aria-busy="true"');
    expect(pending).not.toContain('aria-valuenow');
  });

  it('keeps tooltip content available through the shared anchor', () => {
    const html = renderToStaticMarkup(<UiTooltip content="Aide contextuelle"><button type="button">Action</button></UiTooltip>);
    expect(html).toContain('ui-tooltip-anchor');
    expect(html).toContain('Action');
  });

  it('keeps compact search fields labelled and exposes a typed clear action', () => {
    const filled = renderToStaticMarkup(<UiSearchField label="Rechercher des plans" value="Maya" onChange={() => undefined} onClear={() => undefined} />);
    const empty = renderToStaticMarkup(<UiSearchField label="Rechercher des plans" value="" onChange={() => undefined} onClear={() => undefined} />);
    expect(filled).toContain('type="search"');
    expect(filled).toContain('aria-label="Rechercher des plans"');
    expect(filled).toContain('aria-label="Effacer la recherche"');
    expect(empty).not.toContain('aria-label="Effacer la recherche"');
  });

  it('announces shared binary controls as switches', () => {
    const html = renderToStaticMarkup(<UiSwitch checked onCheckedChange={() => undefined}>Couleurs automatiques</UiSwitch>);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('ui-switch__track');
  });

  it('keeps standalone single-line inputs inside the shared state system', () => {
    const html = renderToStaticMarkup(<UiInput aria-label="Nom de catégorie" disabled defaultValue="Personnages" />);
    expect(html).toContain('class="ui-input"');
    expect(html).toContain('aria-label="Nom de catégorie"');
    expect(html).toContain('disabled=""');
  });

  it('exposes the shared auto-growing multiline behavior', () => {
    const html = renderToStaticMarkup(<UiTextarea autoGrow value="Un commentaire" readOnly />);
    expect(html).toContain('data-auto-grow="true"');
    expect(html).toContain('ui-textarea--auto-grow');
    expect(resolveTextareaAutoGrow(180, 260)).toEqual({ height: 180, overflowY: 'hidden' });
    expect(resolveTextareaAutoGrow(480, 260)).toEqual({ height: 260, overflowY: 'auto' });
  });

  it('sizes popovers from their content and only caps them at the viewport', () => {
    const trigger = { top: 80, right: 140, bottom: 112, left: 108 };
    const fitting = resolveFloatingPanelGeometry({
      align: 'start', contentHeight: 420, panelWidth: 310, trigger, viewportHeight: 720, viewportWidth: 820,
    });
    expect(fitting.height).toBe(420);
    expect(fitting.top + fitting.height).toBeLessThanOrEqual(712);

    const oversized = resolveFloatingPanelGeometry({
      align: 'start', contentHeight: 900, panelWidth: 310, trigger, viewportHeight: 720, viewportWidth: 820,
    });
    expect(oversized.height).toBe(594);
    expect(oversized.top + oversized.height).toBe(712);
  });

  it('builds an overlapping pointer corridor between trigger and panel', () => {
    const trigger = { top: 80, right: 140, bottom: 112, left: 108 };
    const geometry = resolveFloatingPanelGeometry({
      align: 'start', contentHeight: 240, panelWidth: 310, trigger, viewportHeight: 720, viewportWidth: 820,
    });
    expect(geometry.bridge.top).toBeLessThan(trigger.bottom);
    expect(geometry.bridge.top + geometry.bridge.height).toBeGreaterThan(geometry.top);
    expect(geometry.bridge.left).toBeLessThan(trigger.left);
    expect(geometry.bridge.left + geometry.bridge.width).toBeGreaterThan(geometry.left + geometry.width);
  });
});
