using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.Networking;

namespace Zabloo.Editor
{
    /// <summary>
    /// Dev mode (menu: <b>Zabloo → Dev Mode</b>): receives the envelopes
    /// `zabloo dev --unity` pushes on every save and applies them through the SAME
    /// loader path a manual import or a platform hot-update takes.
    ///
    /// It lives in the EDITOR — the opposite of Godot, and for the mirror reason.
    /// Godot's Run launches another process, so its receiver had to live in the
    /// game; in Unity the game runs inside the editor (Play mode), and the envelope
    /// is an imported asset besides. So a push has two things to bring up to date,
    /// and both are the editor's: the views alive in Play, hot-swapped with
    /// <see cref="ZablooView.Reload"/>, and the `.json` each scene view references,
    /// rewritten and reimported so edit mode and the next Play open on the last
    /// export without anyone reimporting by hand.
    ///
    /// The transport is G14's (<see cref="DevPush"/>): the body has no asset bytes,
    /// the `x-zabloo-assets` header says where they are, and only the content
    /// hashes not held yet are fetched — N reloads, one transfer.
    ///
    /// Loopback only, and only while the menu item is checked (remembered in
    /// <see cref="EditorPrefs"/>). Listening survives nothing it should not: a
    /// domain reload and the editor quitting both stop it, because a listener that
    /// outlives its domain is a port held by nobody.
    /// </summary>
    [InitializeOnLoad]
    internal static class ZablooDevServer
    {
        const string EnabledPref = "Zabloo.DevMode";
        /// <summary>Overrides the port; unset means <see cref="DefaultPort"/>. Where the CLI's `--unity-port` has to point.</summary>
        const string PortPref = "Zabloo.DevMode.Port";
        const int DefaultPort = 5077;
        const string MenuPath = "Zabloo/Dev Mode";
        const string Route = "/zabloo/envelope";

        /// <summary>
        /// A push bigger than this is refused rather than buffered. An envelope is a
        /// tree plus a manifest with no bytes in it, so the ceiling is generous by
        /// orders of magnitude — it exists so a wrong client cannot make the editor
        /// eat memory. Same figure as the Godot receiver.
        /// </summary>
        const long MaxBody = 64L * 1024 * 1024;

        /// <summary>How long one asset fetch may take before it is given up on, in seconds.</summary>
        const int FetchTimeoutSeconds = 15;

        /// <summary>
        /// A push, accepted on the listener's thread and answered on the editor's.
        /// The response stays open until the main thread has counted the views —
        /// the count is a Unity API, and the reply promises it.
        /// </summary>
        sealed class Incoming
        {
            public HttpListenerContext Context;
            public string Body;
            public string AssetsBase;
        }

        /// <summary>A push being applied: what it says, and the fetches it is waiting for.</summary>
        sealed class Pending
        {
            public Dictionary<string, object> Envelope;
            public string AssetsBase;
            public readonly List<KeyValuePair<string, UnityWebRequest>> Fetches = new List<KeyValuePair<string, UnityWebRequest>>();
        }

        static HttpListener listener;
        static readonly ConcurrentQueue<Incoming> Queue = new ConcurrentQueue<Incoming>();
        /// <summary>Asset bytes by content hash, base64 exactly as the manifest spells them.</summary>
        static readonly Dictionary<string, string> Blobs = new Dictionary<string, string>();
        /// <summary>The push whose fetches are in flight, or null.</summary>
        static Pending applying;
        /// <summary>
        /// The newest push that arrived while one was being applied. One slot,
        /// because what is queued is always "the project as it is now": the same
        /// collapse the CLI does with saves that land during an export.
        /// </summary>
        static Pending next;
        static int nudgeTicks;

        static ZablooDevServer()
        {
            EditorApplication.update += Pump;
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
            if (EditorPrefs.GetBool(EnabledPref, false)) Start();
        }

        static int Port => EditorPrefs.GetInt(PortPref, DefaultPort);

        static void OnPlayModeChanged(PlayModeStateChange change)
        {
            // With "Run In Background" off (the default) the editor SUSPENDS the
            // whole player loop when it loses OS focus, and a push — which arrives
            // while you are in your code editor — would sit unlaid-out and
            // unrendered until refocus (2026-08-03). While dev mode is on, the game
            // keeps running in the background so pushes show up live.
            if (change == PlayModeStateChange.EnteredPlayMode && EditorPrefs.GetBool(EnabledPref, false))
            {
                Application.runInBackground = true;
                Debug.Log("[zabloo] dev mode: runInBackground enabled — pushes apply while Unity is unfocused");
            }
        }

        [MenuItem(MenuPath)]
        static void Toggle()
        {
            var enabled = !EditorPrefs.GetBool(EnabledPref, false);
            EditorPrefs.SetBool(EnabledPref, enabled);
            if (enabled) Start();
            else Stop();
        }

        [MenuItem(MenuPath, true)]
        static bool ToggleValidate()
        {
            Menu.SetChecked(MenuPath, EditorPrefs.GetBool(EnabledPref, false));
            return true;
        }

        static void Start()
        {
            if (listener != null) return;
            var port = Port;
            try
            {
                listener = new HttpListener();
                // Loopback, never `*`: this listens for the CLI on the same machine,
                // and binding wider would put the editor on the network it is
                // developed on.
                listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                listener.Start();
                listener.BeginGetContext(OnContext, null);
                Debug.Log("[zabloo] dev mode listening on 127.0.0.1:" + port + " — run `zabloo dev --unity`");
            }
            catch (Exception e)
            {
                // Another editor with dev mode on, most likely: say so instead of
                // silently listening to nothing.
                Debug.LogError("[zabloo] dev mode: port " + port + " is taken — another editor listening? (" + e.Message + ")");
                listener = null;
            }
        }

        static void Stop()
        {
            if (listener == null) return;
            try
            {
                listener.Stop();
                listener.Close();
            }
            catch
            {
                // Best effort: a domain reload or the editor quitting.
            }
            listener = null;
            // A push half-applied across a domain reload would be applied against
            // objects that no longer exist; the CLI's next save sends the whole
            // project again anyway.
            Abandon(applying);
            Abandon(next);
            applying = null;
            next = null;
        }

        // --- The listener's thread ----------------------------------------------------

        static void OnContext(IAsyncResult result)
        {
            var current = listener;
            if (current == null || !current.IsListening) return;

            HttpListenerContext context;
            try
            {
                context = current.EndGetContext(result);
            }
            catch
            {
                return; // stopped mid-accept
            }
            current.BeginGetContext(OnContext, null); // keep accepting

            // The whole HTTP surface: one route, one method. Everything else is
            // answered rather than ignored, so a wrong URL says so instead of
            // hanging.
            try
            {
                var request = context.Request;
                if (request.Url.AbsolutePath != Route)
                {
                    Respond(context, 404, "{\"error\":\"unknown route\"}");
                    return;
                }
                if (request.HttpMethod != "POST")
                {
                    Respond(context, 405, "{\"error\":\"POST an envelope\"}");
                    return;
                }
                if (request.ContentLength64 > MaxBody)
                {
                    Respond(context, 413, "{\"error\":\"request too large\"}");
                    return;
                }
                string body;
                using (var reader = new StreamReader(request.InputStream, Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }
                if (body.Length > MaxBody)
                {
                    Respond(context, 413, "{\"error\":\"request too large\"}");
                    return;
                }
                // Answered on the main thread, once the views are counted.
                Queue.Enqueue(new Incoming
                {
                    Context = context,
                    Body = body,
                    AssetsBase = request.Headers["x-zabloo-assets"] ?? "",
                });
            }
            catch (Exception e)
            {
                try { Respond(context, 500, "{\"error\":" + Quote(e.Message) + "}"); }
                catch { /* client gone */ }
            }
        }

        static void Respond(HttpListenerContext context, int status, string json)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }

        static string Quote(string text)
        {
            return "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        // --- The editor's thread ------------------------------------------------------

        static void Pump()
        {
            while (Queue.TryDequeue(out var incoming)) Receive(incoming);

            if (applying != null && FetchesDone(applying)) Apply(applying);

            // While the editor is unfocused it throttles updates AND stops
            // presenting frames. After a push, drive a few player-loop ticks and
            // repaints so the swapped UI is laid out and actually presented — a
            // single immediate repaint would present the pre-layout state.
            if (nudgeTicks > 0)
            {
                nudgeTicks--;
                EditorApplication.QueuePlayerLoopUpdate();
                InternalEditorUtility.RepaintAllViews();
            }
        }

        /// <summary>Answers the push and starts applying it — or parks it, if one is in flight.</summary>
        static void Receive(Incoming incoming)
        {
            if (!DevPush.TryParse(incoming.Body, out var envelope))
            {
                Respond(incoming.Context, 400, "{\"error\":\"not a JSON envelope\"}");
                return;
            }
            // What the receiver is about to do with it, said before the fetches:
            // a fetch may take a moment the CLI has no reason to sit through, and a
            // push that lands in no view at all must look different from one that
            // lands in three.
            var views = Views();
            try
            {
                Respond(incoming.Context, 200, "{\"views\":" + views.Length + "}");
            }
            catch
            {
                // The CLI went away; the push is still worth applying.
            }

            var pending = new Pending { Envelope = envelope, AssetsBase = incoming.AssetsBase };
            if (applying != null)
            {
                // Two saves inside one fetch: the last one wins, because it is the
                // only one that describes the project as it is now.
                Abandon(next);
                next = pending;
                return;
            }
            Begin(pending);
        }

        /// <summary>Asks the preview server for every hash the cache lacks, all at once.</summary>
        static void Begin(Pending pending)
        {
            applying = pending;
            var missing = DevPush.Missing(pending.Envelope, Blobs);
            if (missing.Count > 0 && string.IsNullOrEmpty(pending.AssetsBase))
            {
                Debug.LogWarning("[zabloo] dev mode: " + missing.Count + " asset(s) have no bytes and the push named no source — update @zabloo/cli");
                return;
            }
            foreach (var hash in missing)
            {
                var request = UnityWebRequest.Get(pending.AssetsBase + hash);
                request.timeout = FetchTimeoutSeconds;
                request.SendWebRequest();
                pending.Fetches.Add(new KeyValuePair<string, UnityWebRequest>(hash, request));
            }
        }

        static bool FetchesDone(Pending pending)
        {
            foreach (var fetch in pending.Fetches)
            {
                if (!fetch.Value.isDone) return false;
            }
            return true;
        }

        /// <summary>Puts the fetched bytes in the cache, rehydrates, and brings asset and views up to date.</summary>
        static void Apply(Pending pending)
        {
            applying = null;
            var fetched = 0;
            foreach (var fetch in pending.Fetches)
            {
                var request = fetch.Value;
                if (request.result == UnityWebRequest.Result.Success && request.responseCode == 200)
                {
                    // The route serves the manifest's `data` field verbatim (base64
                    // as text), so it goes into the cache as it came.
                    Blobs[fetch.Key] = request.downloadHandler.text;
                    fetched++;
                }
                else
                {
                    // An image that does not arrive costs its own pixels, never
                    // the reload: the node paints its background, which is the
                    // placeholder the author wrote (ZAB-13).
                    Debug.LogWarning("[zabloo] dev mode: " + request.url + " answered " + request.responseCode + " (" + request.error + ")");
                }
                request.Dispose();
            }
            pending.Fetches.Clear();

            var json = DevPush.Rehydrate(pending.Envelope, Blobs);
            var views = Views();
            var written = new HashSet<string>();
            foreach (var view in views)
            {
                // The imported asset, kept in sync: edit mode and the next Play open
                // on this export. One write per asset, however many views share it.
                var asset = view.Envelope;
                if (asset != null)
                {
                    var path = AssetDatabase.GetAssetPath(asset);
                    if (!string.IsNullOrEmpty(path) && written.Add(path))
                    {
                        File.WriteAllText(path, json);
                        AssetDatabase.ImportAsset(path);
                    }
                }
                // The live hot-swap, through the same call a platform hot-update
                // makes. Data the game pushed lives on the document, so it survives
                // the swap without anyone replaying it.
                if (EditorApplication.isPlaying && view.isActiveAndEnabled) view.Reload(json);
            }
            nudgeTicks = 10;
            EditorApplication.QueuePlayerLoopUpdate();

            var assets = fetched > 0 ? fetched + " asset(s) fetched" : "no new assets";
            var files = written.Count > 0 ? ", " + written.Count + " asset file(s) rewritten" : "";
            var reloaded = EditorApplication.isPlaying ? "reloaded " + views.Length + " view(s)" : views.Length + " view(s) in the scene, not playing";
            Debug.Log("[zabloo] dev mode: " + reloaded + ", " + assets + files);

            if (next != null)
            {
                var queued = next;
                next = null;
                Begin(queued);
            }
        }

        static void Abandon(Pending pending)
        {
            if (pending == null) return;
            foreach (var fetch in pending.Fetches) fetch.Value.Dispose();
            pending.Fetches.Clear();
        }

        /// <summary>Every <see cref="ZablooView"/> in the open scenes, inactive ones included: their asset is kept in sync even while they are off.</summary>
        static ZablooView[] Views()
        {
            return UnityEngine.Object.FindObjectsByType<ZablooView>(FindObjectsInactive.Include, FindObjectsSortMode.None);
        }
    }
}
