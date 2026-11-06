package ru.moymir.kids;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import java.io.File;
import java.nio.file.Files;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_FILE = 41, SAVE_BACKUP = 42, RECORD_PERMISSION = 43;
    private WebView web;
    private TextToSpeech tts;
    private volatile boolean speechReady;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMicrophone;
    private String pendingBackup;
    private MediaRecorder nameRecorder;
    private File nameAudioFile;
    private boolean pendingNameRecording, destroying;
    private final Handler recordingHandler = new Handler(Looper.getMainLooper());
    private final Runnable recordingTimeout = () -> finishNameRecording(true);

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(105,211,251));
        // Keep content below system bars and above the software keyboard on Android 15+.
        web.setOnApplyWindowInsetsListener((v,insets)->{
            v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(false);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(!isLocal(request.getUrl())) return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                return loader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !isLocal(request.getUrl());}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                fileCallback=callback;
                try {startActivityForResult(params.createIntent(),PICK_FILE);return true;}
                catch(Exception ex){fileCallback=null;callback.onReceiveValue(null);notice("Не найдено приложение для выбора файла");return true;}
            }
            @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{
                if(!ORIGIN.equals(request.getOrigin().toString().replaceAll("/$",""))){request.deny();return;}
                boolean audio=false;
                for(String resource:request.getResources())if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource))audio=true;
                if(!audio){request.deny();return;}
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                else {if(pendingMicrophone!=null)pendingMicrophone.deny();pendingMicrophone=request;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},RECORD_PERMISSION);}
            });}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(pendingMicrophone==request)pendingMicrophone=null;}
        });
        web.addJavascriptInterface(new NativeBridge(),"MoyMirNative");
        tts=new TextToSpeech(this,status->{
            if(status==TextToSpeech.SUCCESS){
                int available=tts.setLanguage(new Locale("ru","RU"));
                speechReady=available!=TextToSpeech.LANG_MISSING_DATA&&available!=TextToSpeech.LANG_NOT_SUPPORTED;
                if(speechReady&&tts.getVoices()!=null)for(Voice voice:tts.getVoices())if(voice.getLocale().getLanguage().equals("ru")&&!voice.isNetworkConnectionRequired()){tts.setVoice(voice);break;}
                runOnUiThread(()->web.evaluateJavascript("if(typeof loadVoices==='function')loadVoices()",null));
            }
        });
        web.loadUrl(ORIGIN+"/assets/www/index.html");
    }
    private static boolean isLocal(Uri uri){return "https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost());}
    private void notice(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
    private void nameRecordingResult(String status, String payload) {
        if (!destroying && web != null) web.evaluateJavascript("window.onNativeNameRecording && window.onNativeNameRecording(" + JSONObject.quote(status) + "," + JSONObject.quote(payload) + ")", null);
    }
    private void requestNameRecording() {
        if (pendingNameRecording || nameRecorder != null) return;
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE)) {
            nameRecordingResult("error", "На этом устройстве нет микрофона. Можно выбрать готовую аудиозапись."); return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startNameRecording();
        else { pendingNameRecording = true; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, RECORD_PERMISSION); }
    }
    @SuppressWarnings("deprecation")
    private void startNameRecording() {
        if (destroying || nameRecorder != null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { nameRecordingResult("denied", ""); return; }
        if (tts != null) tts.stop();
        try {
            nameAudioFile = File.createTempFile("name-", ".m4a", getCacheDir());
            nameRecorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? new MediaRecorder(this) : new MediaRecorder();
            nameRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            nameRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            nameRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            nameRecorder.setAudioChannels(1);
            nameRecorder.setAudioSamplingRate(44100);
            nameRecorder.setAudioEncodingBitRate(64000);
            nameRecorder.setOutputFile(nameAudioFile.getAbsolutePath());
            nameRecorder.setMaxDuration(10000);
            nameRecorder.setOnInfoListener((recorder, what, extra) -> { if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) finishNameRecording(true); });
            nameRecorder.setOnErrorListener((recorder, what, extra) -> { finishNameRecording(false); nameRecordingResult("error", "Микрофон недоступен. Завершите другой звонок или запись и попробуйте ещё раз."); });
            nameRecorder.prepare();
            nameRecorder.start();
            recordingHandler.postDelayed(recordingTimeout, 10500);
            nameRecordingResult("started", "");
        } catch (Exception ex) {
            finishNameRecording(false);
            nameRecordingResult("error", "Не удалось начать запись. Проверьте доступ к микрофону для приложения и завершите другие записи или звонок.");
        }
    }
    private void finishNameRecording(boolean save) {
        pendingNameRecording = false;
        recordingHandler.removeCallbacks(recordingTimeout);
        MediaRecorder recorder = nameRecorder;
        File file = nameAudioFile;
        nameRecorder = null; nameAudioFile = null;
        if (recorder == null) { if (file != null) file.delete(); return; }
        boolean stopped = false;
        try { recorder.stop(); stopped = true; } catch (RuntimeException ignored) { /* Too short or interrupted: keep the previous recording. */ }
        finally { try { recorder.release(); } catch (RuntimeException ignored) {} }
        try {
            if (save && stopped && file != null && file.length() > 0 && file.length() <= 1200000) {
                String data = "data:audio/mp4;base64," + Base64.encodeToString(Files.readAllBytes(file.toPath()), Base64.NO_WRAP);
                nameRecordingResult("saved", data);
            } else if (save) nameRecordingResult("error", "Запись слишком короткая или прервалась. Попробуйте записать имя ещё раз.");
        } catch (Exception ex) { nameRecordingResult("error", "Не удалось сохранить звук. Прежняя запись имени сохранена."); }
        finally { if (file != null) file.delete(); }
    }
    public final class NativeBridge {
        @JavascriptInterface public void startNameRecording(){runOnUiThread(()->requestNameRecording());}
        @JavascriptInterface public void stopNameRecording(){runOnUiThread(()->finishNameRecording(true));}
        @JavascriptInterface public void cancelNameRecording(){runOnUiThread(()->finishNameRecording(false));}
        @JavascriptInterface public void openAppSettings(){runOnUiThread(()->{
            try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
            catch(Exception ex) { notice("Откройте настройки Android → Приложения → Мой мир → Разрешения → Микрофон"); }
        });}

        @JavascriptInterface public void speak(String text,float rate,float volume,String voiceName){runOnUiThread(()->{
            if(!speechReady){notice("Для озвучки установите русский голос в настройках синтеза речи Android");return;}
            if(voiceName!=null&&!voiceName.isEmpty()&&tts.getVoices()!=null)for(Voice voice:tts.getVoices())if(voice.getName().equals(voiceName)&&!voice.isNetworkConnectionRequired()){tts.setVoice(voice);break;}
            tts.setSpeechRate(Math.max(0.5f,Math.min(1.2f,rate)));
            Bundle params=new Bundle();params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,Math.max(0f,Math.min(1f,volume)));
            tts.speak(text,TextToSpeech.QUEUE_FLUSH,params,"moy-mir");
        });}
        @JavascriptInterface public void stop(){runOnUiThread(()->{if(tts!=null)tts.stop();});}
        @JavascriptInterface public String getVoices(){
            JSONArray result=new JSONArray();
            if(speechReady&&tts.getVoices()!=null)for(Voice voice:tts.getVoices())if(voice.getLocale().getLanguage().equals("ru")&&!voice.isNetworkConnectionRequired()){
                try{JSONObject item=new JSONObject();item.put("name",voice.getName());item.put("voiceURI",voice.getName());item.put("lang",voice.getLocale().toLanguageTag());item.put("localService",true);result.put(item);}catch(Exception ignored){}
            }
            return result.toString();
        }
        @JavascriptInterface public void saveBackup(String json){
            if(json==null||json.length()>15_000_000)return;
            runOnUiThread(()->{pendingBackup=json;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/json");intent.putExtra(Intent.EXTRA_TITLE,"moy-mir-backup.json");try{startActivityForResult(intent,SAVE_BACKUP);}catch(Exception ex){pendingBackup=null;notice("Не удалось открыть сохранение файла");}});
        }
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==RECORD_PERMISSION){
            boolean granted=grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED;
            if(pendingMicrophone!=null){if(granted)pendingMicrophone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else pendingMicrophone.deny();pendingMicrophone=null;}
            if(pendingNameRecording){pendingNameRecording=false;if(granted)startNameRecording();else nameRecordingResult("denied", "");}
        }
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==PICK_FILE&&fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));fileCallback=null;}
        if(requestCode==SAVE_BACKUP){
            if(resultCode==RESULT_OK&&data!=null&&data.getData()!=null&&pendingBackup!=null){
                try(OutputStream output=getContentResolver().openOutputStream(data.getData())){if(output==null)throw new java.io.IOException("No output");output.write(pendingBackup.getBytes(StandardCharsets.UTF_8));notice("Резервная копия сохранена");}
                catch(Exception ex){notice("Не удалось сохранить резервную копию");}
            }
            pendingBackup=null;
        }
    }
    @Override public void onBackPressed(){web.evaluateJavascript("(()=>{if(document.querySelector('#modal').innerHTML){closeModal();return}if(typeof route!=='undefined'&&route!=='home'){navigate('home');return}MoyMirNative.stop()})()",null);}
    @Override protected void onPause(){super.onPause();if(nameRecorder!=null)finishNameRecording(true);if(tts!=null)tts.stop();web.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){destroying=true;finishNameRecording(false);if(fileCallback!=null)fileCallback.onReceiveValue(null);if(pendingMicrophone!=null)pendingMicrophone.deny();if(tts!=null){tts.stop();tts.shutdown();}web.removeJavascriptInterface("MoyMirNative");web.destroy();super.onDestroy();}
}
