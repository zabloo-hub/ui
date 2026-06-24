using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Editor
{
    public class ImportIrWindow : EditorWindow
    {
        private string _irPath = "";

        [MenuItem("zabloo/Import IR…")]
        public static void Open() => GetWindow<ImportIrWindow>("Zabloo Import IR");

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Ruta del button.ir.json");
            using (new EditorGUILayout.HorizontalScope())
            {
                _irPath = EditorGUILayout.TextField(_irPath);
                if (GUILayout.Button("…", GUILayout.Width(28)))
                {
                    var picked = EditorUtility.OpenFilePanel("Selecciona button.ir.json", "", "json");
                    if (!string.IsNullOrEmpty(picked)) _irPath = picked;
                }
            }
            using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(_irPath) || !File.Exists(_irPath)))
            {
                if (GUILayout.Button("Importar")) Import(_irPath);
            }
        }

        private static void Import(string irPath)
        {
            string irJson = File.ReadAllText(irPath);
            var (uxml, uss) = IrToUxml.Convert(irJson);

            const string dir = "Assets/Zabloo";
            Directory.CreateDirectory(dir);
            File.WriteAllText($"{dir}/Button.uxml", uxml);
            File.WriteAllText($"{dir}/Button.uss", uss);
            File.WriteAllText($"{dir}/Button.binding.cs",
                "// Stub generado por zabloo (PoC). Wiring de onClick:\n" +
                "// root.Q<UnityEngine.UIElements.Button>(\"buy-btn\").clicked += () => OnBuy();\n");
            AssetDatabase.Refresh();

            CreateSample($"{dir}/Button.uxml", dir);
            EditorUtility.DisplayDialog("Zabloo", "IR importada en Assets/Zabloo.", "OK");
        }

        // Crea un UIDocument en la escena activa para ver el botón al instante.
        private static void CreateSample(string uxmlAssetPath, string dir)
        {
            var vta = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(uxmlAssetPath);

            string panelPath = $"{dir}/ZablooPanelSettings.asset";
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(panelPath);
            if (panel == null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panel, panelPath);
                AssetDatabase.SaveAssets();
            }

            var existing = GameObject.Find("ZablooSample");
            if (existing != null) Object.DestroyImmediate(existing);

            var go = new GameObject("ZablooSample");
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = panel;
            doc.visualTreeAsset = vta;
            Selection.activeGameObject = go;
        }
    }
}
