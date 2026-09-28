import { useEffect, useState } from 'react';
import { UiIcon } from './UiIcon';
import './senarioDialog.css';

export interface SenarioDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  kind?: 'info' | 'warning' | 'error';
  confirmation?: boolean;
  dismissible?: boolean;
}

interface PendingDialog extends SenarioDialogOptions {
  id: number;
  resolve(value: boolean): void;
}

let nextDialogId = 0;
let activeHost: ((dialog: PendingDialog) => void) | null = null;
const waitingDialogs: PendingDialog[] = [];

function enqueue(options: SenarioDialogOptions): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = { ...options, id: ++nextDialogId, resolve };
    if (activeHost) activeHost(dialog);
    else waitingDialogs.push(dialog);
  });
}

export function showSenarioConfirm(options: Omit<SenarioDialogOptions, 'confirmation'>): Promise<boolean> {
  return enqueue({ ...options, confirmation: true });
}

export async function showSenarioMessage(options: Omit<SenarioDialogOptions, 'confirmation' | 'cancelLabel'>): Promise<void> {
  await enqueue({ ...options, confirmation: false });
}

export function SenarioDialogHost() {
  const [queue, setQueue] = useState<PendingDialog[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    activeHost = dialog => setQueue(previous => [...previous, dialog]);
    if (waitingDialogs.length) {
      const pending = waitingDialogs.splice(0, waitingDialogs.length);
      setQueue(previous => [...previous, ...pending]);
    }
    return () => { activeHost = null; };
  }, []);

  useEffect(() => {
    if (!current) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || current.confirmation === false || current.dismissible === false) return;
      event.preventDefault();
      finish(false);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [current]);

  function finish(value: boolean) {
    if (!current) return;
    current.resolve(value);
    setQueue(previous => previous.slice(1));
  }

  if (!current) return null;
  const icon = current.destructive ? 'trash' : current.kind === 'error' || current.kind === 'warning' ? 'error' : 'message';
  return <div className="senario-dialog-backdrop" role="presentation" onMouseDown={() => current.confirmation && current.dismissible !== false && finish(false)}>
    <section className={`senario-dialog${current.destructive ? ' is-destructive' : ''}`} role={current.confirmation ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={`senario-dialog-title-${current.id}`} aria-describedby={`senario-dialog-description-${current.id}`} onMouseDown={event => event.stopPropagation()}>
      <UiIcon name={icon} />
      <div>
        <h2 id={`senario-dialog-title-${current.id}`}>{current.title}</h2>
        <p id={`senario-dialog-description-${current.id}`}>{current.description}</p>
      </div>
      <footer>
        {current.confirmation && <button type="button" onClick={() => finish(false)}>{current.cancelLabel ?? 'Annuler'}</button>}
        <button className={current.destructive ? 'senario-dialog-danger' : 'primary-button'} type="button" autoFocus onClick={() => finish(true)}>{current.confirmLabel ?? 'OK'}</button>
      </footer>
    </section>
  </div>;
}
