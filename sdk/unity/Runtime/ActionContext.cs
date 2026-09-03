namespace Zabloo
{
    /// <summary>
    /// Where an action came from: the item of a <c>Repeat</c> it fired inside, or
    /// nothing when it fired from the document itself. The <c>ActionContext</c> of
    /// the format (ZAB-29), as a struct — <c>default</c> is the empty one.
    ///
    /// It describes the INNERMOST item, and that is enough for nested lists:
    /// <see cref="Path"/> already carries the outer indices
    /// (<c>shop.cats.2.items.5</c>). Being an address, it is also what the game
    /// writes back through with <c>SetData</c>.
    /// </summary>
    public readonly struct ActionContext
    {
        readonly int index;

        /// <summary>The item's absolute data path (<c>shop.items.3</c>), or null.</summary>
        public readonly string Path;

        /// <summary>
        /// The item's raw key when the <c>Repeat</c> declares one: a <c>string</c>,
        /// or a number as <c>long</c> (integral) or <c>double</c>. Null when the
        /// list identifies its rows by position.
        /// </summary>
        public readonly object Key;

        /// <summary>The item's index in its array, or -1 without a context.</summary>
        public int Index => Path == null ? -1 : index;

        /// <summary>True for an action fired from inside a repeated item.</summary>
        public bool HasContext => Path != null;

        public ActionContext(string path, object key, int index)
        {
            Path = path;
            Key = key;
            this.index = index;
        }

        public override string ToString()
        {
            return HasContext ? "{path " + Path + ", key " + (Key ?? "none") + ", index " + Index + "}" : "{}";
        }
    }
}
