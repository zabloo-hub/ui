using UnityEngine;
using Zabloo;

namespace Zabloo.Playground
{
    /// <summary>
    /// Plays the role of "the game" in the slice: subscribes to zabloo actions and
    /// pushes data into the view. Buying costs 100 gold — the bound Text updates
    /// and the thank-you row (visible bound to shop.thanked) appears.
    /// </summary>
    [RequireComponent(typeof(ZablooDocument))]
    public sealed class SliceDemoDriver : MonoBehaviour
    {
        [SerializeField] int _gold = 1000;

        ZablooDocument _doc;

        void Start() // Start (not OnEnable): runs after ZablooDocument built the view
        {
            _doc = GetComponent<ZablooDocument>();
            _doc.OnAction += OnZablooAction;
            _doc.View?.SetData("player.gold", _gold);
        }

        void OnDestroy()
        {
            if (_doc != null) _doc.OnAction -= OnZablooAction;
        }

        void OnZablooAction(string action)
        {
            if (action != "buy") return;
            _gold -= 100;
            _doc.View.SetData("player.gold", _gold);
            _doc.View.SetData("shop.thanked", true);
        }
    }
}
