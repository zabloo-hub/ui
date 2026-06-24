using System.Text;
using Newtonsoft.Json.Linq;

namespace Zabloo.Editor
{
    public static class IrToUxml
    {
        // Lee la IR resuelta y baja el Button a UXML + USS de UI Toolkit.
        public static (string uxml, string uss) Convert(string irJson)
        {
            var root = (JObject)JObject.Parse(irJson)["root"];
            string id = (string)root["id"];
            string cls = "zb-" + id;
            var layout = (JObject)root["layout"];
            var style = (JObject)root["style"];

            // Decisión de lowering (Unity): el Button nativo de UI Toolkit tiene `text`,
            // así que colapsamos el Label hijo de texto simple en text + color del botón
            // (no generamos un <ui:Label> anidado).
            string text = "";
            string textColor = "#ffffff";
            foreach (var child in (JArray)root["children"])
            {
                if ((string)child["type"] == "Label")
                {
                    text = (string)child["text"];
                    textColor = (string)child["style"]["color"];
                    break;
                }
            }

            var uxml = new StringBuilder();
            uxml.AppendLine("<ui:UXML xmlns:ui=\"UnityEngine.UIElements\">");
            uxml.AppendLine("  <Style src=\"Button.uss\" />");
            uxml.AppendLine($"  <ui:Button name=\"{id}\" text=\"{text}\" class=\"{cls}\" />");
            uxml.AppendLine("</ui:UXML>");

            int px = (int)layout["paddingX"];
            int py = (int)layout["paddingY"];
            string bg = (string)style["background"];
            int radius = (int)style["radius"];
            string align = (string)layout["alignItems"];

            var uss = new StringBuilder();
            uss.AppendLine($".{cls} {{");
            uss.AppendLine($"  padding-left: {px}px; padding-right: {px}px;");
            uss.AppendLine($"  padding-top: {py}px; padding-bottom: {py}px;");
            uss.AppendLine($"  align-items: {align};");
            uss.AppendLine($"  background-color: {bg};");
            uss.AppendLine($"  border-radius: {radius}px;");
            uss.AppendLine($"  color: {textColor};");
            uss.AppendLine("}");

            var hover = style["states"]?["hover"];
            if (hover != null)
            {
                string hbg = (string)hover["background"];
                uss.AppendLine($".{cls}:hover {{ background-color: {hbg}; }}");
            }

            return (uxml.ToString(), uss.ToString());
        }
    }
}
