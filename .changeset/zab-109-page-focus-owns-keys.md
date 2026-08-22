---
"@zabloo/renderer-web": patch
---

The keys of the page around the canvas are left to the page: a focused control of the host's
own UI keeps the Enter, the Space and the arrows the browser owes it.

The renderer listens for `keydown` on the window, so it hears every key the page gets, and it
answered them all with `preventDefault()` after asking only which of the mounted views owned
input. With any chrome around the canvas — a toolbar, a panel, a console — that meant no button
of the host's could be activated from the keyboard at all: the key arrived already prevented and
the browser never turned it into a click. The view now reads a key only when the page's focus is
on its canvas, on the hidden field a focused `TextInput` types through, or on nothing at all,
and it asks before preventing anything rather than after.

The canvas is made focusable (`tabindex="0"`, unless the host set its own), so the focus can be
tabbed into the game and out again; pressing it takes the page's focus as well as the input, and
focusing it claims the input, so the two can never point at different views. A disposed view
releases the focus it was holding.
