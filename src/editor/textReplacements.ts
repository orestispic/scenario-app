import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export interface TextReplacement {
  id: string;
  shortcut: string;
  replacement: string;
}

const DEFAULT_REPLACEMENT_ENTRIES = `
ac|avec
ajd|aujourd’hui
are|are
askip|à ce qu’il parait
att|attends
audi|aussi
ausi|aussi
avt|avant
azy|vas y
basi|bah si
bassi|bah si
bcp|beaucoup
bebe|bébé
bensur|bien sûr
biensur|bien sûr
bjr|bonjour
blem|problème
blempro|problème
blems|problèmes
bn|bonne nuit
bo|beau
boir|boire
brv|bravo
bs|bien sûr
btr|batard
c|c’est
ca|ça
çà|ça
cad|c’est à dire
cbm|combien
cc|coucou
chepa|je ne sais pas
chte|je te
chu|je suis
chuis|je suis
cke|ce que
clc|casse les couilles
clik|clique
cmb|combien
cmm|comme
cmt|comment
comen|comment
comm|comme
conv|conversation
convo|conversation
cqe|ce que
ct|c’était
cv|ça va
cz|chez
dac|d’accord
dcp|du coup
deso|désolé
dla|de la
ds|dans
dsl|désolé
ducou|du coup
dukou|du coup
echange|échange
enft|enfaite
eske|est-ce que
eskel|est-ce qu’elle
eskelle|est-ce qu’elle
eskil|est-ce qu’il
etait|était
etre|être
excrément|extrêmement
frr|frère
g|j’ai
ga|gars
gav|garde à vue
gave|gavé
grv|grave
gt|j’étais
heur|heure
i|il
incr|incroyable
insta|instagram
j’av|j’avoue
jat|j’attends
jatt|j’attends
jav|j’avoue
jcrois|je crois
jdi|je dis
jdis|je dis
jdomais|je dormais
jdors|je dors
jla|je la
jle|je le
jles|je les
jlui|je lui
jm|j’aime
jme|je me
jnous|je nous
jpense|je pense
jpp|je peux pas
jris|je ris
jrv|j’arrive
js|je sais
jsais|je sais
jsp|je sais pas
jsuis|je suis
jte|je te
jtm|je t’aime
jtp|je t’appelle
jvai|je vais
jvais|je vais
jve|je veux
jveu|je veux
jveux|je veux
jvous|je vous
ka|qu’a
kan|quand
kdo|cadeau
kdos|cadeaux
ke|que
kel|quel
kelk|quelque
kelke|quelque
kelkin|quelqu’un
kelkun|quelqu’un
keske|qu’est ce que
keski|qu’est ce qu’il
keskia|qu’est ce qu’il y a
keskil|qu’est ce qu’il
keskils|qu’est ce qu’ils
keskiya|qu’est ce qu’il y a
keskya|qu’est ce qu’il y a
kesta|qu’est ce que tu as
kestu|qu’est ce que tu
ki|qui
kieski|qui est ce qui
klik|clique
koi|quoi
komen|comment
kon|qu’on
ksakadir|que ça à dire
kya|qu’il y a
kyai|qu’il y ai
laba|là bas
lekel|lequel
lstb|laisse tombé
lvdm|la vie de ma mère
maj|mise a jour
march|marche
mdi|me dis
mdp|mot de passe
mere|mère
merki|merci
min|minute
mins|minutes
mm|même
mn|mon
mparle|me parle
mrc|merci
msg|message
mtn|maintenant
musee|musée
mv|ma vie
nn|non
nrv|énervé
ns|nous
nuh|nuh
num|numéro
nv|nouveau
oai|ouais
oe|ouais
oki|oke
osi|aussi
pa|pas
pabo|pas beau
partt|partout
pb|problème
pck|parce que
pdt|pendant
pere|père
pf|pff
pg|pas grave
pk|pourquoi
po|pas
pr|pour
prsk|parce que
prskil|parcequ’il
ps|pas
psk|parce que
pskil|parce qu’il
ptet|peut être
qq|quelque
qqun|quelqu’un
quya|qu’il y a
quyai|qu’il y ai
r|rien
rav|rien à voir
samarch|ça marche
sdk|ça dit quoi
sitaksakadir|si t’as que ça à dire
ske|ce que
sle|le
slt|salut
sqe|ce que
srx|serieux
staye|staye
stp|s’il te plait
stuv|si tu veux
stv|si tu veux
surtt|surtout
svp|s’il vous plait
tahu|t’as vu
tariv|tu arrives
tel|téléphone
tfk|tu fais quoi
tist|triste
tiste|triste
tjrs|toujours
tkt|t’inquiète
tlm|tellement
toa|toi
tres|très
trkl|tranquile
tro|trop
tsais|tu sais
tt|tout
tte|toute
ttes|toutes
ue|ouais
uh|uh
vfk|vous faites quoi
vodk|vodka
vrm|vraiment
vrmt|vraiment
vs|vous
vsi|vas y
wsh|wesh
ya|il y a
yapa|il y a pas
yaura|il y aura
yavait|il y avait
yen|il y en
yena|il y en a
`;

const RETIRED_DEFAULT_SHORTCUTS = new Set([
  "yt", "wdym", "tpj", "taina", "pdc", "ore", "oremail", "ofc", "nr", "lt",
  "jmlp", "idk", "idgf", "gabin", "fw", "br", "as",
]);

export function createDefaultTextReplacements(): TextReplacement[] {
  return DEFAULT_REPLACEMENT_ENTRIES.trim().split("\n").map((line, index) => {
    const [shortcut, replacement] = line.split("|");
    return { id: `default-shortcut-${index}`, shortcut, replacement };
  });
}

export function mergeTextReplacements(
  defaults: TextReplacement[],
  custom: TextReplacement[],
): TextReplacement[] {
  const byShortcut = new Map<string, TextReplacement>();
  for (const item of [...defaults, ...custom]) {
    byShortcut.set(item.shortcut.toLocaleLowerCase("fr-FR"), item);
  }
  return normalizeTextReplacements([...byShortcut.values()]);
}

/** Retire uniquement les anciens raccourcis inclus par l'application, jamais ceux ajoutés par l'auteur. */
export function removeRetiredDefaultTextReplacements(
  replacements: TextReplacement[],
): TextReplacement[] {
  return replacements.filter(
    (item) =>
      !(
        item.id.startsWith("default-shortcut-") &&
        RETIRED_DEFAULT_SHORTCUTS.has(item.shortcut.toLocaleLowerCase("fr-FR"))
      ),
  );
}

export function hasDuplicateTextReplacementShortcut(replacements: TextReplacement[]): boolean {
  const seen = new Set<string>();
  return replacements.some((item) => {
    const shortcut = item.shortcut.trim().toLocaleLowerCase("fr-FR");
    if (!shortcut) {
      return false;
    }
    if (seen.has(shortcut)) {
      return true;
    }
    seen.add(shortcut);
    return false;
  });
}


interface TextReplacementOptions {
  getReplacements: () => TextReplacement[];
}

export function normalizeTextReplacements(value: unknown): TextReplacement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Partial<TextReplacement>;
    const shortcut = typeof candidate.shortcut === "string" ? candidate.shortcut.trim() : "";
    const replacement = typeof candidate.replacement === "string" ? candidate.replacement.trim() : "";
    const key = shortcut.toLocaleLowerCase("fr-FR");
    if (!shortcut || !replacement || /\s/.test(shortcut) || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ id: typeof candidate.id === "string" ? candidate.id : `shortcut-${index}`, shortcut, replacement }];
  });
}

export const TextReplacementShortcuts = Extension.create<TextReplacementOptions>({
  name: "textReplacementShortcuts",
  priority: 1200,

  addOptions() {
    return {
      getReplacements: () => [],
    };
  },

  addKeyboardShortcuts() {
    return {
      Space: () => replaceShortcutBeforeCursor(this.editor, this.options.getReplacements(), " "),
      ".": () => replaceShortcutBeforeCursor(this.editor, this.options.getReplacements(), "."),
      Enter: () => {
        replaceShortcutBeforeCursor(this.editor, this.options.getReplacements());
        return false;
      },
    };
  },
});

/** Transforme deux espaces de suite en une ponctuation de fin de phrase. */
export const DoubleSpaceToPeriod = Extension.create({
  name: "doubleSpaceToPeriod",
  priority: 1190,

  addKeyboardShortcuts() {
    return {
      Space: () => replaceDoubleSpaceWithPeriod(this.editor),
    };
  },
});

function replaceDoubleSpaceWithPeriod(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph" || $from.parentOffset === 0) {
    return false;
  }

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
  if (!textBeforeCursor.endsWith(" ")) {
    return false;
  }

  const from = $from.pos - 1;
  const transaction = state.tr.insertText(". ", from, $from.pos);
  transaction.setSelection(TextSelection.create(transaction.doc, from + 2));
  view.dispatch(transaction.scrollIntoView());
  return true;
}

function replaceShortcutBeforeCursor(
  editor: Editor,
  replacements: TextReplacement[],
  suffix = "",
): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph") {
    return false;
  }

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
  const match = textBeforeCursor.match(/(?:^|\s)([^\s]+)$/);
  const typedShortcut = match?.[1];
  if (!typedShortcut) {
    return false;
  }

  const replacement = replacements.find(
    (item) => item.shortcut.toLocaleLowerCase("fr-FR") === typedShortcut.toLocaleLowerCase("fr-FR"),
  );
  if (!replacement) {
    return false;
  }

  const from = $from.pos - typedShortcut.length;
  const prefix = textBeforeCursor.slice(0, -typedShortcut.length);
  const startsSentence = prefix.length === 0 || /[.!?]\s+$/.test(prefix);
  const expandedText = startsSentence
    ? `${replacement.replacement[0].toLocaleUpperCase("fr-FR")}${replacement.replacement.slice(1)}`
    : replacement.replacement;
  const text = `${expandedText}${suffix}`;
  const transaction = state.tr.insertText(text, from, $from.pos);
  transaction.setSelection(TextSelection.create(transaction.doc, from + text.length));
  view.dispatch(transaction.scrollIntoView());
  return true;
}
