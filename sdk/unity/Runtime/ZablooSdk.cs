namespace Zabloo
{
    /// <summary>
    /// Entry point of the zabloo SDK. Loads versioned IR envelopes and renders them
    /// via UI Toolkit custom geometry. Skeleton stub — the loader, the Yoga-subset
    /// layout pass and the tessellator land with the vertical slice.
    /// </summary>
    public static class ZablooSdk
    {
        /// <summary>Major IR version this SDK implements (see @zabloo/format).</summary>
        public const int IrVersion = 1;

        public const string Version = "0.1.0";
    }
}
