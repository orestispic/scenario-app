import { useMemo, useState } from 'react';
import { UiButton, UiDialog, UiIconButton, UiSelect, UiSwitch } from '../ui';
import { UiIcon } from '../ui/UiIcon';
import type { SceneBreakdown } from './breakdownModel';
import type { ScenarioScene } from './sceneTimelineModel';
import type { TechnicalBreakdown } from './technicalBreakdownModel';
import type {
  BreakdownPdfOptions,
  TechnicalBreakdownPdfOptions,
  WorkspacePdfContentSize,
  WorkspacePdfOrientation,
  WorkspacePdfPageFormat,
} from '../document/workspacePdfExport';

export type WorkspacePdfExportRequest =
  | { kind: 'breakdown'; options: BreakdownPdfOptions }
  | { kind: 'technical'; options: TechnicalBreakdownPdfOptions };

interface WorkspacePdfExportDialogProps {
  kind: 'breakdown' | 'technical';
  scenes: ScenarioScene[];
  breakdowns: Record<string, SceneBreakdown>;
  technicalBreakdown: TechnicalBreakdown;
  busy: boolean;
  onClose: () => void;
  onExport: (request: WorkspacePdfExportRequest) => void;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

export function WorkspacePdfExportDialog({
  kind,
  scenes,
  breakdowns,
  technicalBreakdown,
  busy,
  onClose,
  onExport,
}: WorkspacePdfExportDialogProps) {
  const categoryNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const scene of scenes) for (const category of breakdowns[scene.id]?.categories ?? []) {
      const key = normalized(category.name);
      if (key && !names.has(key)) names.set(key, category.name);
    }
    return [...names.values()];
  }, [breakdowns, scenes]);
  const [pageFormat, setPageFormat] = useState<WorkspacePdfPageFormat>('a4');
  const [orientation, setOrientation] = useState<WorkspacePdfOrientation>('auto');
  const [contentSize, setContentSize] = useState<WorkspacePdfContentSize>('normal');
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [includeEmptyCategories, setIncludeEmptyCategories] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [selectedCategoryNames, setSelectedCategoryNames] = useState<string[]>(categoryNames);
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>(
    technicalBreakdown.columns.filter(column => !column.hidden).map(column => column.id),
  );
  const selectedCount = kind === 'breakdown' ? selectedCategoryNames.length : selectedColumnIds.length;

  function toggleCategory(name: string): void {
    setSelectedCategoryNames(current => current.includes(name) ? current.filter(value => value !== name) : [...current, name]);
  }

  function toggleColumn(id: string): void {
    setSelectedColumnIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  function submit(): void {
    const common = { pageFormat, orientation, contentSize, includePageNumbers };
    if (kind === 'breakdown') {
      onExport({ kind, options: { ...common, categoryNames: selectedCategoryNames, includeEmptyCategories } });
    } else {
      onExport({ kind, options: { ...common, columnIds: selectedColumnIds, includeImages } });
    }
  }

  const exportLabel = kind === 'breakdown' ? 'dépouillement' : 'découpage technique';

  return <UiDialog
    open
    onOpenChange={open => { if (!open && !busy) onClose(); }}
    className="workspace-pdf-export-panel"
    title={`Exporter le ${exportLabel}`}
    description="Le tableau s’adaptera automatiquement aux pages sans réduire le texte au-delà d’une taille lisible."
    headerAction={<UiIconButton label="Fermer" disabled={busy} onClick={onClose}><UiIcon name="x" /></UiIconButton>}
    footer={<>
      <UiButton disabled={busy} onClick={onClose}>Annuler</UiButton>
      <UiButton variant="primary" loading={busy} disabled={selectedCount === 0} onClick={submit}>
        {busy ? 'Préparation du PDF…' : 'Exporter le PDF'}
      </UiButton>
    </>}
  >
    <div className="workspace-pdf-export-content">
      <div className="workspace-pdf-options-grid">
        <label>Format de page<UiSelect value={pageFormat} onChange={event => setPageFormat(event.target.value as WorkspacePdfPageFormat)}>
          <option value="a4">A4</option><option value="a3">A3</option><option value="letter">Lettre US</option>
        </UiSelect></label>
        <label>Orientation<UiSelect value={orientation} onChange={event => setOrientation(event.target.value as WorkspacePdfOrientation)}>
          <option value="auto">Automatique</option><option value="portrait">Portrait</option><option value="landscape">Paysage</option>
        </UiSelect></label>
        <label>Taille du contenu<UiSelect value={contentSize} onChange={event => setContentSize(event.target.value as WorkspacePdfContentSize)}>
          <option value="compact">Compacte</option><option value="normal">Normale</option><option value="large">Grande</option>
        </UiSelect></label>
      </div>

      <fieldset className="workspace-pdf-content-options">
        <legend>{kind === 'breakdown' ? 'Catégories à inclure' : 'Colonnes à inclure'}</legend>
        <div className="workspace-pdf-option-actions">
          <UiButton variant="ghost" onClick={() => kind === 'breakdown'
            ? setSelectedCategoryNames(categoryNames)
            : setSelectedColumnIds(technicalBreakdown.columns.map(column => column.id))}>Tout afficher</UiButton>
          <UiButton variant="ghost" onClick={() => kind === 'breakdown' ? setSelectedCategoryNames([]) : setSelectedColumnIds([])}>Tout masquer</UiButton>
        </div>
        <div className="workspace-pdf-check-grid">
          {kind === 'breakdown' ? categoryNames.map(name => <label key={name}>
            <input type="checkbox" checked={selectedCategoryNames.includes(name)} onChange={() => toggleCategory(name)} /> {name}
          </label>) : technicalBreakdown.columns.map(column => <label key={column.id}>
            <input type="checkbox" checked={selectedColumnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />
            <span>{column.name}{column.hidden ? <small>masquée dans le tableau</small> : null}</span>
          </label>)}
        </div>
      </fieldset>

      <fieldset className="workspace-pdf-switches">
        <legend>Présentation</legend>
        {kind === 'breakdown' && <UiSwitch checked={includeEmptyCategories} onCheckedChange={setIncludeEmptyCategories}>Conserver les catégories vides</UiSwitch>}
        {kind === 'technical' && technicalBreakdown.columns.some(column => column.kind === 'image') && <UiSwitch checked={includeImages} onCheckedChange={setIncludeImages}>Afficher les images</UiSwitch>}
        <UiSwitch checked={includePageNumbers} onCheckedChange={setIncludePageNumbers}>Afficher la pagination</UiSwitch>
      </fieldset>

      <div className="workspace-pdf-preview-summary" aria-label="Aperçu de la structure du PDF">
        <UiIcon name={kind === 'breakdown' ? 'breakdown' : 'screenplay'} />
        <div><strong>{scenes.length} scène{scenes.length > 1 ? 's' : ''}</strong>
          <span>{kind === 'breakdown'
            ? `${selectedCount} catégorie${selectedCount > 1 ? 's' : ''} sélectionnée${selectedCount > 1 ? 's' : ''}`
            : `${technicalBreakdown.shots.length} plan${technicalBreakdown.shots.length > 1 ? 's' : ''} · ${selectedCount} colonne${selectedCount > 1 ? 's' : ''}`}</span>
        </div>
        <small>En-têtes répétés · retours à la ligne automatiques · pages numérotées</small>
      </div>
    </div>
  </UiDialog>;
}
