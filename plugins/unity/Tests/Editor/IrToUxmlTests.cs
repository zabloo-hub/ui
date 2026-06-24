using NUnit.Framework;
using Zabloo.Editor;

public class IrToUxmlTests
{
    const string Ir = @"{
      ""version"": ""0.0.1-poc"",
      ""root"": {
        ""type"": ""Button"", ""id"": ""buy-btn"", ""variant"": ""primary"",
        ""layout"": { ""paddingX"": 16, ""paddingY"": 8, ""alignItems"": ""center"" },
        ""style"": { ""background"": ""#4f46e5"", ""radius"": 8,
          ""states"": { ""hover"": { ""background"": ""#4338ca"" } } },
        ""actions"": { ""onClick"": ""buy"" },
        ""children"": [ { ""type"": ""Label"", ""text"": ""Buy"", ""style"": { ""color"": ""#ffffff"" } } ]
      }
    }";

    [Test]
    public void Convert_EmitsButtonUxmlWithNameTextAndClass()
    {
        var (uxml, _) = IrToUxml.Convert(Ir);
        StringAssert.Contains("<ui:Button", uxml);
        StringAssert.Contains("name=\"buy-btn\"", uxml);
        StringAssert.Contains("text=\"Buy\"", uxml);
        StringAssert.Contains("class=\"zb-buy-btn\"", uxml);
        StringAssert.Contains("src=\"Button.uss\"", uxml);
    }

    [Test]
    public void Convert_EmitsUssWithResolvedStyleAndHover()
    {
        var (_, uss) = IrToUxml.Convert(Ir);
        StringAssert.Contains("padding-left: 16px", uss);
        StringAssert.Contains("padding-top: 8px", uss);
        StringAssert.Contains("background-color: #4f46e5", uss);
        StringAssert.Contains("border-radius: 8px", uss);
        StringAssert.Contains("color: #ffffff", uss);
        StringAssert.Contains(".zb-buy-btn:hover", uss);
        StringAssert.Contains("background-color: #4338ca", uss);
    }
}
