// View "settings-demo" (file-based convention: the filename is the view ID).
// Manual test bed for the F5 form controls: Checkbox/Switch (independent
// booleans, ZAB-23), RadioGroup (one value, exclusive selection, ZAB-23),
// Slider (a continuous value, ZAB-24), TextInput (text with a caret and a
// selection, ZAB-26) and Select (one value picked from a popover in the overlay
// layer, ZAB-25). Every control is bound, so the preview's data panel shows
// both directions: type a value and the control moves; drag, tap or type into
// the control and the field updates (the game's onDataChanged).
import {
  Checkbox,
  Column,
  Container,
  Option,
  Radio,
  RadioGroup,
  Row,
  Select,
  Slider,
  Switch,
  Text,
  TextInput,
} from "@zabloo/react";

const LABEL = { color: "{color.text}", fontSize: 16 } as const;
const ROW = { padding: "{space.2}", width: 320 } as const;

// Long enough that the dropdown scrolls: what makes the list navigable is the
// focus dragging the ScrollView along with it.
const LANGUAGES = [
  "Español",
  "English",
  "Français",
  "Deutsch",
  "Italiano",
  "Português",
  "Polski",
  "Türkçe",
  "Svenska",
  "Suomi",
] as const;

export default function SettingsDemo() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Text style={{ color: "{color.text}", fontSize: 20 }}>Ajustes</Text>

      <Column
        layout={{ padding: "{space.4}", gap: "{space.2}", align: "stretch" }}
        style={{
          background: "{color.panel}",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "{color.border}",
        }}
      >
        {/* Texto: el nodo ES la caja, y el SDK pinta dentro el caret, la
            selección y el placeholder. `onChange` sigue cada pulsación (el
            nombre de al lado se actualiza al teclear) y `onSubmit` salta con
            Enter. ←/→ mueven el caret y, en el extremo, dejan navegar. */}
        <Row layout={{ ...ROW, justify: "space-between", align: "center", gap: 12 }}>
          <Text style={LABEL}>Nombre</Text>
          <Text bind="profile.name" style={{ color: "{color.muted}", fontSize: 14 }} />
        </Row>
        <TextInput
          id="player-name"
          value={{ bind: "profile.name" }}
          placeholder="Tu nombre"
          maxLength={16}
          onSubmit="name-accept"
          width={320}
          style={{ borderWidth: 1, borderColor: "{color.border}" }}
          states={{
            empty: { style: { color: "{color.muted}" } },
            focused: { style: { borderColor: "{color.on}" } },
          }}
        />

        <Checkbox
          id="subtitles"
          variant="row"
          autofocus
          checked={{ bind: "settings.subtitles" }}
          onChange="subtitles-changed"
          layout={ROW}
        >
          <Text style={LABEL}>Subtítulos</Text>
        </Checkbox>

        <Switch
          id="sfx"
          variant="row"
          checked={{ bind: "settings.sfx" }}
          onChange="sfx-changed"
          checkedTrack={{ background: "{color.on}" }}
          layout={ROW}
        >
          <Text style={LABEL}>Efectos de sonido</Text>
        </Switch>

        {/* Continuous: `onChange` sigue al dedo (preview del volumen) y
            `onCommit` salta al soltar (aplicar el ajuste de verdad). */}
        <Row layout={{ ...ROW, justify: "space-between", align: "center", gap: 12 }}>
          <Text style={LABEL}>Volumen</Text>
          <Text bind="settings.volume" style={{ color: "{color.muted}", fontSize: 14 }} />
        </Row>
        <Slider
          id="volume"
          value={{ bind: "settings.volume" }}
          onChange="volume-preview"
          onCommit="volume-apply"
          length={320}
          fill={{ background: "{color.on}" }}
        />

        {/* Cuantizado: brillo de 0 a 100 de diez en diez, y las flechas se
            mueven por esa misma rejilla cuando el control tiene el focus. */}
        <Row layout={{ ...ROW, justify: "space-between", align: "center", gap: 12 }}>
          <Text style={LABEL}>Brillo</Text>
          <Text bind="settings.brightness" style={{ color: "{color.muted}", fontSize: 14 }} />
        </Row>
        <Slider
          id="brightness"
          value={{ bind: "settings.brightness" }}
          min={0}
          max={100}
          step={10}
          onCommit="brightness-apply"
          length={320}
        />

        {/* Desplegable: el botón cerrado enseña el VALOR (la IR no tiene
            expresiones con las que buscar una etiqueta), y la lista se abre en la
            capa de overlays anclada a él. Se cierra al elegir, con Escape y al
            clicar fuera; con el teclado, Enter abre sobre la opción en uso y las
            flechas arrastran el scroll de la lista larga. */}
        <Row layout={{ ...ROW, justify: "space-between", align: "center", gap: 12 }}>
          <Text style={LABEL}>Idioma</Text>
          <Text bind="settings.language" style={{ color: "{color.muted}", fontSize: 14 }} />
        </Row>
        <Select
          id="language"
          value={{ bind: "settings.language" }}
          onChange="language-changed"
          width={320}
          maxHeight={180}
        >
          {LANGUAGES.map((language) => (
            <Option key={language} value={language}>
              <Text style={LABEL}>{language}</Text>
            </Option>
          ))}
        </Select>

        <Text style={{ color: "{color.muted}", fontSize: 14 }}>Calidad gráfica</Text>
        <RadioGroup value={{ bind: "settings.quality" }} layout={{ gap: 4 }}>
          <Radio value="low" variant="row" layout={ROW}>
            <Text style={LABEL}>Baja</Text>
          </Radio>
          <Radio value="medium" variant="row" layout={ROW}>
            <Text style={LABEL}>Media</Text>
          </Radio>
          <Radio value="high" variant="row" layout={ROW}>
            <Text style={LABEL}>Alta</Text>
          </Radio>
        </RadioGroup>
      </Column>

      <Container layout={{ direction: "row", gap: 6 }}>
        <Text style={{ color: "{color.muted}", fontSize: 14 }}>Calidad seleccionada:</Text>
        <Text bind="settings.quality" style={{ color: "{color.text}", fontSize: 14 }} />
      </Container>
    </Column>
  );
}
