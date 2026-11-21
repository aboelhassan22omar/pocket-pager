package cc.aurexis.pocketpager;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** The brand's look for the native screens: navy, cloud text, one orange action. */
final class Ui {
    static final int NAVY = Color.parseColor("#0D1324");
    static final int SURFACE = Color.parseColor("#131B30");
    static final int SURFACE2 = Color.parseColor("#1A2440");
    static final int TEXT = Color.parseColor("#F5F7FB");
    static final int MUTED = Color.parseColor("#9AA4B8");
    static final int ORANGE = Color.parseColor("#FF6A13");
    static final int INK = Color.parseColor("#1B1206");
    static final int READY = Color.parseColor("#22D39A");
    static final int ALERT = Color.parseColor("#FF8A7A");

    private Ui() {}

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static GradientDrawable box(Context c, int color, float radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(c, radius));
        return d;
    }

    static LinearLayout column(Context c, int padding) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(c, padding), dp(c, padding), dp(c, padding), dp(c, padding));
        l.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        l.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return l;
    }

    static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setLineSpacing(0, 1.25f);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static EditText field(Context c, String hint, boolean password) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setHintTextColor(Color.parseColor("#6B7690"));
        e.setTextColor(TEXT);
        e.setTextSize(17);
        e.setSingleLine(true);
        e.setTextDirection(View.TEXT_DIRECTION_LTR);
        e.setInputType(password ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_CLASS_TEXT);
        e.setBackground(box(c, NAVY, 12));
        e.setPadding(dp(c, 14), 0, dp(c, 14), 0);
        e.setMinHeight(dp(c, 52));
        return e;
    }

    static Button button(Context c, String label, boolean primary) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? INK : TEXT);
        b.setBackground(box(c, primary ? ORANGE : SURFACE2, 14));
        b.setMinHeight(dp(c, 52));
        b.setStateListAnimator(null);
        return b;
    }

    static LinearLayout.LayoutParams full(Context c, int topMargin) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(c, topMargin);
        return p;
    }
}
