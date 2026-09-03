namespace Zabloo
{
    /// <summary>
    /// One line the loader had to say about a payload — the format's
    /// <c>Diagnostic</c> (<c>docs/format/loading.md</c>). The <see cref="Code"/> is
    /// the contract: the same input produces the same code here, in the web
    /// renderer and in Godot; the message is for a human.
    /// </summary>
    public readonly struct Diagnostic
    {
        /// <summary>The stable code every SDK emits for the same input (<c>unsupported-version</c>, <c>invalid-node</c>…).</summary>
        public readonly string Code;

        /// <summary>Where in the envelope (<c>views["hud"].children[2].text</c>), or null for the envelope itself.</summary>
        public readonly string Path;

        /// <summary>The human-readable reason.</summary>
        public readonly string Message;

        /// <summary>True when the payload was refused; false for a warning that was repaired and loaded without the broken part.</summary>
        public readonly bool Fatal;

        public Diagnostic(string code, string path, string message, bool fatal)
        {
            Code = code;
            Path = path;
            Message = message;
            Fatal = fatal;
        }

        /// <summary>The line the console shows: <c>[zabloo] code (path): message</c>.</summary>
        public override string ToString()
        {
            return Path == null
                ? "[zabloo] " + Code + ": " + Message
                : "[zabloo] " + Code + " (" + Path + "): " + Message;
        }
    }
}
