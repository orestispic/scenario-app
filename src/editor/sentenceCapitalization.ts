import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export const SentenceCapitalization = Extension.create({
  name: "sentenceCapitalization",
  priority: 1250,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            if (
              from !== to ||
              !text ||
              text[0] === text[0].toLocaleUpperCase("fr-FR")
            ) {
              return false;
            }

            const position = view.state.doc.resolve(from);
            if (position.parent.type.name !== "paragraph") {
              return false;
            }

            const before = position.parent.textBetween(
              0,
              position.parentOffset,
              "\0",
              "\0",
            );
            if (before.length !== 0 && !/[.!?]\s+$/.test(before)) {
              return false;
            }

            const capitalized = `${text[0].toLocaleUpperCase("fr-FR")}${text.slice(1)}`;
            view.dispatch(view.state.tr.insertText(capitalized, from, to));
            return true;
          },
        },
      }),
    ];
  },
});
