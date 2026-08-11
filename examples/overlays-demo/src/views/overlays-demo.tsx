// View "overlays-demo" (file-based convention: the filename is the view ID).
// Manual test bed for the F4 overlay layer (ZAB-21): <Modal> (dims, captures
// input, traps focus), <Toast> (non-modal, self-closing) and <Tooltip> (a hint
// bubble), plus the enter/exit fade every one of them gets from its `transition`.
//
// Nothing here "opens" anything by itself: `visible` is the single mechanism, so
// each overlay is bound to a flag and the switches below write that same flag —
// the read/write binding loop standing in for the game's SetData. That is why a
// dismiss shows up as the switch turning itself off: Escape, a tap on the
// backdrop and the toast's timer all write `false` back through the binding.
//
// The exception is an ANCHORED tooltip (ZAB-46): it hangs from another node's
// rect and rides that node's hover/focus, so the two at the bottom show
// themselves with no flag and no game behind them.
import { Button, Column, Modal, Row, Switch, Text, Toast, Tooltip } from "@zabloo/react";

const TITLE = { color: "{color.text}", fontSize: 20 } as const;
const BODY = { color: "{color.muted}", fontSize: 14 } as const;
const LABEL = { color: "{color.text}", fontSize: 16 } as const;
// Padding is layout, not style, so it travels on the node instead of the variant.
const BTN = { padding: "{space.2}" } as const;

export default function OverlaysDemo() {
  return (
    <Column layout={{ grow: 1, justify: "center", align: "center", gap: 16 }}>
      <Text style={TITLE}>Overlays</Text>

      <Column
        layout={{ padding: "{space.4}", gap: "{space.2}", align: "stretch" }}
        style={{
          background: "{color.panel}",
          radius: "{radius.md}",
          borderWidth: 1,
          borderColor: "{color.border}",
        }}
      >
        <Switch checked={{ bind: "ui.confirmOpen" }} layout={{ width: 320 }}>
          <Text style={LABEL}>Diálogo de confirmación</Text>
        </Switch>
        <Switch checked={{ bind: "ui.saved" }} layout={{ width: 320 }}>
          <Text style={LABEL}>Aviso de guardado (se cierra solo)</Text>
        </Switch>
        <Switch checked={{ bind: "ui.hint" }} layout={{ width: 320 }}>
          <Text style={LABEL}>Pista</Text>
        </Switch>
      </Column>

      {/* Modal: el fondo se atenúa con su propio `background`, el input de debajo
          queda capturado y el focus se confina al panel. `autofocus` marca el
          botón que lo recibe al abrirse; al cerrarse vuelve al interruptor. */}
      <Modal
        id="confirm"
        visible={{ bind: "ui.confirmOpen" }}
        onDismiss="quit-cancelled"
        transition={{ duration: "{motion.base}" }}
      >
        <Text style={TITLE}>¿Salir de la partida?</Text>
        <Text style={BODY}>Perderás el progreso desde el último punto de control.</Text>
        <Row layout={{ gap: "{space.2}", justify: "end" }}>
          <Button variant="quiet" layout={BTN} onClick="details-open">
            <Text style={LABEL}>Detalles</Text>
          </Button>
          <Button variant="quiet" layout={BTN} onClick="quit-cancelled">
            <Text style={LABEL}>Cancelar</Text>
          </Button>
          <Button variant="action" layout={BTN} autofocus onClick="quit-confirm">
            <Text style={LABEL}>Salir</Text>
          </Button>
        </Row>

        {/* Modal sobre modal, declarado DENTRO del primero: sale igualmente del
            flujo y se aplana en la misma capa, más arriba por orden de documento.
            Mientras está abierto, es él quien captura el input y el focus. */}
        <Modal
          id="details"
          visible={{ bind: "ui.detailsOpen" }}
          onDismiss="details-closed"
          transition={{ duration: "{motion.fast}" }}
          panel={{ layout: { width: 260 } }}
        >
          <Text style={BODY}>Último punto de control: hace 12 minutos.</Text>
          <Button variant="quiet" layout={BTN} autofocus onClick="details-closed">
            <Text style={LABEL}>Entendido</Text>
          </Button>
        </Modal>
      </Modal>

      {/* Toast: no modal, así que la capa es inerte al input y los interruptores
          de debajo se siguen usando mientras está arriba. A los 3 s el SDK pide
          su propio cierre: escribe `false` en el binding y dispara `onDismiss`. */}
      <Toast
        visible={{ bind: "ui.saved" }}
        onDismiss="toast-closed"
        transition={{ duration: "{motion.fast}" }}
      >
        Partida guardada
      </Toast>

      {/* Tooltip sin ancla: se coloca en la capa como cualquier overlay y se
          muestra por binding — el tooltip de mando, que el juego enciende. */}
      <Tooltip visible={{ bind: "ui.hint" }} transition={{ duration: "{motion.fast}" }}>
        Pulsa A para saltar
      </Tooltip>

      {/* Anclaje + disparo por hover/focus (ZAB-46). Ninguno de los dos lleva
          `visible`: se muestran solos mientras el ratón o el foco están sobre su
          ancla, así que la misma pista llega al mando sin nada más. Fíjate en que
          el de arriba se voltea abajo cuando no cabe, y en que ambos se van si su
          ancla se va. */}
      <Row layout={{ gap: "{space.2}", align: "center" }}>
        <Button id="jump-btn" variant="action" layout={BTN} onClick="jump">
          <Text style={LABEL}>Saltar</Text>
        </Button>
        <Button id="load-btn" variant="quiet" layout={BTN} onClick="load">
          <Text style={LABEL}>Cargar partida</Text>
        </Button>
      </Row>

      <Tooltip anchor="jump-btn" transition={{ duration: "{motion.fast}" }}>
        Pulsa A para saltar
      </Tooltip>
      <Tooltip anchor="load-btn" position="right" transition={{ duration: "{motion.fast}" }}>
        Vuelve al último punto de control
      </Tooltip>
    </Column>
  );
}
