package cc.aurexis.pocketpager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * Pocket Pager for restaurant owners and branch managers (Google Play).
 *
 * The app opens the server's /welcome page: what Pocket Pager does, then sign up or log in, then
 * the dashboard. Pages of our own server stay inside; anything else (WhatsApp, maps, phone
 * numbers) opens in its own app. The user agent carries "PocketPagerApp/android", so the pages
 * show no prices and no subscription inside the app.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 1;

    private WebView web;
    private String server;
    private ValueCallback<Uri[]> pendingFiles;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        server = getString(R.string.server).replaceAll("/+$", "");
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0D1324"));
        setContentView(web);
        setUpWebView();
        if (state == null || web.restoreState(state) == null) web.loadUrl(server + "/welcome");
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    private void setUpWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // target="_blank" (open the cashier screen) loads here too; Back comes home.
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " PocketPagerApp/android " + versionName());
        WebView.setWebContentsDebuggingEnabled(false);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isOwn(url.toString())) {
                    // The website's home page sells; the app's home is /welcome.
                    if ("/".equals(url.getPath()) || url.getPath() == null || url.getPath().isEmpty()) {
                        view.loadUrl(server + "/welcome");
                        return true;
                    }
                    return false;
                }
                openOutside(url);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) offline();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // The logo and the promo picture.
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void offline() {
        web.loadDataWithBaseURL(null,
                "<html dir='rtl' style='background:#0D1324;color:#F5F7FB;font-family:sans-serif'>"
                        + "<body style='display:grid;place-items:center;height:90vh;text-align:center'>"
                        + "<div><h2>مفيش اتصال بالإنترنت</h2><p style='color:#9AA4B8'>اتأكد من النت، والصفحة هترجع لوحدها.</p></div>"
                        + "</body></html>", "text/html", "UTF-8", null);
        web.postDelayed(() -> web.loadUrl(server + "/welcome"), 5000);
    }

    private boolean isOwn(String url) {
        return url != null && (url.equals(server) || url.startsWith(server + "/"));
    }

    private void openOutside(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "مفيش برنامج يفتح اللينك ده", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        new AlertDialog.Builder(this)
                .setMessage("تقفل Pocket Pager؟")
                .setPositiveButton("اقفل", (d, w) -> finish())
                .setNegativeButton("رجوع", null)
                .show();
    }
}
