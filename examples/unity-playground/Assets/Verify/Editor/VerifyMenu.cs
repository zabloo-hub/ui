using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;
using Zabloo;

namespace Zabloo.Verify
{
    /// <summary>
    /// <c>Zabloo › Verify › …</c>: builds the throwaway scene for one capability
    /// and leaves it open, unsaved, ready for Play. A scene is built rather than
    /// stored because a <c>.unity</c> file authored by hand is a YAML document
    /// Unity is free to reject on open, and one authored by Unity is a diff
    /// nobody can review; ten lines of C# are both.
    ///
    /// Every scene is the playground's shape — a Screen Space – Overlay
    /// <c>Canvas</c>, a <c>ZablooView</c> stretched over it, no
    /// <c>EventSystem</c> — with a <see cref="VerifyRig"/> standing in for the
    /// game. The golden capture is the one exception: a 480×320 view on a
    /// constant-pixel canvas, so a captured pixel is a view pixel.
    /// </summary>
    public static class VerifyMenu
    {
        const string Menu = "Zabloo/Verify/";

        [MenuItem(Menu + "Render (UN4)")]
        static void Render() => Build(VerifyRig.Capability.Render, "settings-screen", "settings");

        [MenuItem(Menu + "Pointer & keyboard (UN5)")]
        static void PointerKeyboard() => Build(VerifyRig.Capability.PointerKeyboard, "settings-screen", "settings");

        [MenuItem(Menu + "Gamepad (UN6)")]
        static void Gamepad() => Build(VerifyRig.Capability.Gamepad, "settings-screen", "settings");

        [MenuItem(Menu + "Host channel (UN7)")]
        static void HostChannel() => Build(VerifyRig.Capability.HostChannel, "settings-screen", "settings");

        [MenuItem(Menu + "Dev loop (UN8)")]
        static void DevLoop() => Build(VerifyRig.Capability.DevLoop, "showcase", "media");

        [MenuItem(Menu + "Golden capture: text-wrap at 480×320 (UN10)")]
        static void GoldenCapture()
        {
            var rig = Build(VerifyRig.Capability.GoldenCapture, "", "", stretch: false);
            var so = new SerializedObject(rig);
            so.FindProperty("envelopePath").stringValue = "../../golden/envelopes/text-wrap.json";
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static VerifyRig Build(VerifyRig.Capability capability, string source, string viewId, bool stretch = true)
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return null;
            EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var canvasObject = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler));
            var canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            if (stretch)
            {
                // The playground's own scaler: a 960×600 reference.
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                scaler.referenceResolution = new Vector2(960f, 600f);
            }
            else
            {
                // A capture is compared 1:1 with the other targets' 480×320: one
                // canvas unit is one device pixel, whatever the Game view's size.
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
                scaler.scaleFactor = 1f;
            }

            var host = new GameObject("Zabloo", typeof(RectTransform));
            host.transform.SetParent(canvasObject.transform, false);
            var rect = (RectTransform)host.transform;
            if (stretch)
            {
                rect.anchorMin = Vector2.zero;
                rect.anchorMax = Vector2.one;
                rect.offsetMin = Vector2.zero;
                rect.offsetMax = Vector2.zero;
            }
            else
            {
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.sizeDelta = new Vector2(480f, 320f);
            }
            var view = host.AddComponent<ZablooView>();

            var rigObject = new GameObject("Verify", typeof(VerifyRig));
            var rig = rigObject.GetComponent<VerifyRig>();
            var so = new SerializedObject(rig);
            so.FindProperty("capability").enumValueIndex = (int)capability;
            so.FindProperty("view").objectReferenceValue = view;
            so.FindProperty("source").stringValue = source;
            so.FindProperty("viewId").stringValue = viewId;
            so.ApplyModifiedPropertiesWithoutUndo();

            Selection.activeGameObject = rigObject;
            Debug.Log($"[verify] scene for {capability} built — press Play; the checklist prints in the Console, the full procedure is in the README (§ Checking UN10 by hand)");
            return rig;
        }
    }
}
