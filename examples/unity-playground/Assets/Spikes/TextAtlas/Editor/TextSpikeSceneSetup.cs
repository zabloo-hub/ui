using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Spikes.EditorTools
{
    /// <summary>
    /// One-click scene setup for the text spike: creates a PanelSettings asset
    /// (the ScriptableObject a UIDocument needs to know how to render — resolution,
    /// scaling, target display) and a GameObject wired with UIDocument + the spike.
    /// </summary>
    public static class TextSpikeSceneSetup
    {
        const string PanelSettingsPath = "Assets/Spikes/TextAtlas/SpikePanelSettings.asset";

        [MenuItem("Zabloo/Set Up Text Spike Scene")]
        public static void SetUp()
        {
            var panelSettings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsPath);
            if (panelSettings == null)
            {
                panelSettings = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panelSettings, PanelSettingsPath);
                AssetDatabase.SaveAssets();
            }

            var go = new GameObject("ZablooTextSpike");
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = panelSettings;
            go.AddComponent<ZablooTextSpike>();

            Undo.RegisterCreatedObjectUndo(go, "Set Up Text Spike Scene");
            Selection.activeGameObject = go;

            Debug.Log("[zabloo spike] Scene ready — press Play to run the text spike.");
        }
    }
}
