/** Placeholder — V15 (typed editors) fills this in. */

import type { Binding } from "@/store/bindings";

interface BindingFieldProps {
  binding: Binding;
}

/**
 * The signature is here already so that V14's panel can hand each row its
 * binding without V15 having to come back and edit the panel too.
 */
function BindingField(_props: BindingFieldProps): null {
  return null;
}

export type { BindingFieldProps };
export { BindingField };
