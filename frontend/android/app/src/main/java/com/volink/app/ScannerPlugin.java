package com.volink.app;

import android.app.Activity;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 종이 확인서 스캔하기 (2026-11-12): Google's document scanner (ML Kit through Google Play services — no key, nothing sent
 * by Volink). It shows its own camera screen, finds the paper's edges, takes the picture by itself and flattens it; one page
 * comes back as a JPEG (base64) for the 확인서 reader in the app. CANCELED when the person closes it; any other error lets the
 * app fall back to the plain camera.
 */
@CapacitorPlugin(name = "VolinkScanner")
public class ScannerPlugin extends Plugin {
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall pending;

    @Override
    public void load() {
        // Registered while the activity is being created (Capacitor loads plugins in onCreate).
        launcher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = pending;
            pending = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("closed", "CANCELED"); return; }
            GmsDocumentScanningResult scan = GmsDocumentScanningResult.fromActivityResultIntent(result.getData());
            if (scan == null || scan.getPages() == null || scan.getPages().isEmpty()) { call.reject("no page", "NO_PAGE"); return; }
            Uri uri = scan.getPages().get(0).getImageUri();
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) { call.reject("no image", "NO_PAGE"); return; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                JSObject ret = new JSObject();
                ret.put("jpeg", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception error) {
                call.reject("could not read the page", "READ_FAILED");
            }
        });
    }

    @PluginMethod
    public void scan(PluginCall call) {
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(false)
                .setPageLimit(1)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build();
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        scanner.getStartScanIntent(getActivity())
                .addOnSuccessListener(sender -> {
                    pending = call;
                    launcher.launch(new IntentSenderRequest.Builder(sender).build());
                })
                .addOnFailureListener(error -> call.reject("scanner unavailable", "UNAVAILABLE"));
    }
}
