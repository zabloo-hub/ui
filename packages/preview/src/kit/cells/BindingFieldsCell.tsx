import { BindingField } from "@/components/bindings/editors/BindingField";
import { KitCaption, KitCell, KitLabel } from "@/kit/KitCell";
import { type Binding, useBindings } from "@/store";

/**
 * The field itself, in the five shapes its four editors give it — and then, on
 * its own, the one state that has a clock on it.
 *
 * `BindingInputsCell` above mirrors the CONTROLS a field can hold: a switch, a
 * number with its stepper, an input with the focus ring. This is the component
 * that decides which of them you get, draws the path and the type tag over it,
 * and keeps a canvas write from yanking the text out from under whoever is
 * typing. None of that is visible in a specimen made of primitives.
 *
 * **The first group is LIVE and is meant to be typed in**, which is why its
 * bindings are seeded into the store rather than held here: a field writes
 * through `setFromEditor` and reads its value back off the binding it was handed,
 * so a kit that kept its own copy would be showing five boxes that refuse to
 * change. The states worth reaching by hand are all in there — the JSON editor
 * collapsed, editing, and holding text that does not parse (type a stray comma:
 * the border goes red and the text is KEPT); the number editor swapping to a
 * plain field the moment its value stops being a number (type a word into it).
 * Flipping the scenario reseeds them, which is the page's undo.
 *
 * **The second group is FROZEN, and it is the exception the ticket's precedent
 * describes.** The `← UI` mark is a four-second affair: the field starts a timer
 * and clears it, so a store-backed specimen of it would undress itself while you
 * looked at it. Handed a binding as a PROP instead, the field draws the marked
 * row and the timer clears an entry in the store that nothing here reads. The
 * component is real, the mechanism is not mounted — which is the pattern for
 * every state with a clock in it.
 */
function BindingFieldsCell() {
  const { byPath, order } = useBindings();

  return (
    <KitCell id="binding-fields" label="Binding fields · typed editors" className="col-span-2">
      {/* The panel's own column: 296px minus the card's padding, and the 14px
          the panel puts between fields. */}
      <div className="flex w-[272px] flex-col gap-[14px]">
        {order.map((path) => {
          const binding = byPath[path];
          return binding === undefined ? null : (
            <BindingField
              key={path}
              binding={binding}
              // One field held, which is the panel's error state: values are
              // shown, nothing is editable.
              disabled={path === "settings.volume"}
            />
          );
        })}
      </div>
      <KitCaption>
        number · string · boolean · array (JSON) · one held — live, type in them
      </KitCaption>

      <KitLabel>Two-way write</KitLabel>
      <div className="w-[272px]">
        <BindingField binding={WRITTEN_BY_UI} />
      </div>
      <KitCaption>frozen — the real field, holding the mark its own timer would clear</KitCaption>
    </KitCell>
  );
}

/**
 * A binding as it looks the instant a control on the canvas wrote to it. Kept out
 * of the store on purpose (see above), which is also why its `writtenAt` never
 * has to be a real clock reading: nothing re-reads it.
 */
const WRITTEN_BY_UI: Binding = {
  path: "settings.sfx",
  type: "boolean",
  value: true,
  lastWriteFrom: "ui",
  writtenAt: 0,
};

export { BindingFieldsCell };
