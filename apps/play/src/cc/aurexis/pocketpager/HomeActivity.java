package cc.aurexis.pocketpager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateUtils;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Signed in: four tabs. «الفروع» (each branch's day, its cashier screen online or not, its plan;
 * a tap opens the branch), «التنبيهات», «الإدارة» (the website's full dashboard, same session)
 * and «حسابي» (WhatsApp, sign out). Refreshed every 10 seconds while open; alerts also arrive as
 * Android notifications (AlertJob).
 */
public class HomeActivity extends Activity {
    private static final int FILE_REQUEST = 1;
    private static final long REFRESH_MS = 10_000;
    private static final String[] TABS = { "الفروع", "التنبيهات", "الإدارة", "حسابي" };

    private Api api;
    private String brand;
    private JSONObject overview;
    private JSONArray alerts = new JSONArray();
    private int tab = 0;
    private String openBranch;
    private FrameLayout content;
    private LinearLayout bar;
    private WebView manage;
    private ValueCallback<Uri[]> pendingFiles;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            load();
            handler.postDelayed(this, REFRESH_MS);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        api = new Api(this);
        brand = Api.prefs(this).getString("brand", null);
        if (brand == null) {
            backToLogin();
            return;
        }
        LinearLayout root = Ui.column(this, 0);
        root.setBackgroundColor(Ui.NAVY);
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        bar = Ui.row(this);
        bar.setBackgroundColor(Ui.SURFACE);
        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 60)));
        setContentView(root);
        if (api.server.startsWith("http://127.0.0.1")) {
            tab = getIntent().getIntExtra("tab", 0);
            openBranch = getIntent().getStringExtra("branch");
        }
        drawBar();
        render();
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 7);
        AlertJob.schedule(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(tick);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(tick);
        CookieManager.getInstance().flush();
    }

    private void load() {
        new Thread(() -> AlertJob.check(getApplicationContext())).start();
        api.call(() -> {
            JSONObject ov = api.get("/api/brand/" + brand + "/overview");
            JSONObject al = api.get("/api/brand/" + brand + "/alerts");
            return new JSONObject().put("ov", ov).put("al", al);
        }, res -> {
            overview = res.optJSONObject("ov");
            alerts = res.optJSONObject("al").optJSONArray("alerts");
            if (tab != 2) render();
        }, fail -> {
            // Aurexis stopped the account, or changed its password: back to sign-in.
            if (fail.status == 401 || fail.status == 403) api.signOut(this, this::backToLogin);
        });
    }

    private void backToLogin() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }

    // ---------- tabs ----------

    private void drawBar() {
        bar.removeAllViews();
        for (int i = 0; i < TABS.length; i++) {
            final int index = i;
            String label = i == 0 && overview != null && "manager".equals(overview.optJSONObject("owner").optString("role")) ? "فرعي" : TABS[i];
            TextView t = Ui.text(this, label, 13, i == tab ? Ui.ORANGE : Ui.MUTED, i == tab);
            t.setGravity(Gravity.CENTER);
            t.setOnClickListener(v -> {
                tab = index;
                openBranch = null;
                drawBar();
                render();
            });
            bar.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f));
        }
    }

    private void render() {
        content.removeAllViews();
        if (tab == 2) {
            content.addView(managePage());
            return;
        }
        ScrollView scroll = new ScrollView(this);
        LinearLayout col = Ui.column(this, 16);
        scroll.addView(col);
        content.addView(scroll);
        if (overview == null) {
            col.addView(Ui.text(this, "بنحمّل…", 15, Ui.MUTED, false));
            return;
        }
        if (tab == 0 && openBranch != null) branchDetail(col, openBranch);
        else if (tab == 0) branches(col);
        else if (tab == 1) alertList(col);
        else account(col);
    }

    private void branches(LinearLayout col) {
        col.addView(Ui.text(this, overview.optJSONObject("brand").optString("name"), 24, Ui.TEXT, true));
        String stopped = overview.isNull("stopped") ? null : overview.optString("stopped");
        if (stopped != null) {
            LinearLayout box = card();
            box.setBackground(Ui.box(this, Color.parseColor("#2A1820"), 16));
            box.addView(Ui.text(this, "trial_ended".equals(stopped) ? "التجربة المجانية خلصت" : "unpaid".equals(stopped) ? "الاشتراك خلص" : "الخدمة متوقفة", 16, Ui.TEXT, true));
            box.addView(Ui.text(this, "العملاء مش بياخدوا أرقام دلوقتي. كلّم مدير حسابك في Aurexis على واتساب.", 14, Ui.MUTED, false));
            col.addView(box, Ui.full(this, 12));
        }
        JSONArray list = overview.optJSONArray("branches");
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject b = list.optJSONObject(i);
            LinearLayout c = card();
            LinearLayout top = Ui.row(this);
            top.addView(Ui.text(this, b.optString("name"), 18, Ui.TEXT, true), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            boolean off = b.optBoolean("paused") || "suspended".equals(b.optJSONObject("plan").optString("status"));
            TextView chip = Ui.text(this, b.optBoolean("paused") ? "مقفول مؤقتًا" : planText(b), 12, off ? Ui.ALERT : Ui.ORANGE, true);
            top.addView(chip);
            c.addView(top);
            LinearLayout stats = Ui.row(this);
            stats.addView(stat("النهارده", b.optInt("ordersToday"), false), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            stats.addView(stat("مفتوح", b.optInt("openNow"), false), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            stats.addView(stat("متأخر", b.optInt("lateToday"), true), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            c.addView(stats, Ui.full(this, 10));
            boolean online = b.optInt("screens") > 0;
            TextView cashier = Ui.text(this, (online ? "● " : "○ ") + (online ? "شاشة الكاشير شغّالة" : "شاشة الكاشير مقفولة"), 13, online ? Ui.READY : Ui.MUTED, false);
            c.addView(cashier, Ui.full(this, 8));
            final String id = b.optString("id");
            c.setOnClickListener(v -> {
                openBranch = id;
                render();
            });
            col.addView(c, Ui.full(this, 12));
        }
    }

    private void branchDetail(LinearLayout col, String id) {
        JSONObject b = null;
        JSONArray list = overview.optJSONArray("branches");
        for (int i = 0; list != null && i < list.length(); i++) if (id.equals(list.optJSONObject(i).optString("id"))) b = list.optJSONObject(i);
        Button back = Ui.button(this, "← كل الفروع", false);
        back.setOnClickListener(v -> {
            openBranch = null;
            render();
        });
        col.addView(back);
        if (b == null) return;
        col.addView(Ui.text(this, b.optString("name"), 24, Ui.TEXT, true), Ui.full(this, 14));
        col.addView(info("طلبات النهارده", String.valueOf(b.optInt("ordersToday"))), Ui.full(this, 10));
        col.addView(info("مفتوح دلوقتي", String.valueOf(b.optInt("openNow"))), Ui.full(this, 8));
        col.addView(info("متأخر", String.valueOf(b.optInt("lateToday"))), Ui.full(this, 8));
        col.addView(info("الاشتراك", planText(b)), Ui.full(this, 8));
        col.addView(info("الفرع", b.optBoolean("paused") ? "مقفول مؤقتًا" : "بياخد طلبات"), Ui.full(this, 8));
        col.addView(info("شاشة الكاشير", b.optInt("screens") > 0 ? "شغّالة دلوقتي" : "مقفولة"), Ui.full(this, 8));
        if (!b.isNull("pin")) col.addView(info("الرقم السري للكاشير", b.optString("pin")), Ui.full(this, 8));
        JSONObject urls = b.optJSONObject("urls");
        if (urls != null) {
            col.addView(Ui.text(this, "لينكات الفرع", 16, Ui.TEXT, true), Ui.full(this, 18));
            col.addView(linkButton("ابعت لينك شاشة الكاشير", urls.optString("bar")), Ui.full(this, 8));
            col.addView(linkButton("ابعت لينك شاشة الكود", urls.optString("qr")), Ui.full(this, 8));
        }
        col.addView(Ui.text(this, "عشان تغيّر الخصائص أو الرسايل أو الكاشيرية افتح «الإدارة» تحت.", 13, Ui.MUTED, false), Ui.full(this, 16));
    }

    private void alertList(LinearLayout col) {
        col.addView(Ui.text(this, "التنبيهات", 24, Ui.TEXT, true));
        if (alerts == null || alerts.length() == 0) {
            col.addView(Ui.text(this, "مفيش تنبيهات. هنبعتلك هنا لو فرع وقف أو اتقفل، أو الاشتراك قرّب يخلص، أو شاشة الكاشير اتقفلت وقت الشغل.", 14, Ui.MUTED, false), Ui.full(this, 12));
            return;
        }
        for (int i = 0; i < alerts.length(); i++) {
            JSONObject a = alerts.optJSONObject(i);
            LinearLayout c = card();
            c.addView(Ui.text(this, a.optString("title"), 16, Ui.TEXT, true));
            c.addView(Ui.text(this, a.optString("body"), 14, Ui.MUTED, false));
            c.addView(Ui.text(this, DateUtils.getRelativeTimeSpanString(a.optLong("at")).toString(), 12, Ui.MUTED, false));
            col.addView(c, Ui.full(this, 10));
        }
    }

    private void account(LinearLayout col) {
        JSONObject o = overview.optJSONObject("owner");
        col.addView(Ui.text(this, "حسابي", 24, Ui.TEXT, true));
        col.addView(info("الاسم", o.isNull("name") ? o.optString("username") : o.optString("name")), Ui.full(this, 14));
        col.addView(info("بتدخل بـ", o.optString("username")), Ui.full(this, 8));
        col.addView(info("الصلاحية", "manager".equals(o.optString("role")) ? "مدير فرع" : "صاحب المطعم"), Ui.full(this, 8));
        col.addView(info("المطعم", overview.optJSONObject("brand").optString("name")), Ui.full(this, 8));
        col.addView(Ui.text(this, "لأي تغيير في الاشتراك أو الفروع أو الحساب كلّمنا على واتساب.", 14, Ui.MUTED, false), Ui.full(this, 18));
        Button wa = Ui.button(this, "كلّمنا على واتساب", false);
        String link = Api.whatsapp(overview.isNull("whatsapp") ? null : overview.optString("whatsapp"));
        wa.setOnClickListener(v -> open(link));
        col.addView(wa, Ui.full(this, 10));
        Button out = Ui.button(this, "خروج", false);
        out.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setMessage("تخرج من الحساب؟")
                .setPositiveButton("خروج", (d, w) -> api.signOut(this, this::backToLogin))
                .setNegativeButton("رجوع", null)
                .show());
        col.addView(out, Ui.full(this, 24));
    }

    // ---------- «الإدارة»: the website's dashboard, same session ----------

    private View managePage() {
        if (manage == null) {
            manage = new WebView(this);
            manage.setBackgroundColor(Ui.NAVY);
            WebSettings s = manage.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setAllowFileAccess(false);
            s.setSupportMultipleWindows(false);
            s.setUserAgentString(s.getUserAgentString() + " PocketPagerApp/android");
            CookieManager.getInstance().setAcceptThirdPartyCookies(manage, false);
            manage.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if (url.startsWith(api.server + "/brand/")) return false;
                    // Signed out from the page (or the account closed): the native sign-in.
                    if (url.equals(api.server + "/") || url.startsWith(api.server + "/login") || url.startsWith(api.server + "/welcome")) {
                        api.signOut(HomeActivity.this, HomeActivity.this::backToLogin);
                        return true;
                    }
                    open(url);
                    return true;
                }
            });
            manage.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                    pendingFiles = callback;
                    try {
                        startActivityForResult(params.createIntent(), FILE_REQUEST);
                    } catch (Exception e) {
                        pendingFiles = null;
                        return false;
                    }
                    return true;
                }
            });
            manage.loadUrl(api.server + "/brand/" + brand);
        }
        if (manage.getParent() != null) ((FrameLayout) manage.getParent()).removeView(manage);
        return manage;
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
    public void onBackPressed() {
        if (tab == 2 && manage != null && manage.canGoBack()) {
            manage.goBack();
        } else if (openBranch != null) {
            openBranch = null;
            render();
        } else if (tab != 0) {
            tab = 0;
            drawBar();
            render();
        } else {
            super.onBackPressed();
        }
    }

    // ---------- pieces ----------

    private LinearLayout card() {
        LinearLayout c = Ui.column(this, 16);
        c.setBackground(Ui.box(this, Ui.SURFACE, 18));
        return c;
    }

    private View stat(String label, int value, boolean alert) {
        LinearLayout c = Ui.column(this, 0);
        c.addView(Ui.text(this, label, 12, Ui.MUTED, false));
        c.addView(Ui.text(this, String.valueOf(value), 22, alert && value > 0 ? Ui.ALERT : Ui.TEXT, true));
        return c;
    }

    private View info(String title, String value) {
        LinearLayout r = Ui.row(this);
        r.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 12));
        r.setBackground(Ui.box(this, Ui.SURFACE, 14));
        r.addView(Ui.text(this, title, 14, Ui.MUTED, false), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        r.addView(Ui.text(this, value, 14, Ui.TEXT, true));
        return r;
    }

    private View linkButton(String label, String url) {
        Button b = Ui.button(this, label, false);
        b.setOnClickListener(v -> {
            Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url);
            startActivity(Intent.createChooser(send, label));
        });
        return b;
    }

    private static String planText(JSONObject b) {
        JSONObject p = b.optJSONObject("plan");
        if (p == null) return "";
        if ("awaiting_payment".equals(p.optString("reason"))) return "مستني التفعيل";
        switch (p.optString("status")) {
            case "trial": return p.isNull("daysLeft") ? "تجربة" : "تجربة · فاضل " + p.optInt("daysLeft") + " يوم";
            case "active": return "شغّال";
            case "past_due": return "الاشتراك خلص · فترة سماح";
            default: return "واقف";
        }
    }

    private void open(String url) {
        if (url == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
            // no app for the link
        }
    }
}
