package cc.aurexis.pocketpager;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

/**
 * Pocket Pager for restaurant owners and branch managers (Google Play). Signed in once, the app
 * opens on the branches (HomeActivity) every time after; only «خروج», or Aurexis stopping the
 * account or changing its password, brings it back here. Accounts are made by Aurexis: no
 * sign-up, no automatic «forgot password», only WhatsApp.
 */
public class MainActivity extends Activity {
    private Api api;
    private String whatsapp;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        api = new Api(this);
        if (Api.prefs(this).getString("brand", null) != null) {
            openHome();
            return;
        }
        showLogin();
    }

    private void openHome() {
        Intent home = new Intent(this, HomeActivity.class);
        if (testBuild()) home.putExtras(getIntent());
        startActivity(home);
        finish();
    }

    /** A build pointed at a local server (CI's emulator run): it takes sign-in and tab as extras. */
    private boolean testBuild() {
        return api.server.startsWith("http://127.0.0.1") && getIntent().getExtras() != null;
    }

    private void showLogin() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.NAVY);
        scroll.setFillViewport(true);
        LinearLayout col = Ui.column(this, 22);
        scroll.addView(col);

        LinearLayout head = Ui.row(this);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        head.addView(icon, new LinearLayout.LayoutParams(Ui.dp(this, 52), Ui.dp(this, 52)));
        LinearLayout names = Ui.column(this, 0);
        names.setPadding(Ui.dp(this, 12), 0, Ui.dp(this, 12), 0);
        names.addView(Ui.text(this, "Pocket Pager", 22, Ui.TEXT, true));
        names.addView(Ui.text(this, "تطبيق الإدارة", 14, Ui.MUTED, false));
        head.addView(names);
        col.addView(head, Ui.full(this, 24));

        col.addView(Ui.text(this, "لأصحاب المطاعم ومديرين الفروع: تابع فروعك وطلباتها وتنبيهاتها من مكانك.", 15, Ui.MUTED, false), Ui.full(this, 18));

        col.addView(Ui.text(this, "رقم الموبايل أو اسم المستخدم", 15, Ui.TEXT, true), Ui.full(this, 24));
        EditText login = Ui.field(this, "01012345678", false);
        col.addView(login, Ui.full(this, 8));
        col.addView(Ui.text(this, "اللي وصلك من Aurexis.", 13, Ui.MUTED, false), Ui.full(this, 6));

        col.addView(Ui.text(this, "كلمة السر", 15, Ui.TEXT, true), Ui.full(this, 18));
        EditText password = Ui.field(this, "", true);
        password.setImeOptions(EditorInfo.IME_ACTION_DONE);
        col.addView(password, Ui.full(this, 8));

        TextView error = Ui.text(this, "", 14, Ui.ALERT, false);
        error.setVisibility(View.GONE);
        col.addView(error, Ui.full(this, 12));

        Button go = Ui.button(this, "دخول", true);
        col.addView(go, Ui.full(this, 16));

        col.addView(Ui.text(this, "لحساب جديد أو نسيت الباسورد كلّمنا على واتساب", 14, Ui.MUTED, false), Ui.full(this, 28));
        Button wa = Ui.button(this, "كلّمنا على واتساب", false);
        col.addView(wa, Ui.full(this, 10));
        wa.setOnClickListener(v -> openWhatsapp());

        col.addView(Ui.text(this, "إنت عميل مستني طلبك؟ امسح الكود اللي عند الكاشير بكاميرا موبايلك، ورقمك هيظهر على طول.", 13, Ui.MUTED, false), Ui.full(this, 22));

        Runnable submit = () -> {
            String l = login.getText().toString().trim();
            String p = password.getText().toString();
            if (l.isEmpty() || p.isEmpty()) {
                error.setText(l.isEmpty() ? "اكتب رقم موبايلك أو اسم المستخدم" : "اكتب كلمة السر");
                error.setVisibility(View.VISIBLE);
                return;
            }
            go.setEnabled(false);
            go.setText("بندخلك…");
            api.call(() -> api.post("/api/login", new JSONObject().put("login", l).put("password", p)), res -> {
                Api.prefs(this).edit().putString("brand", res.optString("brandId")).apply();
                openHome();
            }, fail -> {
                error.setText(fail.getMessage());
                error.setVisibility(View.VISIBLE);
                go.setEnabled(true);
                go.setText("دخول");
            });
        };
        go.setOnClickListener(v -> submit.run());
        password.setOnEditorActionListener((v, action, e) -> {
            submit.run();
            return true;
        });

        api.call(() -> api.get("/api/signup/info"), info -> whatsapp = Api.whatsapp(info.optString("support", null)), f -> { });
        setContentView(scroll);
        if (testBuild() && getIntent().hasExtra("login")) {
            login.setText(getIntent().getStringExtra("login"));
            password.setText(getIntent().getStringExtra("password"));
            submit.run();
        }
    }

    private void openWhatsapp() {
        if (whatsapp == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(whatsapp)));
        } catch (Exception ignored) {
            // no app for the link
        }
    }
}
