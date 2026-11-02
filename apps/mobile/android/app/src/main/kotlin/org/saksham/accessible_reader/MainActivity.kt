package org.saksham.accessible_reader

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "org.saksham.accessible_reader/accessibility")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    // Focus moves inside the book page reach TalkBack only while the WebView itself has focus.
                    "focusWebView" -> result.success(findWebView(window.decorView)?.requestFocus() ?: false)
                    else -> result.notImplemented()
                }
            }
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) findWebView(view.getChildAt(i))?.let { return it }
        }
        return null
    }
}
