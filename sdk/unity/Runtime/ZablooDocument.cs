using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;
using Zabloo.Format;

namespace Zabloo
{
    /// <summary>
    /// Scene entry point: attach next to a UIDocument, assign an exported envelope
    /// (a .json TextAsset from `zabloo export`) and a view ID.
    ///
    /// The document is the game's stable handle; the view is disposable:
    /// <see cref="Reload"/> swaps content through the single loader path (manual
    /// import, `zabloo dev` push and production hot-update are the same payload),
    /// keeping <see cref="OnAction"/> subscriptions and replaying pushed data.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class ZablooDocument : MonoBehaviour
    {
        [SerializeField] TextAsset _envelope;
        [SerializeField] string _view = "main-menu";
        [Tooltip("Log actions to the console (handy while developing).")]
        [SerializeField] bool _logActions = true;

        /// <summary>Fires with the action name declared in the IR (e.g. "buy").</summary>
        public event Action<string> OnAction;

        /// <summary>The live view (e.g. for `View.SetOpen`); null before OnEnable.</summary>
        public ZablooView View => _viewElement;

        /// <summary>The assigned envelope asset (used by the editor dev mode).</summary>
        public TextAsset EnvelopeAsset => _envelope;

        ZablooView _viewElement;
        readonly Dictionary<string, object> _dataCache = new Dictionary<string, object>();

        /// <summary>
        /// Pushes game data at a path ("player.gold"). Cached on the document and
        /// replayed into every (re)loaded view, so hot-swapped content stays bound.
        /// </summary>
        public void SetData(string path, object value)
        {
            _dataCache[path] = value;
            _viewElement?.SetData(path, value);
        }

        /// <summary>
        /// Loads (or hot-swaps) a versioned envelope. On invalid content the current
        /// view is kept and the error logged. Returns true on success.
        /// </summary>
        public bool Reload(string envelopeJson)
        {
            ZablooView newView;
            try
            {
                var envelope = EnvelopeLoader.Parse(envelopeJson);
                newView = new ZablooView(envelope, _view);
            }
            catch (ZablooContentException e)
            {
                Debug.LogError($"[zabloo] {e.Message}", this);
                return false;
            }

            _viewElement?.RemoveFromHierarchy();
            _viewElement = newView;
            _viewElement.OnAction += Dispatch;
            foreach (var entry in _dataCache)
            {
                _viewElement.SetData(entry.Key, entry.Value);
            }

            var root = GetComponent<UIDocument>().rootVisualElement;
            root.style.flexGrow = 1;
            root.Add(_viewElement);
            return true;
        }

        void OnEnable()
        {
            if (_envelope == null)
            {
                Debug.LogError("[zabloo] ZablooDocument has no envelope assigned.", this);
                return;
            }
            Reload(_envelope.text);
        }

        void OnDisable()
        {
            _viewElement?.RemoveFromHierarchy();
            _viewElement = null;
        }

        void Dispatch(string action)
        {
            if (_logActions) Debug.Log($"[zabloo] action: {action}");
            OnAction?.Invoke(action);
        }
    }
}
