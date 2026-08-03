using System;
using Newtonsoft.Json.Linq;

namespace Zabloo.Format
{
    /// <summary>Raised when content cannot be consumed (e.g. major version mismatch).</summary>
    public sealed class ZablooContentException : Exception
    {
        public ZablooContentException(string message) : base(message) { }
    }

    /// <summary>
    /// The single loading path: every input is a versioned payload, whether it comes
    /// from a manually imported JSON or (later) a platform hot-update.
    ///
    /// Forward-tolerant rules (decision 2026-08-01): unknown props are ignored
    /// (Newtonsoft default), unknown node types render a fallback (see ZablooView),
    /// and loading refuses ONLY on a major-version mismatch.
    /// </summary>
    public static class EnvelopeLoader
    {
        public static Envelope Parse(string json)
        {
            JObject root;
            try
            {
                root = JObject.Parse(json);
            }
            catch (Exception e)
            {
                throw new ZablooContentException($"zabloo envelope: invalid JSON — {e.Message}");
            }

            var version = root["v"];
            if (version == null || (version.Type != JTokenType.Integer && version.Type != JTokenType.Float))
            {
                throw new ZablooContentException("zabloo envelope: missing numeric `v` field");
            }
            if ((int)version != ZablooSdk.IrVersion)
            {
                throw new ZablooContentException(
                    $"zabloo envelope: content is IR v{(int)version} but this SDK implements v{ZablooSdk.IrVersion}");
            }

            var envelope = root.ToObject<Envelope>();
            if (envelope?.views == null || envelope.views.Count == 0)
            {
                throw new ZablooContentException("zabloo envelope: missing or empty `views` map");
            }
            return envelope;
        }
    }
}
