/** Light by default, dark by choice — and the choice is the user's, not the OS's. */

import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

describe("theme", () => {
  it("starts light", () => {
    expect(store().getState().theme).toBe("light");
  });

  it("toggles both ways", () => {
    const preview = store();

    preview.getState().toggleTheme();
    expect(preview.getState().theme).toBe("dark");

    preview.getState().toggleTheme();
    expect(preview.getState().theme).toBe("light");
  });

  it("takes a theme outright", () => {
    const preview = store();

    preview.getState().setTheme("dark");

    expect(preview.getState().theme).toBe("dark");
  });
});
