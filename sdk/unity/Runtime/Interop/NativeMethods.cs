// The C ABI, transcribed (UN2, ZAB-195).
//
// This file is `core/capi/zabloo.h` in C#, field by field and function by
// function, and NOTHING else: no logic, no wrappers, no defaults. The header is
// the contract; this is its spelling on the managed side. When the header gains
// a function or a struct gains a field, this file gains the same line — and
// `zb_abi_sizes` is what catches the two drifting apart (asserted from C# by the
// ABI size tests, UN10): a field missing, mistyped or misaligned on either side
// changes a struct's size before it changes any corpus metric.
//
// Three rules the header fixes, repeated here because the reader of this file
// is the one who has to honour them:
//
//   * Strings are UTF-8 with an EXPLICIT length. Going in: a `byte*` and a
//     `nuint` (encode with `Encoding.UTF8`, no NUL needed). Coming out: a
//     `ZbStr` — pointer and length, also NUL-terminated as a courtesy.
//   * Every pointer the core hands out has a LIFETIME written on the function
//     that hands it out. The rule of thumb: what `zb_view_paint` returns is
//     good until the next paint; an atlas's pixels until the next
//     `zb_view_layout_frame` or paint; a diagnostic's strings until the next
//     `zb_document_load`; a drained array until the next drain of the same
//     kind. Reading them as `NativeArray` views without a copy is the point.
//   * ONE thread: everything on a document, its view and its pad happens on
//     the thread that created the document. No callbacks ever come back from
//     native code — everything the core produces is DRAINED after the frame.
//
// `unsafe` because the batches are raw arrays the core owns; the assembly
// definition allows it (UN3).

using System;
using System.Runtime.InteropServices;

namespace Zabloo.Sdk.Interop
{
    /// <summary>`zb_str`: a string coming OUT of the core. UTF-8, `Len` bytes, NUL-terminated too.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbStr
    {
        public IntPtr Data;
        public nuint Len;
    }

    /// <summary>`zb_clip`: a clipping region. `Radius` 0 means square corners.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbClip
    {
        public double X;
        public double Y;
        public double Width;
        public double Height;
        public double Radius;
    }

    /// <summary>`ZB_TEXTURE_*`: what a batch's texture handle points at.</summary>
    public enum ZbTextureKind : int
    {
        None = 0,
        /// <summary>A glyph atlas: `zb_view_atlas_info` finds it by handle. LA8 pixels.</summary>
        Glyphs = 1,
        /// <summary>A manifest image: `zb_view_image_info` finds it by handle. Encoded bytes.</summary>
        Image = 2,
    }

    /// <summary>
    /// `zb_batch`: one draw call — a run of triangles sharing a texture and a clip
    /// region. `Positions` is `x, y` per vertex, `Uvs` is `u, v`, `Colors` is
    /// `r, g, b, a` with the inherited opacity already in the alpha. Valid until
    /// the next `zb_view_paint` on the same view, or the next `zb_document_load`.
    /// Group by `Group` (the ordinal), never by the region: two adjacent groups may
    /// share a region and still have to be drawn one after the other.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public unsafe struct ZbBatch
    {
        public float* Positions;
        public float* Uvs;
        public float* Colors;
        public uint* Indices;
        public uint VertexCount;
        public uint IndexCount;
        /// <summary>Atlas or image handle, or null for untextured geometry (every solid).</summary>
        public IntPtr Texture;
        public ZbTextureKind TextureKind;
        /// <summary>The region to scissor to (and, with a radius, discard corners of), or null.</summary>
        public ZbClip* Clip;
        public uint Group;
    }

    /// <summary>`zb_frame`: a painted frame, `BatchCount` batches in draw order. Empty batches are not listed.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public unsafe struct ZbFrame
    {
        public ZbBatch* Batches;
        public uint BatchCount;
    }

    /// <summary>`zb_atlas_info`: one live glyph atlas.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public unsafe struct ZbAtlasInfo
    {
        /// <summary>What a `ZbBatch.Texture` of kind `Glyphs` names.</summary>
        public IntPtr Handle;
        /// <summary>Bumped every time the pixels change: re-upload when it moved.</summary>
        public uint Version;
        /// <summary>Side in pixels. Square, a power of two, and it can GROW (then re-create).</summary>
        public int Size;
        /// <summary>
        /// `Size * Size * 2` bytes, LA8 row-major: luminance always 255, alpha is the
        /// coverage. Valid until the next `zb_view_layout_frame` or `zb_view_paint`.
        /// </summary>
        public byte* Pixels;
        public nuint PixelBytes;
    }

    /// <summary>
    /// `zb_image_info`: one manifest image the view has resolved. The core carries
    /// the ENCODED bytes and decodes nothing; key the texture by `Hash`.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public unsafe struct ZbImageInfo
    {
        /// <summary>What a `ZbBatch.Texture` of kind `Image` names.</summary>
        public IntPtr Handle;
        public ZbStr Hash;
        /// <summary>`image/png`, `image/jpeg`… as the manifest declared it.</summary>
        public ZbStr Mime;
        /// <summary>
        /// The encoded file. Valid until the next `zb_view_paint` (which sweeps assets
        /// the frame no longer references) or the next `zb_document_load`.
        /// </summary>
        public byte* Bytes;
        public nuint ByteCount;
        /// <summary>Intrinsic size from the manifest; 0 when it carried none.</summary>
        public double Width;
        public double Height;
    }

    /// <summary>`ZB_KEY_*`: the keys a focused text field claims. Same order as the core's `EditKey`.</summary>
    public enum ZbEditKey : int
    {
        Other = 0,
        Left = 1,
        Right = 2,
        Home = 3,
        End = 4,
        Backspace = 5,
        Delete = 6,
        Submit = 7,
        Tab = 8,
        Space = 9,
        /// <summary>Ctrl/Cmd+A. Only meaningful with `Shortcut` set.</summary>
        SelectAll = 10,
    }

    /// <summary>`zb_key_intent`: a keystroke as an INTENTION, not a platform event.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbKeyIntent
    {
        public ZbEditKey Key;
        public int Shift;
        /// <summary>Ctrl on most platforms, Cmd on macOS: the adapter decides which.</summary>
        public int Shortcut;
        /// <summary>The OS repeating a held key — a held Enter is not a second submission.</summary>
        public int Repeat;
    }

    /// <summary>
    /// `zb_pad_snapshot`: one poll's worth of a gamepad, in the STANDARD MAPPING's
    /// indices (A = 0, B = 1, d-pad = 12..15, left stick = axes 0/1, right stick =
    /// 2/3). Short arrays are fine: a missing index is not pressed / at rest.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public unsafe struct ZbPadSnapshot
    {
        /// <summary>One byte per button, non-zero = pressed.</summary>
        public byte* Buttons;
        public nuint ButtonCount;
        /// <summary>-1..1 per axis.</summary>
        public double* Axes;
        public nuint AxisCount;
    }

    /// <summary>`zb_action`: a named action leaving the UI for the game, with the item it fired from.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbAction
    {
        public ZbStr Name;
        /// <summary>The innermost `Repeat` item's path, or empty for an action from the document itself.</summary>
        public ZbStr ItemPath;
        public int HasKey;
        public int KeyIsNumber;
        public double KeyNumber;
        public ZbStr KeyText;
        /// <summary>The item's index in its array. Meaningless without `ItemPath`.</summary>
        public int Index;
    }

    /// <summary>`zb_data_change`: a control writing its own value back through a bound path.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbDataChange
    {
        public ZbStr Path;
        /// <summary>The value, as JSON: `true`, `0.35`, `"Sergi"`…</summary>
        public ZbStr ValueJson;
    }

    /// <summary>`zb_frame_stats`: what the last paint cost. Telemetry, not contract.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbFrameStats
    {
        public uint DrawCalls;
        public uint Vertices;
        public uint Indices;
        public uint Atlases;
        public ulong AtlasBytes;
        public uint Resolved;
        public uint TextLayouts;
        public uint BufferGrowths;
        public int RepaintOnly;
    }

    /// <summary>`ZB_DIAGNOSTIC_WARN` / `ZB_DIAGNOSTIC_FATAL`.</summary>
    public enum ZbDiagnosticLevel : int
    {
        Warn = 0,
        Fatal = 1,
    }

    /// <summary>`ZB_DIAGNOSTIC_*` codes — the core's `DiagnosticCode`, same order.</summary>
    public enum ZbDiagnosticCode : int
    {
        InvalidJson = 0,
        NotAnObject = 1,
        MissingVersion = 2,
        UnsupportedVersion = 3,
        MissingViews = 4,
        NoUsableViews = 5,
        InvalidTokens = 6,
        InvalidToken = 7,
        InvalidAssets = 8,
        InvalidAsset = 9,
        InvalidNode = 10,
        InvalidProp = 11,
        InvalidBinding = 12,
        TooDeep = 13,
        DuplicateId = 14,
        UnknownToken = 15,
        UnknownAsset = 16,
        UnknownAnchor = 17,
    }

    /// <summary>`zb_diagnostic`: what a load (or a view's build) found. `CodeName` is the wire spelling.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbDiagnostic
    {
        public ZbDiagnosticLevel Level;
        public ZbDiagnosticCode Code;
        public ZbStr CodeName;
        /// <summary>Where, as a path into the envelope. Empty is the envelope itself.</summary>
        public ZbStr Path;
        public ZbStr Message;
    }

    /// <summary>
    /// `zb_abi_size_table`: `sizeof` every struct above as the NATIVE build laid
    /// them out. Assert each against `Marshal.SizeOf` of its transcription here.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct ZbAbiSizeTable
    {
        public uint Str;
        public uint Clip;
        public uint Batch;
        public uint Frame;
        public uint AtlasInfo;
        public uint ImageInfo;
        public uint KeyIntent;
        public uint PadSnapshot;
        public uint Action;
        public uint DataChange;
        public uint FrameStats;
        public uint Diagnostic;
        public uint AbiSizeTable;
    }

    /// <summary>
    /// `core/capi/zabloo.h`, function by function. Handles (`zb_document *`,
    /// `zb_view *`, `zb_pad *`) are `IntPtr`s; the core's `int` answers are
    /// `int`s (1 = true, 0 = false); every string going in is `byte*` + `nuint`.
    /// </summary>
    public static unsafe class NativeMethods
    {
#if UNITY_IOS && !UNITY_EDITOR
        /// <summary>iOS links the core statically (`libzabloo.a`), so the symbols are in the player itself.</summary>
        public const string Lib = "__Internal";
#else
        /// <summary>`libzabloo.dylib` / `libzabloo.so` / `zabloo.dll`, under `Runtime/Plugins/`.</summary>
        public const string Lib = "zabloo";
#endif

        #region The library

        /// <summary>The version this binary was built as — the npm `fixed` group's. Static, valid forever.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr zb_version();

        /// <summary>Fills `sizes` with the sizes of every ABI struct.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_abi_sizes(out ZbAbiSizeTable sizes);

        #endregion

        #region The document

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr zb_document_create();

        /// <summary>Destroys the document, its view and everything they handed out. Null is fine.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_document_destroy(IntPtr doc);

        /// <summary>
        /// The one loading path. A payload the core refuses leaves the previous one ON
        /// SCREEN and returns 0; `zb_document_diagnostic` says why.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_document_load(IntPtr doc, byte* json, nuint jsonLen);

        /// <summary>1 once an envelope has loaded — a refused one does not count.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_document_loaded(IntPtr doc);

        /// <summary>Shows a view by id. 0 if this envelope has no such view; nothing changes then.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_document_show(IntPtr doc, byte* viewId, nuint viewIdLen);

        /// <summary>
        /// The view on screen, or null before the first successful load. The handle is
        /// stable for the document's life: a load or a show swaps the view underneath it.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr zb_document_view(IntPtr doc);

        /// <summary>Diagnostics of the last load, whether it took or not.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern uint zb_document_diagnostic_count(IntPtr doc);

        /// <summary>The i-th diagnostic, worst first. 0 for an index out of range. Strings valid until the next load.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_document_diagnostic(IntPtr doc, uint index, out ZbDiagnostic diagnostic);

        /// <summary>
        /// The game→UI data channel: `valueJson` is any JSON value, and a bound path
        /// is an ADDRESS into what was pushed. Returns 0 and writes NOTHING when
        /// `valueJson` is not valid JSON.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_document_set_data_json(
            IntPtr doc, byte* path, nuint pathLen, byte* valueJson, nuint valueJsonLen);

        #endregion

        #region The view: size, clock, frames

        /// <summary>The viewport the tree is laid out against, in view-space units.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_view_set_size(IntPtr view, double width, double height);

        /// <summary>The clock every tween reads, in milliseconds. Give it a monotonic engine clock; ignore delta time.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_view_set_now(IntPtr view, double milliseconds);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern double zb_view_now(IntPtr view);

        /// <summary>Resolve → measure → arrange. Everything geometric happens here.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_view_layout_frame(IntPtr view);

        /// <summary>Whether the last frame left anything moving. Ask for the next frame while 1.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_animating(IntPtr view);

        /// <summary>
        /// Tessellates the arranged tree into `frame`. Paint FIRST, then sweep the
        /// atlases: a text field rasterizes its glyphs while painting. Valid until
        /// the next paint on this view or the next load.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_view_paint(IntPtr view, out ZbFrame frame);

        /// <summary>The live glyph atlases, least recently used first. At most eight.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern uint zb_view_atlas_count(IntPtr view);

        /// <summary>0 for an index out of range.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_atlas_info(IntPtr view, uint index, out ZbAtlasInfo atlas);

        /// <summary>The manifest images the view has resolved, in first-sight order.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern uint zb_view_image_count(IntPtr view);

        /// <summary>0 for an index out of range. Decodes the entry's base64 on first sight.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_image_info(IntPtr view, uint index, out ZbImageInfo image);

        /// <summary>
        /// What the engine decoded, for an image whose manifest carried no size. The
        /// manifest always wins; 1 when a gap was filled, which is the cue to lay out again.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_image_adopt_size(IntPtr view, IntPtr imageHandle, double width, double height);

        /// <summary>What building this view's runtime found. Strings valid until the next load or show.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern uint zb_view_warning_count(IntPtr view);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_warning(IntPtr view, uint index, out ZbDiagnostic diagnostic);

        #endregion

        #region Pointer

        // Each answers "did anything change?". `mouse` separates a cursor from a
        // finger: hover is a mouse state, so a touch must not leave a control lit up.

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_pointer_move(IntPtr view, double x, double y, int mouse);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_pointer_down(IntPtr view, double x, double y, int mouse);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_pointer_up(IntPtr view, double x, double y, int mouse);

        /// <summary>A wheel notch or a trackpad pan, in view-space pixels, at a point.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_pointer_wheel(IntPtr view, double x, double y, double dx, double dy);

        /// <summary>The pointer left the surface: whatever it held is released, nothing fires.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_pointer_exit(IntPtr view);

        /// <summary>The gesture ended without concluding: every hold dropped, nothing fires.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_pointer_cancel(IntPtr view);

        #endregion

        #region Keyboard, text entry and directional navigation

        /// <summary>The keys a focused text field claims; 1 if it consumed this one, 0 lets navigation run.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_edit_key(IntPtr view, in ZbKeyIntent intent);

        /// <summary>Text into the focused field: a keystroke's character, a paste. Honors `maxLength`.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_insert_text(IntPtr view, byte* text, nuint textLen);

        /// <summary>An IME composition. Each update REPLACES the previous; the game is not told.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_composition(IntPtr view, byte* text, nuint textLen);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_end_composition(IntPtr view);

        /// <summary>
        /// The focused field's selection, or empty. Valid until the next call on this
        /// view, or the next load. 1 when there is a selection.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_field_selection_text(IntPtr view, out ZbStr text);

        /// <summary>Moves the focus along a unit axis. 0 when nothing moved.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_move_focus(IntPtr view, double dx, double dy);

        /// <summary>Press (`down` = 1) / release (0) the focused node. Releasing activates.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_press_focused(IntPtr view, int down);

        /// <summary>Asks the modal that owns the input to close. 0 when no modal is up — that Escape is the game's.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_dismiss_top_modal(IntPtr view);

        /// <summary>Releases the focused node's press WITHOUT activating it — an unplugged pad.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_cancel_focused_press(IntPtr view);

        /// <summary>Scrolls the `ScrollView` the focus lives in, by a pixel delta.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_scroll_focused_by(IntPtr view, double dx, double dy);

        /// <summary>The arrow key adjusting a `Slider` was let go: the gesture ends and `onCommit` fires if the value moved.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_settle_slider_keys(IntPtr view);

        #endregion

        #region The host channel, by id

        // Each answers whether it FOUND the control: 0 means no node of that type
        // carries that id and nothing was applied. They are the player's gesture,
        // hooks included.

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_open(IntPtr view, byte* id, nuint idLen, int open);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_selected_tab(IntPtr view, byte* id, nuint idLen, int index);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_checked(IntPtr view, byte* id, nuint idLen, int isChecked);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_value(IntPtr view, byte* id, nuint idLen, double value);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_text(IntPtr view, byte* id, nuint idLen, byte* text, nuint textLen);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_set_scroll(IntPtr view, byte* id, nuint idLen, double x, double y);

        #endregion

        #region Draining what the last input produced

        /// <summary>
        /// Named actions since the last drain, in order. `actions` points at an array
        /// of the returned length, valid until the next drain of actions on this view
        /// or the next load. Drained means drained: each action is read exactly once.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern uint zb_view_drain_actions(IntPtr view, out ZbAction* actions);

        /// <summary>Values controls wrote back since the last drain. Same lifetime rule.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern uint zb_view_drain_data_changes(IntPtr view, out ZbDataChange* changes);

        #endregion

        #region Telemetry and the cross-target contract

        /// <summary>What the last paint cost. Zeros before one.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_view_stats(IntPtr view, out ZbFrameStats stats);

        /// <summary>
        /// The `ViewSnapshot` of the frame on screen, as the bytes a golden file holds.
        /// Valid until the next call on this view, or the next load.
        /// </summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_view_snapshot_json(IntPtr view, out ZbStr json);

        #endregion

        #region The gamepad

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr zb_pad_create();

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_pad_destroy(IntPtr pad);

        /// <summary>A pad arrived, at this instant (the scroll stick moves px per SECOND).</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void zb_pad_connect(IntPtr pad, double now);

        /// <summary>One poll: reads the snapshot and hands each intention to the view. 1 if anything changed.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_pad_poll(IntPtr pad, IntPtr view, in ZbPadSnapshot snapshot, double now);

        /// <summary>The pad went away: a press in flight CANCELS, a Slider being nudged SETTLES. `view` may be null.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_pad_disconnect(IntPtr pad, IntPtr view);

        /// <summary>Whether a direction is being held right now — the repeat clock is running.</summary>
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int zb_pad_holding(IntPtr pad);

        #endregion
    }
}
