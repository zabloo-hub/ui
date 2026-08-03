using System;
using UnityEngine;
using UnityEngine.UIElements;
using Zabloo.Format;

namespace Zabloo
{
    /// <summary>
    /// Scene entry point: attach next to a UIDocument, assign an exported envelope
    /// (a .json TextAsset from `zabloo export`) and a view ID. Named actions declared
    /// in the IR surface on <see cref="OnAction"/> — the game's only coupling point.
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

        ZablooView _viewElement;

        void OnEnable()
        {
            if (_envelope == null)
            {
                Debug.LogError("[zabloo] ZablooDocument has no envelope assigned.", this);
                return;
            }

            try
            {
                var envelope = EnvelopeLoader.Parse(_envelope.text);
                _viewElement = new ZablooView(envelope, _view);
            }
            catch (ZablooContentException e)
            {
                Debug.LogError($"[zabloo] {e.Message}", this);
                return;
            }

            _viewElement.OnAction += Dispatch;

            var root = GetComponent<UIDocument>().rootVisualElement;
            root.style.flexGrow = 1;
            root.Add(_viewElement);
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
