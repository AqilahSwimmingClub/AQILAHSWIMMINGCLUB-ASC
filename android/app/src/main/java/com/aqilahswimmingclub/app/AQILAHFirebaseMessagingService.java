package com.aqilahswimmingclub.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class AQILAHFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID="aqilah_notifications";

    @Override public void onNewToken(String token) {
        getSharedPreferences("aqilah_fcm",MODE_PRIVATE).edit().putString("token",token).apply();
        MainActivity activity=MainActivity.getCurrent();
        if(activity!=null)activity.deliverFcmToken(token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        // Notification payload ditampilkan otomatis oleh FCM saat background.
        // Service hanya menampilkan manual untuk foreground atau data-only agar tidak ganda.
        if(message.getNotification()!=null&&!MainActivity.foreground)return;
        String title=message.getData().get("title"),body=message.getData().get("body");
        if(message.getNotification()!=null){if(title==null)title=message.getNotification().getTitle();if(body==null)body=message.getNotification().getBody();}
        showNotification(title==null?"AQILAH Swimming Club":title,body==null?"Ada informasi baru.":body,message.getData().get("deep_link"));
    }

    private void showNotification(String title,String body,String deepLink) {
        NotificationManager manager=getSystemService(NotificationManager.class);
        ensureNotificationChannel(this);
        Intent intent=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("deep_link",deepLink==null?"dashboard":deepLink);
        PendingIntent pending=PendingIntent.getActivity(this,(int)System.currentTimeMillis(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification=new NotificationCompat.Builder(this,CHANNEL_ID).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(pending);
        manager.notify((int)(System.currentTimeMillis()&0x7fffffff),notification.build());
    }

    static void ensureNotificationChannel(Context context) {
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O){
            NotificationManager manager=context.getSystemService(NotificationManager.class);
            if(manager!=null)manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID,"Notifikasi AQILAH",NotificationManager.IMPORTANCE_HIGH));
        }
    }
}
