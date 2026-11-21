package cc.aurexis.pocketpager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The owner's / manager's alerts as Android notifications: a branch stopped or closed, the
 * subscription ending or ended, the cashier screen closed at a busy hour. Android runs this every
 * 15 minutes (also after a restart) and the app on every open; each alert is shown once.
 */
public class AlertJob extends JobService {
    private static final int JOB_ID = 1;
    private static final String CHANNEL = "alerts";

    static void schedule(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, AlertJob.class))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
        scheduler.schedule(job);
        new Thread(() -> check(context.getApplicationContext())).start();
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            check(getApplicationContext());
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    /** Fetches the alerts after the last one seen and shows the new ones. */
    static synchronized void check(Context context) {
        SharedPreferences prefs = Api.prefs(context);
        String brand = prefs.getString("brand", null);
        if (brand == null) return;
        long last = prefs.getLong("lastAlert", -1);
        JSONArray list;
        try {
            list = new Api(context).get("/api/brand/" + brand + "/alerts?after=" + Math.max(0, last)).optJSONArray("alerts");
        } catch (Exception e) {
            return;
        }
        if (list == null || list.length() == 0) {
            if (last < 0) prefs.edit().putLong("lastAlert", 0).apply();
            return;
        }
        long newest = last;
        // The first check after signing in only remembers where we are: no flood of old alerts.
        boolean show = last >= 0;
        for (int i = list.length() - 1; i >= 0; i--) {
            JSONObject a = list.optJSONObject(i);
            long id = a.optLong("id");
            if (id <= last) continue;
            newest = Math.max(newest, id);
            if (show) notify(context, (int) id, a.optString("title"), a.optString("body"));
        }
        prefs.edit().putLong("lastAlert", newest).apply();
    }

    private static void notify(Context context, int id, String title, String body) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "تنبيهات الفروع", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(tap)
                .build();
        nm.notify(id, n);
    }
}
