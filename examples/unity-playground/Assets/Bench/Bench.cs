using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Profiling;
using Zabloo;

/// <summary>
/// The numbers only a running engine has, next to the core's own — the Unity
/// spelling of the Godot playground's bench (G15). Two ways in:
///
/// <list type="bullet">
///   <item><b>B</b> toggles a HUD with them, live.</item>
///   <item><c>-zabloo-bench</c> on a PLAYER's command line walks every example,
///   warms each one up, measures it, prints one line per screen and quits.</item>
/// </list>
///
/// It exists because the two halves of a performance budget can only be read
/// against each other HERE. The core counts the geometry it produced and can do
/// it on a bare CPU (that is what <c>core/tests/test_budgets.cpp</c> holds a
/// ceiling on); frames per second, draw calls actually submitted and texture
/// memory are answers only a running engine has. Side by side they also say
/// whether the adapter adds calls of its own: one <c>CanvasRenderer</c> per clip
/// group and one submesh per batch is the arrangement, and a scene where the two
/// columns diverge is the interesting one.
///
/// It spawns itself when the scene loads, so neither the scene file nor
/// <see cref="Playground"/> has to know it exists; it only asks the playground
/// which example to show. Read it in a PLAYER rather than in the editor: the
/// editor draws its own windows around the Game view, and its numbers include
/// work no player pays for.
/// </summary>
public sealed class Bench : MonoBehaviour
{
    /// <summary>The flag a player is launched with. Godot's is <c>-- --zabloo-bench</c>.</summary>
    const string Flag = "-zabloo-bench";

    /// <summary>
    /// Seconds discarded before each example is measured, and seconds measured
    /// after. The warmup is not politeness: the first frames of an example are
    /// shader compilation, every mesh growing to its size and every glyph it uses
    /// reaching an atlas for the first time. Folded into the average they made the
    /// FIRST example look half as fast as the rest (G15), which says something
    /// about starting up and nothing about the frame.
    /// </summary>
    const double Warmup = 1.5;
    const double Dwell = 4.0;

    Playground playground;
    ZablooView view;

    // The HUD.
    bool hud;
    string hudText = "";
    double hudAt;
    GUIStyle hudStyle;

    // The unattended run.
    bool auto;
    bool warm;
    int frames;
    double started;
    readonly List<string> lines = new List<string>();

    /// <summary>
    /// Draw calls as the ENGINE counts them, from the profiler's render counter.
    /// Available in players too, on the platforms that publish it; where it is
    /// not, the column reads "n/a" rather than a number that means nothing.
    /// </summary>
    ProfilerRecorder drawCalls;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        var go = new GameObject("Zabloo Bench");
        DontDestroyOnLoad(go);
        go.AddComponent<Bench>();
    }

    void Start()
    {
        playground = FindFirstObjectByType<Playground>();
        view = FindFirstObjectByType<ZablooView>();
        if (playground == null || view == null)
        {
            Debug.LogWarning("bench: no Playground or ZablooView in the scene — nothing to measure");
            enabled = false;
            return;
        }
        drawCalls = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls Count");

        auto = Array.IndexOf(Environment.GetCommandLineArgs(), Flag) >= 0;
        if (!auto) return;

        // Uncapped, or every line would read the display's refresh rate and say
        // nothing: what a budget wants to know is the headroom.
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = -1;
        playground.Show(0);
        Restart();
    }

    void OnDestroy()
    {
        if (drawCalls.Valid) drawCalls.Dispose();
    }

    /// <summary>Starts the warmup on the current example, discarding the frames so far.</summary>
    void Restart()
    {
        frames = 0;
        warm = false;
        started = Time.realtimeSinceStartupAsDouble;
    }

    void Update()
    {
        if (auto)
        {
            Tick();
            return;
        }
        var keyboard = Keyboard.current;
        if (keyboard != null && keyboard.bKey.wasPressedThisFrame)
        {
            hud = !hud;
            hudAt = 0;
        }
        if (!hud) return;
        // Twice a second: a label rebuilt every frame is itself work, and an fps
        // readout that flickers at 60 Hz cannot be read anyway.
        var now = Time.realtimeSinceStartupAsDouble;
        if (now - hudAt < 0.5) return;
        hudAt = now;
        hudText = Report(1.0 / Mathf.Max(Time.unscaledDeltaTime, 1e-6f));
    }

    /// <summary>One dwell of the unattended bench, then on to the next example.</summary>
    void Tick()
    {
        var elapsed = Time.realtimeSinceStartupAsDouble - started;
        if (!warm)
        {
            if (elapsed < Warmup) return;
            warm = true;
            frames = 0;
            started = Time.realtimeSinceStartupAsDouble;
            return;
        }
        frames++;
        if (elapsed < Dwell) return;

        lines.Add(Line(playground.Current, frames / elapsed));
        var next = playground.Index + 1;
        if (next < Playground.Sources.Length)
        {
            playground.Show(next);
            Restart();
            return;
        }

        // Everything through Debug.Log: it is what Player.log holds, and
        // `-logFile -` (macOS, Linux) puts it on stdout — see the README.
        var sb = new StringBuilder();
        sb.Append("[zabloo-bench] ").Append(Header()).Append('\n');
        foreach (var line in lines) sb.Append("[zabloo-bench] ").Append(line).Append('\n');
        Debug.Log(sb.ToString());
        Application.Quit();
    }

    /// <summary>
    /// The header a table needs to be read: OS, resolution, GPU, whether vsync
    /// capped the fps, and which scripting backend and build kind produced it —
    /// a Mono development player and an IL2CPP release player are not the same
    /// number, and a reader has to know which one they are looking at.
    /// </summary>
    static string Header()
    {
        var vsync = QualitySettings.vSyncCount == 0 && Application.targetFrameRate <= 0
            ? "vsync off"
            : "VSYNC ON — fps is capped by the display";
#if ENABLE_IL2CPP
        const string backend = "IL2CPP";
#else
        const string backend = "Mono";
#endif
        var kind = Debug.isDebugBuild ? "development" : "release";
        return string.Format(CultureInfo.InvariantCulture, "{0}, {1}x{2}, {3} ({4}), {5}, {6} {7}, Unity {8}",
            SystemInfo.operatingSystem, Screen.width, Screen.height,
            SystemInfo.graphicsDeviceName, SystemInfo.graphicsDeviceType,
            vsync, backend, kind, Application.unityVersion);
    }

    /// <summary>One screen, one line — the same columns as the Godot bench's.</summary>
    string Line(string screen, double fps)
    {
        var stats = view.GetStats();
        // No CPU-time column, deliberately: a frame's time under a display cap is
        // the vsync wait, and what a frame costs on the CPU is measured where no
        // engine can blur it — `scons bench` in `core/`.
        return string.Format(CultureInfo.InvariantCulture,
            "{0,-28} {1,6:F1} fps   {2,3} draw calls (engine {3})   {4,5} vertices   {5,2} atlases   {6:F1} MiB textures{7}",
            screen, fps, stats.DrawCalls, EngineDrawCalls(), stats.Vertices, stats.Atlases,
            Texture.currentTextureMemory / 1048576.0, GraphicsDriverMemory());
    }

    /// <summary>What the HUD shows: the engine's frame next to the core's.</summary>
    string Report(double fps)
    {
        var stats = view.GetStats();
        var sb = new StringBuilder();
        sb.Append("fps ").Append(fps.ToString("F0", CultureInfo.InvariantCulture)).Append('\n');
        sb.Append("engine draw calls ").Append(EngineDrawCalls()).Append('\n');
        sb.Append("textures ").Append((Texture.currentTextureMemory / 1048576.0).ToString("F1", CultureInfo.InvariantCulture)).Append(" MiB").Append(GraphicsDriverMemory()).Append('\n');
        sb.Append("— core —\n");
        sb.Append("draw calls ").Append(stats.DrawCalls).Append("  clip groups ").Append(stats.ClipGroups).Append('\n');
        sb.Append("vertices ").Append(stats.Vertices).Append("  indices ").Append(stats.Indices).Append('\n');
        sb.Append("atlases ").Append(stats.Atlases).Append("  ").Append((stats.AtlasBytes / 1048576.0).ToString("F1", CultureInfo.InvariantCulture)).Append(" MiB\n");
        sb.Append("resolved ").Append(stats.Resolved).Append("  text layouts ").Append(stats.TextLayouts)
          .Append("  buffer growths ").Append(stats.BufferGrowths).Append(stats.RepaintOnly ? "  repaint" : "");
        return sb.ToString();
    }

    string EngineDrawCalls()
    {
        return drawCalls.Valid ? drawCalls.LastValue.ToString(CultureInfo.InvariantCulture) : "n/a";
    }

    /// <summary>
    /// The graphics driver's allocation, when the build reports it (development
    /// players do; release players answer zero, and then the column is not
    /// printed rather than printed as 0).
    /// </summary>
    static string GraphicsDriverMemory()
    {
        var bytes = Profiler.GetAllocatedMemoryForGraphicsDriver();
        return bytes > 0
            ? string.Format(CultureInfo.InvariantCulture, " (driver {0:F1} MiB)", bytes / 1048576.0)
            : "";
    }

    void OnGUI()
    {
        if (!hud || auto) return;
        if (hudStyle == null)
        {
            hudStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.UpperRight,
                fontSize = 12,
                richText = false,
            };
            hudStyle.normal.textColor = Color.white;
        }
        // Top right, and never in the way of the pointer: IMGUI labels take no
        // input, so a click through it reaches the view it is measuring.
        GUI.Label(new Rect(Screen.width - 332, 12, 320, 200), hudText, hudStyle);
    }
}
