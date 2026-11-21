package cc.aurexis.pocketpager;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * The same API as the website (/api/login, /api/brand/...). The session is the website's cookie,
 * kept in the WebView's CookieManager, so the native screens and the management page share it.
 * It lasts 400 days and is renewed on every dashboard load: nobody is signed out by time.
 */
final class Api {
    static final String PREFS = "pocketpager";

    interface Ok<T> { void done(T value); }

    static final class Failure extends Exception {
        final int status;
        Failure(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    final String server;
    private final Handler main = new Handler(Looper.getMainLooper());

    Api(Context context) {
        server = context.getString(R.string.server).replaceAll("/+$", "");
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Runs a call off the main thread, then hands the result (or the failure) back on it. */
    <T> void call(Call<T> work, Ok<T> ok, Ok<Failure> fail) {
        new Thread(() -> {
            try {
                T value = work.run();
                main.post(() -> ok.done(value));
            } catch (Failure f) {
                main.post(() -> fail.done(f));
            } catch (Exception e) {
                main.post(() -> fail.done(new Failure(0, "مفيش اتصال بالإنترنت. جرّب تاني")));
            }
        }).start();
    }

    interface Call<T> { T run() throws Exception; }

    JSONObject get(String path) throws Exception {
        return send("GET", path, null);
    }

    JSONObject post(String path, JSONObject body) throws Exception {
        return send("POST", path, body == null ? new JSONObject() : body);
    }

    private JSONObject send(String method, String path, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(server + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(server);
        if (cookie != null) c.setRequestProperty("Cookie", cookie);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = c.getResponseCode();
        for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
            if (h.getKey() != null && h.getKey().equalsIgnoreCase("Set-Cookie")) {
                for (String v : h.getValue()) cookies.setCookie(server, v);
            }
        }
        cookies.flush();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            text = buf.toString("UTF-8");
            in.close();
        }
        JSONObject json;
        try {
            json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (Exception e) {
            json = new JSONObject();
        }
        if (status >= 400) throw new Failure(status, json.optString("error", "حصلت مشكلة. جرّب تاني"));
        return json;
    }

    /** Signs out on this phone: the server session, our cookie and what the app remembers. */
    void signOut(Context context, Runnable after) {
        String brand = prefs(context).getString("brand", null);
        new Thread(() -> {
            try {
                if (brand != null) post("/api/brand/" + brand + "/logout", null);
            } catch (Exception ignored) {
                // offline: the cookie is gone below anyway
            }
            main.post(() -> {
                CookieManager.getInstance().removeAllCookies(null);
                CookieManager.getInstance().flush();
                prefs(context).edit().remove("brand").remove("lastAlert").apply();
                after.run();
            });
        }).start();
    }

    /** wa.me link to Aurexis (new accounts, forgotten passwords, the subscription). */
    static String whatsapp(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        String digits = raw.replaceAll("\\D", "");
        if (digits.startsWith("01")) digits = "2" + digits;
        return "https://wa.me/" + digits;
    }
}
