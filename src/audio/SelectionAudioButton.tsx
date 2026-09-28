import { AudioIcon } from './AudioIcon';
import { UiIconButton } from '../ui';

export function SelectionAudioButton({enabled, loading, playing, onRead}:{enabled:boolean;loading:boolean;playing:boolean;onRead:()=>void}) {
  const label = playing ? 'Mettre en pause le texte sélectionné' : 'Lire le texte sélectionné';
  return <UiIconButton className="audio-selection-button"
    label={label} loading={loading} disabled={!enabled}
    tooltip={enabled ? label : 'Sélectionnez du texte à lire'}
    onMouseDown={event=>event.preventDefault()} onClick={onRead}>
    <AudioIcon name={playing?'pause':'audio'}/>
  </UiIconButton>;
}
