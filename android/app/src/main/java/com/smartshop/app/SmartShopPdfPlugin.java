package com.smartshop.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "SmartShopPdf")
public class SmartShopPdfPlugin extends Plugin {
    private static final String TEMP_PREFIX = "smartshop-pdf-";
    private static final int MAX_BASE64_LENGTH = 24_000_000;

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String base64 = call.getString("base64");
        if (filename == null || !filename.matches("[A-Za-z0-9_-]{1,110}\\.pdf") || base64 == null || !base64.startsWith("JVBERi0")) {
            call.reject("The PDF file could not be prepared.");
            return;
        }
        if (base64.length() > MAX_BASE64_LENGTH) {
            call.reject("This PDF is too large to save on the phone. Try a shorter date range.");
            return;
        }
        File pending = null;
        try {
            pending = File.createTempFile(TEMP_PREFIX, ".pdf", getContext().getCacheDir());
            try (FileOutputStream output = new FileOutputStream(pending)) {
                output.write(Base64.decode(base64, Base64.DEFAULT));
            }
        } catch (IOException | IllegalArgumentException error) {
            if (pending != null) pending.delete();
            call.reject("The PDF could not be prepared for saving.", error);
            return;
        }
        // The activity may be recreated while the picker is open. Persist the cache name only.
        call.getData().remove("base64");
        call.getData().put("pendingPdf", pending.getName());
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        try {
            startActivityForResult(call, intent, "saveSelectedFile");
        } catch (android.content.ActivityNotFoundException error) {
            pending.delete();
            call.reject("The phone has no file picker that can save this PDF.", error);
        }
    }

    @ActivityCallback
    private void saveSelectedFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String pendingName = call.getString("pendingPdf");
        if (pendingName == null || !pendingName.matches(TEMP_PREFIX + "[0-9]+\\.pdf")) {
            call.reject("The PDF could not be prepared for saving.");
            return;
        }
        File pending = new File(getContext().getCacheDir(), pendingName);
        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null) {
            pending.delete();
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        bridge.execute(() -> {
            try (FileInputStream input = new FileInputStream(pending);
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("The selected file could not be opened.");
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            } catch (IOException | IllegalArgumentException | SecurityException error) {
                call.reject("The PDF could not be saved in that folder.", error);
                return;
            } finally {
                pending.delete();
            }
            call.resolve(new JSObject().put("saved", true));
        });
    }
}
