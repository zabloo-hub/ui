using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;
using Zabloo;

namespace Zabloo.Playground.EditorTools
{
    /// <summary>
    /// One-click setup for the Button vertical slice:
    ///  - "Import Envelope" copies hello-button's exported IR into Assets (v1 dev
    ///    workflow: `zabloo export` → manual import; same loader path as hot-update).
    ///  - "Set Up Scene" creates PanelSettings + a GameObject with UIDocument +
    ///    ZablooDocument wired to the imported envelope.
    /// </summary>
    public static class ButtonSliceSceneSetup
    {
        const string SourceRelative = "../hello-button/dist/zabloo.ir.json";
        const string AssetDir = "Assets/Slice";
        const string EnvelopeAsset = AssetDir + "/zabloo.ir.json";
        const string PanelSettingsAsset = AssetDir + "/SlicePanelSettings.asset";

        [MenuItem("Zabloo/Button Slice/Import Envelope (from hello-button)")]
        public static void ImportEnvelope()
        {
            var projectRoot = Path.GetDirectoryName(Application.dataPath);
            var source = Path.GetFullPath(Path.Combine(projectRoot, "..", "hello-button", "dist", "zabloo.ir.json"));
            if (!File.Exists(source))
            {
                Debug.LogError($"[zabloo slice] Envelope not found: {source}\nRun `pnpm export` in examples/hello-button first.");
                return;
            }
            Directory.CreateDirectory(Path.Combine(projectRoot, AssetDir));
            File.Copy(source, Path.Combine(projectRoot, EnvelopeAsset), overwrite: true);
            AssetDatabase.ImportAsset(EnvelopeAsset);
            Debug.Log($"[zabloo slice] Imported envelope → {EnvelopeAsset}");
        }

        [MenuItem("Zabloo/Button Slice/Set Up Scene")]
        public static void SetUpScene()
        {
            var envelope = AssetDatabase.LoadAssetAtPath<TextAsset>(EnvelopeAsset);
            if (envelope == null)
            {
                ImportEnvelope();
                envelope = AssetDatabase.LoadAssetAtPath<TextAsset>(EnvelopeAsset);
                if (envelope == null) return;
            }

            var panelSettings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsAsset);
            if (panelSettings == null)
            {
                panelSettings = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panelSettings, PanelSettingsAsset);
                AssetDatabase.SaveAssets();
            }

            var go = new GameObject("ZablooButtonSlice");
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = panelSettings;

            var zabloo = go.AddComponent<ZablooDocument>();
            var so = new SerializedObject(zabloo);
            so.FindProperty("_envelope").objectReferenceValue = envelope;
            so.FindProperty("_view").stringValue = "main-menu";
            so.ApplyModifiedPropertiesWithoutUndo();

            Undo.RegisterCreatedObjectUndo(go, "Set Up Button Slice Scene");
            Selection.activeGameObject = go;
            Debug.Log("[zabloo slice] Scene ready — press Play and click the button (watch for `action: buy`).");
        }
    }
}
