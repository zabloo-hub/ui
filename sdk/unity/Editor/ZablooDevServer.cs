using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Text;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;
using Zabloo.Format;

namespace Zabloo.Editor
{
    /// <summary>
    /// Dev mode (menu: Zabloo → Dev Mode): listens on localhost for envelopes pushed
    /// by `zabloo dev` and applies them through the SAME loader path as a manual
    /// import or a production hot-update (one loading mechanism, decision 2026-08-02).
    ///
    /// On each push: validates the envelope, rewrites the imported .json asset each
    /// scene ZablooDocument references (so edit mode / the next play session are in
    /// sync), and — if playing — hot-swaps the live views.
    /// </summary>
    [InitializeOnLoad]
    internal static class ZablooDevServer
    {
        const string PrefKey = "Zabloo.DevMode";
        const string MenuPath = "Zabloo/Dev Mode (listen on localhost:5077)";
        const int Port = 5077;

        static HttpListener _listener;
        static readonly ConcurrentQueue<string> Incoming = new ConcurrentQueue<string>();
        static int _nudgeTicks;

        static ZablooDevServer()
        {
            EditorApplication.update += Pump;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
            if (EditorPrefs.GetBool(PrefKey, false)) Start();
        }

        static void OnPlayModeChanged(PlayModeStateChange change)
        {
            // With "Run In Background" off (the default) the editor SUSPENDS the
            // whole player loop when it loses OS focus — a pushed reload would sit
            // unlaid-out and unrendered until refocus. While dev mode is on, keep
            // the game running in background so pushes show up live.
            if (change == PlayModeStateChange.EnteredPlayMode && EditorPrefs.GetBool(PrefKey, false))
            {
                Application.runInBackground = true;
                Debug.Log("[zabloo] Dev mode: runInBackground enabled — pushes apply while Unity is unfocused.");
            }
        }

        [MenuItem(MenuPath)]
        static void Toggle()
        {
            bool enabled = !EditorPrefs.GetBool(PrefKey, false);
            EditorPrefs.SetBool(PrefKey, enabled);
            if (enabled) Start();
            else Stop();
        }

        [MenuItem(MenuPath, true)]
        static bool ToggleValidate()
        {
            Menu.SetChecked(MenuPath, EditorPrefs.GetBool(PrefKey, false));
            return true;
        }

        static void Start()
        {
            if (_listener != null) return;
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
                _listener.Start();
                _listener.BeginGetContext(OnContext, null);
                Debug.Log($"[zabloo] Dev mode listening on http://127.0.0.1:{Port}/ — run `zabloo dev` (or `pnpm dev`) in your UI project.");
            }
            catch (Exception e)
            {
                Debug.LogError($"[zabloo] Dev mode failed to start: {e.Message}");
                _listener = null;
            }
        }

        static void Stop()
        {
            if (_listener == null) return;
            try
            {
                _listener.Stop();
                _listener.Close();
            }
            catch
            {
                // Best-effort shutdown (domain reload / editor quit).
            }
            _listener = null;
        }

        static void OnContext(IAsyncResult result)
        {
            var listener = _listener;
            if (listener == null || !listener.IsListening) return;

            HttpListenerContext context;
            try
            {
                context = listener.EndGetContext(result);
            }
            catch
            {
                return; // listener stopped mid-accept
            }
            listener.BeginGetContext(OnContext, null); // keep accepting

            try
            {
                string body;
                using (var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }

                if (context.Request.HttpMethod != "POST" || string.IsNullOrEmpty(body))
                {
                    Respond(context, 400, "expected a POSTed zabloo envelope");
                    return;
                }

                Incoming.Enqueue(body); // applied on the main thread (Unity API)
                Respond(context, 200, "queued");
            }
            catch (Exception e)
            {
                try { Respond(context, 500, e.Message); }
                catch { /* client gone */ }
            }
        }

        static void Respond(HttpListenerContext context, int status, string message)
        {
            var bytes = Encoding.UTF8.GetBytes(message);
            context.Response.StatusCode = status;
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }

        static void Pump()
        {
            while (Incoming.TryDequeue(out var json)) Apply(json);

            // While the editor is unfocused it throttles updates AND stops
            // presenting frames. After a push, drive several player-loop ticks +
            // view repaints so the swapped UI is laid out and actually presented
            // (a single immediate repaint would present the pre-layout state).
            if (_nudgeTicks > 0)
            {
                _nudgeTicks--;
                EditorApplication.QueuePlayerLoopUpdate();
                InternalEditorUtility.RepaintAllViews();
            }
        }

        static void Apply(string json)
        {
            // Validate before touching anything — bad content must not reach assets
            // or live views (the loader would refuse it anyway; fail early + loudly).
            try
            {
                EnvelopeLoader.Parse(json);
            }
            catch (ZablooContentException e)
            {
                Debug.LogError($"[zabloo] Dev push rejected: {e.Message}");
                return;
            }

            var documents = UnityEngine.Object.FindObjectsByType<ZablooDocument>(
                FindObjectsInactive.Include, FindObjectsSortMode.None);
            if (documents.Length == 0)
            {
                Debug.LogWarning("[zabloo] Dev push received but no ZablooDocument is in the open scene.");
                return;
            }

            foreach (var document in documents)
            {
                // Keep the imported asset in sync (edit mode + next play session).
                var asset = document.EnvelopeAsset;
                if (asset != null)
                {
                    var assetPath = AssetDatabase.GetAssetPath(asset);
                    if (!string.IsNullOrEmpty(assetPath))
                    {
                        File.WriteAllText(assetPath, json);
                        AssetDatabase.ImportAsset(assetPath);
                    }
                }

                // Live hot-swap while playing — same call a production hot-update uses.
                if (Application.isPlaying && document.isActiveAndEnabled)
                {
                    document.Reload(json);
                }
            }

            // The push usually arrives while the editor is unfocused (the user is in
            // their code editor) — keep nudging update+repaint for a few ticks (see
            // Pump) so the swap becomes visible without focusing Unity.
            _nudgeTicks = 10;
            EditorApplication.QueuePlayerLoopUpdate();

            Debug.Log($"[zabloo] Dev push applied to {documents.Length} document(s).");
        }
    }
}
