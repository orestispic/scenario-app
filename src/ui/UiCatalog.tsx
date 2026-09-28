import { useState } from 'react';
import { UiButton } from './UiButton';
import { UiContextMenu, UiMenuItem, UiMenuSeparator } from './UiMenu';
import { UiDialog } from './UiDialog';
import { UiEmptyState } from './UiEmptyState';
import { UiFeedback } from './UiFeedback';
import { UiField } from './UiField';
import { UiIcon } from './UiIcon';
import { UiIconButton } from './UiIconButton';
import { UiInput } from './UiInput';
import { UiListItem } from './UiListItem';
import { UiPanel } from './UiPanel';
import { UiProgress } from './UiProgress';
import { UiReadOnlyNotice } from './UiReadOnlyNotice';
import { UiSearchField } from './UiSearchField';
import { UiSelect } from './UiSelect';
import { UiSwitch } from './UiSwitch';
import { UiTabPanel, UiTabs } from './UiTabs';
import { UiTextarea } from './UiTextarea';
import { UiTooltip } from './UiTooltip';
import './uiCatalog.css';

type UiCatalogProps = { open: boolean; onOpenChange: (open: boolean) => void };

const catalogTabs = [
  { value: 'components', label: 'Composants' },
  { value: 'states', label: 'États' },
  { value: 'foundations', label: 'Fondations' },
];

export function UiCatalog({ open, onOpenChange }: UiCatalogProps) {
  const [section, setSection] = useState('components');
  const [enabled, setEnabled] = useState(true);
  const [selectedItem, setSelectedItem] = useState('scene');
  const [dialogDemo, setDialogDemo] = useState<'standard' | 'danger' | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  function changeCatalogOpen(nextOpen: boolean) {
    if (!nextOpen) setDialogDemo(null);
    onOpenChange(nextOpen);
  }

  return <>
    <UiDialog
      open={open}
      onOpenChange={changeCatalogOpen}
      className="ui-catalog"
      title="Catalogue UI Senario"
      description="Référence interne des primitives, variantes et états partagés."
      headerAction={<UiIconButton label="Fermer le catalogue" tooltip="Fermer" onClick={() => changeCatalogOpen(false)}><UiIcon name="x" /></UiIconButton>}
      footer={<UiButton onClick={() => changeCatalogOpen(false)}>Fermer</UiButton>}
    >
      <UiTabs value={section} tabs={catalogTabs} onValueChange={setSection} ariaLabel="Sections du catalogue UI" />

      <UiTabPanel active={section === 'components'} aria-label="Composants">
        <div className="ui-catalog-grid">
          <CatalogGroup title="Actions">
            <div className="ui-catalog-row"><UiButton variant="primary">Primaire</UiButton><UiButton>Secondaire</UiButton><UiButton variant="ghost">Discret</UiButton><UiButton variant="danger">Danger</UiButton></div>
            <div className="ui-catalog-row"><UiIconButton label="Ajouter"><UiIcon name="plus" /></UiIconButton><UiTooltip content="Information contextuelle affichée au survol et au focus"><UiButton>Survoler</UiButton></UiTooltip><UiButton onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom + 6 }); }} onContextMenu={event => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }); }}>Menu contextuel</UiButton></div>
            <div className="ui-catalog-row"><UiButton onClick={() => setDialogDemo('standard')}>Dialogue standard</UiButton><UiButton variant="danger" onClick={() => setDialogDemo('danger')}>Confirmation destructive</UiButton></div>
          </CatalogGroup>
          <CatalogGroup title="Saisie">
            <UiField label="Titre du projet" defaultValue="L’Écho des étoiles" hint="Le libellé reste lisible avec un texte long." />
            <UiInput aria-label="Nom de catégorie" defaultValue="Personnages" />
            <UiSearchField label="Rechercher une scène" placeholder="Rechercher…" value="Observatoire" onChange={() => undefined} onClear={() => undefined} />
            <UiSelect aria-label="Type de paragraphe" defaultValue="action"><option value="action">Action</option><option value="dialogue">Dialogue</option></UiSelect>
            <UiTextarea aria-label="Description" defaultValue="Une description multiligne adaptable à son contenu." />
            <UiSwitch checked={enabled} onCheckedChange={setEnabled}>Fonction activée</UiSwitch>
          </CatalogGroup>
          <CatalogGroup title="Navigation et listes">
            <div role="listbox" aria-label="Exemple de liste" className="ui-catalog-list">
              <UiListItem role="option" selected={selectedItem === 'scene'} onClick={() => setSelectedItem('scene')} leading={<UiIcon name="screenplay" />}><strong>Scénario</strong><span>Document principal</span></UiListItem>
              <UiListItem role="option" selected={selectedItem === 'notes'} onClick={() => setSelectedItem('notes')} leading={<UiIcon name="message" />} trailing="12"><strong>Commentaires</strong><span>Annotations du projet</span></UiListItem>
            </div>
          </CatalogGroup>
          <CatalogGroup title="Progression">
            <UiProgress label="Export PDF" value={64} showValue />
            <UiProgress label="Espace disponible" value={18} showValue tone="warning" />
            <UiProgress label="Chargement" indeterminate />
          </CatalogGroup>
        </div>
      </UiTabPanel>

      <UiTabPanel active={section === 'states'} aria-label="États interactifs">
        <div className="ui-catalog-state-grid">
          <span>Repos</span><UiButton>Modifier</UiButton>
          <span>Sélectionné</span><UiListItem selected>Élément sélectionné</UiListItem>
          <span>Verrouillé</span><UiButton data-ui-locked="true">Fonction Studio</UiButton>
          <span>Désactivé</span><UiButton disabled>Indisponible</UiButton>
          <span>Lecture seule</span><UiReadOnlyNotice />
          <span>Chargement</span><UiButton loading>Enregistrement…</UiButton>
          <span>Information</span><UiFeedback>Le document est enregistré localement.</UiFeedback>
          <span>Succès</span><UiFeedback tone="success">Export terminé.</UiFeedback>
          <span>Avertissement</span><UiFeedback tone="warning">Connexion instable.</UiFeedback>
          <span>Erreur</span><UiFeedback tone="danger">L’opération a échoué.</UiFeedback>
        </div>
      </UiTabPanel>

      <UiTabPanel active={section === 'foundations'} aria-label="Fondations visuelles">
        <div className="ui-catalog-foundations">
          <CatalogGroup title="Couleurs sémantiques"><div className="ui-catalog-swatches"><i data-token="canvas" /><i data-token="surface" /><i data-token="primary" /><i data-token="success" /><i data-token="warning" /><i data-token="danger" /></div></CatalogGroup>
          <CatalogGroup title="Règles"><p>Cibles de 32 px minimum, focus clavier visible, texte adaptable et composants dimensionnés par leur contenu.</p></CatalogGroup>
          <UiPanel title="Surface partagée"><p>Les panneaux, bordures, ombres et espacements proviennent des tokens centralisés.</p></UiPanel>
          <UiEmptyState title="État vide" description="Une explication concise et une action claire peuvent être ajoutées ici." />
        </div>
      </UiTabPanel>
    </UiDialog>

    <UiContextMenu open={Boolean(contextMenu)} x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0}
      onOpenChange={(nextOpen) => { if (!nextOpen) setContextMenu(null); }} ariaLabel="Exemple de menu contextuel">
      <UiMenuItem>Ouvrir</UiMenuItem>
      <UiMenuItem>Dupliquer</UiMenuItem>
      <UiMenuSeparator />
      <UiMenuItem className="is-danger">Supprimer</UiMenuItem>
    </UiContextMenu>

    <UiDialog
      open={open && dialogDemo === 'standard'}
      onOpenChange={(nextOpen) => { if (!nextOpen) setDialogDemo(null); }}
      title="Dialogue partagé"
      description="Le titre, la description, le focus et les espacements viennent de la bibliothèque UI."
      footer={<><UiButton onClick={() => setDialogDemo(null)}>Annuler</UiButton><UiButton variant="primary" onClick={() => setDialogDemo(null)}>Confirmer</UiButton></>}
    >
      <p className="ui-catalog-dialog-copy">Le contenu reste lisible lorsque le texte s’allonge et les actions passent automatiquement à la ligne si l’espace disponible diminue.</p>
    </UiDialog>

    <UiDialog
      open={open && dialogDemo === 'danger'}
      onOpenChange={(nextOpen) => { if (!nextOpen) setDialogDemo(null); }}
      title="Supprimer cet élément ?"
      description="Cette confirmation utilise la sémantique d’alerte réservée aux actions destructives."
      destructive
      footer={<><UiButton onClick={() => setDialogDemo(null)}>Annuler</UiButton><UiButton variant="danger" onClick={() => setDialogDemo(null)}>Supprimer</UiButton></>}
    >
      <UiFeedback tone="warning">Cette action ne pourra pas être annulée.</UiFeedback>
    </UiDialog>
  </>;
}

function CatalogGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ui-catalog-group"><h3>{title}</h3>{children}</section>;
}
