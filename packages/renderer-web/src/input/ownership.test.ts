import { afterEach, describe, expect, it } from "vitest";
import {
  claimInput,
  type InputView,
  ownsInput,
  registerView,
  unregisterView,
} from "./ownership.js";

/**
 * Who owns the keyboard and the pad when more than one view is mounted
 * (ZAB-70). The registry is module state — the page is one page — so every test
 * here cleans up after itself.
 */

/** A stand-in view that only records how often it was asked to re-check its pad. */
function fakeView(): InputView & { syncs: number } {
  return {
    syncs: 0,
    syncPad() {
      this.syncs++;
    },
  };
}

const mounted: InputView[] = [];

function mount(): InputView & { syncs: number } {
  const view = fakeView();
  mounted.push(view);
  registerView(view);
  return view;
}

afterEach(() => {
  for (const view of mounted.splice(0)) unregisterView(view);
});

describe("input ownership", () => {
  it("gives input to the first view mounted, and to nobody else", () => {
    const first = mount();
    const second = mount();

    expect(ownsInput(first)).toBe(true);
    expect(ownsInput(second)).toBe(false);
  });

  it("hands it over to the view the player touched", () => {
    const first = mount();
    const second = mount();

    claimInput(second);

    expect(ownsInput(second)).toBe(true);
    expect(ownsInput(first)).toBe(false);
  });

  it("tells both ends to re-check their pad, so only one polls it", () => {
    const first = mount();
    const second = mount();
    const before = { first: first.syncs, second: second.syncs };

    claimInput(second);

    // The one losing input has to stop its loop before the one taking it starts.
    expect(first.syncs).toBe(before.first + 1);
    expect(second.syncs).toBe(before.second + 1);
  });

  it("says nothing changed when the owner claims again", () => {
    const first = mount();
    const syncs = first.syncs;

    claimInput(first);

    expect(first.syncs).toBe(syncs);
  });

  it("ignores a claim from a view that is not mounted", () => {
    const first = mount();
    const stranger = fakeView();

    claimInput(stranger);

    expect(ownsInput(first)).toBe(true);
    expect(ownsInput(stranger)).toBe(false);
  });

  it("falls back to the oldest view left when the owner is disposed", () => {
    const first = mount();
    const second = mount();
    const third = mount();

    unregisterView(first);
    mounted.splice(mounted.indexOf(first), 1);

    expect(ownsInput(second)).toBe(true);
    expect(ownsInput(third)).toBe(false);
  });

  it("leaves nobody owning input when the last view goes", () => {
    const only = mount();

    unregisterView(only);
    mounted.splice(mounted.indexOf(only), 1);

    expect(ownsInput(only)).toBe(false);
  });

  it("keeps the owner when some OTHER view is disposed", () => {
    const first = mount();
    const second = mount();
    claimInput(second);

    unregisterView(first);
    mounted.splice(mounted.indexOf(first), 1);

    expect(ownsInput(second)).toBe(true);
  });
});
