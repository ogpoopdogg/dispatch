package com.ec.pastepad;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.util.Date;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * PastePad: a tiny, fast plain-text editor.
 * Paste text, then one tap saves it into the phone's Downloads folder as .txt or .json.
 * The text is also kept automatically, so closing the app never loses it.
 */
public class MainActivity extends Activity {

    private static final int REQ_OPEN = 1;
    private static final int REQ_PERM = 2;

    private static final int BG = 0xFF0D1117;
    private static final int PANEL = 0xFF161B22;
    private static final int LINE = 0xFF30363D;
    private static final int TEXT = 0xFFE6EDF3;
    private static final int MUTED = 0xFF8B949E;
    private static final int BLUE = 0xFF1F6FEB;
    private static final int GREEN = 0xFF238636;
    private static final int GREY = 0xFF30363D;
    private static final int RED = 0xFF8E1519;

    private EditText editor;
    private EditText nameBox;
    private TextView stats;
    private TextView status;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable autosave = this::saveDraft;
    private final Runnable recount = this::updateStats;

    private String undoText;          // text before the last Clear / Paste+Save
    private String lastSavedName;     // e.g. "rules.txt", used by tapping the status line
    private Runnable afterPermission; // save waiting for the storage permission (Android 9 and older)

    // ---------------------------------------------------------------- setup

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(PANEL);
        getWindow().setNavigationBarColor(PANEL);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        // Top bar: file name + size
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackgroundColor(PANEL);
        top.setPadding(dp(12), dp(4), dp(12), dp(4));

        TextView label = new TextView(this);
        label.setText("Name");
        label.setTextColor(MUTED);
        label.setTextSize(13);
        top.addView(label);

        nameBox = new EditText(this);
        nameBox.setSingleLine(true);
        nameBox.setTextColor(TEXT);
        nameBox.setHintTextColor(MUTED);
        nameBox.setHint("rules");
        nameBox.setTextSize(15);
        nameBox.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        nameBox.setImeOptions(EditorInfo.IME_ACTION_DONE);
        nameBox.setBackground(box(BG, LINE));
        nameBox.setPadding(dp(10), dp(6), dp(10), dp(6));
        LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(0, dp(40), 1f);
        nlp.setMargins(dp(8), 0, dp(10), 0);
        top.addView(nameBox, nlp);

        stats = new TextView(this);
        stats.setTextColor(MUTED);
        stats.setTextSize(12);
        stats.setGravity(Gravity.END);
        top.addView(stats);

        root.addView(top, new LinearLayout.LayoutParams(-1, dp(52)));

        // The editor
        editor = new EditText(this);
        editor.setGravity(Gravity.TOP | Gravity.START);
        editor.setTypeface(Typeface.MONOSPACE);
        editor.setTextSize(13);
        editor.setTextColor(TEXT);
        editor.setHintTextColor(MUTED);
        editor.setHint("Paste here, or tap \"Paste + Save .txt\" below.");
        editor.setBackgroundColor(BG);
        editor.setPadding(dp(12), dp(10), dp(12), dp(10));
        editor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        editor.setHorizontallyScrolling(false);
        editor.setVerticalScrollBarEnabled(true);
        if (Build.VERSION.SDK_INT >= 26) editor.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        root.addView(editor, new LinearLayout.LayoutParams(-1, 0, 1f));

        // Status line (tap: undo, or share the last saved file)
        status = new TextView(this);
        status.setTextColor(MUTED);
        status.setTextSize(12);
        status.setBackgroundColor(PANEL);
        status.setPadding(dp(12), dp(6), dp(12), dp(6));
        status.setSingleLine(true);
        status.setOnClickListener(v -> onStatusTap());
        root.addView(status, new LinearLayout.LayoutParams(-1, -2));

        // Quick buttons, at the bottom so a thumb can reach them
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setBackgroundColor(PANEL);
        bar.setPadding(dp(8), dp(2), dp(8), dp(8));

        LinearLayout row1 = row();
        row1.addView(button("Paste + Save .txt", BLUE, v -> pasteAndSave()), weight(1.4f));
        row1.addView(button("Save .txt", GREEN, v -> save("txt")), weight(1f));
        bar.addView(row1);

        LinearLayout row2 = row();
        row2.addView(button("Save .json", GREEN, v -> saveJson()), weight(1.2f));
        row2.addView(button("Share", GREY, v -> share()), weight(1f));
        row2.addView(button("Copy", GREY, v -> copyAll()), weight(1f));
        row2.addView(button("Open", GREY, v -> openFile()), weight(1f));
        row2.addView(button("Clear", RED, v -> clearAll()), weight(1f));
        bar.addView(row2);

        root.addView(bar, new LinearLayout.LayoutParams(-1, -2));
        setContentView(root);

        // Restore last session
        SharedPreferences p = prefs();
        nameBox.setText(p.getString("name", "rules"));
        editor.setText(readDraft());
        editor.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable s) {
                ui.removeCallbacks(autosave);
                ui.postDelayed(autosave, 700);
                ui.removeCallbacks(recount);
                ui.postDelayed(recount, 250);
            }
        });
        updateStats();
        setStatus("Your text is kept automatically. Saved files go to Downloads.");

        handleIncoming(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIncoming(intent);
    }

    @Override
    protected void onPause() {
        super.onPause();
        saveDraft();
    }

    // -------------------------------------------------------------- actions

    private void pasteAndSave() {
        String clip = clipboardText();
        if (clip == null || clip.isEmpty()) {
            toast("The clipboard is empty. Copy your text first.");
            return;
        }
        String old = editor.getText().toString();
        if (!old.isEmpty() && !old.equals(clip)) undoText = old;
        editor.setText(clip);
        editor.setSelection(0);
        saveDraft();
        save("txt");
    }

    private void saveJson() {
        String text = editor.getText().toString();
        String problem = jsonProblem(text);
        if (problem == null) {
            save("json");
            return;
        }
        final int pos = problemPos;
        AlertDialog.Builder b = new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("This is not valid JSON")
                .setMessage(problem + "\n\nSave it anyway?")
                .setPositiveButton("Save anyway", (d, w) -> save("json"))
                .setNegativeButton("Cancel", null);
        if (pos >= 0) b.setNeutralButton("Show me", (d, w) -> jumpTo(pos));
        b.show();
    }

    /** One tap: keeps the text and writes the file into Downloads. */
    private void save(String ext) {
        String text = editor.getText().toString();
        if (text.isEmpty()) {
            toast("Nothing to save yet.");
            return;
        }
        String fileName = baseName() + "." + ext;
        String mime = ext.equals("json") ? "application/json" : "text/plain";

        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            afterPermission = () -> save(ext);
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
            return;
        }
        try {
            String finalName = writeToDownloads(fileName, mime, text.getBytes(StandardCharsets.UTF_8));
            lastSavedName = finalName;
            undoText = null;
            String time = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date());
            setStatus("Saved Downloads/" + finalName + " at " + time + ". Tap here to share it.");
            toast("Saved to Downloads/" + finalName);
        } catch (Exception e) {
            setStatus("Could not save: " + e.getMessage());
            toast("Could not save: " + e.getMessage());
        }
    }

    private void share() {
        String text = editor.getText().toString();
        if (text.isEmpty()) {
            toast("Nothing to share yet.");
            return;
        }
        String name = lastSavedName != null && lastSavedName.endsWith(".json")
                ? baseName() + ".json" : baseName() + ".txt";
        shareAs(name, text);
    }

    private void shareAs(String name, String text) {
        try {
            File dir = ShareProvider.dir(this);
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File f = new File(dir, name);
            try (OutputStream out = new FileOutputStream(f)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = ShareProvider.uriFor(name);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(name.endsWith(".json") ? "application/json" : "text/plain");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TITLE, name);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "Share " + name));
        } catch (Exception e) {
            toast("Could not share: " + e.getMessage());
        }
    }

    private void copyAll() {
        String text = editor.getText().toString();
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("PastePad", text));
        toast("Copied " + text.length() + " characters.");
    }

    private void openFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/*", "application/json", "application/octet-stream"});
        try {
            startActivityForResult(i, REQ_OPEN);
        } catch (Exception e) {
            toast("No file picker found on this phone.");
        }
    }

    private void clearAll() {
        String old = editor.getText().toString();
        if (old.isEmpty()) return;
        undoText = old;
        editor.setText("");
        setStatus("Cleared. Tap here to undo.");
    }

    private void onStatusTap() {
        if (undoText != null) {
            editor.setText(undoText);
            undoText = null;
            setStatus("Brought your text back.");
        } else if (lastSavedName != null) {
            shareAs(lastSavedName, editor.getText().toString());
        }
    }

    // --------------------------------------------------------- file helpers

    /** Writes into the public Downloads folder. Replaces the old copy this app made with the same name. */
    private String writeToDownloads(String fileName, String mime, byte[] data) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            Uri coll = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            try {
                cr.delete(coll, MediaStore.MediaColumns.DISPLAY_NAME + "=? AND "
                                + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                        new String[]{fileName, Environment.DIRECTORY_DOWNLOADS + "/"});
            } catch (Exception ignored) {
                // A file with this name that another app made: Android will pick "name (1).txt".
            }
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri item = cr.insert(coll, v);
            if (item == null) throw new Exception("Android would not create the file.");
            try (OutputStream out = cr.openOutputStream(item, "w")) {
                if (out == null) throw new Exception("Android would not open the file.");
                out.write(data);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(item, done, null, null);
            String real = fileName;
            try (android.database.Cursor c = cr.query(item,
                    new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) real = c.getString(0);
            } catch (Exception ignored) {
            }
            return real;
        } else {
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            dir.mkdirs();
            File f = new File(dir, fileName);
            try (OutputStream out = new FileOutputStream(f, false)) {
                out.write(data);
            }
            MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
            return fileName;
        }
    }

    private String readUri(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("could not open the file");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) > 0) {
                buf.write(chunk, 0, n);
                if (buf.size() > 20 * 1024 * 1024) throw new Exception("file is bigger than 20 MB");
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor c = getContentResolver().query(uri,
                new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
        }
        return null;
    }

    private void loadUri(Uri uri) {
        try {
            String text = readUri(uri);
            String old = editor.getText().toString();
            if (!old.isEmpty()) undoText = old;
            editor.setText(text);
            editor.setSelection(0);
            String name = displayName(uri);
            if (name != null) {
                int dot = name.lastIndexOf('.');
                nameBox.setText(dot > 0 ? name.substring(0, dot) : name);
            }
            saveDraft();
            setStatus("Opened " + (name != null ? name : "file") + (undoText != null ? ". Tap here to undo." : "."));
        } catch (Exception e) {
            toast("Could not open: " + e.getMessage());
        }
    }

    private void handleIncoming(Intent i) {
        if (i == null) return;
        String action = i.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            String t = i.getStringExtra(Intent.EXTRA_TEXT);
            Uri stream = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (t != null) {
                String old = editor.getText().toString();
                if (!old.isEmpty()) undoText = old;
                editor.setText(t);
                saveDraft();
                setStatus("Got shared text" + (undoText != null ? ". Tap here to undo." : "."));
            } else if (stream != null) {
                loadUri(stream);
            }
        } else if (Intent.ACTION_VIEW.equals(action) && i.getData() != null) {
            loadUri(i.getData());
        }
        i.setAction(null); // don't load it again after a screen rotation
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_OPEN && result == RESULT_OK && data != null && data.getData() != null) {
            loadUri(data.getData());
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] grants) {
        if (req == REQ_PERM) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED && afterPermission != null) {
                afterPermission.run();
            } else {
                toast("PastePad needs storage permission to save into Downloads.");
            }
            afterPermission = null;
        }
    }

    // ------------------------------------------------------- draft + stats

    private SharedPreferences prefs() {
        return getSharedPreferences("pastepad", MODE_PRIVATE);
    }

    private File draftFile() {
        return new File(getFilesDir(), "draft.txt");
    }

    private void saveDraft() {
        if (editor == null) return;
        ui.removeCallbacks(autosave);
        try (OutputStream out = new FileOutputStream(draftFile(), false)) {
            out.write(editor.getText().toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
        prefs().edit().putString("name", nameBox.getText().toString()).apply();
    }

    private String readDraft() {
        File f = draftFile();
        if (!f.isFile()) return "";
        try {
            return readUri(Uri.fromFile(f));
        } catch (Exception e) {
            return "";
        }
    }

    private void updateStats() {
        CharSequence t = editor.getText();
        int lines = t.length() == 0 ? 0 : 1;
        for (int i = 0; i < t.length(); i++) if (t.charAt(i) == '\n') lines++;
        int bytes = t.toString().getBytes(StandardCharsets.UTF_8).length;
        String size = bytes < 1024 ? bytes + " B" : String.format(java.util.Locale.US, "%.1f KB", bytes / 1024f);
        stats.setText(String.format(java.util.Locale.US, "%,d lines\n%s", lines, size));
    }

    // --------------------------------------------------------------- JSON

    private int problemPos = -1;
    private static final Pattern AT_CHAR = Pattern.compile("at character (\\d+)");

    /** Returns null when the text is valid JSON, otherwise a short, readable reason. */
    private String jsonProblem(String text) {
        problemPos = -1;
        try {
            JSONTokener tok = new JSONTokener(text);
            Object v = tok.nextValue();
            if (!(v instanceof org.json.JSONObject) && !(v instanceof org.json.JSONArray)) {
                return "It should start with { or [.";
            }
            if (tok.more()) {
                char c = tok.nextClean();
                if (c != 0) return "There is extra text after the last closing bracket.";
            }
            return null;
        } catch (JSONException e) {
            String msg = e.getMessage() == null ? "Unknown problem" : e.getMessage();
            int of = msg.indexOf(" of ");
            if (of > 0) msg = msg.substring(0, of); // Android puts the whole text after " of "
            Matcher m = AT_CHAR.matcher(msg);
            if (m.find()) {
                try {
                    problemPos = Math.min(Integer.parseInt(m.group(1)), text.length());
                    msg = msg.substring(0, m.start()).trim() + " (line " + lineOf(text, problemPos) + ").";
                } catch (NumberFormatException ignored) {
                }
            }
            return msg;
        }
    }

    private static int lineOf(String text, int pos) {
        int line = 1;
        for (int i = 0; i < pos && i < text.length(); i++) if (text.charAt(i) == '\n') line++;
        return line;
    }

    private void jumpTo(int pos) {
        editor.requestFocus();
        editor.setSelection(Math.max(0, Math.min(pos, editor.length())));
    }

    // ---------------------------------------------------------------- misc

    private String clipboardText() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) return null;
        ClipData c = cm.getPrimaryClip();
        if (c == null || c.getItemCount() == 0) return null;
        CharSequence t = c.getItemAt(0).coerceToText(this);
        return t == null ? null : t.toString();
    }

    private String baseName() {
        String n = nameBox.getText().toString().trim();
        if (n.toLowerCase(java.util.Locale.US).endsWith(".txt") || n.toLowerCase(java.util.Locale.US).endsWith(".json")) {
            n = n.substring(0, n.lastIndexOf('.'));
        }
        n = n.replaceAll("[\\\\/:*?\"<>|\\n\\r\\t]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.isEmpty()) n = "rules";
        return n;
    }

    private void setStatus(String s) {
        status.setText(s);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private GradientDrawable box(int fill, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(8));
        if (stroke != 0) g.setStroke(dp(1), stroke);
        return g;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(0, dp(6), 0, 0);
        return r;
    }

    private LinearLayout.LayoutParams weight(float w) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(46), w);
        lp.setMargins(dp(3), 0, dp(3), 0);
        return lp;
    }

    private Button button(String text, int color, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(14);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setSingleLine(true);
        b.setPadding(dp(4), 0, dp(4), 0);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setStateListAnimator(null);
        b.setBackground(new android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(0x33FFFFFF), box(color, 0), null));
        b.setOnClickListener(click);
        return b;
    }
}
