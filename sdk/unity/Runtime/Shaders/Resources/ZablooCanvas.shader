// The one shader every zabloo batch draws with — the UGUI spelling of the Godot
// adapter's canvas_item shader (G6) and of the web renderer's (ZAB-7).
//
// Compatible with the Canvas the way UI/Default is: the vertex color times the
// texture, alpha blend, no depth, ZTest from unity_GUIZTestMode so it works in
// Screen Space-Overlay and Screen Space-Camera alike. Three things on top:
//
//  * _TextureKind says what _MainTex is. 0: nothing — a solid, drawn with the
//    vertex color alone. 1: a glyph atlas — one channel of coverage, read through
//    the global _ZablooCoverage (which channel depends on whether the GPU took R8
//    or Alpha8), multiplied into the alpha; the RGB stays the vertex color, which
//    is how a Text gets its style.color. 2: an image — sampled and multiplied.
//  * _ClipRect / _ClipRadius: the clip group's region, in ROOT CANVAS space (the
//    Canvas batches vertices into that space before this shader sees them). The
//    rounded-box SDF, feathered over one device pixel with fwidth, discards the
//    corners and — with radius 0 — cuts the exact rect. No RectMask2D, no stencil:
//    the SDF is the whole clip, eight lines against a buffer, mask geometry and a
//    state machine per nesting level, which is the argument ZAB-7 made.
//  * Cull Off, because the surface flips Y with a negative scale, which turns the
//    winding around.
Shader "Zabloo/Canvas"
{
    Properties
    {
        [PerRendererData] _MainTex ("Texture", 2D) = "white" {}
        _TextureKind ("Texture kind (0 none, 1 glyph atlas, 2 image)", Float) = 0
        _ClipRect ("Clip rect (x, y, w, h) in root canvas space", Vector) = (-10000000, -10000000, 20000000, 20000000)
        _ClipRadius ("Clip corner radius", Float) = 0
        _ColorMask ("Color mask", Float) = 15
    }

    SubShader
    {
        Tags
        {
            "Queue" = "Transparent"
            "IgnoreProjector" = "True"
            "RenderType" = "Transparent"
            "PreviewType" = "Plane"
            "CanUseSpriteAtlas" = "False"
        }

        Cull Off
        Lighting Off
        ZWrite Off
        ZTest [unity_GUIZTestMode]
        Blend SrcAlpha OneMinusSrcAlpha
        ColorMask [_ColorMask]

        Pass
        {
            Name "Zabloo"

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0

            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                float2 canvas : TEXCOORD1;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            sampler2D _MainTex;
            float _TextureKind;
            float4 _ClipRect;
            float _ClipRadius;
            float4 _ZablooCoverage;

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                // Root canvas space: what the clip rect is expressed in.
                o.canvas = v.vertex.xy;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.color = v.color;
                o.uv = v.uv;
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float4 color = i.color;
                if (_TextureKind > 1.5)
                {
                    color *= tex2D(_MainTex, i.uv);
                }
                else if (_TextureKind > 0.5)
                {
                    color.a *= dot(tex2D(_MainTex, i.uv), _ZablooCoverage);
                }

                // The rounded-box SDF, as Godot and the web write it. Everything
                // outside the rect is a positive distance, so radius 0 is the
                // scissor and nothing else.
                float2 half_size = _ClipRect.zw * 0.5;
                float2 q = abs(i.canvas - (_ClipRect.xy + half_size)) - (half_size - _ClipRadius);
                float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - _ClipRadius;
                float aa = max(fwidth(d), 0.0001);
                color.a *= 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);

                // Nothing to blend: skip the blend rather than write a zero.
                clip(color.a - 0.001);
                return color;
            }
            ENDCG
        }
    }
}
