using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.InputSystem;
using Zabloo;

namespace Zabloo.Verify
{
    /// <summary>
    /// One throwaway scene per capability, built by <c>Zabloo › Verify › …</c>
    /// (<c>Editor/VerifyMenu.cs</c>) and driven by this component — the Unity
    /// spelling of the "Checking G# by hand" scenes of the Godot playground, with
    /// the difference that a scene here is CODE: the menu builds it, this prints
    /// what to do and what to look for, and nothing lives in a <c>.unity</c> file
    /// that has to be kept in sync by hand.
    ///
    /// What it checks is the half of the adapter the golden corpus cannot see —
    /// pixels, a real pointer, a real pad, an event reaching a C# handler, a
    /// push arriving from the CLI — and every step is written twice: short here,
    /// in the Console, and in full in the playground's README
    /// (§ "Checking UN10 by hand"), which is the reference. The Console line says
    /// what to expect; the README says why.
    ///
    /// The host-channel steps are <c>[ContextMenu]</c> items: right-click the
    /// component while playing. The golden capture is <b>C</b>.
    /// </summary>
    public sealed class VerifyRig : MonoBehaviour
    {
        public enum Capability
        {
            Render,
            PointerKeyboard,
            Gamepad,
            HostChannel,
            DevLoop,
            GoldenCapture,
        }

        [SerializeField] Capability capability;

        [SerializeField] ZablooView view;

        [Tooltip("An example's export under StreamingAssets/ (the file name without .json) — what scons install copies there.")]
        [SerializeField] string source = "settings-screen";

        [SerializeField] string viewId = "settings";

        [Tooltip("A path relative to the project folder that wins over `source` when set — the golden capture reads ../../golden/envelopes/text-wrap.json.")]
        [SerializeField] string envelopePath = "";

        [Tooltip("Where C writes the capture, relative to the project folder. Gitignored: a capture is evidence for a PR, not a file for the repo.")]
        [SerializeField] string capturePath = "Captures/text-wrap-unity.png";

        public Capability What => capability;

        void Start()
        {
            if (view == null) view = FindFirstObjectByType<ZablooView>();
            view.OnAction += (name, context) =>
                Debug.Log(!context.HasContext
                    ? $"action: {name}"
                    : $"action: {name}  (item {context.Path}, key {context.Key}, index {context.Index})");
            view.OnDataChanged += (path, value) => Debug.Log($"{path} = {value}");
            view.OnDiagnostic += d => Debug.Log($"{(d.Fatal ? "fatal" : "warn")} {d.Code} at {d.Path}: {d.Message}");
            Load();
            Debug.Log($"[verify] {capability}\n" + string.Join("\n", Steps()));
        }

        void Update()
        {
            var keyboard = Keyboard.current;
            if (keyboard == null) return;
            if (keyboard.rKey.wasPressedThisFrame) Load();
            if (capability == Capability.GoldenCapture && keyboard.cKey.wasPressedThisFrame) StartCoroutine(Capture());
        }

        // --- loading ---------------------------------------------------------------

        string ProjectDir => Path.GetFullPath(Path.Combine(Application.dataPath, ".."));

        void Load()
        {
            string path;
            if (!string.IsNullOrEmpty(envelopePath))
            {
                path = Path.GetFullPath(Path.Combine(ProjectDir, envelopePath));
            }
            else
            {
                path = Path.Combine(Application.streamingAssetsPath, source + ".json");
            }
            if (!File.Exists(path))
            {
                Debug.LogWarning($"[verify] {path} is missing — run `scons install` in sdk/unity after building the example");
                return;
            }
            var ok = view.LoadEnvelope(File.ReadAllText(path), viewId);
            Debug.Log($"[verify] {Path.GetFileName(path)} / {viewId} → {(ok ? "loaded" : "not loaded")}");
        }

        // --- the host channel, step by step ------------------------------------------
        //
        // Each is the line the README asks you to type, as a menu item, so the
        // check is a right-click instead of a script. The Console line to expect is
        // in the README; the summary here is the short form.

        [ContextMenu("Host 1 · SetData player.gold = 1100 (hello-button)")]
        void HostSetGold()
        {
            view.SetData("player.gold", 1100);
            Debug.Log("[verify] expect: the bound gold reads 1100, and NO `player.gold = …` line (SetData never echoes)");
        }

        [ContextMenu("Host 2 · SetChecked sfx = true (settings-screen)")]
        void HostSetChecked()
        {
            var found = view.SetChecked("sfx", true);
            Debug.Log($"[verify] SetChecked → {found}; expect: `action: sfx-changed` then `settings.sfx = True`, in that order");
        }

        [ContextMenu("Host 3 · SetValue volume = 40 (settings-screen)")]
        void HostSetValue()
        {
            var found = view.SetValue("volume", 40);
            Debug.Log($"[verify] SetValue → {found}; expect: `action: volume-preview`, `action: volume-apply`, `settings.volume = 40`");
        }

        [ContextMenu("Host 4 · SetData settings.sfx = false never echoes")]
        void HostSetDataNoEcho()
        {
            view.SetData("settings.sfx", false);
            Debug.Log("[verify] expect: the toggle moves and NO `settings.sfx = …` line follows");
        }

        [ContextMenu("Host 5 · Reload a truncated payload: the screen stays")]
        void HostRefusedReload()
        {
            var was = view.Snapshot();
            var ok = view.Reload("{\"v\": 1, \"views\"");
            var same = was == view.Snapshot();
            Debug.Log($"[verify] Reload → {ok} (expect false); IsLoaded = {view.IsLoaded} (expect true); snapshot unchanged = {same} (expect true); and a red `[zabloo] invalid-json` line above");
        }

        [ContextMenu("Host 6 · Push four inventory rows (inventory-demo)")]
        void HostPushRows()
        {
            var rows = new List<object>();
            for (var i = 0; i < 4; i++)
            {
                rows.Add(new Dictionary<string, object>
                {
                    { "id", "row-" + i },
                    { "tag", "T" + i },
                    { "name", "Item " + i },
                    { "detail", "Pushed from VerifyRig" },
                    { "price", 100 + i },
                    { "fav", i % 2 == 0 },
                });
            }
            view.SetData("shop.items", rows);
            Debug.Log("[verify] expect: four rows on screen; a click on row 3's Buy logs `action: buy  (item shop.items.3, key row-3, index 3)`");
        }

        [ContextMenu("Stats · what the last paint cost")]
        void LogStats()
        {
            var stats = view.GetStats();
            Debug.Log($"[verify] draw calls {stats.DrawCalls}, vertices {stats.Vertices}, atlases {stats.Atlases}, atlas bytes {stats.AtlasBytes}, clip groups {stats.ClipGroups}, repaint only {stats.RepaintOnly}");
        }

        // --- the golden capture --------------------------------------------------------

        /// <summary>
        /// Reads back exactly the view's rect at the end of the frame — the canvas
        /// alone, 1:1, no post-processing in the way — and writes a PNG. The Game
        /// view has to be at scale 1 (its Scale slider) for a device pixel to be a
        /// view pixel; the menu already builds this scene with a constant-pixel
        /// scaler at factor 1.
        /// </summary>
        IEnumerator Capture()
        {
            yield return new WaitForEndOfFrame();
            var rt = (RectTransform)view.transform;
            var corners = new Vector3[4];
            rt.GetWorldCorners(corners);
            var canvas = view.GetComponentInParent<Canvas>();
            var camera = canvas != null && canvas.renderMode != RenderMode.ScreenSpaceOverlay ? canvas.worldCamera : null;
            var min = RectTransformUtility.WorldToScreenPoint(camera, corners[0]);
            var max = RectTransformUtility.WorldToScreenPoint(camera, corners[2]);
            var width = Mathf.RoundToInt(max.x - min.x);
            var height = Mathf.RoundToInt(max.y - min.y);
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
            texture.ReadPixels(new Rect(min.x, min.y, width, height), 0, 0);
            texture.Apply();
            var path = Path.GetFullPath(Path.Combine(ProjectDir, capturePath));
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, texture.EncodeToPNG());
            Destroy(texture);
            Debug.Log($"[verify] captured {width}×{height} → {path}  (expect 480×320; if not, set the Game view's Scale to 1)");
        }

        // --- the checklists ------------------------------------------------------------

        string[] Steps()
        {
            switch (capability)
            {
                case Capability.Render:
                    return new[]
                    {
                        "1. Something draws: settings-screen paints. Hierarchy: Zabloo › Zabloo Surface › one `clip group N` per group, each with a mesh.",
                        "2. Switch the Canvas to Screen Space – Camera (drag Main Camera in): identical picture, corners still round.",
                        "3. Frame Debugger: the Canvas draws = GetStats().DrawCalls (right-click › Stats) plus the Canvas's own, never more.",
                        "4. Press R (reload): no `could not decode` line, the Profiler's texture count does not move.",
                        "5. Profiler › CPU › GC Alloc with nothing moving: ZablooView.Update reports 0 B. Hover a button: still 0 B.",
                    };
                case Capability.PointerKeyboard:
                    return new[]
                    {
                        "1. Hover lights a button; the action fires on release. Press, drag off, release: nothing. Alt-tab mid-drag: nothing stuck pressed.",
                        "2. Arrows walk the focus ring; Enter/Space activate on release; a held arrow waits 400 ms then steps every 90.",
                        "3. On a slider ←/→ move the value, ↑/↓ leave it; `brightness-apply` fires when the arrow comes UP, once.",
                        "4. Enter opens the language dropdown, Escape closes it; with nothing open Escape does nothing (EscapeConsumedThisFrame stays false).",
                        "5. The name field: type and the bound label follows; Shift+arrows select; Cmd/Ctrl+C/X/V; a 38-char paste stops at maxLength; ←/→ at the ends leave the field; Enter → `name-accept`.",
                        "6. The wheel scrolls the list 50 px per notch; over a horizontal-only strip it does nothing (deliberate).",
                    };
                case Capability.Gamepad:
                    return new[]
                    {
                        "1. D-pad / left stick: one push, one step of focus. Hold one: nothing for 400 ms, then a step every 90 ms — a second held is 8 steps.",
                        "2. A presses the focused control and activates it when you LET GO. Unplug mid-press: it cancels, nothing fires.",
                        "3. On a slider, the axis directions move the VALUE, the cross ones leave; `brightness-apply` when the direction is released — or the pad unplugged.",
                        "4. On the name field ←/→ walk the caret and hand back at the ends; ↑/↓ always navigate.",
                        "5. B closes the language dropdown (its binding is written); with nothing up it does nothing.",
                        "6. Right stick scrolls the ScrollView the focus is in; walking the focus down the list drags the list along.",
                        "7. This is the milestone's exit criterion: the same list, on an IL2CPP player (README › the player run).",
                    };
                case Capability.HostChannel:
                    return new[]
                    {
                        "Right-click this component (Inspector › ⋮) for the steps: Host 1 … Host 6, each says what to expect.",
                        "Host 1 needs hello-button, 2–5 settings-screen, 6 inventory-demo: set `source`/`viewId` and press R.",
                    };
                case Capability.DevLoop:
                    return new[]
                    {
                        "1. Turn on Zabloo › Dev Mode in the menu bar: the Console says `dev mode listening on 127.0.0.1:5077`.",
                        "2. In ../showcase run `pnpm dev --unity`, then press Play here.",
                        "3. Edit src/views/media.tsx: the view swaps without leaving Play; a value pushed with SetData survives the swap.",
                        "4. Watch both logs: the CLI prints `pushed to Unity … ✔ (1 view)`, the Console `reloaded 1 view(s), no new assets` — save again, still no new assets.",
                        "5. Replace src/assets/banner.png: `1 asset(s) fetched` exactly once, then back to `no new assets`. N reloads, one transfer.",
                        "6. Dev mode off, keep saving: the CLI says it is not reachable ONCE, then `— back` when it is on again. Full list: README › Checking UN8 by hand.",
                    };
                case Capability.GoldenCapture:
                    return new[]
                    {
                        "1. Set the Game view to 480×320 (or larger) and its Scale slider to 1; the canvas is a constant-pixel scaler at factor 1.",
                        "2. Press C: Captures/text-wrap-unity.png, exactly the view's 480×320.",
                        "3. Capture the same envelope in the web preview and the Godot playground (golden/README.md › Golden images) and compare at 1:1.",
                        "4. Tolerance: placement exact — same breaks, same left edges, same baselines; ≤ 2/255 per channel on antialiased edges only.",
                    };
                default:
                    return new string[0];
            }
        }
    }
}
