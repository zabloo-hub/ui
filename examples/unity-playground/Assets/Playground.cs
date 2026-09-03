using System.IO;
using UnityEngine;
using UnityEngine.InputSystem;
using Zabloo;

/// <summary>
/// Stands in for the game — the Unity spelling of the Godot playground's
/// <c>main.gd</c>. Everything a real integration does is here, and it is the
/// whole game↔UI coupling surface of v1: named actions out, data in.
///
/// It loads the examples' envelopes from <c>StreamingAssets/</c>, where
/// <c>scons install</c> (in <c>sdk/unity</c>) copies the current export of each
/// one, so what is on screen is always the current build of that example.
/// <b>E</b> swaps between them, <b>R</b> reloads the current one — the same swap
/// a dev push performs.
///
/// Desktop only: on Android the streaming assets live inside the APK and are
/// read with a web request, which is not what this file is for.
/// </summary>
public sealed class Playground : MonoBehaviour
{
    /// <summary>The examples this playground can show, and the view each opens on.</summary>
    static readonly (string file, string view)[] Sources =
    {
        ("settings-screen", "settings"),
        ("showcase", "motion"),
        ("showcase", "overlays"),
        ("inventory-demo", "inventory"),
        ("hello-button", "main-menu"),
    };

    [SerializeField] ZablooView view;

    int source;

    void Start()
    {
        if (view == null) view = FindFirstObjectByType<ZablooView>();
        view.OnAction += (name, context) =>
            Debug.Log(context.IsEmpty
                ? $"action: {name}"
                : $"action: {name}  (item {context.Path}, key {context.Key}, index {context.Index})");
        view.OnDataChanged += (path, json) => Debug.Log($"{path} = {json}");
        view.OnDiagnostic += d => Debug.Log($"{(d.Fatal ? "fatal" : "warn")} {d.Code} at {d.Path}: {d.Message}");
        Load();
    }

    void Update()
    {
        var keyboard = Keyboard.current;
        if (keyboard == null) return;
        if (keyboard.eKey.wasPressedThisFrame)
        {
            source = (source + 1) % Sources.Length;
            Load();
        }
        else if (keyboard.rKey.wasPressedThisFrame)
        {
            Load();
        }
    }

    void Load()
    {
        var (file, viewId) = Sources[source];
        var path = Path.Combine(Application.streamingAssetsPath, file + ".json");
        if (!File.Exists(path))
        {
            Debug.LogWarning($"playground: {path} is missing — run `scons install` in sdk/unity after building the example");
            return;
        }
        var ok = view.LoadEnvelope(File.ReadAllText(path), viewId);
        Debug.Log($"playground: {file} / {viewId} → {(ok ? "loaded" : "not loaded")}");
    }
}
