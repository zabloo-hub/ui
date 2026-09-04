using System.Collections.Generic;
using Zabloo.Json;

namespace Zabloo.Editor
{
    /// <summary>
    /// The half of a dev push that needs no editor: what the CLI sent, which asset
    /// bytes it left out, and the complete envelope once they are back.
    ///
    /// `zabloo dev` pushes the envelope THIN — its asset manifest without the
    /// `data` fields — plus the address the bytes can be fetched from, so a save
    /// that changed one `.tsx` moves a few KB in a project with megabytes of PNGs.
    /// What is missing is fetched by content hash and kept, so the same image is
    /// transferred once no matter how many reloads follow (ZAB-14, G14). The
    /// rehydrated envelope is what reaches <c>ZablooView.Reload</c> and what is
    /// written back to the imported asset: the loader ALWAYS receives a complete
    /// envelope, which is the one loading path every SDK shares.
    ///
    /// Kept apart from <see cref="ZablooDevServer"/> so it can be tested without
    /// Unity (<c>Tests/Editor/DevPushTests.cs</c>): the rules here are the same
    /// ones the Godot receiver applies in GDScript, and they are the part that
    /// decides whether N reloads cost one transfer or N.
    /// </summary>
    internal static class DevPush
    {
        /// <summary>
        /// Parses a pushed envelope. <c>false</c> when the body is not a JSON
        /// object — the CLI never sends one, so this is a wrong client, and it is
        /// answered rather than applied.
        /// </summary>
        internal static bool TryParse(string json, out Dictionary<string, object> envelope)
        {
            envelope = null;
            if (!JsonReader.TryParse(json, out var value)) return false;
            envelope = value as Dictionary<string, object>;
            return envelope != null;
        }

        /// <summary>
        /// The content hashes this envelope references and the cache does not hold,
        /// in manifest order, each once. An entry that carried its bytes anyway (a
        /// manual POST, an older CLI) is not missing: <see cref="Rehydrate"/> keeps it.
        /// </summary>
        internal static List<string> Missing(Dictionary<string, object> envelope, IDictionary<string, string> cache)
        {
            var missing = new List<string>();
            foreach (var entry in Entries(envelope))
            {
                if (!(entry["hash"] is string hash)) continue;
                if (entry.TryGetValue("data", out var inline) && inline is string) continue;
                if (cache.ContainsKey(hash) || missing.Contains(hash)) continue;
                missing.Add(hash);
            }
            return missing;
        }

        /// <summary>
        /// Puts the bytes back into the manifest from the cache and returns the
        /// complete envelope as JSON. Bytes a push carried inline are kept in the
        /// cache, so the next thin push about the same hash needs nothing; hashes the
        /// envelope stopped referencing are dropped from it — the cache tracks the
        /// content on screen, not everything ever seen, exactly as the adapter drops
        /// the texture behind an image the envelope no longer names (ZAB-12).
        ///
        /// A hash still missing after the fetches (the preview server did not answer)
        /// stays without `data`: that image costs its own pixels, never the reload —
        /// the node paints the background that IS its placeholder (ZAB-13).
        /// </summary>
        internal static string Rehydrate(Dictionary<string, object> envelope, IDictionary<string, string> cache)
        {
            var referenced = new HashSet<string>();
            foreach (var entry in Entries(envelope))
            {
                if (!(entry["hash"] is string hash)) continue;
                referenced.Add(hash);
                if (entry.TryGetValue("data", out var inline) && inline is string bytes)
                {
                    cache[hash] = bytes;
                }
                else if (cache.TryGetValue(hash, out var cached))
                {
                    entry["data"] = cached;
                }
            }
            var stale = new List<string>();
            foreach (var hash in cache.Keys)
            {
                if (!referenced.Contains(hash)) stale.Add(hash);
            }
            foreach (var hash in stale)
            {
                cache.Remove(hash);
            }
            return JsonWriter.Write(envelope);
        }

        /// <summary>The manifest's entries that have the shape of one: an object with a string `hash`.</summary>
        static IEnumerable<Dictionary<string, object>> Entries(Dictionary<string, object> envelope)
        {
            if (!envelope.TryGetValue("assets", out var assets) || !(assets is Dictionary<string, object> manifest)) yield break;
            foreach (var value in manifest.Values)
            {
                if (value is Dictionary<string, object> entry && entry.ContainsKey("hash")) yield return entry;
            }
        }
    }
}
